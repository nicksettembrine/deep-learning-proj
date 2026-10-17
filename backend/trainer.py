"""Interactive training for the app's Train tab (HW2 optional challenges).

One experiment runs at a time in a background thread, using the same data preparation
and training loop as `python -m training.train`. The browser polls `snapshot()` to draw
the live curve. A finished experiment can be made the model behind Run model with
`use_experiment()`, and `reset()` switches back to the saved model in backend/model/.
"""

import argparse
import threading
from functools import lru_cache

from training.model import count_parameters
from training.train import CACHE as CACHE_PATH

PATIENCE = 15        # same early stopping as the saved model
SEED = 7400          # fixed, so the same settings always give the same result
WEIGHT_DECAY = 1e-4
BATCH = 128

_lock = threading.Lock()
_job = {"status": "idle"}          # idle | loading | running | done | stopped | error
_stop = threading.Event()
_experiment = {"model": None, "use": False, "settings": None}


@lru_cache(maxsize=1)
def prepared():
    """Windows, split, scaling and weighted loss, loaded once (a few seconds) and reused."""
    from training.train import prepare_data
    return prepare_data()


def snapshot():
    """Current state for the Train tab: settings, per-epoch history, and final scores."""
    with _lock:
        state = {k: v for k, v in _job.items() if k != "model"}   # the network itself is not JSON
        state["history"] = {k: list(v) for k, v in _job.get("history", {}).items()}
    state["active_model"] = "experiment" if _experiment["use"] else "saved"
    state["active_settings"] = _experiment["settings"] if _experiment["use"] else None
    return state


def start(settings):
    """Begin training an experiment. Returns False if one is already running."""
    with _lock:
        if _job["status"] in ("loading", "running"):
            return False
        _stop.clear()
        _job.clear()
        _job.update({"status": "loading", "settings": settings, "epoch": 0, "history": {}, "scores": None})
    threading.Thread(target=_run, args=(settings,), daemon=True).start()
    return True


def stop():
    _stop.set()


def _run(settings):
    from training.train import evaluate, train_network
    try:
        p = prepared()
        hidden = [settings["units"]] * settings["hidden_layers"]
        args = argparse.Namespace(seed=SEED, dropout=settings["dropout"], activation=settings["activation"],
                                  lr=settings["learning_rate"], weight_decay=WEIGHT_DECAY,
                                  epochs=settings["epochs"], batch=BATCH, patience=PATIENCE)
        with _lock:
            _job["status"] = "running"
            _job["history"] = {k: [] for k in ("epoch", "train_loss", "val_loss", "train_acc", "val_acc", "val_f1")}

        def on_epoch(row):
            with _lock:
                _job["epoch"] = row["epoch"]
                for key, value in row.items():
                    _job["history"][key].append(value)

        model, history, best_epoch = train_network(hidden, p["data"], p["loss_fn"], args,
                                                   on_epoch=on_epoch, should_stop=_stop.is_set)
        # Test scores are computed only now, at the end, so they are not used to pick settings.
        scores = {name: evaluate(model, *p["data"][name], p["loss_fn"]) for name in ("train", "val", "test")}
        with _lock:
            _job.update({"status": "stopped" if _stop.is_set() else "done", "best_epoch": best_epoch,
                         "epochs_run": history["epoch"][-1], "scores": scores,
                         "parameters": count_parameters(model)})
            _job["model"] = model
    except Exception as error:  # report any failure to the Train tab instead of dying silently
        with _lock:
            _job.update({"status": "error", "error": str(error)})


def use_experiment():
    """Make the finished experiment the model behind Run model. Returns False if there is none."""
    with _lock:
        model = _job.get("model")
        if model is None:
            return False
        _experiment.update({"model": model, "use": True, "settings": _job["settings"]})
    return True


def reset():
    """Go back to the saved model in backend/model/."""
    _experiment.update({"model": None, "use": False, "settings": None})


def active_experiment():
    """(model, mean, std) of the experiment in use, or None when the saved model is active."""
    if not _experiment["use"]:
        return None
    p = prepared()
    return _experiment["model"], p["mean"], p["std"]
