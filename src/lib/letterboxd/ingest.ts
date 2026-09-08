import { db } from '@/lib/supabase/server';
import { keyOf, parseExport, type HistoryEntry, type ParseReport } from './parse';

export interface ImportResult {
  report: ParseReport;
  inserted: number;
  updated: number;
  unchanged: number;
  errors: string[];
}

/**
 * Fold a parsed export into `history_entries`.
 *
 * Additive by design: a re-import updates the Letterboxd-owned columns and
 * leaves everything the app has learned since (tmdb_id, match_method, the
 * joke-rating exclusion flag) untouched, so re-importing from a phone can
 * never undo hand resolution work.
 */
export async function importExport(files: Record<string, string>): Promise<ImportResult> {
  const { entries, report } = parseExport(files);
  const errors: string[] = [];

  const existingByKey = new Map<string, any>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from('history_entries')
      .select('id, letterboxd_uri, name, year, rating, diary_views, rewatch_views, has_logged_rewatch')
      .range(from, from + PAGE - 1);
    if (error) {
      errors.push(`read existing: ${error.message}`);
      break;
    }
    if (!data?.length) break;
    for (const row of data) existingByKey.set(keyOf(row.name, row.year, row.letterboxd_uri), row);
    if (data.length < PAGE) break;
  }

  const rows = entries.map((e: HistoryEntry) => ({
    letterboxd_uri: e.letterboxdUri,
    name: e.name,
    year: e.year,
    rating: e.rating,
    rated_at: e.ratedAt,
    liked: e.liked,
    in_watchlist: e.inWatchlist,
    diary_views: e.diaryViews,
    rewatch_views: e.rewatchViews,
    has_logged_rewatch: e.hasLoggedRewatch,
    first_watched: e.firstWatched,
    last_watched: e.lastWatched,
    updated_at: new Date().toISOString(),
  }));

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  for (const r of rows) {
    const prev = existingByKey.get(keyOf(r.name, r.year, r.letterboxd_uri));
    if (!prev) inserted++;
    else if (
      Number(prev.rating ?? NaN) !== Number(r.rating ?? NaN) ||
      prev.diary_views !== r.diary_views ||
      prev.rewatch_views !== r.rewatch_views
    )
      updated++;
    else unchanged++;
  }

  // Upsert on the natural key.  Rows without a URI (rare) fall back to insert.
  const withUri = rows.filter((r) => r.letterboxd_uri);
  const withoutUri = rows.filter((r) => !r.letterboxd_uri);

  for (let i = 0; i < withUri.length; i += 500) {
    const chunk = withUri.slice(i, i + 500);
    const { error } = await db()
      .from('history_entries')
      .upsert(chunk, { onConflict: 'letterboxd_uri', ignoreDuplicates: false });
    if (error) errors.push(`upsert ${i}: ${error.message}`);
  }
  for (const r of withoutUri) {
    const prev = existingByKey.get(keyOf(r.name, r.year, null));
    if (prev) {
      const { error } = await db().from('history_entries').update(r).eq('id', prev.id);
      if (error) errors.push(`update ${r.name}: ${error.message}`);
    } else {
      const { error } = await db().from('history_entries').insert(r);
      if (error) errors.push(`insert ${r.name}: ${error.message}`);
    }
  }

  return { report, inserted, updated, unchanged, errors };
}

/**
 * Read every CSV out of a Letterboxd export ZIP buffer.
 *
 * Some exports put the CSVs at the root, others wrap them in a dated folder.
 * Strip a shared root prefix if and only if every file has it, so `likes/films.csv`
 * keeps the `likes/` that tells the parser what it is.
 */
export async function unzipExport(buf: Buffer): Promise<Record<string, string>> {
  const unzipper = await import('unzipper');
  const dir = await (unzipper as any).Open.buffer(buf);
  const entries: { path: string; read: () => Promise<Buffer> }[] = [];
  for (const f of dir.files) {
    if (f.type !== 'File' || !/\.csv$/i.test(f.path)) continue;
    if (f.path.split('/').pop()!.startsWith('.')) continue; // __MACOSX junk
    entries.push({ path: f.path, read: () => f.buffer() });
  }
  const prefix = commonRoot(entries.map((e) => e.path));
  const files: Record<string, string> = {};
  for (const e of entries) {
    files[prefix ? e.path.slice(prefix.length) : e.path] = (await e.read()).toString('utf8');
  }
  return files;
}

function commonRoot(paths: string[]): string {
  if (paths.length < 2) return '';
  const first = paths[0].split('/')[0] + '/';
  return paths.every((p) => p.startsWith(first)) ? first : '';
}
