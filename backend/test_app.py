"""API tests use a temporary database, never the user's annotations."""
import tempfile
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from backend import app as backend


class AnnotationTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.previous = backend.DB_PATH
        backend.DB_PATH = Path(self.directory.name) / 'annotations.sqlite3'
        self.endpoint = '/api/recordings/Bidslab00-night-1/annotations'
        self.payload = dict(start_seconds=60, end_seconds=90, label='Review interval', note='Test only')

    def tearDown(self):
        backend.DB_PATH = self.previous
        self.directory.cleanup()

    def test_persistence_edit_isolation_and_delete(self):
        with TestClient(backend.app) as client:
            result = client.post(self.endpoint, json=self.payload)
            self.assertEqual(result.status_code, 201)
            annotation = result.json()
        # Reopening the application simulates restarting the backend on the same DB.
        with TestClient(backend.app) as client:
            self.assertEqual(client.get(self.endpoint).json(), [annotation])
            other = '/api/recordings/Bidslab01-night-1/annotations'
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


if __name__ == '__main__':
    unittest.main()
