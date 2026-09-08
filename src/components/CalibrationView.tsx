'use client';

import { useEffect, useState } from 'react';
import { CalibrationCurve, LineChart, ResidualPlot, Scatter } from './Charts';

interface Payload {
  card: any;
  live: {
    n: number;
    mae: number | null;
    points: { at: string; actual: number; predicted: number; confidence: number | null }[];
    running: { i: number; mae: number }[];
  };
  inSample: {
    metrics: any;
    points: {
      name: string;
      actualRating: number;
      predictedRating: number;
      residual: number;
      actualRewatch: number;
      predictedRewatch: number;
    }[];
  } | null;
  error?: string;
}

export function CalibrationView() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/calibration')
      .then((r) => r.json())
      .then((j) => (j.error ? setError(j.error) : setData(j)))
      .catch((e) => setError(e.message));
  }, []);

  if (error) return <p className="panel mt-4 p-4 text-xs text-bad">{error}</p>;
  if (!data) return <p className="py-8 text-center text-2xs text-ink-500">Loading…</p>;

  const card = data.card;
  const a = card.model_a;
  const b = card.model_b;

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-sm font-semibold text-ink-100">Calibration</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-400">
          The held-out numbers come from grouped cross-validation at fit time — grouped by{' '}
          <code className="text-signal">{card.cv?.groups}</code>, so franchise entries never sit on
          both sides of a split. The live numbers below come from what you have actually rated since,
          each stored with the prediction that was on screen at the time.
        </p>
      </section>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Model A · MAE"
          value={fmt(a.metrics.mae)}
          sub={`baseline ${fmt(a.baseline.mae)} · lift ${fmt(a.metrics.mae_lift)}`}
          good={a.metrics.mae < a.baseline.mae}
        />
        <Metric label="Model A · Spearman" value={fmt(a.metrics.spearman)} sub={`${a.kind} · ${card.rows} rows`} good={a.metrics.spearman > 0.2} />
        <Metric
          label="Model B · ROC-AUC"
          value={fmt(b.metrics.auc)}
          sub={`baseline 0.500 · lift ${fmt(b.metrics.auc_lift)}`}
          good={b.metrics.auc > 0.6}
        />
        <Metric
          label="Model B · precision@20"
          value={fmt(b.metrics.precision_at_20)}
          sub={`base rate ${fmt(b.metrics.base_rate)}`}
          good={b.metrics.precision_at_20 > b.metrics.base_rate}
        />
      </section>

      {b.metrics.auc < 0.55 && (
        <p className="panel border-warn/40 p-3 text-xs text-warn">
          Model B is close to chance. Rewatch is not being predicted by these features, and the
          two-score premise needs rethinking before any of it is worth trusting.
        </p>
      )}

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="panel p-3">
          <div className="label mb-1">Model B calibration (held out at fit time)</div>
          <CalibrationCurve bins={b.calibration ?? []} />
          <p className="mt-1 text-2xs text-ink-500">
            Calibration error {fmt(b.metrics.calibration_error)} — this is what widens the interval
            printed next to every Score B.
          </p>
        </div>

        <div className="panel p-3">
          <div className="label mb-1">Running MAE on titles you rated after scoring</div>
          <LineChart
            points={data.live.running.map((r) => ({ x: r.i, y: r.mae }))}
            xLabel="ratings given, in order"
            yLabel="MAE ★"
          />
          <p className="mt-1 text-2xs text-ink-500">
            {data.live.n === 0
              ? 'Nothing rated through the app yet — rate a few and drift becomes visible here.'
              : `${data.live.n} rated since scoring · MAE ${fmt(data.live.mae)}★`}
          </p>
        </div>
      </section>

      {data.inSample && (
        <section className="grid gap-3 lg:grid-cols-2">
          <div className="panel p-3">
            <div className="label mb-1">Predicted vs actual (in-sample, whole history)</div>
            <Scatter
              points={data.inSample.points.map((p) => ({
                x: p.actualRating,
                y: p.predictedRating,
                label: `${p.name}: predicted ${p.predictedRating.toFixed(2)}, actual ${p.actualRating}`,
              }))}
              domain={[0.5, 5]}
              xLabel="your rating"
              yLabel="predicted"
            />
            <p className="mt-1 text-2xs text-ink-600">
              In-sample and therefore optimistic — the honest number is the held-out MAE above.
            </p>
          </div>
          <div className="panel p-3">
            <div className="label mb-1">Residuals</div>
            <ResidualPlot
              points={data.inSample.points.map((p) => ({
                x: p.predictedRating,
                y: p.residual,
                label: `${p.name}: ${p.residual > 0 ? 'over' : 'under'}predicted by ${Math.abs(p.residual).toFixed(2)}`,
              }))}
            />
            <p className="mt-1 text-2xs text-ink-600">
              A tilt here means the model regresses to the mean: it flatters what you disliked and
              underrates what you loved.
            </p>
          </div>
        </section>
      )}

      <section className="panel p-3">
        <div className="label mb-2">Model card</div>
        <dl className="grid gap-x-8 gap-y-1 text-2xs sm:grid-cols-2 lg:grid-cols-3">
          <Row k="Fitted" v={String(card.fitted_at).slice(0, 19).replace('T', ' ')} />
          <Row k="Rows" v={String(card.rows)} />
          <Row k="Feature version" v={card.feature_version} />
          <Row k="Model A" v={a.kind} />
          <Row k="Model B" v={b.kind} />
          <Row k="CV" v={`${card.cv?.scheme} · ${card.cv?.folds} folds · ${card.cv?.groups}`} />
          <Row k="Global mean rating" v={fmt(card.global_mean)} />
          <Row k="Global rewatch rate" v={`${(card.global_rewatch_rate * 100).toFixed(1)}%`} />
          <Row k="Shrinkage m" v={String(card.shrinkage_m)} />
        </dl>
        {card.notes?.length > 0 && (
          <ul className="mt-3 space-y-1 text-2xs leading-relaxed text-ink-500">
            {card.notes.map((n: string) => (
              <li key={n}>— {n}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined || Number.isNaN(v) ? '—' : Number(v).toFixed(3);
}

function Metric({ label, value, sub, good }: { label: string; value: string; sub: string; good?: boolean }) {
  return (
    <div className="panel p-3">
      <div className="label">{label}</div>
      <div className={`tabular mt-1 font-mono text-2xl ${good ? 'text-signal' : 'text-ink-100'}`}>{value}</div>
      <div className="mt-1 text-2xs text-ink-500">{sub}</div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{k}</dt>
      <dd className="tabular font-mono text-ink-200">{v}</dd>
    </div>
  );
}
