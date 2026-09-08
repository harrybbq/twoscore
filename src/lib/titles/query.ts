import { db } from '@/lib/supabase/server';

export interface TitleFilters {
  type?: 'movie' | 'tv' | 'all';
  minConfidence?: number;
  minScoreB?: number;
  genre?: string;
  maxRuntime?: number;
  releasedAfter?: string;
  releasedBefore?: string;
  sort?: string;
  dir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
  search?: string;
}

export const SORTABLE: Record<string, string> = {
  score_b: 'score_b',
  score_a: 'score_a',
  delta: 'delta',
  confidence: 'confidence',
  public_rating: 'public_rating',
  vote_count: 'vote_count',
  runtime: 'runtime',
  release_year: 'release_year',
  title: 'title',
  scored_at: 'scored_at',
};

export function parseFilters(sp: URLSearchParams): TitleFilters {
  const num = (k: string) => {
    const v = sp.get(k);
    if (v === null || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  };
  return {
    type: (sp.get('type') as TitleFilters['type']) ?? 'all',
    minConfidence: num('minConfidence'),
    minScoreB: num('minScoreB'),
    genre: sp.get('genre') ?? undefined,
    maxRuntime: num('maxRuntime'),
    releasedAfter: sp.get('after') ?? undefined,
    releasedBefore: sp.get('before') ?? undefined,
    sort: sp.get('sort') ?? 'score_b',
    dir: (sp.get('dir') as 'asc' | 'desc') ?? 'desc',
    limit: num('limit') ?? 40,
    offset: num('offset') ?? 0,
    search: sp.get('q') ?? undefined,
  };
}

export function toQueryString(f: TitleFilters): string {
  const sp = new URLSearchParams();
  if (f.type && f.type !== 'all') sp.set('type', f.type);
  if (f.minConfidence) sp.set('minConfidence', String(f.minConfidence));
  if (f.minScoreB) sp.set('minScoreB', String(f.minScoreB));
  if (f.genre) sp.set('genre', f.genre);
  if (f.maxRuntime) sp.set('maxRuntime', String(f.maxRuntime));
  if (f.releasedAfter) sp.set('after', f.releasedAfter);
  if (f.releasedBefore) sp.set('before', f.releasedBefore);
  if (f.sort && f.sort !== 'score_b') sp.set('sort', f.sort);
  if (f.dir && f.dir !== 'desc') sp.set('dir', f.dir);
  if (f.search) sp.set('q', f.search);
  if (f.limit) sp.set('limit', String(f.limit));
  if (f.offset) sp.set('offset', String(f.offset));
  return sp.toString();
}

export interface TitleRow {
  tmdb_id: number;
  media_type: 'movie' | 'tv';
  title: string;
  release_year: number | null;
  release_date: string | null;
  runtime: number | null;
  poster_path: string | null;
  genres: { id: number; name: string }[];
  keywords: { id: number; name: string }[];
  director_names: string[];
  collection_name: string | null;
  vote_average: number | null;
  vote_count: number | null;
  public_rating: number | null;
  public_source: 'imdb' | 'tmdb' | null;
  score_a: number;
  score_a_stars: number;
  score_a_sigma: number;
  score_b: number;
  score_b_lo: number;
  score_b_hi: number;
  delta: number | null;
  confidence: number;
  confidence_parts: Record<string, number>;
  contributions: { a: WhyRow[]; b: WhyRow[] };
  sources: string[];
  scored_at: string;
}

export interface WhyRow {
  label: string;
  detail: string;
  effect: number;
  n: number | null;
}

export async function queryTitles(f: TitleFilters): Promise<{ rows: TitleRow[]; total: number }> {
  const sort = SORTABLE[f.sort ?? 'score_b'] ?? 'score_b';
  let q = db().from('titles').select('*', { count: 'exact' }).eq('in_history', false);

  if (f.type && f.type !== 'all') q = q.eq('media_type', f.type);
  if (f.minConfidence !== undefined) q = q.gte('confidence', f.minConfidence);
  if (f.minScoreB !== undefined) q = q.gte('score_b', f.minScoreB);
  if (f.maxRuntime !== undefined) q = q.lte('runtime', f.maxRuntime);
  if (f.releasedAfter) q = q.gte('release_date', f.releasedAfter);
  if (f.releasedBefore) q = q.lte('release_date', f.releasedBefore);
  if (f.search) q = q.ilike('title', `%${f.search}%`);
  // Genre lives in a jsonb array; `contains` is the only index-friendly test.
  if (f.genre) q = q.contains('genres', JSON.stringify([{ name: f.genre }]));

  const from = f.offset ?? 0;
  const to = from + (f.limit ?? 40) - 1;
  const { data, error, count } = await q
    .order(sort, { ascending: f.dir === 'asc', nullsFirst: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as TitleRow[], total: count ?? 0 };
}

/** Distinct genre names present in the scored set, for the filter bar. */
export async function genreOptions(): Promise<string[]> {
  const { data } = await db().from('titles').select('genres').eq('in_history', false).limit(2000);
  const set = new Set<string>();
  for (const row of data ?? []) for (const g of (row.genres ?? []) as { name: string }[]) if (g?.name) set.add(g.name);
  return [...set].sort();
}
