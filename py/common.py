"""Shared plumbing for fit.py.

Nothing here knows what a film is.  Feature engineering lives in
src/lib/scoring/features.ts and reaches Python only as a named matrix, so the
deployed TypeScript scorer and the fitted model can never disagree about what
column 12 means.
"""
from __future__ import annotations

import json
from dataclasses import dataclass

import numpy as np


@dataclass
class Frame:
    features: list[str]
    X: np.ndarray
    y_rating: np.ndarray
    y_rewatch: np.ndarray
    groups: dict[str, np.ndarray]
    names: list[str]
    meta: dict

    @property
    def n(self) -> int:
        return self.X.shape[0]


def load_frame(path: str = "data/training_frame.json") -> Frame:
    with open(path) as fh:
        raw = json.load(fh)
    rows = raw["rows"]
    if not rows:
        raise SystemExit("training frame is empty — run `npm run frame` after backfill")
    X = np.array([r["x"] for r in rows], dtype=float)
    return Frame(
        features=raw["features"],
        X=X,
        y_rating=np.array([r["rating"] for r in rows], dtype=float),
        y_rewatch=np.array([r["rewatch"] for r in rows], dtype=int),
        groups={
            key: np.array([r[key] for r in rows])
            for key in ("group_director", "group_collection", "group_combined")
        },
        names=[r["name"] for r in rows],
        meta={
            "feature_version": raw["feature_version"],
            "globals": raw["globals"],
            "rewatch_base_rate": raw["rewatch_base_rate"],
            "generated_at": raw["generated_at"],
        },
    )


class Standardizer:
    """z-scoring with the parameters exported for the TypeScript scorer."""

    def __init__(self, X: np.ndarray):
        self.mean = X.mean(axis=0)
        scale = X.std(axis=0)
        # A constant column would divide by zero; the scorer treats scale 0 as
        # "always contribute nothing", so mirror that here.
        scale[scale < 1e-9] = 1.0
        self.scale = scale
        self.constant = X.std(axis=0) < 1e-9

    def transform(self, X: np.ndarray) -> np.ndarray:
        Z = (X - self.mean) / self.scale
        Z[:, self.constant] = 0.0
        return Z

    def export(self) -> dict:
        scale = self.scale.copy()
        scale[self.constant] = 0.0  # signals "skip" to the TS scorer
        return {"mean": self.mean.tolist(), "scale": scale.tolist()}


def export_tree(tree) -> list[dict]:
    """sklearn tree -> the flat node array src/lib/scoring/scorer.ts walks.

    sklearn sends a sample left when `X[:, feature] <= threshold`, which is
    exactly the comparison the TypeScript walker makes.
    """
    t = tree.tree_
    nodes = []
    for i in range(t.node_count):
        leaf = t.children_left[i] == -1
        nodes.append(
            {
                "f": -1 if leaf else int(t.feature[i]),
                "t": 0.0 if leaf else float(t.threshold[i]),
                "l": -1 if leaf else int(t.children_left[i]),
                "r": -1 if leaf else int(t.children_right[i]),
                "v": float(t.value[i].ravel()[0]),
            }
        )
    return nodes


def gbm_base_score(est, Z: np.ndarray, raw_fn) -> float:
    """Recover the ensemble's init score without touching sklearn internals.

    raw = base + lr * sum(tree(x)), so base = raw(x0) - lr * sum(tree(x0)).
    Computed numerically so it stays correct across sklearn versions.
    """
    x0 = Z[:1]
    trees_sum = sum(float(e[0].predict(x0)[0]) for e in est.estimators_)
    return float(raw_fn(x0)[0] - est.learning_rate * trees_sum)


def precision_at_k(y_true: np.ndarray, scores: np.ndarray, k: int = 20) -> float:
    k = min(k, len(scores))
    if k == 0:
        return float("nan")
    idx = np.argsort(-scores)[:k]
    return float(y_true[idx].mean())


def calibration_bins(y_true: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    out = []
    for i in range(bins):
        lo, hi = edges[i], edges[i + 1]
        mask = (p >= lo) & (p < hi if i < bins - 1 else p <= hi)
        n = int(mask.sum())
        if n == 0:
            continue
        out.append(
            {
                "bin": round(float((lo + hi) / 2), 3),
                "predicted": round(float(p[mask].mean()), 4),
                "actual": round(float(y_true[mask].mean()), 4),
                "n": n,
            }
        )
    return out


def calibration_error(bins_: list[dict]) -> float:
    """Weighted RMS gap between predicted and observed frequency.

    This, not the Bernoulli residual, is what Model B's error bar reports:
    the question the UI answers is "how far off is this probability likely to
    be", not "will this particular film be rewatched".
    """
    if not bins_:
        return 0.15
    total = sum(b["n"] for b in bins_)
    err = sum(b["n"] * (b["predicted"] - b["actual"]) ** 2 for b in bins_) / total
    return float(max(np.sqrt(err), 0.03))
