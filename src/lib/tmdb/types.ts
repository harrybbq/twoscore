export type MediaType = 'movie' | 'tv';

export interface NamedId {
  id: number;
  name: string;
}

export interface CastMember extends NamedId {
  order: number;
}

export interface CrewMember extends NamedId {
  job: string;
}

/** The normalised shape everything downstream reads.  Never pass raw TMDB. */
export interface TitleMeta {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  originalTitle: string | null;
  releaseDate: string | null;
  releaseYear: number | null;
  runtime: number | null;
  originalLanguage: string | null;
  overview: string | null;
  posterPath: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  budget: number | null;
  revenue: number | null;
  popularity: number | null;
  status: string | null;
  imdbId: string | null;
  collectionId: number | null;
  collectionName: string | null;
  genres: NamedId[];
  keywords: NamedId[];
  cast: CastMember[];
  crew: CrewMember[];
  companies: NamedId[];
}

export interface DiscoverItem {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  releaseYear: number | null;
  source: string;
}
