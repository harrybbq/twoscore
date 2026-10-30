/**
 * Checks the cinema API's scoring (src/lib/cinema/score.ts) on synthetic data:
 * no database, no network, no Python.  The models here are hand-built linear
 * ones; what is being checked is the cinema-specific handling around the real
 * scorer, not anyone's taste.
 *
 *   npm run verify:cinema
 */
import { AffinityTables, type TrainingTitle } from '../src/lib/affinity/compute';
import { MAX_BATCH, parseTitles, scoreForCinema, type CinemaHistory } from '../src/lib/cinema/score';
import type { LoadedModels } from '../src/lib/models/load';
import type { ModelJson } from '../src/lib/scoring/model';
import type { MediaType, TitleMeta } from '../src/lib/tmdb/types';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => results.push({ name, ok, detail });

function meta(id: number, o: { director: number; collection?: number; mediaType?: MediaType; runtime?: number } ): TitleMeta {
  return {
    tmdbId: id,
    mediaType: o.mediaType ?? 'movie',
    title: `Synthetic ${id}`,
    originalTitle: null,
    releaseDate: '2015-01-01',
    releaseYear: 2015,
    runtime: o.runtime ?? 110,
    originalLanguage: 'en',
    overview: null,
    posterPath: null,
    voteAverage: 7,
    voteCount: 5000,
    budget: null,
    revenue: null,
    popularity: null,
    status: null,
    imdbId: null,
    collectionId: o.collection ?? null,
    collectionName: o.collection ? `Collection ${o.collection}` : null,
    genres: [{ id: 18, name: 'Drama' }],
    keywords: [1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ id: k, name: `kw${k}` })),
    cast: [1, 2, 3].map((c) => ({ id: 1000 + c, name: `Actor ${c}`, order: c - 1 })),
    crew: [{ id: o.director, name: `Director ${o.director}`, job: 'Director' }],
    companies: [],
  };
}

// Director 1: four films, all rewatched and rated highly.  Director 2: four films, admired, never rewatched.
const train: TrainingTitle[] = [];
for (let i = 0; i < 4; i++) {
  train.push({ key: `movie:${10 + i}`, tmdbId: 10 + i, mediaType: 'movie', name: `Comfort ${i}`, rating: 4.5, hasLoggedRewatch: true, meta: meta(10 + i, { director: 1, collection: 77 }) });
  train.push({ key: `movie:${20 + i}`, tmdbId: 20 + i, mediaType: 'movie', name: `Admired ${i}`, rating: 4.5, hasLoggedRewatch: false, meta: meta(20 + i, { director: 2 }) });
}
for (let i = 0; i < 12; i++) {
  train.push({ key: `movie:${40 + i}`, tmdbId: 40 + i, mediaType: 'movie', name: `Filler ${i}`, rating: 2.5, hasLoggedRewatch: false, meta: meta(40 + i, { director: 3 + i }) });
}
const tables = new AffinityTables(train);

const linear = (name: 'model_a' | 'model_b', features: string[], coef: number[], intercept: number): ModelJson => ({
  name,
  target: name === 'model_a' ? 'rating' : 'rewatch',
  kind: name === 'model_a' ? 'ridge' : 'logistic',
  feature_version: 'f1',
  features,
  standardizer: { mean: features.map(() => 0), scale: features.map(() => 1) },
  linear: { coef, intercept },
  clip: name === 'model_a' ? [0.5, 5] : undefined,
  sigma: name === 'model_a' ? 0.6 : 0.12,
  metrics: {},
  fitted_at: '2026-10-29T00:00:00Z',
  rows: train.length,
});
const models: LoadedModels = {
  a: linear('model_a', ['a_director', 'a_collection'], [0.6, 0.3], 0.3),
  b: linear('model_b', ['rw_director', 'rw_collection', 'loved_collection'], [4, 2, 0.5], -2),
  card: {} as any,
};

