import { AffinityTables, entitiesOf } from '@/lib/affinity/compute';
import { directorsOf, writersOf } from '@/lib/tmdb/normalise';
import type { TitleMeta } from '@/lib/tmdb/types';
import { DECADES, DECADE_FEATURES, GENRE_FEATURES, GENRE_SLUGS } from './genres';

/**
 * THE contract between Python and TypeScript.
 *
 * Feature engineering happens here and nowhere else.  `py/fit.py` never looks
 * at a TMDB payload; it is handed this exact matrix by
 * `scripts/export-training-frame.ts` and returns coefficients keyed by these
 * names.  That is what makes "fit in Python, score in TypeScript" safe: there
 * is no second implementation to drift.
 */
export const FEATURE_VERSION = 'f1';

/** Rewatched films cluster here; admired-but-never-rewatched sit well above. */
export const REWATCH_BAND: [number, number] = [95, 140];
const RUNTIME_CENTRE = 120;
const RUNTIME_SCALE = 60;
const MEDIAN_RUNTIME = 105;
const KEYWORD_TOP_K = 8;

export interface EvidenceTerm {
  feature: string;
  label: string;
  detail: string;
  n: number | null;
  value: number;
}

export interface BuiltFeatures {
  values: Record<string, number>;
  evidence: EvidenceTerm[];
  /** Inputs used for the confidence score. */
  completeness: {
    keywordCount: number;
    voteCount: number;
    directorKnown: boolean;
    castKnown: number;
    hasRuntime: boolean;
    hasGenres: boolean;
    isTv: boolean;
  };
}

export interface ExcludeSelf {
  rating: number;
  rewatch: boolean;
}

function log1p(x: number): number {
  return Math.log(1 + Math.max(0, x));
}

/** Billing-weighted mean: the lead matters more than the eighth name. */
function billingWeighted(vals: { v: number; order: number }[], fallback: number): number {
  if (!vals.length) return fallback;
  let num = 0;
  let den = 0;
  for (const { v, order } of vals) {
    const w = 1 / (1 + order);
    num += v * w;
    den += w;
  }
  return num / den;
}

