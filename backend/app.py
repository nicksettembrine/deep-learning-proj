"""Local annotation API. SQLite stores user notes separately from research data."""
from contextlib import asynccontextmanager, contextmanager
from functools import lru_cache
from pathlib import Path
import json
import os
import sqlite3

from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from backend import trainer

PROJECT = Path(__file__).resolve().parents[1]
# A configurable file path allows tests to use a temporary database.
DB_PATH = Path(os.environ.get("ACCEL_DB", PROJECT / "backend/data/annotations.sqlite3"))
CATALOG_PATH = PROJECT / "public/data/recordings.json"


@contextmanager
def database():
    """Open one connection per operation; commit writes and always close it."""
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            yield connection
    finally:
        connection.close()


@asynccontextmanager
async def lifespan(app):
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with database() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS annotations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recording_id TEXT NOT NULL,
            start_seconds REAL NOT NULL,
            end_seconds REAL NOT NULL CHECK(end_seconds > start_seconds),
            label TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
            updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        )""")
        db.execute("CREATE INDEX IF NOT EXISTS recording_annotations ON annotations(recording_id)")
    yield


app = FastAPI(title="Accelerometry Activity Viewer API", lifespan=lifespan)


class AnnotationInput(BaseModel):
    # Store seconds, not chart hours, to preserve meaningful interval precision.
    model_config = ConfigDict(str_strip_whitespace=True, allow_inf_nan=False, extra="forbid")
    start_seconds: float
    end_seconds: float
    label: str = Field(min_length=1, max_length=100)
    note: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def ordered_interval(self):
        if self.end_seconds <= self.start_seconds:
            raise ValueError("End time must be after start time.")
        return self


@lru_cache(maxsize=256)
def recording_bounds(recording_id):
    """Validate IDs against the catalog; sessions run from 0 to their duration in seconds."""
    catalog = json.loads(CATALOG_PATH.read_text())
    recording = next((r for r in catalog if r["id"] == recording_id), None)
    if recording is None:
        raise HTTPException(404, "Recording not found.")
    return 0.0, float(recording["duration_s"])


def validate_interval(recording_id, annotation):
    low, high = recording_bounds(recording_id)
    if annotation.start_seconds < low or annotation.end_seconds > high:
        raise HTTPException(422, "Annotation must stay within the recording's time range.")


@app.get("/api/recordings/{recording_id}/annotations")
def list_annotations(recording_id: str):
    recording_bounds(recording_id)
    with database() as db:
        return [dict(row) for row in db.execute(
            "SELECT * FROM annotations WHERE recording_id=? ORDER BY start_seconds, id",
            (recording_id,),
        )]


@app.post("/api/recordings/{recording_id}/annotations", status_code=201)
def create_annotation(recording_id: str, annotation: AnnotationInput):
    validate_interval(recording_id, annotation)
    with database() as db:
        cursor = db.execute(
            "INSERT INTO annotations(recording_id,start_seconds,end_seconds,label,note) VALUES(?,?,?,?,?)",
            (recording_id, annotation.start_seconds, annotation.end_seconds, annotation.label, annotation.note),
        )
        return dict(db.execute("SELECT * FROM annotations WHERE id=?", (cursor.lastrowid,)).fetchone())


@app.put("/api/recordings/{recording_id}/annotations/{annotation_id}")
def update_annotation(recording_id: str, annotation_id: int, annotation: AnnotationInput):
    validate_interval(recording_id, annotation)
    with database() as db:
        cursor = db.execute(
            """UPDATE annotations SET start_seconds=?, end_seconds=?, label=?, note=?,
            updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND recording_id=?""",
            (annotation.start_seconds, annotation.end_seconds, annotation.label, annotation.note,
             annotation_id, recording_id),
        )
        if not cursor.rowcount:
            raise HTTPException(404, "Annotation not found for this recording.")
        return dict(db.execute("SELECT * FROM annotations WHERE id=?", (annotation_id,)).fetchone())


@app.delete("/api/recordings/{recording_id}/annotations/{annotation_id}", status_code=204)
def delete_annotation(recording_id: str, annotation_id: int):
    recording_bounds(recording_id)
    with database() as db:
        cursor = db.execute("DELETE FROM annotations WHERE id=? AND recording_id=?", (annotation_id, recording_id))
        if not cursor.rowcount:
            raise HTTPException(404, "Annotation not found for this recording.")


# ---------------------------------------------------------------------------
# HW2: neural-network predictions. Model files come from `python -m training.train`.
# ---------------------------------------------------------------------------
MODEL_DIR = PROJECT / "backend" / "model"
SAMPLES_DIR = PROJECT / "backend" / "samples"


@lru_cache(maxsize=1)
def model_bundle():
    """Load the trained MLP once; later requests reuse it."""
    path = MODEL_DIR / "mlp.pt"
    if not path.is_file():
        raise HTTPException(503, "No trained model found. Run: python -m training.train")
    from training.model import load_model   # imported lazily so annotation-only use needs no torch
    return load_model(path)


@app.get("/api/model")
def model_info():
    """Training history and metrics shown in the Model tab, plus per-person test scores."""
    path = MODEL_DIR / "metrics.json"
    if not path.is_file():
        raise HTTPException(503, "No trained model found. Run: python -m training.train")
    return {**json.loads(path.read_text()), "per_person": per_person_scores()}


@lru_cache(maxsize=1)
def per_person_scores():
    """Agreement for each test participant in the viewer, computed exactly as the Data Viewer does."""
    catalog = json.loads(CATALOG_PATH.read_text())
    rows = []
    for recording in catalog:
        if recording.get("split") != "test":
            continue
        result = predict_recording(recording["id"], use_saved=True)
        rows.append({"id": recording["id"], "scored_windows": result["scored_windows"],
                     "correct": result["correct"], "accuracy": result["accuracy"]})
    return rows


@app.post("/api/recordings/{recording_id}/predict")
def predict(recording_id: str):
    """Run model button: uses the saved model, or the Train-tab experiment if one is in use."""
    return predict_recording(recording_id)


def predict_recording(recording_id, use_saved=False):
    """Classify every back-to-back (non-overlapping) 4-second left-wrist window of one recording.

    Uses the same window cutting and scaling as training (training/data.py), with the
    training-set mean and standard deviation stored in the model file.
    """
    import numpy as np
    import torch
    from training.data import CLASS_CODES, CLASSES, WINDOW, make_windows, scale_and_flatten

    recording_bounds(recording_id)  # 404 for unknown recordings
    sample = SAMPLES_DIR / f"{recording_id}.npz"
    if not sample.is_file():
        raise HTTPException(404, "No wrist signal stored for this recording. Re-run scripts/preprocess.py.")
    data = np.load(sample)
    xyz, activity, fs = data["xyz"], data["activity"], int(data["fs"])

    experiment = None if use_saved else trainer.active_experiment()
    if experiment:
        model, mean, std = experiment
    else:
        model, checkpoint = model_bundle()
        mean, std = checkpoint["mean"], checkpoint["std"]
    windows, _, starts = make_windows(xyz, step=WINDOW)              # step = 400: no overlap
    inputs = scale_and_flatten(windows, mean, std)
    with torch.no_grad():
        probs = torch.softmax(model(torch.from_numpy(inputs)), dim=1).numpy()   # logits -> probabilities

    results, correct, scored = [], 0, 0
    for start, p in zip(starts, probs):
        labels = activity[start:start + WINDOW]
        # A window has a single true class only if all its samples share one studied activity.
        true = int(labels[0]) if (labels == labels[0]).all() and labels[0] in CLASS_CODES else None
        pred = CLASS_CODES[int(p.argmax())]
        if true is not None:
            scored += 1
            correct += int(pred == true)
        results.append({"start": round(start / fs, 2), "end": round((start + WINDOW) / fs, 2),
                        "pred": pred, "true": true, "probs": [round(float(v), 4) for v in p]})
    return {"classes": [CLASSES[c] for c in CLASS_CODES], "class_codes": CLASS_CODES,
            "model": "experiment" if experiment else "saved",
            "windows": results, "scored_windows": scored, "correct": correct,
            "accuracy": round(correct / scored, 4) if scored else None}


# ---------------------------------------------------------------------------
# HW2 optional challenges: interactive training with a live training monitor.
# ---------------------------------------------------------------------------
class TrainSettings(BaseModel):
    """Settings the Train tab can change; everything else matches the saved model."""
    model_config = ConfigDict(extra="forbid")
    hidden_layers: int = Field(ge=0, le=3)          # 0 = logistic regression
    units: int = Field(ge=16, le=256)
    activation: Literal["relu", "tanh", "sigmoid"]
    learning_rate: float = Field(gt=0, le=0.1)
    epochs: int = Field(ge=1, le=200)
    dropout: float = Field(ge=0, le=0.8)


@app.get("/api/train")
def training_status():
    """Polled by the Train tab about twice a second for the live curve and final scores."""
    return trainer.snapshot()


@app.post("/api/train", status_code=202)
def start_training(settings: TrainSettings):
    if not trainer.CACHE_PATH.is_file():
        raise HTTPException(503, "Training data not found: training/cache/windows.npz. "
                                 "Download the dataset and run python -m training.train --rebuild.")
    if not trainer.start(settings.model_dump()):
        raise HTTPException(409, "A training run is already in progress.")
    return trainer.snapshot()


@app.post("/api/train/stop")
def stop_training():
    trainer.stop()
    return trainer.snapshot()


@app.post("/api/train/use")
def use_trained_model():
    """Make the finished experiment the model behind Run model."""
    if not trainer.use_experiment():
        raise HTTPException(409, "Finish a training run first.")
    return trainer.snapshot()


@app.post("/api/train/reset")
def reset_model():
    """Return Run model to the saved model in backend/model/."""
    trainer.reset()
    return trainer.snapshot()
