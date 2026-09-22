# Sleep Signal Viewer

A web application for viewing and annotating overnight heart rate, wrist
acceleration, and EEG sleep-stage labels from the BIDSleep dataset. The included
demo uses a small downloaded subset of the full dataset: two participants with
two nights each. These sample recordings are included so the app can run without
downloading the full dataset. 

## Features

- Select a participant and night; zoom and pan through synchronized plots.
- Compare signals in stacked or overlay views, with selectable overlay signals.
- **Annotations:** select an interval, add a label and optional note, then save,
  edit, or delete it. Click a saved label to return to that interval.
- **Backend/database:** FastAPI stores annotations in SQLite. They persist after
  reloads and server restarts without changing the original EEG labels.

## Run locally

Requires Node.js 22.12+ and Python 3.12+. The commands below use macOS/Linux paths.
From the project folder:

```sh
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```

Start the backend and frontend in **two terminals**, both in the project folder:

```sh
# Terminal 1
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

```sh
# Terminal 2
npm run dev
```

Open the URL printed by Vite. Both servers must remain running to save annotations.
The sample files in `public/data/` are included; no raw-data download is needed.
SQLite creates `backend/data/annotations.sqlite3` on first startup. This local
file is excluded from Git; keep it to preserve your saved annotations.

## Libraries

React, Vite, Plotly/react-plotly.js, FastAPI, Pydantic, Uvicorn, and SQLite.
Optional preprocessing uses NumPy, pandas, and SciPy.

## Data source and license

Contains information from [BIDSleep on PhysioNet](https://physionet.org/content/bidsleep-dataset/1.0.0/),
under the [Open Data Commons Attribution License v1.0](https://physionet.org/content/bidsleep-dataset/view-license/1.0.0/).

Song, T. (2026). *A Multi-Night Instantaneous Heart Rate and Accelerometry Dataset
with EEG Sleep Stage Labels* (version 1.0.0). PhysioNet.
https://doi.org/10.13026/a0sy-7t69
