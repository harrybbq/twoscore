# twoscore

Ingests new and trending films and TV, scores each against a taste model fitted
to a personal Letterboxd history, and shows that score next to the public
rating so the disagreements are visible.

**Star rating and rewatch behaviour are different variables** — in this history
they correlate 0.264. 5★ films split almost evenly between the ones you return
to constantly and the ones you never watch again. So there are two scores:

| | what it predicts | scale | model |
|---|---|---|---|
| **Score A** — admiration | the star rating you would give it | 0–100 (predicted ★ × 20) | ridge or gradient boosting |
| **Score B** — rewatch | probability you watch it more than once | 0–100 | logistic regression or gradient boosting |
| **Δ** | Score A − public rating × 10 | signed points | — |

Every score is rendered with its error bar and a confidence value derived from
feature completeness. Scoring is deterministic: same inputs, same output, no LLM
anywhere in the path.

## How the pieces fit

```
Letterboxd export ──▶ history_entries ──▶ TMDB resolve ──▶ tmdb_titles (30d cache)
                                                              │
                                          affinity tables ◀───┤
                                     (Bayesian-shrunk, LOO)   │
                                                 │            │
                       src/lib/scoring/features.ts ◀──────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
        data/training_frame.json            runtime scoring
                    │                       (TypeScript only)
                    ▼                               ▲
              py/fit.py  ──────▶ models/*.json ─────┘
```

The important line is the one that forks. **Feature engineering exists once, in
TypeScript.** `py/fit.py` never sees a TMDB payload — it is handed a named
matrix and returns coefficients keyed by the same names. That is what makes
"fit in Python, score in TypeScript" safe: there is no second implementation of
the features to drift out of sync. Nothing in the serverless path needs Python.

## Stack

Next.js (App Router) + TypeScript + Tailwind · Supabase Postgres · Python
(scikit-learn) for one-off fitting · Vercel, with Vercel Cron for nightly ingest.

## Setup

### 1. Supabase

Create a project, then run `supabase/schema.sql` in the SQL editor. RLS is
enabled on every table with **no policies** on purpose: the anon key can read
nothing even if it leaks, and all access goes through the service-role key from
server code.

### 2. Environment

Copy `.env.example` to `.env.local`:

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Server-only. Never expose it. |
| `TMDB_API_KEY` | yes | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) — the v3 key, not the v4 read token |
| `TMDB_CACHE_DAYS` | no | default 30 |
| `TMDB_RPS` | no | default 20 |
| `ENABLE_IMDB` | no | `true` turns on OMDb |
| `OMDB_API_KEY` | no | required only when the flag is on |
| `OMDB_CACHE_HOURS` | no | default 24 |
| `CRON_SECRET` | on Vercel | the cron route rejects anything without `Authorization: Bearer <secret>` |
| `CINEMA_TOKEN` | for CaptureDeck | the `/api/cinema/*` routes refuse everything until it is set, then require `Authorization: Bearer <token>` |

**On IMDb.** IMDb has no free public API and imdb.com must not be scraped. The
real IMDb rating only exists when OMDb is enabled, joined on
`external_ids.imdb_id`. The free tier is 1000 calls/day, so it is only called
for titles that already survived the ingest filter, and cached for 24 hours.
With the flag off, TMDB's `vote_average` is the public rating and the UI labels
it as such. The app is fully functional without the second key.

### 3. Python (fitting only)

```bash
python3 -m venv .venv
.venv/bin/pip install -r py/requirements.txt
```

### 4. Verify before you have data

```bash
npm run verify
```

Builds a synthetic history with a known structure, runs the real pipeline end to
end, and asserts that the TypeScript scorer reproduces sklearn's predictions to
1e-6. It proves the machinery works. It says nothing about your taste.

## Importing

Two paths, same code underneath.

```bash
# put the export ZIP in data/, or unzip it to data/letterboxd/
npm run import              # or: npm run import path/to/export.zip
```

