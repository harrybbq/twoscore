import { NextResponse } from 'next/server';
import { loadAffinities } from '@/lib/affinity/store';
import { cinemaAuth } from '@/lib/cinema/auth';
import { loadCinemaHistory } from '@/lib/cinema/history';
import { CINEMA_API_VERSION, MAX_BATCH, modelVersionOf } from '@/lib/cinema/score';
import { loadModels } from '@/lib/models/load';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * What CaptureDeck's Cinema tab checks first: is there a fitted model, which
 * one (so it only rescores when this changes), and how good is it.
 */
export async function GET(req: Request) {
  const refused = cinemaAuth(req);
  if (refused) return refused;
  try {
    const [models, tables, history] = await Promise.all([loadModels(), loadAffinities(), loadCinemaHistory()]);
    const base = { api: CINEMA_API_VERSION, maxBatch: MAX_BATCH, historyCount: history.size };
    if (!models) {
      return NextResponse.json({ ...base, fitted: false, reason: 'Models are not fitted yet: run npm run affinities, npm run frame, then npm run fit.' });
    }
    if (!tables) {
      return NextResponse.json({ ...base, fitted: false, reason: 'Affinity tables are empty: run npm run affinities.' });
    }
    const card = models.card;
    return NextResponse.json({
      ...base,
      fitted: true,
      modelVersion: modelVersionOf(models),
      fittedAt: card.fitted_at,
      rows: card.rows,
      ratedTitles: tables.globals.ratedTitles,
      modelA: { kind: card.model_a.kind, metrics: card.model_a.metrics, baseline: card.model_a.baseline },
      modelB: { kind: card.model_b.kind, metrics: card.model_b.metrics, baseline: card.model_b.baseline },
      notes: card.notes,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
