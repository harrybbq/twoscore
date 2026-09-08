'use client';

import { useState } from 'react';
import type { TitleRow, WhyRow } from '@/lib/titles/query';
import { ConfidenceDot, DeltaBadge, Poster } from './Score';

/**
 * Side-by-side, term by term. Rows are unioned across the selected titles so a
 * term that fires for one and not the other is visible as a blank rather than
 * silently absent — the gap is usually the answer.
 */
export function CompareView() {
  const [picked, setPicked] = useState<TitleRow[]>([]);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<TitleRow[]>([]);
  const [model, setModel] = useState<'b' | 'a'>('b');
  const [busy, setBusy] = useState(false);

  const search = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/titles?q=${encodeURIComponent(q)}&limit=8`);
      const json = await res.json();
      setHits(json.rows ?? []);
    } finally {
      setBusy(false);
    }
  };

  const add = (r: TitleRow) => {
    setPicked((p) =>
      p.some((x) => x.tmdb_id === r.tmdb_id && x.media_type === r.media_type) ? p : [...p, r],
    );
    setHits([]);
    setQ('');
  };

  const labels: string[] = [];
  for (const t of picked) {
    for (const term of (t.contributions?.[model] ?? []) as WhyRow[]) {
      if (!labels.includes(term.label)) labels.push(term.label);
    }
  }

  return (
    <div className="space-y-4">
      <section>
        <h1 className="text-sm font-semibold text-ink-100">Compare</h1>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-ink-400">
          Two or more titles, one term at a time. A blank cell means that term did not fire for that
          title at all.
        </p>
      </section>

      <section className="flex flex-wrap items-center gap-1.5">
        <input
          className="input w-72"
          placeholder="Search scored titles…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
        />
        <button className="btn" onClick={search} disabled={busy}>
          {busy ? '…' : 'Search'}
        </button>
        <select className="input" value={model} onChange={(e) => setModel(e.target.value as 'a' | 'b')}>
          <option value="b">Score B terms (rewatch)</option>
          <option value="a">Score A terms (admiration)</option>
        </select>
        {picked.length > 0 && (
          <button className="btn" onClick={() => setPicked([])}>
            Clear
          </button>
        )}
      </section>

      {hits.length > 0 && (
        <ul className="panel divide-y divide-ink-850 p-0">
          {hits.map((h) => (
            <li key={`${h.media_type}:${h.tmdb_id}`}>
              <button
                onClick={() => add(h)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-ink-800"
              >
                <span className="flex-1 truncate text-ink-200">{h.title}</span>
                <span className="tabular text-ink-500">{h.release_year ?? '—'}</span>
                <span className="tabular font-mono text-signal">{h.score_b.toFixed(0)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked.length === 0 ? (
        <p className="panel p-6 text-center text-xs text-ink-500">
          Search for two titles to put them side by side.
        </p>
      ) : (
        <section className="panel overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-ink-700">
                <th className="w-56 px-3 py-2 text-left font-medium text-ink-400">Term</th>
                {picked.map((t) => (
                  <th key={`${t.media_type}:${t.tmdb_id}`} className="min-w-[13rem] px-3 py-2 text-left align-top">
                    <div className="flex gap-2">
                      <Poster path={t.poster_path} alt={t.title} />
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-ink-100">{t.title}</div>
                        <div className="tabular mt-0.5 text-2xs text-ink-500">
                          {t.release_year ?? '—'} · {t.runtime ? `${t.runtime} min` : '—'}
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-2xs">
                          <span className="tabular font-mono text-signal">B {t.score_b.toFixed(0)}</span>
                          <span className="tabular font-mono text-ink-300">A {t.score_a.toFixed(0)}</span>
                          <DeltaBadge value={t.delta} />
                          <ConfidenceDot value={t.confidence} />
                        </div>
                        <button
                          className="mt-1 text-2xs text-ink-600 underline hover:text-bad"
                          onClick={() =>
                            setPicked((p) =>
                              p.filter((x) => !(x.tmdb_id === t.tmdb_id && x.media_type === t.media_type)),
                            )
                          }
                        >
                          remove
                        </button>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labels.map((label) => (
                <tr key={label} className="border-b border-ink-850">
                  <td className="px-3 py-1.5 text-ink-300">{label}</td>
                  {picked.map((t) => {
                    const term = ((t.contributions?.[model] ?? []) as WhyRow[]).find(
                      (x) => x.label === label,
                    );
                    return (
                      <td key={`${t.tmdb_id}-${label}`} className="px-3 py-1.5 align-top">
                        {term ? (
                          <>
                            <span
                              className={`tabular font-mono ${term.effect >= 0 ? 'text-good' : 'text-bad'}`}
                            >
                              {term.effect > 0 ? '+' : ''}
                              {term.effect.toFixed(1)}
                            </span>
                            <span className="ml-2 text-2xs text-ink-500">{term.detail}</span>
                          </>
                        ) : (
                          <span className="text-ink-700">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
