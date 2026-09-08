/** Plain-language names for features that have no evidence term of their own. */
export const FEATURE_LABELS: Record<string, string> = {
  a_director: 'Director affinity',
  rw_director: 'Director rewatch rate',
  director_n: 'Films by this director in your history',
  director_known: 'Director appears in your history',
  a_writer: 'Writer affinity',
  rw_writer: 'Writer rewatch rate',
  writer_known: 'Writer appears in your history',
  a_cast: 'Cast affinity (billing-weighted)',
  rw_cast: 'Cast rewatch rate',
  a_cast_max: 'Best cast affinity',
  cast_known: 'Cast members in your history',
  a_collection: 'Collection affinity',
  rw_collection: 'Collection rewatch rate',
  in_collection: 'Part of a collection',
  loved_collection: 'You rate this universe 4.0+',
  collection_n: 'Entries of this collection you have rated',
  a_company: 'Production company affinity',
  rw_company: 'Production company rewatch rate',
  a_keyword: 'Keyword affinity',
  rw_keyword: 'Keyword rewatch rate',
  a_keyword_max: 'Strongest keyword affinity',
  a_keyword_min: 'Weakest keyword affinity',
  keyword_known: 'Keywords seen in your history',
  keyword_count: 'Keyword coverage',
  a_genre: 'Genre affinity',
  rw_genre: 'Genre rewatch rate',
  a_genre_max: 'Best genre affinity',
  a_language: 'Language affinity',
  rw_language: 'Language rewatch rate',
  is_english: 'English-language',
  runtime: 'Runtime',
  runtime_sq: 'Runtime, squared term',
  runtime_missing: 'Runtime unknown',
  runtime_in_band: 'Runtime inside your rewatch band',
  vote_average: 'Public rating',
  vote_missing: 'No public rating yet',
  log_vote_count: 'Number of public votes',
  log_budget: 'Budget',
  has_budget: 'Budget known',
  is_tv: 'Television',
  release_year: 'Release year',
};

export function labelFor(feature: string): string {
  if (FEATURE_LABELS[feature]) return FEATURE_LABELS[feature];
  if (feature.startsWith('genre_'))
    return `Genre: ${feature.slice(6).replace(/_/g, ' & ').replace(/\b\w/g, (c) => c.toUpperCase())}`;
  if (feature.startsWith('dec_')) return `Released in the ${feature.slice(4)}s`;
  return feature;
}
