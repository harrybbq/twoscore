import type { AffinityTables } from '@/lib/affinity/compute';
import type { TitleMeta } from '@/lib/tmdb/types';
import { buildFeatures, type EvidenceTerm, type ExcludeSelf } from './features';
import { labelFor } from './labels';
import type { ModelJson } from './model';
import { confidenceOf, errorBar, predict, type ConfidenceParts, type Contribution } from './scorer';

export interface WhyTerm {
  label: string;
  detail: string;
  /** Signed push on this model's output, in display points. */
  effect: number;
  n: number | null;
}

export interface ScoredTitle {
  /** Predicted star rating, 0.5–5.0. */
  scoreAStars: number;
  /** Same thing on the 0–100 scale the UI compares against public × 10. */
  scoreA: number;
  scoreASigma: number;
  /** Probability of rewatch, 0–100. */
  scoreB: number;
  scoreBLo: number;
  scoreBHi: number;
  publicRating: number | null;
  publicSource: 'imdb' | 'tmdb' | null;
  delta: number | null;
  confidence: number;
  confidenceParts: ConfidenceParts;
  why: { a: WhyTerm[]; b: WhyTerm[] };
  features: Record<string, number>;
  modelVersion: string;
}

export interface ScoreOptions {
  imdbRating?: number | null;
  exclude?: ExcludeSelf;
  topTerms?: number;
}

/**
 * Turn contributions into sentences a person can argue with.
 *
 * `effect` is a counterfactual, not a raw coefficient: it is how many display
 * points the score would move if this one term were taken away, computed by
 * pushing the prediction back through the link function. That keeps the number
 * meaningful for Model B, where a local slope collapses to zero whenever the
 * probability saturates — precisely the titles you most want explained.
 *
 * Evidence terms (which carry real sample sizes) win over generic labels, so
 * the panel says "Director Armando Iannucci — 2 films, mean 4.75" rather than
 * "a_director +0.31".
 */
function explain(
  raw: number,
  contributions: Contribution[],
  evidence: EvidenceTerm[],
  project: (raw: number) => number,
  limit: number,
): WhyTerm[] {
  const byFeature = new Map(evidence.map((e) => [e.feature, e]));
  const here = project(raw);
  const terms: (WhyTerm & { magnitude: number })[] = contributions.map((c) => {
    const ev = byFeature.get(c.feature);
    const without = project(raw - c.contribution);
    const effect = here - without;
    return {
      label: ev ? ev.label : labelFor(c.feature),
      detail: ev ? ev.detail : formatValue(c.feature, c.value),
      effect: Number(effect.toFixed(2)),
      n: ev?.n ?? null,
      magnitude: Math.abs(effect),
    };
  });
  return terms
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, limit)
    .map(({ magnitude, ...t }) => t);
}

function formatValue(feature: string, v: number): string {
  if (feature.startsWith('genre_') || feature.startsWith('dec_')) return v ? 'yes' : 'no';
  if (feature === 'runtime') return `${Math.round(v * 60 + 120)} min`;
  if (feature === 'log_vote_count') return `${Math.round(Math.expm1(v)).toLocaleString()} votes`;
  if (feature === 'log_budget') return v ? `$${Math.round(Math.expm1(v)).toLocaleString()}` : 'unknown';
  if (feature === 'vote_average') return v.toFixed(1);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(2);
}

const starsToPoints = (raw: number) => (Math.min(5, Math.max(0.5, raw)) / 5) * 100;

function logitToPoints(model: ModelJson, raw: number): number {
  const a = model.platt?.a ?? 1;
  const b = model.platt?.b ?? 0;
  const z = a * raw + b;
  const p = z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
  return p * 100;
}

export function scoreTitle(
  meta: TitleMeta,
  tables: AffinityTables,
  modelA: ModelJson,
  modelB: ModelJson,
  opts: ScoreOptions = {},
): ScoredTitle {
  const built = buildFeatures(meta, tables, opts.exclude);
  const { confidence, parts } = confidenceOf(built.completeness);

  const a = predict(modelA, built.values);
  const b = predict(modelB, built.values);

  const stars = Math.min(5, Math.max(0.5, a.value));
  const scoreA = Number(((stars / 5) * 100).toFixed(1));
  // Model A's sigma is in stars; the display scale is 20 points per star.
  const sigmaStars = errorBar(modelA.sigma, confidence);
  const scoreASigma = Number((sigmaStars * 20).toFixed(1));

  const p = Math.min(1, Math.max(0, b.value));
  const scoreB = Number((p * 100).toFixed(1));
  const sigmaB = errorBar(modelB.sigma, confidence);
  const scoreBLo = Number((Math.max(0, p - sigmaB) * 100).toFixed(1));
  const scoreBHi = Number((Math.min(1, p + sigmaB) * 100).toFixed(1));

  const publicRating =
    opts.imdbRating != null ? opts.imdbRating : meta.voteAverage != null ? meta.voteAverage : null;
  const publicSource = opts.imdbRating != null ? 'imdb' : meta.voteAverage != null ? 'tmdb' : null;
  const delta = publicRating == null ? null : Number((scoreA - publicRating * 10).toFixed(1));

  const limit = opts.topTerms ?? 8;
  return {
    scoreAStars: Number(stars.toFixed(2)),
    scoreA,
    scoreASigma,
    scoreB,
    scoreBLo,
    scoreBHi,
    publicRating,
    publicSource,
    delta,
    confidence,
    confidenceParts: parts,
    why: {
      // Model A predicts stars directly; 20 display points per star.
      a: explain(a.raw, a.contributions, built.evidence, starsToPoints, limit),
      // Model B predicts log-odds; project through the same link the score uses.
      b: explain(b.raw, b.contributions, built.evidence, (r) => logitToPoints(modelB, r), limit),
    },
    features: built.values,
    modelVersion: `${modelA.feature_version}:${modelA.fitted_at}`,
  };
}
