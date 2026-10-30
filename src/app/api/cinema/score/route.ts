import { NextResponse } from 'next/server';
import { loadAffinities } from '@/lib/affinity/store';
import { cinemaAuth } from '@/lib/cinema/auth';
import { loadCinemaHistory } from '@/lib/cinema/history';
import { historyKey, parseTitles, scoreForCinema, type CinemaScore } from '@/lib/cinema/score';
import { loadModels } from '@/lib/models/load';
import { getTitle } from '@/lib/tmdb/client';
import { callLog } from '@/lib/util/callLog';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * Scores up to 100 titles for CaptureDeck's Cinema tab: POST { titles: [{ tmdbId, mediaType }] }.
 *
 * Metadata comes through getTitle, so the 30-day tmdb_titles cache is shared
 * with the feed and a title is fetched from TMDB at most once a month.  The
 * cinema caches scores by modelVersion, so a batch is only sent again after a
 * refit.
 */
export async function POST(req: Request) {
  const refused = cinemaAuth(req);
  if (refused) return refused;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'body must be JSON' }, { status: 400 });
  }
  const titles = parseTitles(body);
  if (typeof titles === 'string') return NextResponse.json({ error: titles }, { status: 400 });

  try {
    const [models, tables, history] = await Promise.all([loadModels(), loadAffinities(), loadCinemaHistory()]);
    if (!models || !tables) {
      return NextResponse.json({ fitted: false, error: 'twoscore has no fitted model yet' }, { status: 409 });
    }
    const scores: CinemaScore[] = [];
    const failed: { tmdbId: number; mediaType: string; error: string }[] = [];
    // A few at a time: tmdbGet has its own rate limiter, this just keeps the batch moving.
    const queue = [...titles];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        try {
          const meta = await getTitle(t.tmdbId, t.mediaType);
          scores.push(scoreForCinema(meta, history.get(historyKey(t.mediaType, t.tmdbId)), tables, models));
        } catch (e) {
          failed.push({ ...t, error: (e as Error).message });
        }
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));
    await callLog.flush();
    return NextResponse.json({ fitted: true, scores, failed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
