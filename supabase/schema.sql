-- twoscore schema.  Single-user app: everything is reached through the
-- service-role key from server code only.  RLS is ON with no permissive
-- policies, so the anon key can read nothing even if it leaks.

create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- history
-- One row per title in the Letterboxd export (ratings ∪ watched ∪ diary).
create table if not exists history_entries (
  id                 bigserial primary key,
  letterboxd_uri     text unique,
  name               text not null,
  year               int,
  rating             numeric(2,1),          -- 0.5 .. 5.0, null if unrated
  rated_at           date,
  liked              boolean not null default false,
  in_watchlist       boolean not null default false,
  diary_views        int not null default 0,   -- rows in diary.csv
  rewatch_views      int not null default 0,   -- diary rows flagged Rewatch
  has_logged_rewatch boolean not null default false,
  first_watched      date,
  last_watched       date,
  -- resolution
  tmdb_id            int,
  media_type         text check (media_type in ('movie','tv')),
  match_method       text,                  -- exact|year|fuzzy|manual|unresolved
  match_score        numeric,
  -- feedback loop
  excluded           boolean not null default false,   -- "joke rating" flag
  exclude_reason     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists history_tmdb_idx on history_entries (tmdb_id, media_type);
create index if not exists history_unresolved_idx on history_entries (tmdb_id) where tmdb_id is null;
create index if not exists history_name_trgm on history_entries using gin (name gin_trgm_ops);

-- ------------------------------------------------------------ tmdb cache
create table if not exists tmdb_titles (
  tmdb_id          int not null,
  media_type       text not null check (media_type in ('movie','tv')),
  title            text,
  original_title   text,
  release_date     date,
  release_year     int,
  runtime          int,
  original_language text,
  overview         text,
  poster_path      text,
  vote_average     numeric,
  vote_count       int,
  budget           bigint,
  revenue          bigint,
  popularity       numeric,
  status           text,
  imdb_id          text,
  collection_id    int,
  collection_name  text,
  genres           jsonb not null default '[]'::jsonb,  -- [{id,name}]
  keywords         jsonb not null default '[]'::jsonb,  -- [{id,name}]
  credits_cast     jsonb not null default '[]'::jsonb,  -- [{id,name,order}] top 8
  credits_crew     jsonb not null default '[]'::jsonb,  -- [{id,name,job}] dir/writer
  companies        jsonb not null default '[]'::jsonb,  -- [{id,name}]
  fetched_at       timestamptz not null default now(),
  primary key (tmdb_id, media_type)
);
create index if not exists tmdb_stale_idx on tmdb_titles (fetched_at);
create index if not exists tmdb_imdb_idx on tmdb_titles (imdb_id);

-- Every outbound TMDB/OMDb call, so ingest cost is visible.
create table if not exists api_calls (
  id         bigserial primary key,
  provider   text not null,          -- tmdb|omdb
  endpoint   text not null,
  status     int,
  ms         int,
  cache_hit  boolean not null default false,
  run_id     bigint,
  called_at  timestamptz not null default now()
);
create index if not exists api_calls_at_idx on api_calls (called_at desc);

-- OMDb / IMDb ratings, 24h TTL.
create table if not exists omdb_ratings (
  imdb_id      text primary key,
  imdb_rating  numeric,
  imdb_votes   int,
  metascore    int,
  rt_score     int,
  fetched_at   timestamptz not null default now()
);

-- ------------------------------------------------------------- affinities
create table if not exists affinities (
  kind             text not null,   -- director|writer|actor|collection|company|keyword|genre|decade|language
  entity_id        text not null,
  entity_name      text not null,
  n                int not null,            -- rated films by this entity
  mean_rating      numeric,
  affinity         numeric not null,        -- Bayesian-shrunk mean rating
  n_rewatch        int not null default 0,  -- of those, with >=1 logged rewatch
  rewatch_rate     numeric,
  rewatch_affinity numeric not null,        -- Bayesian-shrunk rewatch rate
  best_title       text,
  best_rating      numeric,
  computed_at      timestamptz not null default now(),
  primary key (kind, entity_id)
);
create index if not exists affinities_kind_idx on affinities (kind, affinity desc);

-- ---------------------------------------------------------- scored titles
create table if not exists titles (
  tmdb_id           int not null,
  media_type        text not null check (media_type in ('movie','tv')),
  title             text not null,
  release_year      int,
  release_date      date,
  runtime           int,
  poster_path       text,
  genres            jsonb not null default '[]'::jsonb,
  keywords          jsonb not null default '[]'::jsonb,
  director_names    text[] not null default '{}',
  collection_name   text,
  original_language text,
  vote_average      numeric,
  vote_count        int,
  imdb_rating       numeric,
  public_rating     numeric,          -- 0..10, imdb if enabled else tmdb
  public_source     text,             -- imdb|tmdb
  score_a           numeric,          -- predicted rating, 0..100
  score_a_stars     numeric,          -- predicted rating, 0.5..5.0
  score_a_sigma     numeric,          -- 1 s.d. error bar, in points
  score_b           numeric,          -- rewatch probability, 0..100
  score_b_lo        numeric,
  score_b_hi        numeric,
  delta             numeric,          -- score_a - public_rating*10
  confidence        numeric,          -- 0..1
  confidence_parts  jsonb not null default '{}'::jsonb,
  contributions     jsonb not null default '{}'::jsonb,  -- {a:[...],b:[...]}
  features          jsonb not null default '{}'::jsonb,
  sources           text[] not null default '{}',
  model_version     text,
  in_history        boolean not null default false,
  first_seen        timestamptz not null default now(),
  scored_at         timestamptz not null default now(),
  primary key (tmdb_id, media_type)
);
create index if not exists titles_score_b_idx on titles (score_b desc);
create index if not exists titles_delta_idx on titles (delta);
create index if not exists titles_scored_idx on titles (scored_at desc);

-- -------------------------------------------------------------- feedback
create table if not exists feedback (
  id            bigserial primary key,
  tmdb_id       int not null,
  media_type    text not null,
  action        text not null check (action in ('watched','rated','dismissed','not_interested','watchlist','undismiss')),
  rating        numeric(2,1),
  predicted_a   numeric,               -- captured at decision time, so error accumulates
  predicted_b   numeric,
  confidence    numeric,
  model_version text,
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists feedback_title_idx on feedback (tmdb_id, media_type);
create index if not exists feedback_at_idx on feedback (created_at desc);

-- ------------------------------------------------------------ ingest runs
create table if not exists ingest_runs (
  id           bigserial primary key,
  kind         text not null default 'cron',    -- cron|manual
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  discovered   int not null default 0,
  kept         int not null default 0,
  scored       int not null default 0,
  tmdb_calls   int not null default 0,
  omdb_calls   int not null default 0,
  cache_hits   int not null default 0,
  errors       jsonb not null default '[]'::jsonb,
  model_version text
);

-- --------------------------------------------------------------- lockdown
alter table history_entries enable row level security;
alter table tmdb_titles    enable row level security;
alter table api_calls      enable row level security;
alter table omdb_ratings   enable row level security;
alter table affinities     enable row level security;
alter table titles         enable row level security;
alter table feedback       enable row level security;
alter table ingest_runs    enable row level security;
-- No policies are created on purpose: anon/authenticated get nothing.
-- The service-role key used by server code bypasses RLS.