Or upload the ZIP at **`/import`** — parsed server-side, so it works from a
phone. Re-importing is additive: it refreshes ratings and diary counts and
leaves TMDB matches and exclusions alone.

Read: `ratings.csv`, `diary.csv`, `watched.csv`, `watchlist.csv`,
`likes/films.csv`, `reviews.csv`. **`lists/gammon.csv` is ignored entirely.**

```bash
npm run backfill            # resolve names+years to TMDB ids, cache metadata
npm run backfill -- --retry # re-attempt rows that failed
npm run backfill -- --tv    # also try the TV endpoints
```

Prints the match rate and flags anything under 95%. Safe to interrupt — progress
lives in the database, so a rerun picks up where it stopped. Anything the
matcher will not guess at goes to **`/unresolved`**, where you search TMDB and
pick. Nothing is guessed: a wrong match poisons the affinity tables for everyone
credited on the wrong film.

## Fitting

```bash
npm run affinities   # Bayesian-shrunk affinity tables for every entity
npm run frame        # leave-one-out design matrix -> data/training_frame.json
.venv/bin/python py/fit.py
```

`fit.py` tries ridge and gradient boosting for A, logistic and gradient boosting
for B, keeps whichever cross-validates better, and writes `models/model_a.json`,
`models/model_b.json` and `models/model_card.json`.

**Read the metrics before building on them.** If Model B's ROC-AUC is not
meaningfully above 0.5, rewatch is not being predicted by these features and the
premise needs rethinking rather than a front end.

Three things make those metrics honest:

- **Leave-one-out features.** Every training row's own rating is removed from its
  entities' affinities before its features are built. Without that, a director's
  affinity already contains the rating being predicted.
- **Grouped cross-validation.** `GroupKFold` grouped by director, by collection,
  and by the transitive closure of both. With five Guardians entries and a large
  Marvel / Spider-Man / Harry Potter block, random k-fold puts sequels of the
  same franchise on both sides of the split and reports a number the model
  cannot reproduce on anything new. All three groupings are reported; the
  combined one selects the model.
- **Baselines.** Model A against predict-the-mean, Model B against the base rate.

### What the model is not told

- **Rewatch labels are a floor, not a measurement.** The diary starts June 2020;
  earlier viewings were never logged. Model B's negatives therefore include films
  that were in fact rewatched — the review of *Step Brothers* says nine viewings,
  the diary has three. The metrics are pessimistic by an unknown amount, and the
  model card says so.
- **Joke ratings are excluded by hand.** Nothing tries to detect one; the flag is
  on every imported row, at `/unresolved` and in `PATCH /api/history`.
- **TV is lower confidence by construction.** Letterboxd's TV coverage in the
  export is patchy, so TV titles cannot be reliably deduped against the history.
  They carry a 0.75 confidence multiplier rather than a pretence.

## Running

```bash
npm run dev
```

| Route | Surface | What it is |
|---|---|---|
| `/` | both | The feed. Vertical cards, infinite scroll, Score B descending. Swipe right to rate, left to dismiss. |
| `/title/[type]/[id]` | both | Full metadata, both scores broken down, cast and crew with affinity **and** sample size. |
| `/import` | both | Upload the export; match rate and parse report. |
| `/unresolved` | both | Search TMDB and attach ids by hand. |
| `/table` | desktop | Sortable dense table, multi-select, bulk actions, keyboard shortcuts, CSV export. |
| `/affinities` | desktop | Every affinity table, sortable, filterable by minimum n. |
| `/calibration` | desktop | Predicted vs actual, residuals, running MAE, drift, the model card. |
| `/tune` | desktop | Shrinkage and per-group weights with a live backtest and metric diff. |
| `/compare` | desktop | Two or more titles side by side, term by term. |

Desktop-only routes render a "this one needs a bigger screen" notice on a phone
rather than a broken layout. Every consumption action — browse, filter, rate,
dismiss, watchlist — works on mobile.

**Keyboard, on `/table`:** `j`/`k` move · `x` select · `a` all · `w` watched ·
`d` not interested · `r` rate · `enter` expand the why panel · `e` export.

