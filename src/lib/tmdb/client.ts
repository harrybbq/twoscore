import { env } from '@/lib/env';
import { db, dbConfigured } from '@/lib/supabase/server';
import { callLog } from '@/lib/util/callLog';
import { RateLimiter, sleep } from '@/lib/util/limiter';
import { normalise } from './normalise';
import type { DiscoverItem, MediaType, TitleMeta } from './types';

const BASE = 'https://api.themoviedb.org/3';
const limiter = new RateLimiter(env.tmdbRps);

export class TmdbError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message);
  }
}

/**
 * One GET against TMDB.  Rate limited, retried on 429/5xx with exponential
 * backoff that honours Retry-After, and logged either way.
 */
export async function tmdbGet<T = any>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<T> {
  const url = new URL(BASE + path);
  url.searchParams.set('api_key', env.tmdbKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    await limiter.acquire();
    const started = Date.now();
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      const ms = Date.now() - started;
      callLog.record({ provider: 'tmdb', endpoint: path, status: res.status, ms, cacheHit: false });

      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('retry-after') ?? 1);
        const waitMs = Math.max(retryAfter * 1000, 2 ** attempt * 500);
        limiter.block(waitMs);
        await sleep(waitMs);
        continue;
      }
      if (res.status >= 500) {
        await sleep(2 ** attempt * 400);
        continue;
      }
      if (!res.ok) {
        // 404 on a search or a pulled title is normal; let the caller decide.
        throw new TmdbError(`TMDB ${res.status} on ${path}`, res.status, path);
      }
      return (await res.json()) as T;
    } catch (e) {
      if (e instanceof TmdbError) throw e;
      lastErr = e;
      await sleep(2 ** attempt * 400);
    }
  }
  throw new TmdbError(
    `TMDB failed after retries on ${path}: ${lastErr instanceof Error ? lastErr.message : lastErr}`,
    0,
    path,
  );
}

const APPEND_MOVIE = 'credits,keywords,external_ids';
const APPEND_TV = 'aggregate_credits,keywords,external_ids';

/** Fetch full metadata, honouring the 30-day cache in Postgres. */
export async function getTitle(
  tmdbId: number,
  mediaType: MediaType,
  opts: { force?: boolean } = {},
): Promise<TitleMeta> {
  if (!opts.force) {
    const cached = await readCache(tmdbId, mediaType);
    if (cached) {
      callLog.record({
        provider: 'tmdb',
        endpoint: `/${mediaType}/{id}`,
        status: 200,
        ms: 0,
        cacheHit: true,
      });
      return cached;
    }
  }
  const raw = await tmdbGet(`/${mediaType}/${tmdbId}`, {
    append_to_response: mediaType === 'tv' ? APPEND_TV : APPEND_MOVIE,
  });
  const meta = normalise(raw, mediaType);
  await writeCache(meta);
  return meta;
}

async function readCache(tmdbId: number, mediaType: MediaType): Promise<TitleMeta | null> {
  if (!dbConfigured()) return null;
  const { data } = await db()
    .from('tmdb_titles')
    .select('*')
    .eq('tmdb_id', tmdbId)
    .eq('media_type', mediaType)
    .maybeSingle();
  if (!data) return null;
  const ageDays = (Date.now() - new Date(data.fetched_at).getTime()) / 86_400_000;
  if (ageDays > env.tmdbCacheDays) return null;
  return rowToMeta(data);
}

export function rowToMeta(row: any): TitleMeta {
  return {
    tmdbId: row.tmdb_id,
    mediaType: row.media_type,
    title: row.title,
    originalTitle: row.original_title,
    releaseDate: row.release_date,
    releaseYear: row.release_year,
    runtime: row.runtime,
    originalLanguage: row.original_language,
    overview: row.overview,
    posterPath: row.poster_path,
    voteAverage: row.vote_average === null ? null : Number(row.vote_average),
    voteCount: row.vote_count,
    budget: row.budget === null ? null : Number(row.budget),
    revenue: row.revenue === null ? null : Number(row.revenue),
    popularity: row.popularity === null ? null : Number(row.popularity),
    status: row.status,
    imdbId: row.imdb_id,
    collectionId: row.collection_id,
    collectionName: row.collection_name,
    genres: row.genres ?? [],
    keywords: row.keywords ?? [],
    cast: row.credits_cast ?? [],
    crew: row.credits_crew ?? [],
    companies: row.companies ?? [],
  };
}

