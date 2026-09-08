import { env } from '@/lib/env';
import { db, dbConfigured } from '@/lib/supabase/server';
import { callLog } from '@/lib/util/callLog';
import { RateLimiter } from '@/lib/util/limiter';

const limiter = new RateLimiter(4);

export interface ImdbRating {
  imdbId: string;
  imdbRating: number | null;
  imdbVotes: number | null;
  metascore: number | null;
  rtScore: number | null;
}

/**
 * IMDb has no free public API and imdb.com must not be scraped, so the real
 * IMDb number only exists when OMDb is enabled.  Free tier is 1000 calls/day:
 * callers must only ask for titles that already survived the ingest filter,
 * and results are cached for 24h.
 */
export async function getImdbRating(imdbId: string | null): Promise<ImdbRating | null> {
  if (!imdbId || !env.imdbEnabled) return null;

  if (dbConfigured()) {
    const { data } = await db().from('omdb_ratings').select('*').eq('imdb_id', imdbId).maybeSingle();
    if (data) {
      const ageH = (Date.now() - new Date(data.fetched_at).getTime()) / 3_600_000;
      if (ageH <= env.omdbCacheHours) {
        callLog.record({ provider: 'omdb', endpoint: '/', status: 200, ms: 0, cacheHit: true });
        return {
          imdbId,
          imdbRating: data.imdb_rating === null ? null : Number(data.imdb_rating),
          imdbVotes: data.imdb_votes,
          metascore: data.metascore,
          rtScore: data.rt_score,
        };
      }
    }
  }

  await limiter.acquire();
  const url = new URL('https://www.omdbapi.com/');
  url.searchParams.set('apikey', env.omdbKey!);
  url.searchParams.set('i', imdbId);
  const started = Date.now();
  let json: any;
  try {
    const res = await fetch(url);
    callLog.record({
      provider: 'omdb',
      endpoint: '/',
      status: res.status,
      ms: Date.now() - started,
      cacheHit: false,
    });
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }
  if (json?.Response === 'False') return null;

  const numOrNull = (v: unknown) => {
    const n = Number(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const rt = (json.Ratings ?? []).find((r: any) => r.Source === 'Rotten Tomatoes');

  const out: ImdbRating = {
    imdbId,
    imdbRating: numOrNull(json.imdbRating),
    imdbVotes: numOrNull(json.imdbVotes),
    metascore: numOrNull(json.Metascore),
    rtScore: rt ? numOrNull(String(rt.Value).replace('%', '')) : null,
  };

  if (dbConfigured()) {
    await db().from('omdb_ratings').upsert({
      imdb_id: imdbId,
      imdb_rating: out.imdbRating,
      imdb_votes: out.imdbVotes,
      metascore: out.metascore,
      rt_score: out.rtScore,
      fetched_at: new Date().toISOString(),
    });
  }
  return out;
}
