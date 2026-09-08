/**
 * `npm run retrain` — fold new feedback into the training set and refit.
 *
 * Ratings given in the app become history rows (resolved already, since they
 * came from a scored title), the affinity tables are rebuilt, the design matrix
 * is re-exported and py/fit.py runs again. /calibration is where you check
 * whether it actually helped — a refit is not an improvement by default.
 */
import { loadEnv } from './lib/loadEnv';
loadEnv();

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { db } from '../src/lib/supabase/server';

async function foldInFeedback(): Promise<number> {
  const { data: rated, error } = await db()
    .from('feedback')
    .select('tmdb_id, media_type, rating, created_at')
    .eq('action', 'rated')
    .not('rating', 'is', null)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  if (!rated?.length) return 0;

  // Last rating wins if the same title was rated twice.
  const latest = new Map<string, (typeof rated)[0]>();
  for (const r of rated) latest.set(`${r.media_type}:${r.tmdb_id}`, r);

  const { data: existing } = await db()
    .from('history_entries')
    .select('id, tmdb_id, media_type')
    .not('tmdb_id', 'is', null);
  const known = new Map((existing ?? []).map((e) => [`${e.media_type}:${e.tmdb_id}`, e.id]));

  let written = 0;
  for (const [key, fb] of latest) {
    const { data: title } = await db()
      .from('titles')
      .select('title, release_year')
      .eq('tmdb_id', fb.tmdb_id)
      .eq('media_type', fb.media_type)
      .maybeSingle();

    const id = known.get(key);
    if (id) {
      const { error: e } = await db()
        .from('history_entries')
        .update({ rating: fb.rating, rated_at: String(fb.created_at).slice(0, 10), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (e) console.warn(`  update ${key}: ${e.message}`);
      else written++;
    } else {
      const { error: e } = await db().from('history_entries').insert({
        name: title?.title ?? `TMDB ${fb.tmdb_id}`,
        year: title?.release_year ?? null,
        rating: fb.rating,
        rated_at: String(fb.created_at).slice(0, 10),
        tmdb_id: fb.tmdb_id,
        media_type: fb.media_type,
        match_method: 'feedback',
        match_score: 1,
        // A title rated in-app has been watched once, here, and that is all we
        // know — it is not evidence of a rewatch.
        diary_views: 1,
        rewatch_views: 0,
        has_logged_rewatch: false,
      });
      if (e) console.warn(`  insert ${key}: ${e.message}`);
      else written++;
    }
  }
  return written;
}

function run(cmd: string, args: string[]) {
  console.log(`\n$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, PYTHONPATH: 'py' } });
}

async function main() {
  const folded = await foldInFeedback();
  console.log(`Folded ${folded} in-app rating${folded === 1 ? '' : 's'} into the history.`);

  run('npx', ['tsx', 'scripts/build-affinities.ts']);
  run('npx', ['tsx', 'scripts/export-training-frame.ts']);
  run(existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3', ['py/fit.py']);

  console.log('\nRefit complete. Compare against the previous run at /calibration before trusting it.');
  console.log('New scores reach the feed on the next ingest — hit Refresh or wait for the cron.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