export function metaToRow(m: TitleMeta) {
  return {
    tmdb_id: m.tmdbId,
    media_type: m.mediaType,
    title: m.title,
    original_title: m.originalTitle,
    release_date: m.releaseDate,
    release_year: m.releaseYear,
    runtime: m.runtime,
    original_language: m.originalLanguage,
    overview: m.overview,
    poster_path: m.posterPath,
    vote_average: m.voteAverage,
    vote_count: m.voteCount,
    budget: m.budget,
    revenue: m.revenue,
    popularity: m.popularity,
    status: m.status,
    imdb_id: m.imdbId,
    collection_id: m.collectionId,
    collection_name: m.collectionName,
    genres: m.genres,
    keywords: m.keywords,
    credits_cast: m.cast,
    credits_crew: m.crew,
    companies: m.companies,
    fetched_at: new Date().toISOString(),
  };
}

async function writeCache(m: TitleMeta) {
  if (!dbConfigured()) return;
  const { error } = await db().from('tmdb_titles').upsert(metaToRow(m), { onConflict: 'tmdb_id,media_type' });
  if (error) console.warn('[tmdb] cache write failed:', error.message);
}

// --------------------------------------------------------------- search
export interface SearchHit {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  popularity: number;
  posterPath: string | null;
}

export async function search(
  query: string,
  mediaType: MediaType,
  year?: number | null,
): Promise<SearchHit[]> {
  const params: Record<string, string | number | undefined> = { query, include_adult: 'false' };
  if (year) params[mediaType === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = year;
  const data = await tmdbGet<{ results: any[] }>(`/search/${mediaType}`, params);
  return (data.results ?? []).map((r) => ({
    tmdbId: r.id,
    mediaType,
    title: (mediaType === 'tv' ? r.name : r.title) ?? '',
    year: Number(((mediaType === 'tv' ? r.first_air_date : r.release_date) ?? '').slice(0, 4)) || null,
    popularity: r.popularity ?? 0,
    posterPath: r.poster_path ?? null,
  }));
}

// ------------------------------------------------------------ discovery
const DISCOVERY: { source: string; path: string; type?: MediaType }[] = [
  { source: 'trending_week', path: '/trending/all/week' },
  { source: 'trending_day', path: '/trending/all/day' },
  { source: 'now_playing', path: '/movie/now_playing', type: 'movie' },
  { source: 'upcoming', path: '/movie/upcoming', type: 'movie' },
  { source: 'on_the_air', path: '/tv/on_the_air', type: 'tv' },
  { source: 'airing_today', path: '/tv/airing_today', type: 'tv' },
];

/** Every discovery feed, flattened and de-duplicated, sources merged. */
export async function discover(pagesPerFeed = 1): Promise<DiscoverItem[]> {
  const byKey = new Map<string, DiscoverItem & { sources: Set<string> }>();
  for (const feed of DISCOVERY) {
    for (let page = 1; page <= pagesPerFeed; page++) {
      let data: { results?: any[] };
      try {
        data = await tmdbGet(feed.path, { page });
      } catch (e) {
        console.warn(`[tmdb] discovery ${feed.source} p${page} failed:`, (e as Error).message);
        break;
      }
      for (const r of data.results ?? []) {
        const type: MediaType | undefined = feed.type ?? (r.media_type === 'tv' ? 'tv' : r.media_type === 'movie' ? 'movie' : undefined);
        if (!type || !r.id) continue; // drops `person` rows from /trending/all
        const key = `${type}:${r.id}`;
        const existing = byKey.get(key);
        if (existing) {
          existing.sources.add(feed.source);
          continue;
        }
        byKey.set(key, {
          tmdbId: r.id,
          mediaType: type,
          title: (type === 'tv' ? r.name : r.title) ?? '',
          releaseYear:
            Number(((type === 'tv' ? r.first_air_date : r.release_date) ?? '').slice(0, 4)) || null,
          source: feed.source,
          sources: new Set([feed.source]),
        });
      }
      if ((data.results ?? []).length === 0) break;
    }
  }
  return [...byKey.values()].map((v) => ({ ...v, source: [...v.sources].join(',') }));
}
