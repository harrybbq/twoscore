import { toVector } from './features';
import type { ModelJson, TreeNode } from './model';

export interface Contribution {
  feature: string;
  contribution: number;
  value: number;
}

export interface RawPrediction {
  /** Model output in its natural units: stars for A, probability for B. */
  value: number;
  /** Pre-link, pre-clip output. `base + Σ contributions === raw`, exactly. */
  raw: number;
  contributions: Contribution[];
  base: number;
}

function sigmoid(x: number): number {
  return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}

function standardise(x: number[], m: ModelJson): number[] {
  const { mean, scale } = m.standardizer;
  return x.map((v, i) => {
    const s = scale[i];
    return s && Number.isFinite(s) && s !== 0 ? (v - mean[i]) / s : 0;
  });
}

/**
 * Exact per-feature attribution for a tree ensemble (Saabas): the change in
 * node value at every split is credited to the feature that split there, so
 * base + Σ contributions === prediction.  Not an approximation — the "why"
 * panel has to be auditable or the number is worthless.
 */
function walkTree(tree: TreeNode[], z: number[], out: number[]): number {
  let i = 0;
  let prev = tree[0].v;
  for (;;) {
    const node = tree[i];
    if (node.f < 0) return prev;
    const next = z[node.f] <= node.t ? node.l : node.r;
    const child = tree[next];
    out[node.f] += child.v - node.v;
    prev = child.v;
    i = next;
  }
}

function predictRaw(m: ModelJson, z: number[]): { raw: number; contrib: number[]; base: number } {
  const contrib = new Array(m.features.length).fill(0);
  if (m.kind === 'gbm') {
    const g = m.gbm!;
    let raw = g.base_score;
    // Each tree's own root value is part of the baseline, not of any feature's
    // contribution — contributions only carry the *changes* made at splits.
    let base = g.base_score;
    const treeContrib = new Array(m.features.length).fill(0);
    for (const tree of g.trees) {
      const scratch = new Array(m.features.length).fill(0);
      const leaf = walkTree(tree, z, scratch);
      raw += g.learning_rate * leaf;
      base += g.learning_rate * tree[0].v;
      for (let i = 0; i < scratch.length; i++) treeContrib[i] += g.learning_rate * scratch[i];
    }
    return { raw, contrib: treeContrib, base };
  }
  const lin = m.linear!;
  let raw = lin.intercept;
  for (let i = 0; i < z.length; i++) {
    const c = lin.coef[i] * z[i];
    contrib[i] = c;
    raw += c;
  }
  return { raw, contrib, base: lin.intercept };
}

export function predict(m: ModelJson, values: Record<string, number>): RawPrediction {
  const x = toVector(values, m.features);
  const z = standardise(x, m);
  const { raw, contrib, base } = predictRaw(m, z);

  let out = raw;
  if (m.target === 'rewatch') {
    const a = m.platt?.a ?? 1;
    const b = m.platt?.b ?? 0;
    out = sigmoid(a * raw + b);
  }
  if (m.clip) out = Math.min(Math.max(out, m.clip[0]), m.clip[1]);

  const contributions: Contribution[] = m.features
    .map((f, i) => ({ feature: f, contribution: contrib[i], value: x[i] }))
    .filter((c) => Math.abs(c.contribution) > 1e-9)
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return { value: out, raw, contributions, base };
}

export interface ConfidenceParts {
  keywords: number;
  votes: number;
  director: number;
  cast: number;
  metadata: number;
  tvPenalty: number;
}

export interface Completeness {
  keywordCount: number;
  voteCount: number;
  directorKnown: boolean;
  castKnown: number;
  hasRuntime: boolean;
  hasGenres: boolean;
  isTv: boolean;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/**
 * Confidence from feature completeness, not from model output.
 *
 * A film released next week has thin keywords and 40 votes; the score is
 * still computable but it is a guess, and the UI is forbidden from rendering
 * one of these numbers without the other.
 */
export function confidenceOf(c: Completeness): { confidence: number; parts: ConfidenceParts } {
  const parts: ConfidenceParts = {
    keywords: clamp01(c.keywordCount / 8),
    votes: clamp01(Math.log1p(c.voteCount) / Math.log1p(1000)),
    director: c.directorKnown ? 1 : 0.3,
    cast: clamp01(c.castKnown / 3),
    metadata: (c.hasRuntime ? 0.5 : 0) + (c.hasGenres ? 0.5 : 0),
    // Letterboxd's TV coverage in the export is patchy, so TV titles cannot
    // be reliably deduped against the history or matched to its affinities.
    tvPenalty: c.isTv ? 0.75 : 1,
  };
  const weighted =
    0.2 * parts.keywords +
    0.25 * parts.votes +
    0.3 * parts.director +
    0.15 * parts.cast +
    0.1 * parts.metadata;
  return { confidence: Number((weighted * parts.tvPenalty).toFixed(4)), parts };
}

/** Error bars widen as confidence falls — a thin title gets an honest band. */
export function errorBar(sigma: number, confidence: number): number {
  return sigma * (1 + (1 - clamp01(confidence)));
}
