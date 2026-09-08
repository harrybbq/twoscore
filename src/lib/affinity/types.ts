export const AFFINITY_KINDS = [
  'director',
  'writer',
  'actor',
  'collection',
  'company',
  'keyword',
  'genre',
  'decade',
  'language',
] as const;

export type AffinityKind = (typeof AFFINITY_KINDS)[number];

export interface AffinityRow {
  kind: AffinityKind;
  entityId: string;
  entityName: string;
  /** Rated titles carrying this entity. */
  n: number;
  sumRating: number;
  meanRating: number;
  affinity: number;
  /** Of those, how many have >=1 logged rewatch. */
  nRewatch: number;
  rewatchRate: number;
  rewatchAffinity: number;
  bestTitle: string | null;
  /** Top two ratings, so a leave-one-out "is this collection loved?" test can
   *  be exact rather than inferred from the mean. */
  bestRating: number | null;
  secondBestRating: number | null;
}

export interface AffinityGlobals {
  m: number;
  globalMean: number;
  globalRewatchRate: number;
  ratedTitles: number;
}

export interface AffinityValue {
  affinity: number;
  rewatchAffinity: number;
  n: number;
  meanRating: number | null;
  rewatchRate: number | null;
  name: string | null;
}
