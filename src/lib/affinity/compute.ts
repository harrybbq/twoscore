import { directorsOf, writersOf } from '@/lib/tmdb/normalise';
import type { TitleMeta } from '@/lib/tmdb/types';
import { AFFINITY_KINDS, type AffinityGlobals, type AffinityKind, type AffinityRow, type AffinityValue } from './types';

/** Shrinkage strength.  m=3 means an entity needs ~3 films to move much. */
export const DEFAULT_M = 3;
export const FALLBACK_GLOBAL_MEAN = 3.28;
export const FALLBACK_GLOBAL_REWATCH = 0.15;

export interface TrainingTitle {
  key: string;
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  name: string;
  rating: number;
  hasLoggedRewatch: boolean;
  meta: TitleMeta;
}

export interface EntityRef {
  kind: AffinityKind;
  id: string;
  name: string;
}

/** Every affinity entity a title contributes to / is scored against. */
export function entitiesOf(meta: TitleMeta): EntityRef[] {
  const out: EntityRef[] = [];
  for (const d of directorsOf(meta)) out.push({ kind: 'director', id: `p${d.id}`, name: d.name });
  for (const w of writersOf(meta)) out.push({ kind: 'writer', id: `p${w.id}`, name: w.name });
  for (const c of meta.cast.slice(0, 8)) out.push({ kind: 'actor', id: `p${c.id}`, name: c.name });
  if (meta.collectionId)
    out.push({ kind: 'collection', id: `c${meta.collectionId}`, name: meta.collectionName ?? 'Collection' });
  for (const c of meta.companies) out.push({ kind: 'company', id: `co${c.id}`, name: c.name });
  for (const k of meta.keywords) out.push({ kind: 'keyword', id: `k${k.id}`, name: k.name });
  for (const g of meta.genres) out.push({ kind: 'genre', id: `g${g.id}`, name: g.name });
  if (meta.releaseYear) {
    const dec = Math.floor(meta.releaseYear / 10) * 10;
    out.push({ kind: 'decade', id: `d${dec}`, name: `${dec}s` });
  }
  if (meta.originalLanguage)
    out.push({ kind: 'language', id: `l${meta.originalLanguage}`, name: meta.originalLanguage });

  // A person credited twice (writer-director, or double-billed) must only
  // count once per kind or their sample size inflates.
  const seen = new Set<string>();
  return out.filter((e) => {
    const k = `${e.kind}:${e.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export class AffinityTables {
  readonly rows = new Map<string, AffinityRow>();
  readonly globals: AffinityGlobals;
  /** Collections in which at least one entry was rated >= 4.0. */
  readonly lovedCollections = new Set<string>();

  constructor(titles: TrainingTitle[], m = DEFAULT_M) {
    const rated = titles.filter((t) => Number.isFinite(t.rating));
    const globalMean = rated.length
      ? rated.reduce((a, t) => a + t.rating, 0) / rated.length
      : FALLBACK_GLOBAL_MEAN;
    const globalRewatchRate = rated.length
      ? rated.filter((t) => t.hasLoggedRewatch).length / rated.length
      : FALLBACK_GLOBAL_REWATCH;
    this.globals = { m, globalMean, globalRewatchRate, ratedTitles: rated.length };

    for (const t of rated) {
      for (const e of entitiesOf(t.meta)) {
        const key = `${e.kind}:${e.id}`;
        let row = this.rows.get(key);
        if (!row) {
          row = {
            kind: e.kind,
            entityId: e.id,
            entityName: e.name,
            n: 0,
            sumRating: 0,
            meanRating: 0,
            affinity: 0,
            nRewatch: 0,
            rewatchRate: 0,
            rewatchAffinity: 0,
            bestTitle: null,
            bestRating: null,
            secondBestRating: null,
          };
          this.rows.set(key, row);
        }
        row.n += 1;
        row.sumRating += t.rating;
        if (t.hasLoggedRewatch) row.nRewatch += 1;
        if (row.bestRating === null || t.rating > row.bestRating) {
          row.secondBestRating = row.bestRating;
          row.bestRating = t.rating;
          row.bestTitle = t.name;
        } else if (row.secondBestRating === null || t.rating > row.secondBestRating) {
          row.secondBestRating = t.rating;
        }
      }
      if (t.meta.collectionId && t.rating >= 4.0) this.lovedCollections.add(`c${t.meta.collectionId}`);
    }

    for (const row of this.rows.values()) {
      row.meanRating = row.sumRating / row.n;
      row.rewatchRate = row.nRewatch / row.n;
      row.affinity = shrink(row.n, row.meanRating, m, globalMean);
      row.rewatchAffinity = shrink(row.n, row.rewatchRate, m, globalRewatchRate);
    }
  }

  /**
   * Affinity for one entity.
   *
   * `exclude` removes a single title's own contribution first.  Fitting on
   * features that already contain the row's target is the classic way to
   * produce a model that looks excellent and predicts nothing, so training
   * always passes the row being scored here.
   */
  lookup(kind: AffinityKind, id: string, exclude?: { rating: number; rewatch: boolean }): AffinityValue {
    const row = this.rows.get(`${kind}:${id}`);
    const { m, globalMean, globalRewatchRate } = this.globals;
    if (!row) {
      return {
        affinity: globalMean,
        rewatchAffinity: globalRewatchRate,
        n: 0,
        meanRating: null,
        rewatchRate: null,
        name: null,
      };
    }
    let n = row.n;
    let sum = row.sumRating;
    let nRw = row.nRewatch;
    if (exclude) {
      n -= 1;
      sum -= exclude.rating;
      if (exclude.rewatch) nRw -= 1;
    }
    if (n <= 0) {
      return {
        affinity: globalMean,
        rewatchAffinity: globalRewatchRate,
        n: 0,
        meanRating: null,
        rewatchRate: null,
        name: row.entityName,
      };
    }
    const mean = sum / n;
    const rate = nRw / n;
    return {
      affinity: shrink(n, mean, m, globalMean),
      rewatchAffinity: shrink(n, rate, m, globalRewatchRate),
      n,
      meanRating: mean,
      rewatchRate: rate,
      name: row.entityName,
    };
  }

  /**
   * True when another entry in this collection was rated >= 4.0.
   *
   * `excludeSelf` makes this exact under leave-one-out: if the title being
   * scored *is* the collection's best entry, the test falls back to the
   * second best, so a film is never its own evidence that you love the
   * universe it belongs to.
   */
  isLovedCollection(collectionId: string | null, excludeSelf?: { rating: number }): boolean {
    if (!collectionId) return false;
    const row = this.rows.get(`collection:${collectionId}`);
    if (!row) return this.lovedCollections.has(collectionId);
    if (!excludeSelf) return (row.bestRating ?? 0) >= 4.0;
    const best =
      row.bestRating !== null && excludeSelf.rating >= row.bestRating
        ? row.secondBestRating
        : row.bestRating;
    return (best ?? 0) >= 4.0;
  }

  byKind(kind: AffinityKind): AffinityRow[] {
    return [...this.rows.values()].filter((r) => r.kind === kind);
  }

  toJSON() {
    return {
      globals: this.globals,
      lovedCollections: [...this.lovedCollections],
      rows: [...this.rows.values()],
    };
  }

  static fromJSON(json: ReturnType<AffinityTables['toJSON']>): AffinityTables {
    const t = Object.create(AffinityTables.prototype) as AffinityTables;
    (t as any).rows = new Map(json.rows.map((r) => [`${r.kind}:${r.entityId}`, r]));
    (t as any).globals = json.globals;
    (t as any).lovedCollections = new Set(json.lovedCollections);
    return t;
  }
}

export function shrink(n: number, mean: number, m: number, global: number): number {
  return (n * mean + m * global) / (n + m);
}

export const ALL_KINDS = AFFINITY_KINDS;
