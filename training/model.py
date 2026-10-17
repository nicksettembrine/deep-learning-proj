"""A small feed-forward network for activity classification.

    MLP:       1200 -> Linear -> ReLU -> Dropout -> Linear -> ReLU -> Dropout -> Linear -> 4 logits
               (hidden=[64, 64])
    Baseline:  1200 -> Linear -> 4 logits
               (hidden=[]: no hidden layers, which is exactly logistic regression)

Each Linear layer computes W x + b. ReLU, max(0, z), is the nonlinearity (tanh or sigmoid
can be chosen instead in the app's Train tab); without one,
stacked Linear layers would collapse into one Linear layer, i.e. the baseline.
Dropout randomly zeroes 20% of hidden units during training to reduce overfitting
(it is switched off by model.eval()). The output is 4 logits, one per activity;
softmax turns them into probabilities. There is no softmax inside the model because
CrossEntropyLoss applies it itself.
"""

import torch
from torch import nn

ACTIVATIONS = {"relu": nn.ReLU, "tanh": nn.Tanh, "sigmoid": nn.Sigmoid}


class ActivityNet(nn.Module):
    def __init__(self, n_inputs=1200, n_classes=4, hidden=(64, 64), dropout=0.2, activation="relu"):
        super().__init__()
        layers, width = [], n_inputs
        for size in hidden:
            layers += [nn.Linear(width, size), ACTIVATIONS[activation](), nn.Dropout(dropout)]
            width = size
        layers.append(nn.Linear(width, n_classes))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


def count_parameters(model):
    return sum(p.numel() for p in model.parameters())


def load_model(path):
    """Load a checkpoint saved by train.py. Returns (model in eval mode, checkpoint dict)."""
    checkpoint = torch.load(path, map_location="cpu", weights_only=False)
    cfg = checkpoint["config"]
    model = ActivityNet(cfg["n_inputs"], cfg["n_classes"], tuple(cfg["hidden"]), cfg["dropout"],
                        cfg.get("activation", "relu"))
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    return model, checkpoint
