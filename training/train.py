"""Train the activity MLP and the logistic-regression baseline on raw left-wrist windows.

Run from the project folder:  .venv/bin/python -m training.train

Steps
  1. Cut every participant's wrist signal into 4-s single-activity windows (training/data.py).
  2. Split by participant (training/split.json): validation and test people are never trained on.
  3. Scale each axis with the training set's mean and standard deviation.
  4. Train two networks with identical settings:
       MLP       hidden=[64, 64]
       baseline  hidden=[]  (logistic regression)
     Each epoch: mini-batches -> forward pass -> weighted cross-entropy -> backpropagation -> Adam update.
     Keep the epoch with the best validation macro-F1 (early stopping).
  5. Report accuracy, macro-F1 and confusion matrices on train/val/test, and save
     weights, metrics.json and a loss-curve plot to backend/model/.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import confusion_matrix, f1_score
from torch import nn

from training.data import CLASS_CODES, CLASSES, build_dataset, fit_scaler, scale_and_flatten
from training.model import ActivityNet, count_parameters

PROJECT = Path(__file__).resolve().parents[1]
SPLIT_PATH = PROJECT / "training" / "split.json"
CACHE = PROJECT / "training" / "cache" / "windows.npz"
OUT = PROJECT / "backend" / "model"
N_CLASSES = len(CLASS_CODES)


def find_raw_dir(root):
    matches = sorted(Path(root).rglob("raw_accelerometry_data"))
    if not matches:
        raise FileNotFoundError(f"No raw_accelerometry_data folder under {root}. Download and unzip the dataset first.")
    return matches[0]


def evaluate(model, X, y, loss_fn):
    """Loss, accuracy, macro-F1 and confusion matrix with dropout off and no gradients."""
    model.eval()
    with torch.no_grad():
        logits = model(X)
        loss = float(loss_fn(logits, y))
    pred = logits.argmax(dim=1).numpy()
    true = y.numpy()
    return {
        "loss": loss,
        "accuracy": float((pred == true).mean()),
        "macro_f1": float(f1_score(true, pred, average="macro", labels=range(N_CLASSES), zero_division=0)),
        "confusion": confusion_matrix(true, pred, labels=range(N_CLASSES)).tolist(),
    }


def print_epoch(row):
    print(f"  epoch {row['epoch']:3d}  loss train {row['train_loss']:.3f} val {row['val_loss']:.3f}  "
          f"acc train {row['train_acc']:.3f} val {row['val_acc']:.3f}  val macro-F1 {row['val_f1']:.3f}")


def train_network(hidden, data, loss_fn, args, on_epoch=print_epoch, should_stop=lambda: False):
    """Train one network; return it at its best-validation-F1 epoch, plus its per-epoch history.

    on_epoch(row) is called after every epoch (the app's Train tab uses it for the live curve);
    should_stop() lets the app's Stop button end training early.
    """
    torch.manual_seed(args.seed)                     # same starting point every run
    model = ActivityNet(data["train"][0].shape[1], N_CLASSES, hidden, args.dropout, args.activation)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    X_train, y_train = data["train"]

    history = {"epoch": [], "train_loss": [], "val_loss": [], "train_acc": [], "val_acc": [], "val_f1": []}
    best = {"val_f1": -1.0, "epoch": 0, "state": None}
    for epoch in range(1, args.epochs + 1):
        # ---- One epoch of mini-batch gradient descent ----
        model.train()                                # dropout on
        order = torch.randperm(len(X_train))         # shuffle so batches differ each epoch
        for start in range(0, len(X_train), args.batch):
            batch = order[start:start + args.batch]
            optimizer.zero_grad()                    # clear gradients from the previous step
            logits = model(X_train[batch])           # forward propagation
            loss = loss_fn(logits, y_train[batch])   # weighted cross-entropy
            loss.backward()                          # backpropagation: gradient of loss for every weight
            optimizer.step()                         # gradient-descent update (Adam)

        # ---- Measure the whole training and validation sets after this epoch ----
        train, val = evaluate(model, *data["train"], loss_fn), evaluate(model, *data["val"], loss_fn)
        row = {"epoch": epoch, "train_loss": train["loss"], "val_loss": val["loss"],
               "train_acc": train["accuracy"], "val_acc": val["accuracy"], "val_f1": val["macro_f1"]}
        for key, value in row.items():
            history[key].append(value)
        on_epoch(row)

        # ---- Early stopping: keep the best validation macro-F1; stop after `patience` epochs without improvement ----
        if val["macro_f1"] > best["val_f1"]:
            best = {"val_f1": val["macro_f1"], "epoch": epoch,
                    "state": {k: v.clone() for k, v in model.state_dict().items()}}
        elif epoch - best["epoch"] >= args.patience:
            print(f"  No improvement for {args.patience} epochs; best was epoch {best['epoch']}.")
            break
        if should_stop():
            break

    model.load_state_dict(best["state"])
    model.eval()
    return model, history, best["epoch"]


def prepare_data(data_dir=PROJECT / "data" / "physionet", rebuild=False):
    """Steps 1-3 plus class weights: windows, participant split, scaling, and the weighted loss.

    Returns a dict with tensors per split, the scaler, the loss function, and counts. The app's
    Train tab reuses this, so experiments see exactly the same data as the saved model.
    """
    # ---- 1. Windows (cached, because reading 32 large CSVs takes a while) ----
    if CACHE.is_file() and not rebuild:
        cached = np.load(CACHE)
        windows, y, groups = cached["windows"], cached["y"], cached["groups"]
        print(f"Loaded {len(windows)} cached windows.")
    else:
        print("Cutting windows from the raw CSVs...")
        windows, y, groups = build_dataset(find_raw_dir(data_dir))
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(CACHE, windows=windows, y=y, groups=groups)

    # ---- 2. Split by participant ----
    split = json.loads(SPLIT_PATH.read_text())
    masks = {name: np.isin(groups, split[name]) for name in ("train", "val", "test")}
    for name, mask in masks.items():
        counts = np.bincount(y[mask], minlength=N_CLASSES)
        print(f"{name:5s} {len(split[name]):2d} people  {mask.sum():6d} windows  "
              + "  ".join(f"{CLASSES[c]} {n}" for c, n in zip(CLASS_CODES, counts)))

    # ---- 3. Scale with training statistics only, then flatten to 1,200 numbers per window ----
    mean, std = fit_scaler(windows[masks["train"]])
    data = {name: (torch.from_numpy(scale_and_flatten(windows[m], mean, std)), torch.from_numpy(y[m]))
            for name, m in masks.items()}

    # ---- 4. Weighted cross-entropy: each class's weight = total / (4 x class count) ----
    # Rare stair windows get a large weight and common driving windows a small one,
    # so every activity contributes equally to the loss.
    counts = np.bincount(y[masks["train"]], minlength=N_CLASSES)
    class_weights = torch.tensor(counts.sum() / (N_CLASSES * counts), dtype=torch.float32)
    print("Class weights:", {CLASSES[c]: round(float(w), 2) for c, w in zip(CLASS_CODES, class_weights)})
    return {"data": data, "mean": mean, "std": std, "split": split, "class_weights": class_weights,
            "loss_fn": nn.CrossEntropyLoss(weight=class_weights),
            "n_windows": {k: int(m.sum()) for k, m in masks.items()}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default=PROJECT / "data" / "physionet")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--patience", type=int, default=15)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--batch", type=int, default=128)
    parser.add_argument("--hidden", type=int, nargs="+", default=[64, 64])
    parser.add_argument("--dropout", type=float, default=0.2)
    parser.add_argument("--activation", choices=["relu", "tanh", "sigmoid"], default="relu")
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--seed", type=int, default=7400)
    parser.add_argument("--rebuild", action="store_true", help="Re-cut windows from the raw CSVs instead of using the cache.")
    args = parser.parse_args()

    prepared = prepare_data(args.data, args.rebuild)
    data, loss_fn, mean, std = prepared["data"], prepared["loss_fn"], prepared["mean"], prepared["std"]
    split, class_weights = prepared["split"], prepared["class_weights"]

    results = {}
    for name, hidden in [("mlp", args.hidden), ("baseline", [])]:
        model = ActivityNet(data["train"][0].shape[1], N_CLASSES, hidden, args.dropout, args.activation)
        print(f"\nTraining {name}: hidden layers {hidden or 'none'}, {count_parameters(model):,} parameters")
        model, history, best_epoch = train_network(hidden, data, loss_fn, args)
        scores = {split_name: evaluate(model, *data[split_name], loss_fn) for split_name in ("train", "val", "test")}
        config = {"n_inputs": data["train"][0].shape[1], "n_classes": N_CLASSES, "hidden": hidden,
                  "dropout": args.dropout, "activation": args.activation, "lr": args.lr, "batch": args.batch, "weight_decay": args.weight_decay,
                  "optimizer": "Adam", "seed": args.seed, "best_epoch": best_epoch, "epochs_run": history["epoch"][-1],
                  "parameters": count_parameters(model)}
        results[name] = {"config": config, "history": history, "scores": scores}
        OUT.mkdir(parents=True, exist_ok=True)
        torch.save({"state_dict": model.state_dict(), "config": config, "mean": mean, "std": std,
                    "class_codes": CLASS_CODES}, OUT / f"{name}.pt")

    # ---- 5. Report and save ----
    report = {
        "task": "4-class activity classification from raw 4-s left-wrist windows",
        "classes": [CLASSES[c] for c in CLASS_CODES],
        "split": {k: split[k] for k in ("train", "val", "test")},
        "n_windows": prepared["n_windows"],
        "class_weights": [float(w) for w in class_weights],
        **results,
    }
    (OUT / "metrics.json").write_text(json.dumps(report, indent=2) + "\n")
    save_plot(results, OUT / "loss_curve.png")

    print("\n                  accuracy   error   macro-F1")
    for name in ("mlp", "baseline"):
        for split_name in ("train", "val", "test"):
            s = results[name]["scores"][split_name]
            print(f"{name:8s} {split_name:5s}    {s['accuracy']:.3f}    {1 - s['accuracy']:.3f}    {s['macro_f1']:.3f}")
    mlp_err = 1 - results["mlp"]["scores"]["test"]["accuracy"]
    base_err = 1 - results["baseline"]["scores"]["test"]["accuracy"]
    print(f"\nTest error rate: MLP {mlp_err:.3f} vs baseline {base_err:.3f} -> "
          + ("MLP beats the baseline." if mlp_err < base_err else "MLP does NOT beat the baseline."))
    print("\nMLP test confusion matrix (rows = true, columns = predicted):")
    print("  " + " | ".join(CLASSES[c] for c in CLASS_CODES))
    for code, row in zip(CLASS_CODES, results["mlp"]["scores"]["test"]["confusion"]):
        print(f"  {CLASSES[code]:18s} {row}")
    print(f"\nSaved weights, metrics.json and loss_curve.png to {OUT.relative_to(PROJECT)}/")


def save_plot(results, path):
    """Training and validation loss vs epoch for both networks, with the kept epoch marked."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, axes = plt.subplots(1, 2, figsize=(10, 3.6), dpi=150, sharey=True)
    for ax, (name, title) in zip(axes, [("mlp", "MLP (1200 → 64 → 64 → 4)"), ("baseline", "Logistic regression (1200 → 4)")]):
        h, best = results[name]["history"], results[name]["config"]["best_epoch"]
        ax.plot(h["epoch"], h["train_loss"], label="Training loss")
        ax.plot(h["epoch"], h["val_loss"], label="Validation loss")
        ax.axvline(best, color="gray", linestyle="--", linewidth=1, label=f"Kept epoch ({best})")
        ax.set_title(title, fontsize=10); ax.set_xlabel("Epoch"); ax.grid(alpha=0.3)
    axes[0].set_ylabel("Weighted cross-entropy loss"); axes[0].legend()
    fig.tight_layout(); fig.savefig(path); plt.close(fig)


if __name__ == "__main__":
    main()
