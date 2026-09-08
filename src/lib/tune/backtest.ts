import { AffinityTables, DEFAULT_M } from '@/lib/affinity/compute';
import { loadTrainingTitles } from '@/lib/affinity/loadTraining';
import { buildFeatures, featureNames } from '@/lib/scoring/features';
import type { ModelJson } from '@/lib/scoring/model';
import { predict } from '@/lib/scoring/scorer';
import { calibrationBins, mae, precisionAtK, rocAuc, spearman, type CalibrationBin } from './metrics';

/** Feature families the /tune sliders act on. */
export const WEIGHT_GROUPS = [
  'director',
  'writer',
  'cast',
  'collection',
  'keyword',
  'genre',
  'company',
  'language',
  'runtime',
  'public',
] as const;
export type WeightGroup = (typeof WEIGHT_GROUPS)[number];

export function groupOf(feature: string): WeightGroup | null {
  if (feature.includes('director')) return 'director';
  if (feature.includes('writer')) return 'writer';
  if (feature.includes('cast')) return 'cast';
  if (feature.includes('collection')) return 'collection';
  if (feature.includes('keyword')) return 'keyword';
  if (feature.startsWith('genre_') || feature.includes('genre')) return 'genre';
  if (feature.includes('company')) return 'company';
  if (feature.includes('language') || feature === 'is_english') return 'language';
  if (feature.startsWith('runtime')) return 'runtime';
  if (feature.startsWith('vote_') || feature === 'log_vote_count') return 'public';
  return null;
}

export interface BacktestRow {
  key: string;
  name: string;
  year: number | null;
  rating: number;
  rewatch: number;
  values: Record<string, number>;
}

let frameCache: { m: number; rows: BacktestRow[]; at: number } | null = null;
const FRAME_TTL = 10 * 60 * 1000;

/**
 * Rebuild the leave-one-out design matrix from the history.
 *
 * `m` is a live knob: changing the shrinkage changes the affinities, which
 * changes the features, so a /tune run with a different m is a genuinely
 * different backtest rather than the same numbers rescaled.
 */
export async function buildBacktestRows(m = DEFAULT_M): Promise<BacktestRow[]> {
  if (frameCache && frameCache.m === m && Date.now() - frameCache.at < FRAME_TTL) return frameCache.rows;
  const titles = await loadTrainingTitles();
  const tables = new AffinityTables(titles, m);
  const rows = titles.map((t) => ({
    key: t.key,
    name: t.name,
    year: t.meta.releaseYear,
    rating: t.rating,
    rewatch: t.hasLoggedRewatch ? 1 : 0,
    values: buildFeatures(t.meta, tables, { rating: t.rating, rewatch: t.hasLoggedRewatch }).values,
  }));
  frameCache = { m, rows, at: Date.now() };
  return rows;
}

export function clearBacktestCache() {
  frameCache = null;
}

/** Apply per-group multipliers to a linear model's coefficients. */
export function reweight(model: ModelJson, weights: Partial<Record<WeightGroup, number>>): ModelJson {
  if (model.kind === 'gbm' || !model.linear) return model;
  const coef = model.linear.coef.map((c, i) => {
    const g = groupOf(model.features[i]);
    const w = g ? (weights[g] ?? 1) : 1;
    return c * w;
  });
  return { ...model, linear: { ...model.linear, coef } };
}

export interface BacktestMetrics {
  a: { mae: number; spearman: number; baselineMae: number; n: number };
  b: {
    auc: number;
    precisionAt20: number;
    baseRate: number;
    calibration: CalibrationBin[];
    n: number;
  };
}

export interface BacktestPoint {
  key: string;
  name: string;
  year: number | null;
  actualRating: number;
  predictedRating: number;
  residual: number;
  actualRewatch: number;
  predictedRewatch: number;
}

/**
 * Re-score the history with the given models and report the metrics.
 *
 * This is an in-sample re-score, not a refit: the models were fitted under
 * grouped CV by py/fit.py and those are the numbers on the model card. What
 * this measures is the *direction* a weight change moves things — useful for
 * exploring, useless as a headline metric, and labelled as such in the UI.
 */
export function backtest(
  rows: BacktestRow[],
  modelA: ModelJson,
  modelB: ModelJson,
): { metrics: BacktestMetrics; points: BacktestPoint[] } {
  const points: BacktestPoint[] = rows.map((r) => {
    const pa = Math.min(5, Math.max(0.5, predict(modelA, r.values).value));
    const pb = Math.min(1, Math.max(0, predict(modelB, r.values).value));
    return {
      key: r.key,
      name: r.name,
      year: r.year,
      actualRating: r.rating,
      predictedRating: Number(pa.toFixed(3)),
      residual: Number((pa - r.rating).toFixed(3)),
      actualRewatch: r.rewatch,
      predictedRewatch: Number(pb.toFixed(4)),
    };
  });

  const yA = points.map((p) => p.actualRating);
  const pA = points.map((p) => p.predictedRating);
  const meanA = yA.reduce((a, b) => a + b, 0) / (yA.length || 1);
  const yB = points.map((p) => p.actualRewatch);
  const pB = points.map((p) => p.predictedRewatch);

  return {
    metrics: {
      a: {
        mae: mae(yA, pA),
        spearman: spearman(yA, pA),
        baselineMae: mae(yA, yA.map(() => meanA)),
        n: yA.length,
      },
      b: {
        auc: rocAuc(yB, pB),
        precisionAt20: precisionAtK(yB, pB, 20),
        baseRate: yB.reduce((a, b) => a + b, 0) / (yB.length || 1),
        calibration: calibrationBins(yB, pB),
        n: yB.length,
      },
    },
    points,
  };
}
