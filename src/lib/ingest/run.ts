import { loadAffinities } from '@/lib/affinity/store';
import { loadHistoryKeys } from '@/lib/affinity/loadTraining';
import { env } from '@/lib/env';
import { loadModels } from '@/lib/models/load';
import { getImdbRating } from '@/lib/omdb/client';
import { scoreTitle } from '@/lib/scoring/score';
import { db } from '@/lib/supabase/server';
import { discover, getTitle } from '@/lib/tmdb/client';
import { directorsOf } from '@/lib/tmdb/normalise';
import type { TitleMeta } from '@/lib/tmdb/types';
import { callLog } from '@/lib/util/callLog';

export interface IngestResult {
  runId: number | null;
  discovered: number;
  kept: number;
  scored: number;
  skippedInHistory: number;
  skippedDismissed: number;
  calls: { tmdb: number; omdb: number; cacheHits: number };
  errors: string[];
  ms: number;
}

/**
 * The nightly pull.
 *
 * Order matters for cost: discover, drop what is already in the history or
 * dismissed, and only then spend a metadata call — and only then, if OMDb is
 * enabled, an IMDb call. That is what keeps a 1000/day free tier viable.
 */
export async function runIngest(opts: { kind?: 'cron' | 'manual'; pages?: number } = {}): Promise<IngestResult> {
  const started = Date.now();
  const errors: string[] = [];

  const { data: run } = await db()
    .from('ingest_runs')
    .insert({ kind: opts.kind ?? 'cron' })
    .select('id')
    .single();
  const runId: number | null = run?.id ?? null;
  callLog.setRun(runId);

  const [models, tables, historyKeys, dismissed] = await Promise.all([
    loadModels(),
    loadAffinities(true),
    loadHistoryKeys(),
    loadDismissed(),
  ]);

  if (!models || !tables) {
    const msg = !models
      ? 'Models are not fitted yet — run npm run frame && python py/fit.py.'
      : 'Affinity tables are empty — run npm run affinities.';
    await finish(runId, { discovered: 0, kept: 0, scored: 0, errors: [msg] });
    return {
      runId,
      discovered: 0,
      kept: 0,
      scored: 0,
      skippedInHistory: 0,
      skippedDismissed: 0,
      calls: callLog.summary(),
      errors: [msg],
      ms: Date.now() - started,
    };
  }

  const candidates = await discover(opts.pages ?? 1);
  let skippedInHistory = 0;
  let skippedDismissed = 0;
  const keep = candidates.filter((c) => {
    const key = `${c.mediaType}:${c.tmdbId}`;
    // Letterboxd's TV coverage is patchy, so a TV title missing from the
    // history is weak evidence that it is unseen — it is kept, but scored
    // with the TV confidence penalty rather than silently trusted.
    if (historyKeys.has(key)) {
      skippedInHistory++;
      return false;
    }
    if (dismissed.has(key)) {
      skippedDismissed++;
      return false;
    }
    return true;
  });

  let scored = 0;
  const rows: any[] = [];
  for (const c of keep) {
    let meta: TitleMeta;
    try {
      meta = await getTitle(c.tmdbId, c.mediaType);
    } catch (e) {
      errors.push(`${c.mediaType}/${c.tmdbId}: ${(e as Error).message}`);
      continue;
    }

    let imdbRating: number | null = null;
    if (env.imdbEnabled) {
      const r = await getImdbRating(meta.imdbId);
      imdbRating = r?.imdbRating ?? null;
    }

    const s = scoreTitle(meta, tables, models.a, models.b, { imdbRating });
    scored++;
    rows.push({
      tmdb_id: meta.tmdbId,
      media_type: meta.mediaType,
      title: meta.title,
      release_year: meta.releaseYear,
      release_date: meta.releaseDate,
      runtime: meta.runtime,
      poster_path: meta.posterPath,
      genres: meta.genres,
      keywords: meta.keywords.slice(0, 20),
      director_names: directorsOf(meta).map((d) => d.name),
      collection_name: meta.collectionName,
      original_language: meta.originalLanguage,
      vote_average: meta.voteAverage,
      vote_count: meta.voteCount,
      imdb_rating: imdbRating,
      public_rating: s.publicRating,
      public_source: s.publicSource,
      score_a: s.scoreA,
      score_a_stars: s.scoreAStars,
      score_a_sigma: s.scoreASigma,
      score_b: s.scoreB,
      score_b_lo: s.scoreBLo,
      score_b_hi: s.scoreBHi,
      delta: s.delta,
      confidence: s.confidence,
      confidence_parts: s.confidenceParts,
      contributions: s.why,
      features: s.features,
      sources: c.source.split(','),
      model_version: s.modelVersion,
      in_history: false,
      scored_at: new Date().toISOString(),
    });
  }

  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db()
      .from('titles')
      .upsert(rows.slice(i, i + 200), { onConflict: 'tmdb_id,media_type' });
    if (error) errors.push(`upsert ${i}: ${error.message}`);
  }

  await callLog.flush();
  await finish(runId, { discovered: candidates.length, kept: keep.length, scored, errors });

  return {
    runId,
    discovered: candidates.length,
    kept: keep.length,
    scored,
    skippedInHistory,
    skippedDismissed,
    calls: callLog.summary(),
    errors,
    ms: Date.now() - started,
  };
}

async function loadDismissed(): Promise<Set<string>> {
  const { data } = await db()
    .from('feedback')
    .select('tmdb_id, media_type, action')
    .in('action', ['dismissed', 'not_interested', 'watched']);
  const set = new Set<string>();
  for (const r of data ?? []) set.add(`${r.media_type}:${r.tmdb_id}`);
  return set;
}

async function finish(
  runId: number | null,
  o: { discovered: number; kept: number; scored: number; errors: string[] },
) {
  if (!runId) return;
  const c = callLog.summary();
  await db()
    .from('ingest_runs')
    .update({
      finished_at: new Date().toISOString(),
      discovered: o.discovered,
      kept: o.kept,
      scored: o.scored,
      tmdb_calls: c.tmdb,
      omdb_calls: c.omdb,
      cache_hits: c.cacheHits,
      errors: o.errors.slice(0, 50),
    })
    .eq('id', runId);
}
