/**
 * `npm run verify` — end-to-end check of everything that does not need a key.
 *
 * Builds a synthetic history with a KNOWN structure (a handful of directors
 * worth returning to, some loved collections, a runtime hump), then runs the
 * real code path: CSV parse -> affinity tables -> leave-one-out features ->
 * training frame -> py/fit.py -> TypeScript scorer, and asserts that the
 * TypeScript scorer reproduces sklearn's predictions to 1e-6.
 *
 * This proves the machinery. It says nothing about the real taste model —
 * that needs the actual export.
 */
import { loadEnv } from './lib/loadEnv';
loadEnv();

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { AffinityTables, type TrainingTitle } from '../src/lib/affinity/compute';
import { parseExport } from '../src/lib/letterboxd/parse';
import { buildFeatures, featureNames, toVector, FEATURE_VERSION } from '../src/lib/scoring/features';
import { predict } from '../src/lib/scoring/scorer';
import { scoreTitle } from '../src/lib/scoring/score';
import { directorsOf } from '../src/lib/tmdb/normalise';
import type { ModelJson } from '../src/lib/scoring/model';
import type { TitleMeta } from '../src/lib/tmdb/types';

const OUT = 'models/_verify';
let failures = 0;

function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures++;
}

// ---------------------------------------------------------------- rng
let seed = 12345;
function rand(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
const gauss = () => {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

// ------------------------------------------------------ synthetic world
const N_TITLES = 800;
const N_DIRECTORS = 60;
const N_COLLECTIONS = 14;
const GENRE_IDS = [28, 12, 35, 18, 27, 878, 53, 10749, 16, 80];

interface Synth {
  meta: TitleMeta;
  rating: number;
  rewatch: boolean;
}

function makeWorld(): Synth[] {
  const dirQuality = Array.from({ length: N_DIRECTORS }, () => 3.3 + gauss() * 0.75);
  const dirReturn = Array.from({ length: N_DIRECTORS }, () => gauss() * 0.9);
  const collLove = Array.from({ length: N_COLLECTIONS }, () => rand() < 0.45);
  const keywordEffect = new Map<number, number>();
  for (let k = 0; k < 120; k++) keywordEffect.set(k, gauss() * 0.35);

  const out: Synth[] = [];
  for (let i = 0; i < N_TITLES; i++) {
    const d = Math.floor(rand() * N_DIRECTORS);
    const inColl = rand() < 0.3;
    const c = inColl ? Math.floor(rand() * N_COLLECTIONS) : null;

    // Runtime: rewatchable films cluster 95-140, the long admired ones 145-200.
    const wantsShort = rand() < 0.55;
    const runtime = wantsShort
      ? Math.round(95 + rand() * 45)
      : Math.round(140 + rand() * 60);

    const kws = Array.from({ length: 4 + Math.floor(rand() * 6) }, () => Math.floor(rand() * 120));
    const kwPush = kws.reduce((a, k) => a + (keywordEffect.get(k) ?? 0), 0) / kws.length;

    const rating = Math.min(5, Math.max(0.5,
      Math.round((dirQuality[d] + kwPush + gauss() * 0.55) * 2) / 2));

    const inBand = runtime >= 95 && runtime <= 140 ? 1 : 0;
    const logit =
      -2.3 +
      2.4 * (c !== null && collLove[c] ? 1 : 0) +
      1.6 * inBand +
      1.1 * dirReturn[d] +
      0.9 * (rating - 3.3);
    const rewatch = rand() < 1 / (1 + Math.exp(-logit));

    out.push({
      rating,
      rewatch,
      meta: {
        tmdbId: 1000 + i,
        mediaType: 'movie',
        title: `Synthetic Film ${i}`,
        originalTitle: null,
        releaseDate: `${1980 + Math.floor(rand() * 45)}-01-01`,
        releaseYear: 1980 + Math.floor(rand() * 45),
        runtime,
        originalLanguage: rand() < 0.85 ? 'en' : pick(['fr', 'ja', 'ko', 'es']),
        overview: null,
        posterPath: null,
        voteAverage: Math.min(9.5, Math.max(2, 6.4 + gauss() * 1.1)),
        voteCount: Math.round(Math.exp(4 + rand() * 5)),
        budget: rand() < 0.6 ? Math.round(Math.exp(14 + rand() * 5)) : null,
        revenue: null,
        popularity: rand() * 100,
        status: 'Released',
        imdbId: `tt${9000000 + i}`,
        collectionId: c === null ? null : 500 + c,
        collectionName: c === null ? null : `Collection ${c}`,
        genres: [{ id: pick(GENRE_IDS), name: 'G' }, { id: pick(GENRE_IDS), name: 'G2' }],
        keywords: kws.map((k) => ({ id: k, name: `kw${k}` })),
        cast: Array.from({ length: 8 }, (_, j) => ({
          id: 20000 + Math.floor(rand() * 400),
          name: `Actor ${j}`,
          order: j,
        })),
        crew: [{ id: 100 + d, name: `Director ${d}`, job: 'Director' }],
        companies: [{ id: 900 + Math.floor(rand() * 25), name: 'Studio' }],
      },
    });
  }
  return out;
}

// --------------------------------------------------------------- checks
function checkParser() {
  console.log('\nCSV parsing');
  const files = {
    'ratings.csv': [
      'Date,Name,Year,Letterboxd URI,Rating',
      '2024-01-02,"Hail, Caesar!",2016,https://boxd.it/a,4.0',
      '2024-01-03,"The ""Burbs",1989,https://boxd.it/b,3.5',
      '2024-01-04,Step Brothers,2008,https://boxd.it/c,5.0',
    ].join('\n'),
    'diary.csv': [
      'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date',
      '2024-01-04,Step Brothers,2008,https://boxd.it/c,5.0,Yes,,2024-01-04',
      '2024-06-01,Step Brothers,2008,https://boxd.it/c,5.0,Yes,,2024-06-01',
      '2024-02-01,"Hail, Caesar!",2016,https://boxd.it/a,4.0,,,2024-02-01',
    ].join('\n'),
    'watchlist.csv': 'Date,Name,Year,Letterboxd URI\n2024-01-01,Dune,2021,https://boxd.it/d',
    'lists/gammon.csv': 'Date,Name,Year,Letterboxd URI\n2024-01-01,Ignore Me,2001,https://boxd.it/z',
  };
  const { entries, report } = parseExport(files);
  const byName = new Map(entries.map((e) => [e.name, e]));

  check('quoted comma in title survives', byName.has('Hail, Caesar!'));
  check('escaped quotes survive', byName.has('The "Burbs'));
  check('lists/gammon.csv ignored', !byName.has('Ignore Me') && report.ignored.length === 1);
  check('rewatch detected', byName.get('Step Brothers')?.hasLoggedRewatch === true,
    `views=${byName.get('Step Brothers')?.diaryViews}`);
  check('single viewing is not a rewatch', byName.get('Hail, Caesar!')?.hasLoggedRewatch === false);
  check('watchlist merged', byName.get('Dune')?.inWatchlist === true);
  check('diary floor warning present', report.warnings.some((w) => w.includes('floor')));
}

function checkAffinity(world: Synth[], tables: AffinityTables) {
  console.log('\nAffinity tables');
  const g = tables.globals;
  const meanOf = world.reduce((a, w) => a + w.rating, 0) / world.length;
  check('global mean matches data', Math.abs(g.globalMean - meanOf) < 1e-9,
    `${g.globalMean.toFixed(3)}`);

  // Shrinkage must pull a single 5.0 towards the mean, not enshrine it.
  const singles = tables.byKind('actor').filter((r) => r.n === 1 && r.meanRating === 5);
  if (singles.length) {
    const s = singles[0];
    const expected = (1 * 5 + g.m * g.globalMean) / (1 + g.m);
    check('one 5.0 does not make a top predictor',
      Math.abs(s.affinity - expected) < 1e-9 && s.affinity < 4.0,
      `n=1 mean=5.00 -> affinity ${s.affinity.toFixed(2)}`);
  }

  // Leave-one-out must actually remove the row.
  const t = world.find((w) => directorsOf(w.meta).length > 0)!;
  const dirId = `p${directorsOf(t.meta)[0].id}`;
  const withSelf = tables.lookup('director', dirId);
  const without = tables.lookup('director', dirId, { rating: t.rating, rewatch: t.rewatch });
  check('leave-one-out drops the row', without.n === withSelf.n - 1,
    `n ${withSelf.n} -> ${without.n}`);
  check('leave-one-out changes the affinity',
    withSelf.n === 1 || Math.abs(without.affinity - withSelf.affinity) > 1e-9);
}

function main() {
  console.log('twoscore pipeline verification (synthetic data)\n' + '='.repeat(52));
  checkParser();

  const world = makeWorld();
  const titles: TrainingTitle[] = world.map((w, i) => ({
    key: `movie:${w.meta.tmdbId}`,
    tmdbId: w.meta.tmdbId,
    mediaType: 'movie',
    name: w.meta.title,
    rating: w.rating,
    hasLoggedRewatch: w.rewatch,
    meta: w.meta,
  }));
  const tables = new AffinityTables(titles);
  checkAffinity(world, tables);

  console.log('\nTraining frame');
  const names = featureNames();
  const rows = titles.map((t) => {
    const built = buildFeatures(t.meta, tables, { rating: t.rating, rewatch: t.hasLoggedRewatch });
    const dirs = directorsOf(t.meta);
    return {
      key: t.key,
      name: t.name,
      year: t.meta.releaseYear,
      media_type: t.mediaType,
      rating: t.rating,
      rewatch: t.hasLoggedRewatch ? 1 : 0,
      runtime: t.meta.runtime,
      group_director: dirs.length ? `d:${dirs[0].id}` : `t:${t.key}`,
      group_collection: t.meta.collectionId ? `c:${t.meta.collectionId}` : `t:${t.key}`,
      group_combined: t.meta.collectionId ? `c:${t.meta.collectionId}` : `d:${dirs[0]?.id ?? t.key}`,
      x: toVector(built.values, names).map((v) => Number(v.toFixed(6))),
    };
  });
  mkdirSync('data', { recursive: true });
  const framePath = 'data/_verify_frame.json';
  writeFileSync(framePath, JSON.stringify({
    feature_version: FEATURE_VERSION,
    generated_at: new Date().toISOString(),
    features: names,
    globals: tables.globals,
    rewatch_base_rate: rows.filter((r) => r.rewatch).length / rows.length,
    rows,
  }));
  check('frame has every row', rows.length === N_TITLES);
  check('no NaN in the matrix', rows.every((r) => r.x.every((v) => Number.isFinite(v))));
  check('rewatch rate is plausible',
    rows.filter((r) => r.rewatch).length / rows.length > 0.05,
    `${((rows.filter((r) => r.rewatch).length / rows.length) * 100).toFixed(1)}%`);

  console.log('\nFitting (py/fit.py)');
  const python = existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3';
  let fitOutput: string;
  try {
    fitOutput = execFileSync(python, ['py/fit.py', '--frame', framePath, '--out', OUT], {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: { ...process.env, PYTHONPATH: 'py' },
    });
  } catch (e: any) {
    console.log(e.stdout ?? '');
    console.error(e.stderr ?? e.message);
    check('fit.py runs', false);
    process.exit(1);
  }
  console.log(fitOutput.split('\n').map((l) => `  ${l}`).join('\n'));

  const card = JSON.parse(readFileSync(`${OUT}/model_card.json`, 'utf8'));
  check('Model A beats predict-the-mean',
    card.model_a.metrics.mae < card.model_a.baseline.mae,
    `MAE ${card.model_a.metrics.mae} vs ${card.model_a.baseline.mae}`);
  check('Model B beats chance on planted signal',
    card.model_b.metrics.auc > 0.6,
    `AUC ${card.model_b.metrics.auc}`);

  console.log('\nTypeScript scorer parity with sklearn');
  const modelA: ModelJson = JSON.parse(readFileSync(`${OUT}/model_a.json`, 'utf8'));
  const modelB: ModelJson = JSON.parse(readFileSync(`${OUT}/model_b.json`, 'utf8'));
  const parity = JSON.parse(readFileSync(`${OUT}/parity.json`, 'utf8'));

  let maxA = 0;
  let maxB = 0;
  for (const row of parity.rows) {
    const values: Record<string, number> = {};
    parity.features.forEach((f: string, i: number) => (values[f] = row.x[i]));
    maxA = Math.max(maxA, Math.abs(predict(modelA, values).value - row.a));
    maxB = Math.max(maxB, Math.abs(predict(modelB, values).value - row.b));
  }
  check(`Model A (${modelA.kind}) reproduces sklearn`, maxA < 1e-6, `max |Δ| = ${maxA.toExponential(2)}`);
  check(`Model B (${modelB.kind}) reproduces sklearn`, maxB < 1e-6, `max |Δ| = ${maxB.toExponential(2)}`);

  // Saabas attribution is exact: base + Σ contributions must equal the raw output.
  const sample: Record<string, number> = {};
  parity.features.forEach((f: string, i: number) => (sample[f] = parity.rows[0].x[i]));
  for (const [label, model] of [['A', modelA], ['B', modelB]] as const) {
    const p = predict(model, sample);
    const sum = p.base + p.contributions.reduce((a, c) => a + c.contribution, 0);
    check(`Model ${label} contributions sum to its output`, Math.abs(sum - p.raw) < 1e-6,
      `Σ = ${sum.toFixed(8)} vs raw ${p.raw.toFixed(8)}`);
  }

  console.log('\nScoring + why panel');
  const demo = scoreTitle(world[0].meta, tables, modelA, modelB);
  check('score A in range', demo.scoreA >= 10 && demo.scoreA <= 100, `${demo.scoreA}`);
  check('score B is a probability', demo.scoreB >= 0 && demo.scoreB <= 100, `${demo.scoreB}`);
  check('confidence is reported', demo.confidence > 0 && demo.confidence <= 1,
    `${demo.confidence.toFixed(2)}`);
  check('error bar is non-zero', demo.scoreASigma > 0, `±${demo.scoreASigma}`);
  check('why panel has terms', demo.why.a.length > 0 && demo.why.b.length > 0);
  for (const t of demo.why.b.slice(0, 4)) {
    console.log(`        ${t.effect >= 0 ? '+' : ''}${t.effect.toFixed(1)}  ${t.label} — ${t.detail}`);
  }

  // Cold start: a title with nothing known must score with low confidence.
  const cold: TitleMeta = {
    ...world[0].meta,
    tmdbId: 999999,
    keywords: [],
    voteCount: 3,
    voteAverage: null,
    cast: [],
    crew: [{ id: 999999, name: 'Nobody', job: 'Director' }],
    collectionId: null,
    collectionName: null,
  };
  const coldScore = scoreTitle(cold, tables, modelA, modelB);
  check('cold-start title has low confidence', coldScore.confidence < 0.35,
    `${coldScore.confidence.toFixed(2)}`);
  check('cold-start error bar is wider',
    coldScore.scoreASigma > demo.scoreASigma, `±${coldScore.scoreASigma} vs ±${demo.scoreASigma}`);

  rmSync(framePath, { force: true });
  rmSync(OUT, { recursive: true, force: true });

  console.log('\n' + '='.repeat(52));
  console.log(failures === 0 ? 'All checks passed.' : `${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
