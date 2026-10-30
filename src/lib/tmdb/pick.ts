import type { MediaType } from './types';

/** One TMDB search result, as the matcher sees it. */
export interface PickHit {
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  popularity: number;
}

/** Fold case, strip diacritics, punctuation and a leading article. */
export function normaliseTitle(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^(the|a|an) /, '')
    .trim();
}

/** Sørensen–Dice over character bigrams: cheap, and forgiving of word order. */
export function similarity(a: string, b: string): number {
  const A = normaliseTitle(a);
  const B = normaliseTitle(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.length < 2 || B.length < 2) return A === B ? 1 : 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(A);
  const gb = grams(B);
  let hits = 0;
  let total = 0;
  for (const n of ga.values()) total += n;
  for (const n of gb.values()) total += n;
  for (const [g, n] of ga) hits += Math.min(n, gb.get(g) ?? 0);
  return (2 * hits) / total;
}

/** True when a year-filtered search found nothing convincing and an unfiltered one is worth trying. */
export function needsUnfilteredSearch(name: string, hits: PickHit[]): boolean {
  return !hits.some((h) => similarity(name, h.title) >= 0.85);
}

export interface PickResult<H extends PickHit = PickHit> {
  hit: H | null;
  method: 'exact' | 'year' | 'fuzzy' | 'unresolved';
  score: number;
  candidates: H[];
}

/**
 * Choose the TMDB result for one history row from its search results.
 *
 * Pure, so it can run anywhere the search does (twoscore's backfill, or
 * CaptureDeck's Cinema through the bundled core).  Deliberately conservative:
 * anything below the fuzzy threshold is left unresolved rather than guessed
 * at, because a wrong match poisons the affinity tables for every entity on
 * the wrong film.
 */
export function pickMatch<H extends PickHit>(name: string, year: number | null, hits: H[]): PickResult<H> {
  if (!hits.length) return { hit: null, method: 'unresolved', score: 0, candidates: [] };
  const scored = hits
    .map((h) => {
      const sim = similarity(name, h.title);
      const dy = year && h.year ? Math.abs(h.year - year) : null;
      // Year agreement is worth a lot; popularity only breaks near-ties.
      const yearScore = dy === null ? 0 : dy === 0 ? 0.25 : dy === 1 ? 0.12 : -0.4 * Math.min(dy, 5);
      return { h, sim, dy, total: sim + yearScore + Math.min(h.popularity, 100) / 100_000 };
    })
    .sort((a, b) => b.total - a.total);

  const best = scored[0];
  const exactTitle = normaliseTitle(best.h.title) === normaliseTitle(name);

  let method: PickResult['method'] = 'unresolved';
  if (exactTitle && best.dy === 0) method = 'exact';
  else if (exactTitle && (best.dy === null || best.dy <= 1)) method = 'year';
  else if (best.sim >= 0.85 && (best.dy === null || best.dy <= 1)) method = 'fuzzy';
  else if (best.sim >= 0.94 && best.dy !== null && best.dy <= 2) method = 'fuzzy';

  return {
    hit: method === 'unresolved' ? null : best.h,
    method,
    score: Number(best.sim.toFixed(4)),
    candidates: scored.slice(0, 8).map((s) => s.h),
  };
}
