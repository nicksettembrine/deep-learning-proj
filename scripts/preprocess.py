"""Prepare one set of display files per recording and a catalog for the viewer.

Run with: python3 scripts/preprocess.py
Add recordings to scripts/recordings.json after downloading their three raw files.
Raw inputs are read only; acceleration averaging is for visualization, not training.
"""

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd
from scipy.io import loadmat

# Resolve paths relative to the project so the script works from any directory.
PROJECT = Path(__file__).resolve().parents[1]
OUTPUT = PROJECT / "public" / "data"


def prepare_recording(recording):
    """Keep each night's signals aligned to its own EEG recording start."""
    raw = PROJECT / recording["rawDirectory"]
    participant = recording["participant"]
    night = recording["night"]
    destination = OUTPUT / participant / str(night)
    destination.mkdir(parents=True, exist_ok=True)

    labels = loadmat(raw / "labels.mat")
    # recStart is stored in U.S. Eastern time; Unix timestamps in the wearable
    # files are absolute. This conversion preserves the original alignment rule.
    start = datetime.strptime(labels["recStart"][0], "%Y-%m-%d %H:%M:%S")
    start_unix = start.replace(tzinfo=ZoneInfo("America/New_York")).timestamp()

    # Each expert-reviewed label describes a 30-second epoch. Keep categorical
    # codes unchanged, including 5 (Unknown) when present in other recordings.
    sleep = [
        {"ElapsedSeconds": 30 * i, "Stage": int(stage)}
        for i, stage in enumerate(labels["expert_label"].flatten())
    ]
    (destination / "sleep_stages.json").write_text(json.dumps(sleep))

    # Heart rate has no CSV header. Retain every measurement and negative times
    # for samples collected before the EEG recording began.
    hr = pd.read_csv(raw / "hr.csv", header=None, names=["Timestamp", "HR"])
    hr["ElapsedSeconds"] = hr["Timestamp"] - start_unix
    hr.to_json(destination / "hr.json", orient="records")

    # Preserve the original magnitude calculation and one-second bin averages.
    # Process one night at a time so memory does not grow with the whole dataset.
    motion = pd.read_csv(raw / "motion.csv")
    motion["magnitude"] = np.sqrt(
        motion["x"]**2 + motion["y"]**2 + motion["z"]**2
    )
    motion["ElapsedSeconds"] = motion["Timestamp"] - start_unix
    motion["ElapsedSecondBin"] = np.floor(motion["ElapsedSeconds"]).astype(int)
    viewer_motion = (
        motion.groupby("ElapsedSecondBin")["magnitude"]
        .mean().reset_index()
        .rename(columns={"ElapsedSecondBin": "ElapsedSeconds"})
    )
    viewer_motion.to_json(destination / "motion.json", orient="records")
    print(f"Prepared {participant}, night {night}")

    # Public paths contain only prepared data; raw folder names stay local.
    return {
        "id": f"{participant}-night-{night}",
        "participant": participant,
        "night": night,
        "path": f"data/{participant}/{night}",
        "source": f"https://physionet.org/content/bidsleep-dataset/1.0.0/{participant}/{night}/",
    }


def main():
    recordings = json.loads((PROJECT / "scripts/recordings.json").read_text())
    # Fail before processing if a configured input is missing. Publish the catalog
    # only after all recordings succeed, avoiding links to incomplete exports.
    for recording in recordings:
        for filename in ("hr.csv", "motion.csv", "labels.mat"):
            path = PROJECT / recording["rawDirectory"] / filename
            if not path.is_file():
                raise FileNotFoundError(f"Missing recording input: {path}")
    catalog = [prepare_recording(recording) for recording in recordings]
    temporary = OUTPUT / "recordings.json.tmp"
    temporary.write_text(json.dumps(catalog, indent=2) + "\n")
    temporary.replace(OUTPUT / "recordings.json")


if __name__ == "__main__":
    main()
