/** TMDB genre ids -> stable feature slugs.  Fixed list so feature names never drift. */
export const GENRE_SLUGS: Record<number, string> = {
  28: 'action', 12: 'adventure', 16: 'animation', 35: 'comedy', 80: 'crime',
  99: 'documentary', 18: 'drama', 10751: 'family', 14: 'fantasy', 36: 'history',
  27: 'horror', 10402: 'music', 9648: 'mystery', 10749: 'romance', 878: 'scifi',
  10770: 'tvmovie', 53: 'thriller', 10752: 'war', 37: 'western',
  10759: 'action_adventure', 10762: 'kids', 10763: 'news', 10764: 'reality',
  10765: 'scifi_fantasy', 10766: 'soap', 10767: 'talk', 10768: 'war_politics',
};

export const GENRE_FEATURES = Object.values(GENRE_SLUGS)
  .filter((v, i, a) => a.indexOf(v) === i)
  .sort()
  .map((s) => `genre_${s}`);

export const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
export const DECADE_FEATURES = DECADES.map((d) => `dec_${d}`);
