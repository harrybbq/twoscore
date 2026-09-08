"""Fit both models, cross-validate them honestly, and export JSON for the app.

Run once (and again after `npm run retrain`):

    .venv/bin/python py/fit.py

Nothing in the serverless path runs Python.  This writes models/*.json and
src/lib/scoring/scorer.ts consumes them.
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone

import numpy as np
from scipy.stats import spearmanr
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.linear_model import LogisticRegression, RidgeCV
from sklearn.metrics import mean_absolute_error, roc_auc_score
from sklearn.model_selection import GroupKFold

from common import (
    Frame,
    Standardizer,
    calibration_bins,
    calibration_error,
    export_tree,
    gbm_base_score,
    load_frame,
    precision_at_k,
)

MODEL_DIR = "models"
RIDGE_ALPHAS = np.logspace(-2, 3, 24)


def folds(frame: Frame, group_key: str, n_splits: int) -> GroupKFold:
    groups = frame.groups[group_key]
    n_groups = len(set(groups))
    return GroupKFold(n_splits=min(n_splits, max(2, n_groups)))


def oof_predictions(frame: Frame, group_key: str, n_splits: int, make, target: np.ndarray, proba: bool):
    """Out-of-fold predictions under grouped CV.

    Grouping is the whole point: a random split puts Guardians Vol. 2 in train
    and Vol. 3 in test, and the model scores brilliantly on information it
    would never have for something new.
    """
    groups = frame.groups[group_key]
    gkf = folds(frame, group_key, n_splits)
    oof = np.full(len(target), np.nan)
    for train_idx, test_idx in gkf.split(frame.X, target, groups):
        if proba and len(set(target[train_idx])) < 2:
            continue  # a fold with one class teaches nothing
        std = Standardizer(frame.X[train_idx])
        model = make()
        model.fit(std.transform(frame.X[train_idx]), target[train_idx])
        Zt = std.transform(frame.X[test_idx])
        oof[test_idx] = model.predict_proba(Zt)[:, 1] if proba else model.predict(Zt)
    return oof


# --------------------------------------------------------------- model A
def make_ridge():
    return RidgeCV(alphas=RIDGE_ALPHAS)


def make_gbr():
    return GradientBoostingRegressor(
        n_estimators=200, learning_rate=0.05, max_depth=3, subsample=0.9, random_state=0
    )


def evaluate_a(frame: Frame, group_key: str, n_splits: int) -> dict:
    y = frame.y_rating
    out = {}
    for name, make in (("ridge", make_ridge), ("gbm", make_gbr)):
        oof = oof_predictions(frame, group_key, n_splits, make, y, proba=False)
        ok = ~np.isnan(oof)
        rho = spearmanr(y[ok], oof[ok]).statistic if ok.sum() > 2 else float("nan")
        out[name] = {
            "mae": float(mean_absolute_error(y[ok], oof[ok])),
            "spearman": float(rho),
            "sigma": float(np.std(y[ok] - oof[ok])),
            "n": int(ok.sum()),
            "oof": oof,
        }
    baseline = np.full_like(y, y.mean())
    out["baseline"] = {
        "mae": float(mean_absolute_error(y, baseline)),
        "spearman": 0.0,
        "sigma": float(np.std(y - baseline)),
        "n": int(len(y)),
    }
    return out


# --------------------------------------------------------------- model B
def make_logit():
    # Balanced because ~15% positives; liblinear is stable at this row count.
    return LogisticRegression(
        C=0.5, max_iter=2000, class_weight="balanced", solver="liblinear"
    )


def make_gbc():
    return GradientBoostingClassifier(
        n_estimators=150, learning_rate=0.05, max_depth=3, subsample=0.9, random_state=0
    )


def evaluate_b(frame: Frame, group_key: str, n_splits: int) -> dict:
    y = frame.y_rewatch
    out = {}
    for name, make in (("logistic", make_logit), ("gbm", make_gbc)):
        oof = oof_predictions(frame, group_key, n_splits, make, y, proba=True)
        ok = ~np.isnan(oof)
        auc = (
            float(roc_auc_score(y[ok], oof[ok]))
            if ok.sum() > 2 and len(set(y[ok])) == 2
            else float("nan")
        )
        bins_ = calibration_bins(y[ok], oof[ok])
        out[name] = {
            "auc": auc,
            "precision_at_20": precision_at_k(y[ok], oof[ok], 20),
            "calibration": bins_,
            "calibration_error": calibration_error(bins_),
            "n": int(ok.sum()),
            "oof": oof,
        }
    base = float(y.mean())
    out["baseline"] = {
        "auc": 0.5,
        "precision_at_20": base,
        "base_rate": base,
        "calibration": [],
        "calibration_error": 0.0,
    }
    return out


# ---------------------------------------------------------------- export
def fit_final_a(frame: Frame, kind: str, sigma: float, metrics: dict) -> dict:
    std = Standardizer(frame.X)
    Z = std.transform(frame.X)
    model = (make_ridge() if kind == "ridge" else make_gbr()).fit(Z, frame.y_rating)
    doc = {
        "name": "model_a",
        "target": "rating",
        "kind": kind,
        "feature_version": frame.meta["feature_version"],
        "features": frame.features,
        "standardizer": std.export(),
        "clip": [0.5, 5.0],
        "sigma": round(sigma, 4),
        "metrics": metrics,
        "fitted_at": datetime.now(timezone.utc).isoformat(),
        "rows": frame.n,
    }
    if kind == "ridge":
        doc["linear"] = {
            "coef": [float(c) for c in model.coef_],
            "intercept": float(model.intercept_),
        }
        doc["alpha"] = float(model.alpha_)
    else:
        doc["gbm"] = {
            "trees": [export_tree(e[0]) for e in model.estimators_],
            "learning_rate": float(model.learning_rate),
            "base_score": gbm_base_score(model, Z, lambda z: model.predict(z)),
        }
    return doc


def fit_final_b(frame: Frame, kind: str, sigma: float, metrics: dict) -> dict:
    std = Standardizer(frame.X)
    Z = std.transform(frame.X)
    model = (make_logit() if kind == "logistic" else make_gbc()).fit(Z, frame.y_rewatch)
    doc = {
        "name": "model_b",
        "target": "rewatch",
        "kind": kind,
        "feature_version": frame.meta["feature_version"],
        "features": frame.features,
        "standardizer": std.export(),
        "clip": [0.0, 1.0],
        "sigma": round(sigma, 4),
        "metrics": metrics,
        "fitted_at": datetime.now(timezone.utc).isoformat(),
        "rows": frame.n,
    }
    if kind == "logistic":
        doc["linear"] = {
            "coef": [float(c) for c in model.coef_[0]],
            "intercept": float(model.intercept_[0]),
        }
        # class_weight="balanced" shifts the intercept away from the true base
        # rate, so recover a calibrated probability with a Platt fit on the
        # model's own log-odds.
        doc["platt"] = platt_fit(model.decision_function(Z), frame.y_rewatch)
    else:
        doc["gbm"] = {
            "trees": [export_tree(e[0]) for e in model.estimators_],
            "learning_rate": float(model.learning_rate),
            "base_score": gbm_base_score(model, Z, model.decision_function),
        }
        doc["platt"] = platt_fit(model.decision_function(Z), frame.y_rewatch)
    return doc


def platt_fit(raw: np.ndarray, y: np.ndarray) -> dict:
    """1-D logistic regression mapping raw scores to calibrated probabilities."""
    lr = LogisticRegression(C=1e6, max_iter=1000, solver="lbfgs")
    lr.fit(raw.reshape(-1, 1), y)
    return {"a": float(lr.coef_[0][0]), "b": float(lr.intercept_[0])}


def strip(d: dict) -> dict:
    return {k: v for k, v in d.items() if k not in ("oof", "calibration")}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frame", default="data/training_frame.json")
    ap.add_argument("--group", default="group_combined",
                    choices=["group_combined", "group_director", "group_collection"],
                    help="which grouping selects the model (all three are reported)")
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--out", default=MODEL_DIR)
    args = ap.parse_args()

    frame = load_frame(args.frame)
    print(f"{frame.n} rows · {len(frame.features)} features · "
          f"{int(frame.y_rewatch.sum())} rewatched ({frame.y_rewatch.mean()*100:.1f}%)\n")

    all_groups = {}
    for gk in ("group_combined", "group_director", "group_collection"):
        all_groups[gk] = {"a": evaluate_a(frame, gk, args.folds), "b": evaluate_b(frame, gk, args.folds)}
        a, b = all_groups[gk]["a"], all_groups[gk]["b"]
        print(f"--- grouped by {gk.replace('group_','')} "
              f"({len(set(frame.groups[gk]))} groups) ---")
        print(f"  A baseline   MAE {a['baseline']['mae']:.3f}")
        for k in ("ridge", "gbm"):
            print(f"  A {k:<10} MAE {a[k]['mae']:.3f}  Spearman {a[k]['spearman']:+.3f}")
        print(f"  B baseline   AUC 0.500   P@20 {b['baseline']['precision_at_20']:.3f}")
        for k in ("logistic", "gbm"):
            print(f"  B {k:<10} AUC {b[k]['auc']:.3f}  P@20 {b[k]['precision_at_20']:.3f}  "
                  f"cal.err {b[k]['calibration_error']:.3f}")
        print()

    sel = all_groups[args.group]
    a_kind = min(("ridge", "gbm"), key=lambda k: sel["a"][k]["mae"])
    b_kind = max(("logistic", "gbm"),
                 key=lambda k: (sel["b"][k]["auc"] if not np.isnan(sel["b"][k]["auc"]) else 0))
    print(f"selected: A = {a_kind}, B = {b_kind}  (by {args.group})\n")

    a_metrics = {
        "mae": round(sel["a"][a_kind]["mae"], 4),
        "spearman": round(sel["a"][a_kind]["spearman"], 4),
        "baseline_mae": round(sel["a"]["baseline"]["mae"], 4),
        "mae_lift": round(sel["a"]["baseline"]["mae"] - sel["a"][a_kind]["mae"], 4),
    }
    b_metrics = {
        "auc": round(sel["b"][b_kind]["auc"], 4),
        "precision_at_20": round(sel["b"][b_kind]["precision_at_20"], 4),
        "base_rate": round(float(frame.y_rewatch.mean()), 4),
        "calibration_error": round(sel["b"][b_kind]["calibration_error"], 4),
        "auc_lift": round(sel["b"][b_kind]["auc"] - 0.5, 4),
    }

    os.makedirs(args.out, exist_ok=True)
    doc_a = fit_final_a(frame, a_kind, sel["a"][a_kind]["sigma"], a_metrics)
    doc_b = fit_final_b(frame, b_kind, sel["b"][b_kind]["calibration_error"], b_metrics)

    with open(os.path.join(args.out, "model_a.json"), "w") as fh:
        json.dump(doc_a, fh)
    with open(os.path.join(args.out, "model_b.json"), "w") as fh:
        json.dump(doc_b, fh)

    card = {
        "fitted_at": doc_a["fitted_at"],
        "rows": frame.n,
        "feature_version": frame.meta["feature_version"],
        "global_mean": round(frame.meta["globals"]["globalMean"], 4),
        "global_rewatch_rate": round(frame.meta["globals"]["globalRewatchRate"], 4),
        "shrinkage_m": frame.meta["globals"]["m"],
        "model_a": {
            "kind": a_kind,
            "metrics": a_metrics,
            "baseline": {"mae": round(sel["a"]["baseline"]["mae"], 4), "spearman": 0.0},
        },
        "model_b": {
            "kind": b_kind,
            "metrics": b_metrics,
            "baseline": {"auc": 0.5, "precision_at_20": round(float(frame.y_rewatch.mean()), 4)},
            "calibration": sel["b"][b_kind]["calibration"],
        },
        "cv": {
            "scheme": "GroupKFold",
            "folds": args.folds,
            "groups": args.group,
            "all_groupings": {
                gk: {
                    "a": {k: strip(v) for k, v in g["a"].items()},
                    "b": {k: strip(v) for k, v in g["b"].items()},
                }
                for gk, g in all_groups.items()
            },
        },
        "notes": [
            "Features are built in TypeScript (src/lib/scoring/features.ts) and "
            "handed to Python as a named matrix, so runtime scoring cannot drift from the fit.",
            "Every training row's own rating is removed from its entities' affinities "
            "before its features are built (leave-one-out).",
            "Rewatch labels are a floor: the Letterboxd diary starts June 2020 and "
            "earlier viewings were never logged, so Model B's negatives include "
            "films that were in fact rewatched.",
            "Model B's sigma is calibration error — how far the probability itself is "
            "likely to be off — not the Bernoulli residual.",
        ],
    }
    with open(os.path.join(args.out, "model_card.json"), "w") as fh:
        json.dump(card, fh, indent=2)

    # Parity fixture: the same rows scored by sklearn, so the TypeScript
    # scorer can be proved to reproduce this model rather than assumed to.
    std = Standardizer(frame.X)
    Z = std.transform(frame.X)
    model_a = (make_ridge() if a_kind == "ridge" else make_gbr()).fit(Z, frame.y_rating)
    model_b = (make_logit() if b_kind == "logistic" else make_gbc()).fit(Z, frame.y_rewatch)
    pa = model_a.predict(Z)
    raw_b = model_b.decision_function(Z)
    platt = doc_b["platt"]
    pb = 1.0 / (1.0 + np.exp(-(platt["a"] * raw_b + platt["b"])))
    take = list(range(0, frame.n, max(1, frame.n // 25)))[:25]
    with open(os.path.join(args.out, "parity.json"), "w") as fh:
        json.dump(
            {
                "features": frame.features,
                "rows": [
                    {
                        "name": frame.names[i],
                        "x": [float(v) for v in frame.X[i]],
                        "a": float(np.clip(pa[i], 0.5, 5.0)),
                        "b": float(pb[i]),
                    }
                    for i in take
                ],
            },
            fh,
        )

    print(f"wrote {args.out}/model_a.json  ({a_kind}, MAE {a_metrics['mae']:.3f} "
          f"vs baseline {a_metrics['baseline_mae']:.3f})")
    print(f"wrote {args.out}/model_b.json  ({b_kind}, AUC {b_metrics['auc']:.3f} "
          f"vs baseline 0.500)")
    print(f"wrote {args.out}/model_card.json")

    if np.isnan(b_metrics["auc"]) or b_metrics["auc"] < 0.55:
        print("\n!! Model B is at or near chance. The two-score premise needs "
              "rethinking before a front end is worth building.")


if __name__ == "__main__":
    main()
