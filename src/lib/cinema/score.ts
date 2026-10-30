import type { AffinityTables } from '@/lib/affinity/compute';
import type { LoadedModels } from '@/lib/models/load';
import { scoreTitle, type WhyTerm } from '@/lib/scoring/score';
import type { MediaType, TitleMeta } from '@/lib/tmdb/types';

/**
 * What CaptureDeck's Cinema tab gets back for one title.  Pure: no database,
 * no network, so `scripts/verify-cinema.ts` can check it on synthetic data.
 *
 * The contract with the cinema is versioned (`CINEMA_API_VERSION`); bump it on
 * any change to these shapes.
 */
export const CINEMA_API_VERSION = 1;
export const MAX_BATCH = 100;

export interface CinemaHistory {
  tmdbId: number;
  mediaType: MediaType;
  rating: number | null;
  liked: boolean;
  diaryViews: number;
  rewatchViews: number;
  hasLoggedRewatch: boolean;
  /** The "joke rating" flag: seen, but kept out of training. */
  excluded: boolean;
}

export interface CinemaScore {
  tmdbId: number;
  mediaType: MediaType;
  scoreA: number;
  scoreAStars: number;
  scoreASigma: number;
  scoreB: number;
  scoreBLo: number;
  scoreBHi: number;
  delta: number | null;
  publicRating: number | null;
  publicSource: 'imdb' | 'tmdb' | null;
  confidence: number;
  isTv: boolean;
  why: { a: WhyTerm[]; b: WhyTerm[] };
  /** Null when the title isn't in the Letterboxd history. */
  history: CinemaHistory | null;
  /** True when the title's own rating and rewatch were left out of its features. */
  leftOneOut: boolean;
  modelVersion: string;
}

export const historyKey = (mediaType: string, tmdbId: number) => `${mediaType}:${tmdbId}`;

/** The request body: up to MAX_BATCH distinct { tmdbId, mediaType }. Returns an error string when it's wrong. */
export function parseTitles(body: unknown): { tmdbId: number; mediaType: MediaType }[] | string {
  const list = (body as { titles?: unknown })?.titles;
  if (!Array.isArray(list)) return 'body must be { titles: [{ tmdbId, mediaType }] }';
  if (list.length > MAX_BATCH) return `at most ${MAX_BATCH} titles per request`;
  const out: { tmdbId: number; mediaType: MediaType }[] = [];
  const seen = new Set<string>();
  for (const t of list) {
    const tmdbId = Number((t as any)?.tmdbId);
    const mediaType = (t as any)?.mediaType;
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || (mediaType !== 'movie' && mediaType !== 'tv')) {
      return `bad title ${JSON.stringify(t)}`;
    }
    const k = historyKey(mediaType, tmdbId);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ tmdbId, mediaType });
  }
  return out;
}

/**
 * Scores one title for the cinema.
 *
 * Unlike the feed, the cinema wants titles that are already in the history: a
 * high Score B on something seen is the best "what do I put on tonight" signal
 * there is.  Those titles were part of training, so their own rating and
 * rewatch label are removed from the affinities first (leave-one-out, as in
 * training) or Score B would be inflated by the very answer it predicts.  Rows
 * with no rating, or flagged as joke ratings, never entered training, so
 * nothing is removed for them.
 */
export function scoreForCinema(
  meta: TitleMeta,
  history: CinemaHistory | undefined,
  tables: AffinityTables,
  models: LoadedModels,
  topTerms = 3,
): CinemaScore {
  const inTraining = !!history && history.rating != null && !history.excluded;
  const exclude = inTraining ? { rating: history!.rating!, rewatch: history!.hasLoggedRewatch } : undefined;
  const s = scoreTitle(meta, tables, models.a, models.b, { exclude, topTerms });
  return {
    tmdbId: meta.tmdbId,
    mediaType: meta.mediaType,
    scoreA: s.scoreA,
    scoreAStars: s.scoreAStars,
    scoreASigma: s.scoreASigma,
    scoreB: s.scoreB,
    scoreBLo: s.scoreBLo,
    scoreBHi: s.scoreBHi,
    delta: s.delta,
    publicRating: s.publicRating,
    publicSource: s.publicSource,
    confidence: s.confidence,
    isTv: meta.mediaType === 'tv',
    why: s.why,
    history: history ?? null,
    leftOneOut: inTraining,
    modelVersion: s.modelVersion,
  };
}

/** "feature_version:fitted_at", the same string scoreTitle stamps on every score. */
export const modelVersionOf = (models: LoadedModels) => `${models.a.feature_version}:${models.a.fitted_at}`;
