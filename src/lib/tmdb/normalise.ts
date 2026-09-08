import type { CastMember, CrewMember, MediaType, NamedId, TitleMeta } from './types';

const DIRECTOR_JOBS = new Set(['Director']);
const WRITER_JOBS = new Set(['Writer', 'Screenplay', 'Story', 'Teleplay', 'Author', 'Novel']);
/** TV has no `crew`; creators live on the root and jobs on aggregate_credits. */
const KEEP_JOBS = new Set([...DIRECTOR_JOBS, ...WRITER_JOBS, 'Creator', 'Executive Producer']);

function year(d: string | null | undefined): number | null {
  if (!d) return null;
  const y = Number(d.slice(0, 4));
  return Number.isFinite(y) && y > 1870 ? y : null;
}

function named(list: unknown): NamedId[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((x): x is { id: number; name: string } => !!x && typeof x.id === 'number' && !!x.name)
    .map((x) => ({ id: x.id, name: x.name }));
}

/**
 * Collapse a movie or TV payload (with credits/aggregate_credits, keywords and
 * external_ids appended) into the one shape the scorer understands.
 */
export function normalise(raw: any, mediaType: MediaType): TitleMeta {
  const isTv = mediaType === 'tv';
  const releaseDate: string | null = (isTv ? raw.first_air_date : raw.release_date) || null;

  // Movies: credits.cast[].  TV: aggregate_credits.cast[] where each person
  // carries `roles` and a `total_episode_count` instead of a single character.
  const rawCast: any[] = raw.credits?.cast ?? raw.aggregate_credits?.cast ?? [];
  const cast: CastMember[] = rawCast
    .slice()
    .sort((a, b) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, 8)
    .map((c, i) => ({ id: c.id, name: c.name, order: c.order ?? i }));

  const rawCrew: any[] = raw.credits?.crew ?? [];
  const crew: CrewMember[] = [];
  for (const c of rawCrew) {
    if (c?.id && c?.name && KEEP_JOBS.has(c.job)) crew.push({ id: c.id, name: c.name, job: c.job });
  }
  // aggregate_credits crew members carry `jobs: [{job}]` rather than `job`.
  for (const c of raw.aggregate_credits?.crew ?? []) {
    for (const j of c?.jobs ?? []) {
      if (c?.id && c?.name && KEEP_JOBS.has(j.job)) crew.push({ id: c.id, name: c.name, job: j.job });
    }
  }
  // TV creators are the closest analogue to a film's director.
  for (const c of raw.created_by ?? []) {
    if (c?.id && c?.name) crew.push({ id: c.id, name: c.name, job: 'Director' });
  }

  // De-duplicate on id+job — aggregate credits repeat people across seasons.
  const seen = new Set<string>();
  const dedupedCrew = crew.filter((c) => {
    const k = `${c.id}:${c.job}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const runtime: number | null = isTv
    ? Array.isArray(raw.episode_run_time) && raw.episode_run_time.length
      ? Math.round(raw.episode_run_time.reduce((a: number, b: number) => a + b, 0) / raw.episode_run_time.length)
      : raw.last_episode_to_air?.runtime ?? null
    : raw.runtime ?? null;

  return {
    tmdbId: raw.id,
    mediaType,
    title: (isTv ? raw.name : raw.title) ?? raw.original_name ?? raw.original_title ?? 'Untitled',
    originalTitle: (isTv ? raw.original_name : raw.original_title) ?? null,
    releaseDate,
    releaseYear: year(releaseDate),
    runtime: runtime && runtime > 0 ? runtime : null,
    originalLanguage: raw.original_language ?? null,
    overview: raw.overview || null,
    posterPath: raw.poster_path ?? null,
    voteAverage: typeof raw.vote_average === 'number' && raw.vote_average > 0 ? raw.vote_average : null,
    voteCount: raw.vote_count ?? 0,
    budget: raw.budget && raw.budget > 0 ? raw.budget : null,
    revenue: raw.revenue && raw.revenue > 0 ? raw.revenue : null,
    popularity: raw.popularity ?? null,
    status: raw.status ?? null,
    imdbId: raw.external_ids?.imdb_id ?? raw.imdb_id ?? null,
    collectionId: raw.belongs_to_collection?.id ?? null,
    collectionName: raw.belongs_to_collection?.name ?? null,
    genres: named(raw.genres),
    keywords: named(raw.keywords?.keywords ?? raw.keywords?.results),
    cast,
    crew: dedupedCrew,
    companies: named(raw.production_companies),
  };
}

export function directorsOf(m: Pick<TitleMeta, 'crew'>): NamedId[] {
  return m.crew.filter((c) => DIRECTOR_JOBS.has(c.job)).map((c) => ({ id: c.id, name: c.name }));
}

export function writersOf(m: Pick<TitleMeta, 'crew'>): NamedId[] {
  return m.crew.filter((c) => WRITER_JOBS.has(c.job)).map((c) => ({ id: c.id, name: c.name }));
}
