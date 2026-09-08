import { db } from '@/lib/supabase/server';
import { rowToMeta } from '@/lib/tmdb/client';
import type { TrainingTitle } from './compute';

export interface HistoryRow {
  id: number;
  name: string;
  year: number | null;
  rating: number | null;
  has_logged_rewatch: boolean;
  rewatch_views: number;
  diary_views: number;
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  excluded: boolean;
}

async function page<T>(fn: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>) {
  const out: T[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await fn(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Every resolved, rated, non-excluded history row joined to its cached TMDB
 * metadata.  Rows flagged as joke ratings are dropped here, which is the one
 * place that flag has to be honoured for it to mean anything.
 */
export async function loadTrainingTitles(): Promise<TrainingTitle[]> {
  const history = await page<HistoryRow>((from, to) =>
    db()
      .from('history_entries')
      .select('id, name, year, rating, has_logged_rewatch, rewatch_views, diary_views, tmdb_id, media_type, excluded')
      .not('tmdb_id', 'is', null)
      .not('rating', 'is', null)
      .eq('excluded', false)
      .range(from, to) as any,
  );

  const metaRows = await page<any>((from, to) =>
    db().from('tmdb_titles').select('*').range(from, to) as any,
  );
  const metaByKey = new Map(metaRows.map((m) => [`${m.media_type}:${m.tmdb_id}`, rowToMeta(m)]));

  const out: TrainingTitle[] = [];
  for (const h of history) {
    const meta = metaByKey.get(`${h.media_type}:${h.tmdb_id}`);
    if (!meta) continue; // metadata not fetched yet — backfill will pick it up
    out.push({
      key: `${h.media_type}:${h.tmdb_id}`,
      tmdbId: h.tmdb_id,
      mediaType: h.media_type,
      name: h.name,
      rating: Number(h.rating),
      hasLoggedRewatch: h.has_logged_rewatch,
      meta,
    });
  }
  return out;
}

/** tmdb ids already in the history, in any state — used to filter ingest. */
export async function loadHistoryKeys(): Promise<Set<string>> {
  const rows = await page<{ tmdb_id: number | null; media_type: string | null }>((from, to) =>
    db().from('history_entries').select('tmdb_id, media_type').range(from, to) as any,
  );
  const set = new Set<string>();
  for (const r of rows) if (r.tmdb_id) set.add(`${r.media_type ?? 'movie'}:${r.tmdb_id}`);
  return set;
}
