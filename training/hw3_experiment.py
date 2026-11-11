"""HW3: does penalizing sensitivity to timing reduce overfitting?

Run from the project folder:  .venv/bin/python -m training.hw3_experiment

Trains three versions of the HW2 network, three times each (seeds 7400-7402):
  HW2 model        cross-entropy on each window (the baseline)
  Shift only       also trains on a time-shifted copy of each window
  Shift + penalty  also penalizes predicting differently on the two copies (strength 1.0)

Everything else (data, split, network, optimizer, early stopping) is the same as HW2.
Saves hw3/results.json, hw3/results.md and hw3/loss_curves.png. The HW2 model files
in backend/model/ are not changed.
"""

import argparse
import json

import numpy as np
import torch

from training.train import PROJECT, evaluate, prepare_data, shift_windows, train_network

OUT = PROJECT / "hw3"
SEEDS = [7400, 7401, 7402]
MODELS = [  # name, train on shifted copies?, penalty strength
    ("HW2 model", False, 0.0),
    ("Shift only", True, 0.0),
    ("Shift + penalty", True, 1.0),
]
HW2_SETTINGS = dict(epochs=100, patience=15, lr=1e-3, batch=128, dropout=0.2, activation="relu", weight_decay=1e-4)


def flip_rate(model, X, n_shifts=5):
    """Share of test windows whose predicted activity changes when the window is shifted in time.

    Each window is shifted by 5 random amounts; the result is the average over those shifts.
    A fixed random generator means every model is checked with exactly the same shifts.
    """
    generator = torch.Generator().manual_seed(0)
    with torch.no_grad():
        original = model(X).argmax(dim=1)
        flips = [(model(shift_windows(X, generator)).argmax(dim=1) != original).float().mean().item()
                 for _ in range(n_shifts)]
    return float(np.mean(flips))


def main():
    prepared = prepare_data()
    data, loss_fn = prepared["data"], prepared["loss_fn"]
    runs = []
    for name, shift, penalty in MODELS:
        for seed in SEEDS:
            print(f"\n{name}, seed {seed}")
            args = argparse.Namespace(seed=seed, shift=shift, penalty=penalty, **HW2_SETTINGS)
            model, history, best_epoch = train_network([64, 64], data, loss_fn, args, on_epoch=lambda row: None)
            scores = {split: evaluate(model, *data[split], loss_fn) for split in ("train", "val", "test")}
            runs.append({
                "model": name, "seed": seed, "best_epoch": best_epoch, "epochs_run": history["epoch"][-1],
                "train_acc": scores["train"]["accuracy"], "val_acc": scores["val"]["accuracy"],
                "test_acc": scores["test"]["accuracy"], "test_macro_f1": scores["test"]["macro_f1"],
                "test_confusion": scores["test"]["confusion"],
                "flip_rate": flip_rate(model, data["test"][0]), "history": history,
            })
            r = runs[-1]
            print(f"  best epoch {best_epoch}  train {r['train_acc']:.3f}  val {r['val_acc']:.3f}  "
                  f"test {r['test_acc']:.3f}  test F1 {r['test_macro_f1']:.3f}  changed after shift {r['flip_rate']:.3f}")

    OUT.mkdir(exist_ok=True)
    (OUT / "results.json").write_text(json.dumps(runs, indent=2) + "\n")
    table = summary_table(runs)
    (OUT / "results.md").write_text(table + "\n")
    save_plot(runs, OUT / "loss_curves.png")
    print("\n" + table)


def summary_table(runs):
    """Mean ± standard deviation over the three seeds for each model."""
    def cell(values, percent=True):
        values = np.array(values) * (100 if percent else 1)
        return f"{values.mean():.1f} ± {values.std():.1f}" if percent else f"{values.mean():.3f} ± {values.std():.3f}"
    lines = ["| Model | Test accuracy (%) | Test macro-F1 | Train − val accuracy gap (%) | Changed after shift (%) | Best epoch |",
             "|---|---|---|---|---|---|"]
    for name, _, _ in MODELS:
        rs = [r for r in runs if r["model"] == name]
        lines.append(f"| {name} | {cell([r['test_acc'] for r in rs])} | {cell([r['test_macro_f1'] for r in rs], False)} | "
                     f"{cell([r['train_acc'] - r['val_acc'] for r in rs])} | {cell([r['flip_rate'] for r in rs])} | "
                     f"{np.mean([r['best_epoch'] for r in rs]):.0f} |")
    return "\n".join(lines)


def save_plot(runs, path):
    """Training and validation loss vs. epoch for each model (first seed)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, len(MODELS), figsize=(12, 3.6), dpi=150, sharey=True)
    for ax, (name, _, _) in zip(axes, MODELS):
        r = next(r for r in runs if r["model"] == name and r["seed"] == SEEDS[0])
        h = r["history"]
        ax.plot(h["epoch"], h["train_loss"], label="Training loss")
        ax.plot(h["epoch"], h["val_loss"], label="Validation loss")
        ax.axvline(r["best_epoch"], color="gray", linestyle="--", linewidth=1, label=f"Kept epoch ({r['best_epoch']})")
        ax.set_title(name, fontsize=10); ax.set_xlabel("Epoch"); ax.grid(alpha=0.3)
    axes[0].set_ylabel("Weighted cross-entropy loss"); axes[0].legend(fontsize=8)
    fig.tight_layout(); fig.savefig(path); plt.close(fig)


if __name__ == "__main__":
    main()
