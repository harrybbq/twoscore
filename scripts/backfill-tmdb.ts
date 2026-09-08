/**
 * Resolve history rows to TMDB ids and cache their metadata.
 * `npm run backfill [--retry] [--limit N] [--tv]`
 *
 * Safe to interrupt: progress lives in the database, so a rerun picks up the
 * rows that are still unresolved rather than starting over.
 */
import { loadEnv } from './lib/loadEnv';
loadEnv();

import { db } from '../src/lib/supabase/server';
import { getTitle } from '../src/lib/tmdb/client';
import { matchTitle } from '../src/lib/tmdb/match';
import { callLog } from '../src/lib/util/callLog';
import type { MediaType } from '../src/lib/tmdb/types';

const args = process.argv.slice(2);
const retry = args.includes('--retry');
const alsoTv = args.includes('--tv');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

async function main() {
  let query = db()
    .from('history_entries')
    .select('id, name, year, rating, match_method')
    .is('tmdb_id', null)
    .order('rating', { ascending: false, nullsFirst: false });
  if (!retry) query = query.or('match_method.is.null,match_method.neq.unresolved');

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []).slice(0, Number.isFinite(limit) ? limit : undefined);

  const { count: total } = await db()
    .from('history_entries')
    .select('*', { count: 'exact', head: true });

  console.log(`${rows.length} rows to resolve (of ${total} in history)\n`);

  let resolved = 0;
  let failed = 0;
  let i = 0;
  for (const row of rows) {
    i++;
    const types: MediaType[] = alsoTv ? ['movie', 'tv'] : ['movie'];
    let best: { tmdbId: number; mediaType: MediaType; method: string; score: number } | null = null;

    for (const type of types) {
      const m = await matchTitle(row.name, row.year, type);
      if (m.hit && (!best || m.score > best.score)) {
        best = { tmdbId: m.hit.tmdbId, mediaType: type, method: m.method, score: m.score };
      }
      if (best && best.method === 'exact') break;
    }

    if (!best) {
      failed++;
      await db().from('history_entries').update({ match_method: 'unresolved' }).eq('id', row.id);
      process.stdout.write(`\r${i}/${rows.length}  resolved ${resolved}  unresolved ${failed}   `);
      continue;
    }

    try {
      await getTitle(best.tmdbId, best.mediaType);
    } catch (e) {
      console.warn(`\n  metadata fetch failed for ${row.name}: ${(e as Error).message}`);
    }
    await db()
      .from('history_entries')
      .update({
        tmdb_id: best.tmdbId,
        media_type: best.mediaType,
        match_method: best.method,
        match_score: best.score,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id);
    resolved++;
    process.stdout.write(`\r${i}/${rows.length}  resolved ${resolved}  unresolved ${failed}   `);
    if (i % 50 === 0) await callLog.flush();
  }
  await callLog.flush();

  const { count: matched } = await db()
    .from('history_entries')
    .select('*', { count: 'exact', head: true })
    .not('tmdb_id', 'is', null);
  const rate = ((matched ?? 0) / Math.max(1, total ?? 1)) * 100;

  console.log(`\n\nMatch rate: ${matched}/${total} = ${rate.toFixed(1)}%`);
  console.log(`API calls: ${JSON.stringify(callLog.summary())}`);
  if (rate < 95) {
    console.log(
      `\n! Below the 95% expected. Work the queue at /unresolved, then rerun with --retry.`,
    );
  }
  console.log('\nNext: npm run affinities');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