export function buildFeatures(
  meta: TitleMeta,
  tables: AffinityTables,
  exclude?: ExcludeSelf,
): BuiltFeatures {
  const f: Record<string, number> = {};
  const ev: EvidenceTerm[] = [];
  const { globalMean, globalRewatchRate } = tables.globals;
  const ex = exclude ? { rating: exclude.rating, rewatch: exclude.rewatch } : undefined;

  // ---------------------------------------------------------- people
  const dirs = directorsOf(meta);
  const dirVals = dirs.map((d) => tables.lookup('director', `p${d.id}`, ex));
  const bestDir = dirVals.reduce<(typeof dirVals)[0] | null>(
    (best, v, i) => (best === null || v.n > best.n ? { ...v, name: dirs[i].name } : best),
    null,
  );
  f.a_director = dirVals.length ? Math.max(...dirVals.map((v) => v.affinity)) : globalMean;
  f.rw_director = dirVals.length ? Math.max(...dirVals.map((v) => v.rewatchAffinity)) : globalRewatchRate;
  f.director_n = log1p(bestDir?.n ?? 0);
  f.director_known = bestDir && bestDir.n > 0 ? 1 : 0;
  if (bestDir && bestDir.n > 0) {
    ev.push({
      feature: 'a_director',
      label: `Director ${bestDir.name}`,
      detail: `${bestDir.n} rated ${bestDir.n === 1 ? 'film' : 'films'}, mean ${bestDir.meanRating!.toFixed(2)}, ${Math.round((bestDir.rewatchRate ?? 0) * 100)}% rewatched`,
      n: bestDir.n,
      value: f.a_director,
    });
  }

  const writers = writersOf(meta);
  const wVals = writers.map((w) => tables.lookup('writer', `p${w.id}`, ex));
  f.a_writer = wVals.length ? Math.max(...wVals.map((v) => v.affinity)) : globalMean;
  f.rw_writer = wVals.length ? Math.max(...wVals.map((v) => v.rewatchAffinity)) : globalRewatchRate;
  const bestWriter = wVals.reduce<{ v: (typeof wVals)[0]; name: string } | null>(
    (b, v, i) => (b === null || v.n > b.v.n ? { v, name: writers[i].name } : b),
    null,
  );
  f.writer_known = bestWriter && bestWriter.v.n > 0 ? 1 : 0;
  if (bestWriter && bestWriter.v.n > 1) {
    ev.push({
      feature: 'a_writer',
      label: `Writer ${bestWriter.name}`,
      detail: `${bestWriter.v.n} films, mean ${bestWriter.v.meanRating!.toFixed(2)}`,
      n: bestWriter.v.n,
      value: f.a_writer,
    });
  }

  const castVals = meta.cast.slice(0, 8).map((c) => ({
    order: c.order ?? 0,
    name: c.name,
    val: tables.lookup('actor', `p${c.id}`, ex),
  }));
  const known = castVals.filter((c) => c.val.n > 0);
  f.a_cast = billingWeighted(
    castVals.map((c) => ({ v: c.val.affinity, order: c.order })),
    globalMean,
  );
  f.rw_cast = billingWeighted(
    castVals.map((c) => ({ v: c.val.rewatchAffinity, order: c.order })),
    globalRewatchRate,
  );
  f.a_cast_max = known.length ? Math.max(...known.map((c) => c.val.affinity)) : globalMean;
  f.cast_known = known.length;
  const topCast = known.slice().sort((a, b) => b.val.n - a.val.n)[0];
  if (topCast && topCast.val.n > 1) {
    ev.push({
      feature: 'a_cast',
      label: `Cast ${topCast.name}`,
      detail: `${topCast.val.n} films, mean ${topCast.val.meanRating!.toFixed(2)}`,
      n: topCast.val.n,
      value: topCast.val.affinity,
    });
  }

  // ------------------------------------------------------ collection
  const collId = meta.collectionId ? `c${meta.collectionId}` : null;
  const coll = collId ? tables.lookup('collection', collId, ex) : null;
  f.a_collection = coll && coll.n > 0 ? coll.affinity : globalMean;
  f.rw_collection = coll && coll.n > 0 ? coll.rewatchAffinity : globalRewatchRate;
  f.in_collection = collId ? 1 : 0;
  // The heaviest expected term in Model B: I return to universes, not themes.
  f.loved_collection = tables.isLovedCollection(collId, exclude ? { rating: exclude.rating } : undefined) ? 1 : 0;
  f.collection_n = log1p(coll?.n ?? 0);
  if (coll && coll.n > 0) {
    ev.push({
      feature: 'loved_collection',
      label: `Collection ${meta.collectionName}`,
      detail: `${coll.n} rated ${coll.n === 1 ? 'entry' : 'entries'}, mean ${coll.meanRating!.toFixed(2)}${f.loved_collection ? ' — you rate this universe 4.0+' : ''}`,
      n: coll.n,
      value: f.a_collection,
    });
  }

  // --------------------------------------------------------- company
  const compVals = meta.companies.map((c) => tables.lookup('company', `co${c.id}`, ex));
  const knownComp = compVals.filter((v) => v.n > 0);
  f.a_company = knownComp.length ? Math.max(...knownComp.map((v) => v.affinity)) : globalMean;
  f.rw_company = knownComp.length ? Math.max(...knownComp.map((v) => v.rewatchAffinity)) : globalRewatchRate;

  // -------------------------------------------------------- keywords
  const kwVals = meta.keywords
    .map((k) => ({ name: k.name, val: tables.lookup('keyword', `k${k.id}`, ex) }))
    .filter((k) => k.val.n > 0)
    .sort((a, b) => b.val.n - a.val.n)
    .slice(0, KEYWORD_TOP_K);
  if (kwVals.length) {
    let num = 0;
    let den = 0;
    let rnum = 0;
    for (const k of kwVals) {
      const w = log1p(k.val.n);
      num += k.val.affinity * w;
      rnum += k.val.rewatchAffinity * w;
      den += w;
    }
    f.a_keyword = den ? num / den : globalMean;
    f.rw_keyword = den ? rnum / den : globalRewatchRate;
    f.a_keyword_max = Math.max(...kwVals.map((k) => k.val.affinity));
    f.a_keyword_min = Math.min(...kwVals.map((k) => k.val.affinity));
    const top = kwVals.slice().sort((a, b) => b.val.affinity - a.val.affinity)[0];
    if (top.val.n >= 3) {
      ev.push({
        feature: 'a_keyword',
        label: `Keyword "${top.name}"`,
        detail: `affinity ${top.val.affinity.toFixed(2)} (n=${top.val.n})`,
        n: top.val.n,
        value: top.val.affinity,
      });
    }
  } else {
    f.a_keyword = globalMean;
    f.rw_keyword = globalRewatchRate;
    f.a_keyword_max = globalMean;
    f.a_keyword_min = globalMean;
  }
  f.keyword_known = kwVals.length;
  f.keyword_count = log1p(meta.keywords.length);

  // ---------------------------------------------------------- genres
  const genreVals = meta.genres.map((g) => tables.lookup('genre', `g${g.id}`, ex));
  f.a_genre = genreVals.length
    ? genreVals.reduce((a, v) => a + v.affinity, 0) / genreVals.length
    : globalMean;
  f.rw_genre = genreVals.length
    ? genreVals.reduce((a, v) => a + v.rewatchAffinity, 0) / genreVals.length
    : globalRewatchRate;
  f.a_genre_max = genreVals.length ? Math.max(...genreVals.map((v) => v.affinity)) : globalMean;
  for (const name of GENRE_FEATURES) f[name] = 0;
  for (const g of meta.genres) {
    const slug = GENRE_SLUGS[g.id];
    if (slug) f[`genre_${slug}`] = 1;
  }
  const bestGenre = meta.genres
    .map((g, i) => ({ g, v: genreVals[i] }))
    .filter((x) => x.v.n >= 5)
    .sort((a, b) => b.v.affinity - a.v.affinity)[0];
  if (bestGenre) {
    ev.push({
      feature: 'a_genre',
      label: `Genre ${bestGenre.g.name}`,
      detail: `affinity ${bestGenre.v.affinity.toFixed(2)} (n=${bestGenre.v.n})`,
      n: bestGenre.v.n,
      value: bestGenre.v.affinity,
    });
  }

  // -------------------------------------------------------- language
  const lang = meta.originalLanguage;
  const langVal = lang ? tables.lookup('language', `l${lang}`, ex) : null;
  f.a_language = langVal && langVal.n > 0 ? langVal.affinity : globalMean;
  f.rw_language = langVal && langVal.n > 0 ? langVal.rewatchAffinity : globalRewatchRate;
  f.is_english = lang === 'en' ? 1 : 0;

  // --------------------------------------------------------- numeric
  const rt = meta.runtime ?? MEDIAN_RUNTIME;
  const rtC = (rt - RUNTIME_CENTRE) / RUNTIME_SCALE;
  f.runtime = rtC;
  // Explicit square: the rewatch curve is a hump, not a slope, and a linear
  // model will never find it on its own.
  f.runtime_sq = rtC * rtC;
  f.runtime_missing = meta.runtime ? 0 : 1;
  f.runtime_in_band = rt >= REWATCH_BAND[0] && rt <= REWATCH_BAND[1] ? 1 : 0;
  if (meta.runtime) {
    ev.push({
      feature: 'runtime_in_band',
      label: `Runtime ${meta.runtime} min`,
      detail: f.runtime_in_band
        ? `inside your ${REWATCH_BAND[0]}–${REWATCH_BAND[1]} min rewatch band`
        : `outside your ${REWATCH_BAND[0]}–${REWATCH_BAND[1]} min rewatch band`,
      n: null,
      value: f.runtime_in_band,
    });
  }

  f.vote_average = meta.voteAverage ?? 6.5;
  f.vote_missing = meta.voteAverage === null ? 1 : 0;
  f.log_vote_count = log1p(meta.voteCount ?? 0);
  f.log_budget = log1p(meta.budget ?? 0);
  f.has_budget = meta.budget ? 1 : 0;
  f.is_tv = meta.mediaType === 'tv' ? 1 : 0;

  const yr = meta.releaseYear ?? new Date().getFullYear();
  f.release_year = (yr - 2000) / 20;
  for (const name of DECADE_FEATURES) f[name] = 0;
  const dec = Math.min(Math.max(Math.floor(yr / 10) * 10, DECADES[0]), DECADES[DECADES.length - 1]);
  f[`dec_${dec}`] = 1;

  return {
    values: f,
    evidence: ev,
    completeness: {
      keywordCount: meta.keywords.length,
      voteCount: meta.voteCount ?? 0,
      directorKnown: f.director_known === 1,
      castKnown: known.length,
      hasRuntime: !!meta.runtime,
      hasGenres: meta.genres.length > 0,
      isTv: meta.mediaType === 'tv',
    },
  };
}

/** Canonical, sorted feature-name list.  Both models are subsets of this. */
export function featureNames(): string[] {
  const base = [
    'a_director', 'rw_director', 'director_n', 'director_known',
    'a_writer', 'rw_writer', 'writer_known',
    'a_cast', 'rw_cast', 'a_cast_max', 'cast_known',
    'a_collection', 'rw_collection', 'in_collection', 'loved_collection', 'collection_n',
    'a_company', 'rw_company',
    'a_keyword', 'rw_keyword', 'a_keyword_max', 'a_keyword_min', 'keyword_known', 'keyword_count',
    'a_genre', 'rw_genre', 'a_genre_max',
    'a_language', 'rw_language', 'is_english',
    'runtime', 'runtime_sq', 'runtime_missing', 'runtime_in_band',
    'vote_average', 'vote_missing', 'log_vote_count', 'log_budget', 'has_budget',
    'is_tv', 'release_year',
  ];
  return [...base, ...GENRE_FEATURES, ...DECADE_FEATURES];
}

export function toVector(values: Record<string, number>, names: string[]): number[] {
  return names.map((n) => {
    const v = values[n];
    return Number.isFinite(v) ? v : 0;
  });
}
