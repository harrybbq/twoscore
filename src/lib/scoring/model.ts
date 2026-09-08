/** Serialised model format written by `py/fit.py` and read only here. */

export interface TreeNode {
  /** Split feature index, or -1 for a leaf. */
  f: number;
  t: number;
  l: number;
  r: number;
  /** Node value — used for leaves and for Saabas attribution at internal nodes. */
  v: number;
}

export interface ModelJson {
  name: 'model_a' | 'model_b';
  target: 'rating' | 'rewatch';
  kind: 'ridge' | 'logistic' | 'gbm';
  feature_version: string;
  features: string[];
  standardizer: { mean: number[]; scale: number[] };
  linear?: { coef: number[]; intercept: number };
  gbm?: { trees: TreeNode[][]; learning_rate: number; base_score: number };
  /** Platt scaling, applied to GBM log-odds so Model B stays a probability. */
  platt?: { a: number; b: number };
  clip?: [number, number];
  /** 1 s.d. of held-out residuals — the error bar the UI must always show. */
  sigma: number;
  metrics: Record<string, number | null>;
  fitted_at: string;
  rows: number;
}

export interface ModelCard {
  fitted_at: string;
  rows: number;
  feature_version: string;
  global_mean: number;
  global_rewatch_rate: number;
  shrinkage_m: number;
  model_a: { kind: string; metrics: Record<string, number | null>; baseline: Record<string, number | null> };
  model_b: {
    kind: string;
    metrics: Record<string, number | null>;
    baseline: Record<string, number | null>;
    calibration: { bin: number; predicted: number; actual: number; n: number }[];
  };
  cv: { scheme: string; folds: number; groups: string };
  notes: string[];
}
