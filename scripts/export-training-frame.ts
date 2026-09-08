/**
 * `npm run frame` — build the design matrix Python fits on.
 *
 * Two things happen here that decide whether the reported metrics mean
 * anything:
 *
 *  1. Every row's features are built with its OWN contribution removed from
 *     the affinity tables (leave-one-out).  Without that, a director's
 *     affinity already contains the rating being predicted.
 *  2. Group labels are emitted for grouped CV.  With five Guardians entries
 *     and a large Marvel / Spider-Man / Harry Potter block, random k-fold
 *     puts sequels of the same franchise on both sides of the split and
 *     reports a score the model cannot reproduce on anything new.
 */
import { loadEnv } from './lib/loadEnv';
loadEnv();

import { writeFileSync, mkdirSync } from 'node:fs';
import { AffinityTables } from '../src/lib/affinity/compute';
import { loadTrainingTitles } from '../src/lib/affinity/loadTraining';
import { buildFeatures, featureNames, toVector, FEATURE_VERSION } from '../src/lib/scoring/features';
import { directorsOf } from '../src/lib/tmdb/normalise';

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let r = this.parent.get(x)!;
    while (r !== this.parent.get(r)!) r = this.parent.get(r)!;
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

async function main() {
  const titles = await loadTrainingTitles();
  if (!titles.length) throw new Error('No training titles. Run import + backfill + affinities.');

  const tables = new AffinityTables(titles);
  const names = featureNames();

  // A title belongs to the same group as anything sharing a director or a
  // collection with it, transitively.  That is the only grouping that closes
  // both leak paths at once.
  const uf = new UnionFind();
  for (const t of titles) {
    const self = `t:${t.key}`;
    uf.find(self);
    for (const d of directorsOf(t.meta)) uf.union(self, `d:${d.id}`);
    if (t.meta.collectionId) uf.union(self, `c:${t.meta.collectionId}`);
  }

  const rows = titles.map((t) => {
    const built = buildFeatures(t.meta, tables, {
      rating: t.rating,
      rewatch: t.hasLoggedRewatch,
    });
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
      group_combined: uf.find(`t:${t.key}`),
      x: toVector(built.values, names).map((v) => Number(v.toFixed(6))),
    };
  });

  const frame = {
    feature_version: FEATURE_VERSION,
    generated_at: new Date().toISOString(),
    features: names,
    globals: tables.globals,
    rewatch_base_rate: rows.filter((r) => r.rewatch).length / rows.length,
    rows,
  };

  mkdirSync('data', { recursive: true });
  writeFileSync('data/training_frame.json', JSON.stringify(frame));

  const dirGroups = new Set(rows.map((r) => r.group_director)).size;
  const collGroups = new Set(rows.map((r) => r.group_collection)).size;
  const combGroups = new Set(rows.map((r) => r.group_combined)).size;

  console.log(`data/training_frame.json`);
  console.log(`  rows          ${rows.length}`);
  console.log(`  features      ${names.length}`);
  console.log(`  mean rating   ${tables.globals.globalMean.toFixed(3)}`);
  console.log(`  rewatch rate  ${(frame.rewatch_base_rate * 100).toFixed(1)}%  (${rows.filter((r) => r.rewatch).length} titles)`);
  console.log(`  groups        director ${dirGroups} · collection ${collGroups} · combined ${combGroups}`);
  if (frame.rewatch_base_rate * rows.length < 30)
    console.log('  ! Under 30 positive rewatch rows — Model B will be very noisy.');
  console.log('\nNext: npm run fit');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
