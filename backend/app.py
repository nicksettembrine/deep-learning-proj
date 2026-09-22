"""Local annotation API. SQLite stores user notes separately from research data."""
from contextlib import asynccontextmanager, contextmanager
from functools import lru_cache
from pathlib import Path
import json
import os
import sqlite3

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

PROJECT = Path(__file__).resolve().parents[1]
# A configurable file path allows tests to use a temporary database.
DB_PATH = Path(os.environ.get("BIDSLEEP_DB", PROJECT / "backend/data/annotations.sqlite3"))


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


app = FastAPI(title="BIDSleep annotations", lifespan=lifespan)


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
    """Validate IDs against the catalog and allow the complete wearable window."""
    catalog = json.loads((PROJECT / "public/data/recordings.json").read_text())
    recording = next((r for r in catalog if r["id"] == recording_id), None)
    if recording is None:
        raise HTTPException(404, "Recording not found.")
    low, high = float("inf"), float("-inf")
    for name in ("hr.json", "motion.json", "sleep_stages.json"):
        rows = json.loads((PROJECT / "public" / recording["path"] / name).read_text())
        times = [row["ElapsedSeconds"] for row in rows]
        if times:
            low = min(low, min(times))
            # Sleep stages describe intervals, including the final 30-second epoch.
            high = max(high, max(times) + (30 if name == "sleep_stages.json" else 0))
    return low, high


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