// An unseen title by the comfort director.
{
  const s = scoreForCinema(meta(900, { director: 1, collection: 77 }), undefined, tables, models);
  check('unseen: not in history, nothing left out', s.history === null && !s.leftOneOut);
  check('unseen: scores in range with error bars', s.scoreA > 0 && s.scoreA <= 100 && s.scoreASigma > 0 && s.scoreBLo <= s.scoreB && s.scoreB <= s.scoreBHi, JSON.stringify([s.scoreA, s.scoreASigma, s.scoreBLo, s.scoreB, s.scoreBHi]));
  check('unseen: confidence present, 0..1', s.confidence > 0 && s.confidence <= 1, String(s.confidence));
  check('unseen: at most 3 reasons per score', s.why.a.length <= 3 && s.why.b.length <= 3);
  const admired = scoreForCinema(meta(901, { director: 2 }), undefined, tables, models);
  check('comfort director scores higher on B than the admired one', s.scoreB > admired.scoreB, `${s.scoreB} vs ${admired.scoreB}`);
}

// A seen, rated, rewatched title: its own rating and rewatch come out of the affinities first.
{
  const seen = train[0];
  const h: CinemaHistory = { tmdbId: seen.tmdbId, mediaType: 'movie', rating: 4.5, liked: true, diaryViews: 3, rewatchViews: 2, hasLoggedRewatch: true, excluded: false };
  const loo = scoreForCinema(seen.meta, h, tables, models);
  const leaky = scoreForCinema(seen.meta, { ...h, excluded: true }, tables, models); // excluded = scored without leaving out
  check('seen: left one out, history returned', loo.leftOneOut && loo.history?.rewatchViews === 2);
  check('seen: leaving its own rewatch out lowers Score B', loo.scoreB < leaky.scoreB, `${loo.scoreB} < ${leaky.scoreB}`);
}

// Joke-rated and unrated history rows were never in training: nothing is left out.
{
  const h: CinemaHistory = { tmdbId: 20, mediaType: 'movie', rating: 0.5, liked: false, diaryViews: 1, rewatchViews: 0, hasLoggedRewatch: false, excluded: true };
  check('joke-rated: not left out', !scoreForCinema(train[1].meta, h, tables, models).leftOneOut);
  check('unrated: not left out', !scoreForCinema(train[1].meta, { ...h, excluded: false, rating: null }, tables, models).leftOneOut);
}

// TV carries the 0.75 confidence multiplier.
{
  const film = scoreForCinema(meta(902, { director: 1 }), undefined, tables, models);
  const tv = scoreForCinema(meta(902, { director: 1, mediaType: 'tv' }), undefined, tables, models);
  check('TV: flagged, confidence x0.75', tv.isTv && !film.isTv && Math.abs(tv.confidence - film.confidence * 0.75) < 1e-3, `${tv.confidence} vs ${film.confidence}`);
  check('TV: wider error bars', tv.scoreASigma > film.scoreASigma, `${tv.scoreASigma} vs ${film.scoreASigma}`);
}

// Deterministic: same input, same output.
{
  const m = meta(903, { director: 1, collection: 77 });
  check('deterministic', JSON.stringify(scoreForCinema(m, undefined, tables, models)) === JSON.stringify(scoreForCinema(m, undefined, tables, models)));
}

// Request validation.
{
  const ok = parseTitles({ titles: [{ tmdbId: 1, mediaType: 'movie' }, { tmdbId: 1, mediaType: 'movie' }, { tmdbId: 1, mediaType: 'tv' }] });
  check('request: repeats dropped, movie and tv kept apart', Array.isArray(ok) && ok.length === 2, JSON.stringify(ok));
  check('request: too many refused', typeof parseTitles({ titles: Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ tmdbId: i + 1, mediaType: 'movie' })) }) === 'string');
  check('request: bad media type refused', typeof parseTitles({ titles: [{ tmdbId: 1, mediaType: 'film' }] }) === 'string');
  check('request: missing list refused', typeof parseTitles({}) === 'string');
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.ok ? `  (${r.detail})` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} cinema API checks passed`);
process.exit(failed ? 1 : 0);
