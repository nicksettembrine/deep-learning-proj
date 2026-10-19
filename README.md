# Accelerometry Activity Viewer

A web app for viewing and annotating wrist, hip, and ankle accelerometry, with a neural
network that classifies 4-second windows of the left-wrist signal as walking, descending
stairs, ascending stairs, or driving. The repository includes the trained model and five
test participants, so the dataset does not need to be downloaded.

## Data

Raw x, y, and z acceleration at 100 Hz from 32 healthy adults wearing four ActiGraph
sensors during walking, stair climbing, and driving. Every sample has an activity label.

## Features

The Data Viewer shows each participant's signals and activity labels. Run model adds the
network's predictions below the true labels. The Model tab shows how the model was trained
and how well it performs. The Train tab covers both optional challenges: you can change the
network's settings, retrain it, and watch loss and accuracy update during training.

Annotation is implemented. Users can label, edit, and delete time intervals.
A backend and database are implemented. FastAPI with SQLite stores annotations and serves
predictions and training.

## Model

A multilayer perceptron (1,200 → 64 → 64 → 4, ReLU) trained on raw wrist windows with
class-weighted cross-entropy and Adam. The data are split by participant. On five held-out
participants the error rate is 10.3%, compared with 14.8% for a logistic regression baseline.

## Running the app

Requires Node.js 22.12+ and Python 3.12+. From the project folder:

```sh
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
```

Start the backend and the frontend in two terminals, then open the address Vite prints:

```sh
.venv/bin/python -m uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

```sh
npm run dev
```

To retrain the model, run `.venv/bin/python -m training.train`.

## Libraries

React, Vite, Plotly, FastAPI, SQLite, PyTorch, NumPy, pandas, scikit-learn, and matplotlib.

## Data source

Karas, M., Urbanek, J., Crainiceanu, C., Harezlak, J., & Fadel, W. (2021).
[Labeled raw accelerometry data captured during walking, stair climbing and driving](https://physionet.org/content/accelerometry-walk-climb-drive/1.0.0/)
(version 1.0.0). PhysioNet. https://doi.org/10.13026/51h0-a262. Used under the
[Open Database License v1.0](https://physionet.org/content/accelerometry-walk-climb-drive/view-license/1.0.0/).

## AI use

Homework 1 was built with help from Codex. For Homework 2, I used Claude Code to help write
the model, training, backend, and interface code and this README. I made the design
decisions (task, input, data split, architecture, training, baseline, and app integration)
and reviewed the code and results.
