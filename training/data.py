"""Turn raw left-wrist accelerometry into scaled 4-second windows for the network.

Used by both training (train.py) and the backend (/predict), so the model always
sees its input prepared exactly the same way.

One window = 400 samples (4 s at 100 Hz) x 3 axes (x, y, z) = 1,200 numbers.
"""

from pathlib import Path

import numpy as np
import pandas as pd

FS = 100                     # raw sampling rate (Hz)
WINDOW_S = 4                 # window length (seconds)
WINDOW = FS * WINDOW_S       # 400 samples per window
TRAIN_STEP = WINDOW // 2     # 50% overlap when making training examples
CLASSES = {1: "Walking", 2: "Descending stairs", 3: "Ascending stairs", 4: "Driving"}
CLASS_CODES = list(CLASSES)  # model output index -> dataset activity code
WRIST_COLUMNS = ["lw_x", "lw_y", "lw_z"]


def load_wrist(csv_path):
    """Read one participant's CSV. Returns the (n, 3) wrist signal in g and the (n,) activity codes."""
    df = pd.read_csv(csv_path, usecols=["activity", *WRIST_COLUMNS])
    return df[WRIST_COLUMNS].to_numpy(np.float32), df["activity"].to_numpy()


def make_windows(xyz, labels=None, step=TRAIN_STEP):
    """Cut an (n, 3) signal into windows of shape (n_windows, 400, 3).

    Without labels, every window is kept (used by the app for display).
    With labels, only windows whose 400 labels are all the same studied activity
    (codes 1-4) are kept, so every training example has one clean label. Windows
    that span a transition, clapping, or non-study time are dropped.

    Returns windows, each window's activity code (None without labels), and each window's start sample.
    """
    starts = np.arange(0, len(xyz) - WINDOW + 1, step)
    windows = np.stack([xyz[s:s + WINDOW] for s in starts])
    if labels is None:
        return windows, None, starts
    window_labels = np.stack([labels[s:s + WINDOW] for s in starts])
    first = window_labels[:, 0]
    pure = (window_labels == first[:, None]).all(axis=1) & np.isin(first, CLASS_CODES)
    return windows[pure], first[pure].astype(int), starts[pure]


def build_dataset(raw_dir):
    """Windows, class indices (0-3), and participant id for every labeled window of every participant."""
    X, y, groups = [], [], []
    for csv in sorted(Path(raw_dir).glob("*.csv")):
        xyz, labels = load_wrist(csv)
        windows, codes, _ = make_windows(xyz, labels)
        X.append(windows)
        y.append(np.array([CLASS_CODES.index(c) for c in codes], dtype=np.int64))
        groups += [csv.stem] * len(windows)
        print(f"  {csv.stem}: {len(windows)} windows")
    return np.concatenate(X), np.concatenate(y), np.array(groups)


def fit_scaler(train_windows):
    """Mean and standard deviation of each axis (x, y, z), from training windows only."""
    flat = train_windows.reshape(-1, 3)        # every sample of every window, 3 columns
    return flat.mean(axis=0), flat.std(axis=0)


def scale_and_flatten(windows, mean, std):
    """(n, 400, 3) windows -> (n, 1200) network input, each axis centered and scaled.

    Flattening keeps time order: [x0, y0, z0, x1, y1, z1, ...]. The order does not
    matter to an MLP, as long as training and prediction use the same one.
    """
    scaled = (windows - mean) / std
    return scaled.reshape(len(windows), -1).astype(np.float32)
