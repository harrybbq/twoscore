'use client';

import { useState } from 'react';
import { WEIGHT_GROUPS, type WeightGroup } from '@/lib/tune/backtest';

interface Metrics {
  a: { mae: number; spearman: number; baselineMae: number; n: number };
  b: { auc: number; precisionAt20: number; baseRate: number; n: number };
}

interface Result {
  m: number;
  baseline: Metrics;
  tuned: Metrics;
  linear: { a: boolean; b: boolean };
  kinds: { a: string; b: string };
  error?: string;
}

const DEFAULT_M = 3;

export function TuneSandbox() {
  const [m, setM] = useState(DEFAULT_M);
  const [weights, setWeights] = useState<Record<string, number>>(
    Object.fromEntries(WEIGHT_GROUPS.map((g) => [g, 1])),
  );
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tune', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ m, weights }),
      });
      const json = await res.json();
      if (json.error) setError(json.error);
      else setResult(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setM(DEFAULT_M);
    setWeights(Object.fromEntries(WEIGHT_GROUPS.map((g) => [g, 1])));
  };

  const gbmA = result && !result.linear.a;
  const gbmB = result && !result.linear.b;

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-sm font-semibold text-ink-100">Tune</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-400">
          Shrinkage <code className="text-signal">m</code> rebuilds the affinity tables and therefore
          the whole feature matrix, so changing it is a genuinely different backtest. Weight sliders
          scale a linear model&apos;s coefficients. Both are re-scored against your full history{' '}
          <span className="text-warn">in-sample</span> — this shows the direction a change moves
          things, and the honest held-out numbers stay on /calibration.
        </p>
      </section>

      <section className="panel p-4">
        <div className="flex flex-wrap items-end gap-6">
          <label className="block">
            <span className="label">Shrinkage m</span>
            <div className="mt-1 flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={20}
                step={1}
                value={m}
                onChange={(e) => setM(Number(e.target.value))}
                className="w-48 accent-[#4fd1c5]"
              />
              <span className="tabular w-8 font-mono text-sm text-ink-100">{m}</span>
            </div>
            <span className="mt-0.5 block text-2xs text-ink-600">
              0 = trust every sample size · 20 = trust almost nothing but the global mean
            </span>
          </label>
          <div className="flex gap-1.5">
            <button className="btn btn-primary" onClick={run} disabled={busy}>
              {busy ? 'Re-scoring…' : 'Run backtest'}
            </button>
            <button className="btn" onClick={reset} disabled={busy}>
              Reset
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
          {WEIGHT_GROUPS.map((g: WeightGroup) => (
            <label key={g} className="block">
              <span className="flex items-baseline justify-between text-2xs">
                <span className="text-ink-300">{g}</span>
                <span className="tabular font-mono text-ink-400">{weights[g].toFixed(2)}×</span>
              </span>
              <input
                type="range"
                min={0}
                max={3}
                step={0.05}
                value={weights[g]}
                onChange={(e) => setWeights((w) => ({ ...w, [g]: Number(e.target.value) }))}
                className="mt-0.5 w-full accent-[#4fd1c5]"
              />
            </label>
          ))}
        </div>

        {(gbmA || gbmB) && (
          <p className="mt-3 text-2xs text-warn">
            {gbmA && gbmB
              ? 'Both models are gradient-boosted'
              : gbmA
                ? 'Model A is gradient-boosted'
                : 'Model B is gradient-boosted'}
            , so weight sliders do nothing to {gbmA && gbmB ? 'them' : 'it'} — there are no
            coefficients to scale. m still applies. Refit with ridge/logistic to use the sliders.
          </p>
        )}
      </section>

      {error && <p className="panel border-bad/40 p-3 text-xs text-bad">{error}</p>}

      {result && (
        <section className="panel overflow-x-auto p-0">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-ink-700 text-left text-ink-400">
                <th className="px-3 py-2 font-medium">Metric</th>
                <th className="px-3 py-2 text-right font-medium">Baseline (m={DEFAULT_M}, 1×)</th>
                <th className="px-3 py-2 text-right font-medium">Tuned (m={result.m})</th>
                <th className="px-3 py-2 text-right font-medium">Diff</th>
              </tr>
            </thead>
            <tbody>
              <Diff label="Model A · MAE ★" base={result.baseline.a.mae} tuned={result.tuned.a.mae} lowerBetter />
              <Diff label="Model A · Spearman" base={result.baseline.a.spearman} tuned={result.tuned.a.spearman} />
              <Diff label="Model B · ROC-AUC" base={result.baseline.b.auc} tuned={result.tuned.b.auc} />
              <Diff
                label="Model B · precision@20"
                base={result.baseline.b.precisionAt20}
                tuned={result.tuned.b.precisionAt20}
              />
            </tbody>
          </table>
          <p className="border-t border-ink-800 px-3 py-2 text-2xs text-ink-500">
            {result.baseline.a.n} rated titles · rewatch base rate{' '}
            {(result.baseline.b.baseRate * 100).toFixed(1)}% · models: A {result.kinds.a}, B{' '}
            {result.kinds.b}
          </p>
        </section>
      )}
    </div>
  );
}

function Diff({
  label,
  base,
  tuned,
  lowerBetter,
}: {
  label: string;
  base: number;
  tuned: number;
  lowerBetter?: boolean;
}) {
  const d = tuned - base;
  const better = lowerBetter ? d < 0 : d > 0;
  const tone = Math.abs(d) < 1e-4 ? 'text-ink-500' : better ? 'text-good' : 'text-bad';
  return (
    <tr className="border-b border-ink-850">
      <td className="px-3 py-1.5 text-ink-200">{label}</td>
      <td className="tabular px-3 py-1.5 text-right font-mono text-ink-400">{fmt(base)}</td>
      <td className="tabular px-3 py-1.5 text-right font-mono text-ink-100">{fmt(tuned)}</td>
      <td className={`tabular px-3 py-1.5 text-right font-mono ${tone}`}>
        {d > 0 ? '+' : ''}
        {fmt(d)}
      </td>
    </tr>
  );
}

function fmt(v: number): string {
  return Number.isFinite(v) ? v.toFixed(4) : '—';
}
