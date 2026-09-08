import { AffinityTables, DEFAULT_M, FALLBACK_GLOBAL_MEAN, FALLBACK_GLOBAL_REWATCH } from './compute';
import type { AffinityGlobals, AffinityRow } from './types';
import { db, dbConfigured } from '@/lib/supabase/server';

/** Globals live in the same table under a reserved kind, so one read gets everything. */
export const GLOBALS_KIND = 'global';
export const GLOBALS_ID = 'globals';

let cached: { tables: AffinityTables; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

function rowToAffinity(r: any): AffinityRow {
  const n = r.n ?? 0;
  const mean = r.mean_rating === null ? 0 : Number(r.mean_rating);
  return {
    kind: r.kind,
    entityId: r.entity_id,
    entityName: r.entity_name,
    n,
    sumRating: mean * n,
    meanRating: mean,
    affinity: Number(r.affinity),
    nRewatch: r.n_rewatch ?? 0,
    rewatchRate: r.rewatch_rate === null ? 0 : Number(r.rewatch_rate),
    rewatchAffinity: Number(r.rewatch_affinity),
    bestTitle: r.best_title ?? null,
    bestRating: r.best_rating === null || r.best_rating === undefined ? null : Number(r.best_rating),
  };
}

/**
 * Affinity tables as written by `npm run affinities`.  Module-scope cached so a
 * warm instance scoring 200 titles reads them once, not 200 times — Supabase
 * compute is small and this is the heaviest read in the app.
 */
export async function loadAffinities(force = false): Promise<AffinityTables | null> {
  if (!force && cached && Date.now() - cached.at < TTL_MS) return cached.tables;
  if (!dbConfigured()) return null;

  const raw: any[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from('affinities').select('*').range(from, from + PAGE - 1);
    if (error) {
      console.warn('[affinities] load failed:', error.message);
      return null;
    }
    if (!data?.length) break;
    raw.push(...data);
    if (data.length < PAGE) break;
  }
  if (!raw.length) return null;

  const globalsRow = raw.find((r) => r.kind === GLOBALS_KIND);
  const globals: AffinityGlobals = globalsRow
    ? JSON.parse(globalsRow.entity_name)
    : {
        m: DEFAULT_M,
        globalMean: FALLBACK_GLOBAL_MEAN,
        globalRewatchRate: FALLBACK_GLOBAL_REWATCH,
        ratedTitles: 0,
      };

  const rows = raw.filter((r) => r.kind !== GLOBALS_KIND).map(rowToAffinity);
  const tables = AffinityTables.fromJSON({
    globals,
    // A collection counts as "loved" when any rated entry in it reached 4.0.
    lovedCollections: rows
      .filter((r) => r.kind === 'collection' && (r.bestRating ?? 0) >= 4.0)
      .map((r) => r.entityId),
    rows,
  });
  cached = { tables, at: Date.now() };
  return tables;
}

export function affinityToRow(r: AffinityRow) {
  return {
    kind: r.kind,
    entity_id: r.entityId,
    entity_name: r.entityName,
    n: r.n,
    mean_rating: r.meanRating,
    affinity: r.affinity,
    n_rewatch: r.nRewatch,
    rewatch_rate: r.rewatchRate,
    rewatch_affinity: r.rewatchAffinity,
    best_title: r.bestTitle,
    best_rating: r.bestRating,
    computed_at: new Date().toISOString(),
  };
}

export function globalsToRow(g: AffinityGlobals) {
  return {
    kind: GLOBALS_KIND,
    entity_id: GLOBALS_ID,
    entity_name: JSON.stringify(g),
    n: g.ratedTitles,
    mean_rating: g.globalMean,
    affinity: g.globalMean,
    n_rewatch: 0,
    rewatch_rate: g.globalRewatchRate,
    rewatch_affinity: g.globalRewatchRate,
    best_title: null,
    best_rating: null,
    computed_at: new Date().toISOString(),
  };
}

export function clearAffinityCache() {
  cached = null;
}
