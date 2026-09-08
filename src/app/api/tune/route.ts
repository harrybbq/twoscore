import { NextResponse } from 'next/server';
import { DEFAULT_M } from '@/lib/affinity/compute';
import { loadModels } from '@/lib/models/load';
import { backtest, buildBacktestRows, reweight, type WeightGroup } from '@/lib/tune/backtest';

export const maxDuration = 120;
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const models = await loadModels();
  if (!models) return NextResponse.json({ error: 'Models are not fitted yet.' }, { status: 409 });

  const body = (await req.json().catch(() => ({}))) as {
    m?: number;
    weights?: Partial<Record<WeightGroup, number>>;
  };
  const m = Number.isFinite(body.m) ? Math.max(0, Math.min(40, body.m!)) : DEFAULT_M;
  const weights = body.weights ?? {};

  try {
    const [baseRows, rows] = await Promise.all([
      buildBacktestRows(DEFAULT_M),
      buildBacktestRows(m),
    ]);
    const base = backtest(baseRows, models.a, models.b);
    const tuned = backtest(rows, reweight(models.a, weights), reweight(models.b, weights));
    return NextResponse.json({
      m,
      weights,
      baseline: base.metrics,
      tuned: tuned.metrics,
      linear: { a: models.a.kind !== 'gbm', b: models.b.kind !== 'gbm' },
      kinds: { a: models.a.kind, b: models.b.kind },
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
