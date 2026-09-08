'use client';

import { useCallback, useEffect, useState } from 'react';
import { AFFINITY_KINDS } from '@/lib/affinity/types';

interface Row {
  kind: string;
  entity_id: string;
  entity_name: string;
  n: number;
  mean_rating: number | null;
  affinity: number;
  n_rewatch: number;
  rewatch_rate: number | null;
  rewatch_affinity: number;
  best_title: string | null;
}

interface Globals {
  m: number;
  globalMean: number;
  globalRewatchRate: number;
  ratedTitles: number;
}

const COLS: { key: string; label: string; align?: string }[] = [
  { key: 'entity_name', label: 'Entity' },
  { key: 'n', label: 'n', align: 'text-right' },
  { key: 'mean_rating', label: 'Mean', align: 'text-right' },
  { key: 'affinity', label: 'Affinity', align: 'text-right' },
  { key: 'rewatch_rate', label: 'Rewatch %', align: 'text-right' },
  { key: 'rewatch_affinity', label: 'RW affinity', align: 'text-right' },
];

/**
 * The hand-sanity-check surface. Shrinkage is only trustworthy if you can see
 * the raw mean and the sample size next to the shrunk number.
 */
export function AffinityExplorer() {
  const [kind, setKind] = useState('director');
  const [minN, setMinN] = useState(2);
  const [sort, setSort] = useState('affinity');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [globals, setGlobals] = useState<Globals | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const sp = new URLSearchParams({ kind, minN: String(minN), sort, dir, limit: '300' });
    if (q) sp.set('q', q);
    const res = await fetch(`/api/affinities?${sp}`);
    const json = await res.json();
    setRows(json.rows ?? []);
    setTotal(json.total ?? 0);
    setGlobals(json.globals ?? null);
    setLoading(false);
  }, [kind, minN, sort, dir, q]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
          {AFFINITY_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-2xs text-ink-400">
          min n
          <input
            type="number"
            min={1}
            className="input w-16"
            value={minN}
            onChange={(e) => setMinN(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>
        <input
          className="input w-56"
          placeholder="Filter by name…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="tabular text-2xs text-ink-500">
          {rows.length} shown of {total}
        </span>
        {globals && (
          <span className="ml-auto tabular text-2xs text-ink-500">
            global mean {globals.globalMean.toFixed(3)} · rewatch base{' '}
            {(globals.globalRewatchRate * 100).toFixed(1)}% · m = {globals.m} · fitted on{' '}
            {globals.ratedTitles} rated titles
          </span>
        )}
      </div>

      <p className="mt-1.5 text-2xs text-ink-600">
        affinity = (n·mean + m·global) / (n + m). An entity with n=1 sits close to the global mean by
        construction — that is the point.
      </p>

      <div className="panel mt-2 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-ink-850">
            <tr className="border-b border-ink-700 text-left">
              {COLS.map((c) => (
                <th
                  key={c.key}
                  onClick={() => {
                    if (sort === c.key) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
                    else {
                      setSort(c.key);
                      setDir('desc');
                    }
                  }}
                  className={`cursor-pointer select-none px-3 py-1.5 font-medium text-ink-400 hover:text-ink-100 ${c.align ?? ''}`}
                >
                  {c.label}
                  {sort === c.key && <span className="text-signal">{dir === 'asc' ? ' ↑' : ' ↓'}</span>}
                </th>
              ))}
              <th className="px-3 py-1.5 font-medium text-ink-400">Best rated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.entity_id} className="border-b border-ink-850 hover:bg-ink-900">
                <td className="px-3 py-1 text-ink-100">{r.entity_name}</td>
                <td className="tabular px-3 py-1 text-right text-ink-400">{r.n}</td>
                <td className="tabular px-3 py-1 text-right font-mono text-ink-300">
                  {r.mean_rating === null ? '—' : Number(r.mean_rating).toFixed(2)}
                </td>
                <td className="tabular px-3 py-1 text-right font-mono text-ink-100">
                  {Number(r.affinity).toFixed(3)}
                </td>
                <td className="tabular px-3 py-1 text-right font-mono text-ink-300">
                  {r.rewatch_rate === null ? '—' : `${(Number(r.rewatch_rate) * 100).toFixed(0)}%`}
                  <span className="text-ink-600"> ({r.n_rewatch})</span>
                </td>
                <td className="tabular px-3 py-1 text-right font-mono text-signal">
                  {Number(r.rewatch_affinity).toFixed(3)}
                </td>
                <td className="max-w-[18rem] truncate px-3 py-1 text-ink-500">{r.best_title ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading && <p className="py-3 text-center text-2xs text-ink-500">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="py-6 text-center text-2xs text-ink-500">
          Nothing here. Run <code className="text-signal">npm run affinities</code> after the backfill.
        </p>
      )}
    </div>
  );
}
