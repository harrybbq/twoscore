import { NextResponse } from 'next/server';
import { loadModels } from '@/lib/models/load';
import { db } from '@/lib/supabase/server';
import { backtest, buildBacktestRows } from '@/lib/tune/backtest';
import { mae } from '@/lib/tune/metrics';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

/**
 * Two different things live here and must not be conflated:
 *  - the held-out metrics from the fit (the model card), and
 *  - what has happened since, from feedback captured alongside the prediction
 *    that was on screen at the time. The second is the one that tells you
 *    whether a retrain actually helped.
 */
export async function GET() {
  const models = await loadModels();
  if (!models) return NextResponse.json({ error: 'Models are not fitted yet.' }, { status: 409 });

  const { data: fb } = await db()
    .from('feedback')
    .select('tmdb_id, media_type, action, rating, predicted_a, predicted_b, confidence, model_version, created_at')
    .in('action', ['rated', 'watched'])
    .not('rating', 'is', null)
    .order('created_at', { ascending: true });

  const live = (fb ?? [])
    .filter((r) => r.predicted_a !== null)
    .map((r) => ({
      at: r.created_at as string,
      actual: Number(r.rating),
      predicted: Number(r.predicted_a) / 20, // display points -> stars
      confidence: r.confidence === null ? null : Number(r.confidence),
      modelVersion: r.model_version as string | null,
    }));

  // Running MAE, so drift is visible rather than averaged away.
  let sum = 0;
  const running = live.map((p, i) => {
    sum += Math.abs(p.predicted - p.actual);
    return { i: i + 1, at: p.at, mae: Number((sum / (i + 1)).toFixed(4)) };
  });

  let inSample: ReturnType<typeof backtest> | null = null;
  try {
    inSample = backtest(await buildBacktestRows(), models.a, models.b);
  } catch {
    // History not imported yet — the model card alone is still worth showing.
  }

  return NextResponse.json({
    card: models.card,
    live: {
      n: live.length,
      mae: live.length
        ? Number(mae(live.map((p) => p.actual), live.map((p) => p.predicted)).toFixed(4))
        : null,
      points: live,
      running,
    },
    inSample: inSample ? { metrics: inSample.metrics, points: inSample.points } : null,
  });
}
