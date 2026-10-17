"""API tests use a temporary database and catalog, never the user's files."""
import json
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from backend import app as backend


class AnnotationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = backend.DB_PATH, backend.CATALOG_PATH
        backend.DB_PATH = Path(self.directory.name) / 'annotations.sqlite3'
        backend.CATALOG_PATH = Path(self.directory.name) / 'recordings.json'
        backend.CATALOG_PATH.write_text(json.dumps([
            {'id': 'subjA', 'duration_s': 2400.0}, {'id': 'subjB', 'duration_s': 1800.0}]))
        backend.recording_bounds.cache_clear()
        self.endpoint = '/api/recordings/subjA/annotations'
        self.payload = dict(start_seconds=60, end_seconds=90, label='Review interval', note='Test only')

    def tearDown(self):
        backend.DB_PATH, backend.CATALOG_PATH = self.previous
        backend.recording_bounds.cache_clear()
        self.directory.cleanup()

    def test_persistence_edit_isolation_and_delete(self):
        with TestClient(backend.app) as client:
            result = client.post(self.endpoint, json=self.payload)
            self.assertEqual(result.status_code, 201)
            annotation = result.json()
        # Reopening the application simulates restarting the backend on the same DB.
        with TestClient(backend.app) as client:
            self.assertEqual(client.get(self.endpoint).json(), [annotation])
            other = '/api/recordings/subjB/annotations'
            self.assertEqual(client.get(other).json(), [])
            self.assertEqual(client.delete(f'{other}/{annotation["id"]}').status_code, 404)
            self.assertEqual(client.put(f'{other}/{annotation["id"]}', json=self.payload).status_code, 404)
            changed = {**self.payload, 'label': 'Updated label', 'end_seconds': 120}
            self.assertEqual(client.put(f'{self.endpoint}/{annotation["id"]}', json=changed).status_code, 200)
            self.assertEqual(client.get(self.endpoint).json()[0]['end_seconds'], 120)
            self.assertEqual(client.delete(f'{self.endpoint}/{annotation["id"]}').status_code, 204)
            self.assertEqual(client.get(self.endpoint).json(), [])

    def test_validation(self):
        with TestClient(backend.app) as client:
            for change in ({'end_seconds': 60}, {'label': '   '}, {'label': 'x' * 101},
                           {'start_seconds': -1000000}, {'end_seconds': 1e9}, {'start_seconds': 'NaN'}):
                with self.subTest(change=change):
                    self.assertEqual(client.post(self.endpoint, json={**self.payload, **change}).status_code, 422)
            self.assertEqual(client.post('/api/recordings/unknown/annotations', json=self.payload).status_code, 404)
            self.assertEqual(client.get(self.endpoint).json(), [])


@unittest.skipUnless((backend.MODEL_DIR / 'mlp.pt').is_file(), 'Train the model first: python -m training.train')
class PredictTests(unittest.TestCase):
    """Uses the real catalog, trained model, and one stored test participant."""
    recording = 'id1c7e64ad'

    def test_predict_returns_one_prediction_per_window(self):
        import numpy as np
        signal = np.load(backend.SAMPLES_DIR / f'{self.recording}.npz')
        with TestClient(backend.app) as client:
            result = client.post(f'/api/recordings/{self.recording}/predict')
            self.assertEqual(result.status_code, 200)
            body = result.json()
            # Back-to-back 4-s windows cover the recording once.
            self.assertEqual(len(body['windows']), len(signal['xyz']) // 400)
            for window in body['windows']:
                self.assertAlmostEqual(sum(window['probs']), 1, places=3)
                self.assertIn(window['pred'], body['class_codes'])
            self.assertTrue(0 < body['scored_windows'] < len(body['windows']))
            self.assertTrue(0 <= body['accuracy'] <= 1)
            self.assertEqual(client.post('/api/recordings/unknown/predict').status_code, 404)


@unittest.skipUnless(backend.trainer.CACHE_PATH.is_file(), 'Needs training/cache/windows.npz')
class TrainingTests(unittest.TestCase):
    settings = dict(hidden_layers=1, units=16, activation='tanh', learning_rate=0.001, epochs=2, dropout=0.2)

    def test_train_use_and_reset(self):
        import time
        with TestClient(backend.app) as client:
            self.assertEqual(client.post('/api/train', json={**self.settings, 'epochs': 0}).status_code, 422)
            self.assertEqual(client.post('/api/train', json={**self.settings, 'activation': 'elu'}).status_code, 422)
            self.assertEqual(client.post('/api/train', json=self.settings).status_code, 202)
            for _ in range(300):                          # wait up to 60 s for the 2-epoch run
                state = client.get('/api/train').json()
                if state['status'] in ('done', 'stopped', 'error'):
                    break
                time.sleep(0.2)
            self.assertEqual(state['status'], 'done', state.get('error'))
            self.assertEqual(state['history']['epoch'], [1, 2])
            self.assertIn('test', state['scores'])
            # Run model switches to the experiment, then back to the saved model.
            self.assertEqual(client.post('/api/train/use').json()['active_model'], 'experiment')
            self.assertEqual(client.post(f'/api/recordings/{PredictTests.recording}/predict').json()['model'], 'experiment')
            self.assertEqual(client.post('/api/train/reset').json()['active_model'], 'saved')
            self.assertEqual(client.post(f'/api/recordings/{PredictTests.recording}/predict').json()['model'], 'saved')


if __name__ == '__main__':
    unittest.main()
