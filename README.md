# Sleep Signal Viewer

An interactive React/Plotly viewer for time-aligned wearable heart rate,
acceleration magnitude, and expert-reviewed EEG sleep stages.

## Setup and run locally

Install Node.js 22.12 or newer (with npm) and Python 3.12 or newer.
From the project folder, install the dependencies:

```sh
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```

Run the backend and frontend in **two terminals**, both in this project folder:

```sh
# Terminal 1: local FastAPI server (leave running)
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

```sh
# Terminal 2: React/Vite viewer (leave running)
npm run dev
```

Open the local URL Vite prints. Vite forwards `/api` requests to port 8000.
API documentation is available at http://127.0.0.1:8000/docs.
This setup runs locally; it is not a public multi-user deployment.

The prepared sample JSON files in `public/data/` are sufficient to run the viewer.
Raw CSV/MAT files and Python preprocessing packages are only needed to regenerate
those exports. Keep large raw data out of the source-code submission.

## Implemented features

- Participant/night selection with synchronized heart rate, acceleration, and
  expert sleep-stage plots; loading/error messages and retry controls.
- Zoom/pan, stacked or overlay views, selectable overlay signals, and hover units.
- **Annotation: implemented.** Click Add annotation, drag horizontally across any
  plot (or enter times in seconds), add a label and optional note, and save.
- Saved intervals are shaded. Click a label in the annotation list to zoom to it.
  Edit changes the interval/label/note; Delete requires an inline confirmation.
- **Backend/database: implemented.** FastAPI reads/writes a SQLite database at
  `backend/data/annotations.sqlite3`. Notes persist after page reloads and server
  restarts, and are scoped to each participant/night. This file is git-ignored;
  preserve it if you want to keep your annotations. It is created on first start.
- User annotations never replace expert labels or modify source signal files.

Major libraries: React, Vite, Plotly/react-plotly.js, FastAPI, Pydantic, Uvicorn,
and Python's built-in sqlite3. Preprocessing uses NumPy, pandas, and SciPy.
Docker is not required for this local implementation.

## Annotation architecture

`src/useAnnotations.js` manages requests and edit state;
`src/AnnotationPanel.jsx` supplies the form and list;
`src/App.jsx` connects selection events, shaded intervals, and zoom-to-label.
`backend/app.py` validates recording IDs and time bounds, then executes
parameterized SQLite queries. Times are stored as seconds from EEG start and
converted to hours only when drawing the chart.

Endpoints under `/api/recordings/{recording_id}/annotations`:
GET lists, POST creates, PUT `/{id}` edits, DELETE `/{id}` deletes.

If the backend stops, signals remain viewable. Restart it and use Retry annotations.
Failed saves keep the form contents so you can retry without losing your note.

## Prepare recordings

```sh
python3 scripts/preprocess.py
```

Requires Python with numpy, pandas, and scipy. Paths are resolved relative to this
project, so the script can also be invoked from another working directory.

`scripts/recordings.json` is the input list. Each entry names the original
PhysioNet participant ID, night number, and local raw directory containing
`hr.csv`, `motion.csv`, and `labels.mat`. To add a recording, download those files,
add its entry, and rerun preprocessing. No changes to React are necessary.

The script writes three display files under `public/data/<participant>/<night>/`
and publishes `public/data/recordings.json` after all recordings finish.

### Scientific conventions

- All signals use elapsed seconds relative to that night's EEG recording start.
- `recStart` is interpreted in America/New_York; wearable timestamps are Unix time.
- Expert labels are preserved in 30-second epochs, including Unknown (code 5).
- Heart-rate measurements are preserved, including negative elapsed times.
- Acceleration magnitude is `sqrt(x² + y² + z²)`, averaged in one-second bins
  **for display only**. This does not define preprocessing for model training.
- Raw files are never modified by preprocessing.

### Provenance

The original local folder `data/patient-1/night1` is **Bidslab00 / Night 1**.
All three files were matched to the SHA-256 checksums in PhysioNet's version 1.0.0
`SHA256SUMS.txt`. The folder is retained to avoid moving the user's original data.
Other sample recordings are Bidslab00 / Night 2 and Bidslab01 / Nights 1 and 2.

The original flat JSON exports in `public/data/` are retained as a reference but
are no longer loaded by the viewer. Only the per-recording exports are used.

## Validation

```sh
npm run lint
npm run build
.venv/bin/python -m unittest backend.test_app
```

The backend tests use a temporary database. They cover persistence across app
restarts, edits/deletes, recording isolation, and invalid intervals/labels.

## Data source and license

Contains information from [BIDSleep on PhysioNet](https://physionet.org/content/bidsleep-dataset/1.0.0/),
made available under the [Open Data Commons Attribution License v1.0](https://physionet.org/content/bidsleep-dataset/view-license/1.0.0/).
Retain the source and license notices with redistributed prepared data.

Dataset citation: Song, T. (2026). A Multi-Night Instantaneous Heart Rate and
Accelerometry Dataset with EEG Sleep Stage Labels (version 1.0.0). PhysioNet.
https://doi.org/10.13026/a0sy-7t69

See the dataset page for its requested original-publication and PhysioNet citations.

### Viewer navigation

Use **Fit EEG window** to focus on the labeled EEG interval, or **Show full recording** to include all available wearable samples. The chart header displays the EEG-labeled duration. In Overlay mode, select the signals to compare; sleep stages appear as a categorical color strip when combined with wearable measurements. Heart rate and acceleration retain their original units and independent scales. Hover or focus a saved annotation to highlight its interval, and click its label to zoom to it. The **Overview** tab combines the project introduction and step-by-step instructions. **Data Viewer** opens by default. Tabs support arrow-key and Home/End navigation; switching tabs keeps the viewer mounted to preserve recording selection, plot settings, and unfinished annotations.
