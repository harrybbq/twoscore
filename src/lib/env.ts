/** Central env access.  Never read process.env anywhere else on the server. */

function opt(name: string): string | undefined {
  const v = process.env[name];
  return v && v.length ? v : undefined;
}

function req(name: string): string {
  const v = opt(name);
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export const env = {
  get supabaseUrl() {
    return req('NEXT_PUBLIC_SUPABASE_URL');
  },
  get supabaseServiceKey() {
    return req('SUPABASE_SERVICE_ROLE_KEY');
  },
  get tmdbKey() {
    return req('TMDB_API_KEY');
  },
  get tmdbKeyOptional() {
    return opt('TMDB_API_KEY');
  },
  get omdbKey() {
    return opt('OMDB_API_KEY');
  },
  /** OMDb is opt-in: needs both the flag and a key. */
  get imdbEnabled() {
    return opt('ENABLE_IMDB') === 'true' && !!opt('OMDB_API_KEY');
  },
  get cronSecret() {
    return opt('CRON_SECRET');
  },
  /** Shared secret for the /api/cinema routes CaptureDeck calls. Unset = those routes refuse everything. */
  get cinemaToken() {
    return opt('CINEMA_TOKEN');
  },
  get tmdbCacheDays() {
    return Number(opt('TMDB_CACHE_DAYS') ?? 30);
  },
  get omdbCacheHours() {
    return Number(opt('OMDB_CACHE_HOURS') ?? 24);
  },
  get tmdbRps() {
    return Number(opt('TMDB_RPS') ?? 20);
  },
};

export const PUBLIC_RATING_SOURCE_LABEL = () => (env.imdbEnabled ? 'IMDb' : 'TMDB');
