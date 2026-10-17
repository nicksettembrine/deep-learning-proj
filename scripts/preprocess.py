"""Prepare display files for the viewer from the PhysioNet walk/climb/drive dataset.

Run with:  python3 scripts/preprocess.py            (publishes the test participants)
           python3 scripts/preprocess.py --all      (publishes all 32; keep local only)

Input:  data/physionet/**/raw_accelerometry_data/<subj_id>.csv  (100 Hz, 4 sensors)
        data/physionet/**/participant_demog.csv
Output: public/data/recordings.json             catalog shown in the participant menu
        public/data/<subj_id>/vm.json            vector magnitude per sensor, 25 Hz
        public/data/<subj_id>/xyz.json           x/y/z per sensor, 25 Hz (loaded on demand)
        public/data/<subj_id>/activity.json      labeled activity segments
        training/split.json                      participant-level train/val/test split
        backend/samples/<subj_id>.npz            raw 100 Hz left-wrist signal for /predict

Raw files are read only. Downsampling is for display; training uses the raw 100 Hz data.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT = Path(__file__).resolve().parents[1]
RAW_ROOT = PROJECT / "data" / "physionet"
OUTPUT = PROJECT / "public" / "data"
SPLIT_PATH = PROJECT / "training" / "split.json"
SAMPLES = PROJECT / "backend" / "samples"   # 100 Hz left-wrist arrays used by /predict

RAW_HZ = 100
DISPLAY_HZ = 25
FACTOR = RAW_HZ // DISPLAY_HZ  # average blocks of 4 raw samples
SENSORS = {"lw": "Left wrist", "lh": "Left hip", "la": "Left ankle", "ra": "Right ankle"}
ACTIVITIES = {1: "Walking", 2: "Descending stairs", 3: "Ascending stairs",
              4: "Driving", 77: "Clapping", 99: "Non-study"}
SPLIT_SEED = 7400       # course number; fixed so the split never changes between runs
N_TEST, N_VAL = 5, 5
SOURCE = "https://physionet.org/content/accelerometry-walk-climb-drive/1.0.0/"


def find_one(pattern):
    matches = sorted(RAW_ROOT.rglob(pattern))
    if not matches:
        raise FileNotFoundError(
            f"No '{pattern}' under {RAW_ROOT}. Unzip the PhysioNet download into data/physionet/.")
    return matches[0]


def make_split(subject_ids, demographics):
    """Split by participant so validation/test people are never seen in training.

    Stratified by sex (19 women, 13 men): val and test each get 3 women and 2 men,
    so neither held-out set is accidentally single-sex.
    """
    if SPLIT_PATH.is_file():
        split = json.loads(SPLIT_PATH.read_text())
        known = set(split["train"] + split["val"] + split["test"])
        if known == set(subject_ids) and split.get("stratified_by") == "sex":
            return split
    rng = np.random.default_rng(SPLIT_SEED)
    split = {"seed": SPLIT_SEED, "stratified_by": "sex", "test": [], "val": [], "train": []}
    for sex in sorted({demographics[s]["sex"] for s in subject_ids}):
        group = rng.permutation(sorted(s for s in subject_ids if demographics[s]["sex"] == sex)).tolist()
        n_test = round(N_TEST * len(group) / len(subject_ids))
        n_val = round(N_VAL * len(group) / len(subject_ids))
        split["test"] += group[:n_test]
        split["val"] += group[n_test:n_test + n_val]
        split["train"] += group[n_test + n_val:]
    for name in ("test", "val", "train"):
        split[name] = sorted(split[name])
    SPLIT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SPLIT_PATH.write_text(json.dumps(split, indent=2) + "\n")
    return split


def block_mean(values):
    """Average consecutive blocks of FACTOR samples (100 Hz -> 25 Hz)."""
    n = len(values) // FACTOR * FACTOR
    return values[:n].reshape(-1, FACTOR, *values.shape[1:]).mean(axis=1)


def activity_segments(codes):
    """Collapse the per-sample label column into [start, end) runs in seconds."""
    change = np.flatnonzero(np.diff(codes)) + 1
    starts = np.concatenate([[0], change])
    ends = np.concatenate([change, [len(codes)]])
    return [{"start": round(s / RAW_HZ, 2), "end": round(e / RAW_HZ, 2),
             "code": int(codes[s]), "label": ACTIVITIES.get(int(codes[s]), "Unknown")}
            for s, e in zip(starts, ends)]


def write_json(path, payload):
    path.write_text(json.dumps(payload, separators=(",", ":")))


def prepare_subject(csv_path, demographics, split_name):
    subject = csv_path.stem
    df = pd.read_csv(csv_path)
    destination = OUTPUT / subject
    destination.mkdir(parents=True, exist_ok=True)

    vm, xyz = {}, {}
    for key in SENSORS:
        axes = df[[f"{key}_x", f"{key}_y", f"{key}_z"]].to_numpy(dtype=np.float32)
        # Magnitude is computed at 100 Hz before averaging so short peaks are preserved.
        # Stored as integer milli-g (0.001 g, the device's precision) to keep files small.
        vm[key] = np.round(block_mean(np.linalg.norm(axes, axis=1)) * 1000).astype(int).tolist()
        down = np.round(block_mean(axes) * 1000).astype(int)
        xyz[key] = {"x": down[:, 0].tolist(), "y": down[:, 1].tolist(), "z": down[:, 2].tolist()}

    # Time is implicit: sample i is at i / fs seconds since the first sample.
    write_json(destination / "vm.json", {"fs": DISPLAY_HZ, "unit": "milli-g", "sensors": vm})
    write_json(destination / "xyz.json", {"fs": DISPLAY_HZ, "unit": "milli-g", "sensors": xyz})

    codes = df["activity"].to_numpy(dtype=int)
    # Full-rate left-wrist signal for the backend's /predict endpoint (~2–3 MB per person),
    # so the app can run the model without the raw CSVs.
    SAMPLES.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(SAMPLES / f"{subject}.npz",
                        xyz=df[["lw_x", "lw_y", "lw_z"]].to_numpy(dtype=np.float32),
                        activity=codes.astype(np.int16), fs=RAW_HZ)
    segments = activity_segments(codes)
    write_json(destination / "activity.json", segments)

    seconds = {label: 0.0 for label in ACTIVITIES.values()}
    for seg in segments:
        seconds[seg["label"]] = round(seconds.get(seg["label"], 0) + seg["end"] - seg["start"], 2)
    print(f"Prepared {subject} ({split_name}): {len(df) / RAW_HZ / 60:.1f} min")
    return {
        "id": subject,
        "participant": subject,
        "split": split_name,
        "path": f"data/{subject}",
        "duration_s": round(len(df) / RAW_HZ, 2),
        "demographics": demographics.get(subject, {}),
        "activity_seconds": seconds,
        "source": SOURCE,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--all", action="store_true",
                        help="Publish all participants (large; do not commit to Git).")
    args = parser.parse_args()

    raw_dir = find_one("raw_accelerometry_data")
    csvs = sorted(raw_dir.glob("*.csv"))
    demog = pd.read_csv(find_one("participant_demog.csv"))
    demographics = {
        row.subj_id: {"sex": row.gender, "age": int(row.age), "height_in": int(row.height_in),
                      "weight_lbs": int(row.weight_lbs), "right_handed": bool(row.right_handed)}
        for row in demog.itertuples()
    }
    split = make_split([path.stem for path in csvs], demographics)
    split_of = {s: name for name in ("train", "val", "test") for s in split[name]}
    chosen = csvs if args.all else [p for p in csvs if split_of[p.stem] == "test"]

    # Remove previously published folders (including the old BIDSleep sample) so
    # public/data contains exactly the catalog written below.
    OUTPUT.mkdir(parents=True, exist_ok=True)
    keep = {p.stem for p in chosen}
    for child in OUTPUT.iterdir():
        if child.is_dir() and child.name not in keep:
            for file in sorted(child.rglob("*"), reverse=True):
                file.unlink() if file.is_file() else file.rmdir()
            child.rmdir()
        elif child.is_file() and child.name not in ("README.txt",):
            child.unlink()

    if SAMPLES.is_dir():
        for stale in SAMPLES.glob("*.npz"):
            if stale.stem not in keep:
                stale.unlink()
    catalog = [prepare_subject(p, demographics, split_of[p.stem]) for p in chosen]
    temporary = OUTPUT / "recordings.json.tmp"
    temporary.write_text(json.dumps(catalog, indent=2) + "\n")
    temporary.replace(OUTPUT / "recordings.json")
    print(f"Wrote {len(catalog)} recordings to {OUTPUT.relative_to(PROJECT)}; split in "
          f"{SPLIT_PATH.relative_to(PROJECT)} (train {len(split['train'])}, "
          f"val {len(split['val'])}, test {len(split['test'])}).")


if __name__ == "__main__":
    main()