## Cinema API (CaptureDeck)

CaptureDeck's Cinema tab unifies the streaming subscriptions; twoscore decides
what in them is worth watching. Cinema calls these routes live, so a refit here
shows up there on its next sync with nothing exported. The scorer is not copied
anywhere: Cinema only ever gets its output.

| Route | Returns |
|---|---|
| `GET /api/cinema/status` | `fitted`, `modelVersion` (`feature_version:fitted_at`), both models' metrics and baselines, history count |
| `GET /api/cinema/history` | every history row resolved to a TMDB id: rating, diary and rewatch counts, the joke-rating flag |
| `POST /api/cinema/score` | `{ titles: [{ tmdbId, mediaType }] }`, at most 100: both scores, error bars, confidence, Δ, top 3 reasons each |

All three need `Authorization: Bearer <CINEMA_TOKEN>` and refuse with 503
while the token is unset, because they return personal data.

The difference from the feed: **titles in the history are scored, not
dropped.** A high Score B on something already seen is the best "what do I
rewatch tonight" signal, so the cinema wants exactly the case the feed throws
away. Those titles were in training, so `scoreForCinema` scores them
leave-one-out (their own rating and rewatch removed from the affinities first),
as `fit.py`'s frame does. Otherwise Score B would be inflated by the very label
it predicts. Joke-rated and unrated rows never entered training, so nothing is
removed for them. Metadata goes through `getTitle`, so the 30-day `tmdb_titles`
cache is shared with the feed.

`npm run verify:cinema` checks that handling on synthetic data, with no
database and no Python.

## Ingest

Vercel Cron hits `/api/cron/ingest` nightly (`vercel.json`, 05:00 UTC). It pulls
trending, now-playing, upcoming and on-the-air, drops anything already in the
history or dismissed, enriches what is left, fetches the IMDb rating if enabled,
scores both models and upserts.

There is no polling anywhere. The only other way to trigger it is the manual
refresh button (`POST /api/refresh`). Every outbound call is logged to
`api_calls`, so ingest cost is a query rather than a guess.

**Cold start is handled explicitly.** A film released next week has thin
keywords and forty votes. `confidence` is computed from feature completeness —
keyword count, vote count, whether the director appears in your history at all,
how many of the billed cast do — and error bars widen as it falls. The UI never
renders a score without it.

## Feedback and retraining

Every scored title can be marked watched, rated, watchlisted or dismissed. Each
decision is stored **with the prediction that was on screen when you made it**,
so error accumulates against the model that actually ran rather than whatever is
fitted today.

```bash
npm run retrain
```

Folds in-app ratings into the history, rebuilds the affinities, re-exports the
frame and refits. Then check `/calibration` — a refit is not an improvement by
default, and the running MAE is where you find out.

## Deploying

Push to GitHub, import the repo in Vercel, set the environment variables above
(including `CRON_SECRET`), and deploy. `vercel.json` registers the nightly cron.

`models/*.json` are committed and read from disk at runtime, so a deploy ships
the fit. Refitting means running `npm run retrain` locally and committing the
new JSON.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` / `lint` | tsc, eslint |
| `npm run import` | parse an export into `history_entries` |
| `npm run backfill` | resolve to TMDB, cache metadata |
| `npm run affinities` | rebuild the affinity tables |
| `npm run frame` | export the leave-one-out design matrix |
| `npm run fit` | fit both models (needs the venv) |
| `npm run retrain` | fold in feedback, then all of the above |
| `npm run verify` | end-to-end pipeline check on synthetic data |
| `npm run verify:cinema` | the cinema API's scoring (leave-one-out, TV confidence, validation) on synthetic data |

## Not built yet

An optional Anthropic pass scoring qualitative axes — tonal sincerity vs. ironic
distance, ensemble warmth, catharsis, stasis vs. momentum — from the synopsis,
cached per title and added as features. Only worth it once the deterministic
model has a measured baseline to beat, and it would have to stay out of the
scoring path itself to keep scoring deterministic.
