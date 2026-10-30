import { search, type SearchHit } from './client';
import { needsUnfilteredSearch, normaliseTitle, pickMatch, similarity } from './pick';
import type { MediaType } from './types';

// The matching rule itself is pure and lives in ./pick, so it can be bundled
// into src/core without the database client this file needs for searching.
export { normaliseTitle, similarity };

export interface MatchResult {
  hit: SearchHit | null;
  method: 'exact' | 'year' | 'fuzzy' | 'unresolved';
  score: number;
  candidates: SearchHit[];
}

/**
 * Resolve one history row to a TMDB id.
 *
 * Deliberately conservative: anything below the fuzzy threshold goes to the
 * /unresolved queue rather than being guessed at, because a wrong match
 * poisons the affinity tables for every entity on the wrong film.
 */
export async function matchTitle(
  name: string,
  year: number | null,
  mediaType: MediaType = 'movie',
): Promise<MatchResult> {
  const tries: SearchHit[] = [];
  try {
    if (year) tries.push(...(await search(name, mediaType, year)));
    // Letterboxd's year is occasionally the festival year rather than the
    // release year, so a year-filtered search that finds nothing convincing
    // is retried without the filter before giving up.
    if (needsUnfilteredSearch(name, tries)) {
      const seen = new Set(tries.map((h) => h.tmdbId));
      for (const h of await search(name, mediaType, null)) {
        if (!seen.has(h.tmdbId)) tries.push(h);
      }
    }
  } catch {
    return { hit: null, method: 'unresolved', score: 0, candidates: [] };
  }
  return pickMatch(name, year, tries);
}
