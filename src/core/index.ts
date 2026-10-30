/**
 * twoscore's pure core, for running the model somewhere without the app:
 * no Supabase, no Next.js, no network, no Python.  `npm run build:core`
 * bundles this into one CommonJS file (dist/twoscore-core.cjs); CaptureDeck's
 * Cinema vendors that file, so Letterboxd parsing, TMDB normalising,
 * matching, affinities, features and scoring exist in exactly one place:
 * here.  Change anything exported below and rebuild, or the two drift.
 */
export { parseExport, isIgnored, type HistoryEntry, type ParseReport } from '@/lib/letterboxd/parse';
export { normalise, directorsOf, writersOf } from '@/lib/tmdb/normalise';
export { pickMatch, needsUnfilteredSearch, normaliseTitle, similarity, type PickHit, type PickResult } from '@/lib/tmdb/pick';
export { AffinityTables, entitiesOf, type TrainingTitle } from '@/lib/affinity/compute';
export { buildFeatures, featureNames, toVector, FEATURE_VERSION } from '@/lib/scoring/features';
export { predict, confidenceOf, errorBar } from '@/lib/scoring/scorer';
export { scoreTitle, type ScoredTitle } from '@/lib/scoring/score';
export type { ModelJson, ModelCard } from '@/lib/scoring/model';
export type { TitleMeta, MediaType } from '@/lib/tmdb/types';

/** Append parameters twoscore's TMDB client uses, so normalise() sees the payload it expects. */
export const TMDB_APPEND = { movie: 'credits,keywords,external_ids', tv: 'aggregate_credits,keywords,external_ids' } as const;
