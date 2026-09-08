'use client';

import { useState } from 'react';

interface Row {
  id: number;
  name: string;
  year: number | null;
  rating: number | null;
  has_logged_rewatch: boolean;
  match_method: string | null;
  excluded: boolean;
  exclude_reason: string | null;
}

interface Hit {
  tmdbId: number;
  mediaType: 'movie' | 'tv';
  title: string;
  year: number | null;
  posterPath: string | null;
}

export function UnresolvedQueue({ rows }: { rows: Row[] }) {
  const [pending, setPending] = useState<Row[]>(rows);

  if (!pending.length) {
    return (
      <p className="panel mt-3 p-5 text-center text-xs text-ink-400">
        Nothing unresolved. Every rated title in your history has a TMDB id.
      </p>
    );
  }

  return (
    <div className="mt-3 space-y-2">
      <p className="text-2xs text-ink-500">{pending.length} to resolve</p>
      {pending.map((r) => (
        <UnresolvedRow
          key={r.id}
          row={r}
          onDone={() => setPending((p) => p.filter((x) => x.id !== r.id))}
        />
      ))}
    </div>
  );
}

function UnresolvedRow({ row, onDone }: { row: Row; onDone: () => void }) {
  const [q, setQ] = useState(row.name);
  const [type, setType] = useState<'movie' | 'tv'>('movie');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = async () => {
    setBusy(true);
    setError(null);
    try {
      const sp = new URLSearchParams({ q, type });
      if (row.year) sp.set('year', String(row.year));
      const res = await fetch(`/api/unresolved/search?${sp}`);
      const json = await res.json();
      if (json.error) setError(json.error);
      setHits(json.results ?? []);
    } finally {
      setBusy(false);
    }
  };

  const attach = async (hit: Hit) => {
    setBusy(true);
    try {
      const res = await fetch('/api/unresolved', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, tmdbId: hit.tmdbId, mediaType: hit.mediaType }),
      });
      const json = await res.json();
      if (json.error) {
        setError(json.error);
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  const exclude = async () => {
    setBusy(true);
    try {
      await fetch('/api/history', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id, excluded: true, reason: 'joke rating' }),
      });
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-sm text-ink-100">{row.name}</span>
        <span className="tabular text-2xs text-ink-500">{row.year ?? 'no year'}</span>
        {row.rating !== null && (
          <span className="tabular chip">{Number(row.rating).toFixed(1)}★</span>
        )}
        {row.has_logged_rewatch && <span className="chip border-signal-dim text-signal">rewatched</span>}
      </div>

      <div className="mt-2 flex gap-1.5">
        <input
          className="input flex-1"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && search()}
          placeholder="Search TMDB…"
        />
        <select className="input" value={type} onChange={(e) => setType(e.target.value as 'movie' | 'tv')}>
          <option value="movie">Film</option>
          <option value="tv">TV</option>
        </select>
        <button className="btn" onClick={search} disabled={busy}>
          {busy ? '…' : 'Search'}
        </button>
      </div>

      {error && <p className="mt-2 text-2xs text-bad">{error}</p>}

      {hits && hits.length === 0 && (
        <p className="mt-2 text-2xs text-ink-500">
          No results. Try the original-language title, or flag it as a joke rating to leave it out of
          the model.
        </p>
      )}

      {hits && hits.length > 0 && (
        <ul className="mt-2 space-y-1">
          {hits.map((h) => (
            <li key={`${h.mediaType}:${h.tmdbId}`}>
              <button
                onClick={() => attach(h)}
                disabled={busy}
                className="flex w-full items-center gap-2 rounded border border-ink-700 bg-ink-850 px-2 py-1.5
                           text-left text-xs transition hover:border-signal-dim disabled:opacity-40"
              >
                {h.posterPath ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`https://image.tmdb.org/t/p/w92${h.posterPath}`}
                    alt=""
                    className="h-10 w-7 rounded object-cover"
                  />
                ) : (
                  <span className="h-10 w-7 rounded bg-ink-800" />
                )}
                <span className="min-w-0 flex-1 truncate text-ink-200">{h.title}</span>
                <span className="tabular text-2xs text-ink-500">{h.year ?? '—'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <button onClick={exclude} disabled={busy} className="mt-2 text-2xs text-ink-500 underline hover:text-warn">
        Flag as a joke rating and exclude from the model
      </button>
    </div>
  );
}
