import { db } from '@/lib/supabase/server';
import { historyKey, type CinemaHistory } from './score';

/**
 * Every history row resolved to a TMDB id, keyed by "media_type:tmdb_id".
 * Joke-rated rows are kept (they are still seen) but flagged, so the scorer
 * knows they were never part of training.
 */
export async function loadCinemaHistory(): Promise<Map<string, CinemaHistory>> {
  const out = new Map<string, CinemaHistory>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db()
      .from('history_entries')
      .select('tmdb_id, media_type, rating, liked, diary_views, rewatch_views, has_logged_rewatch, excluded')
      .not('tmdb_id', 'is', null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const mediaType = r.media_type === 'tv' ? 'tv' : 'movie';
      const key = historyKey(mediaType, r.tmdb_id);
      const row: CinemaHistory = {
        tmdbId: r.tmdb_id,
        mediaType,
        rating: r.rating == null ? null : Number(r.rating),
        liked: !!r.liked,
        diaryViews: r.diary_views ?? 0,
        rewatchViews: r.rewatch_views ?? 0,
        hasLoggedRewatch: !!r.has_logged_rewatch,
        excluded: !!r.excluded,
      };
      // Two Letterboxd rows can resolve to one title; keep the rated one.
      const prev = out.get(key);
      if (!prev || (prev.rating == null && row.rating != null)) out.set(key, row);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}
