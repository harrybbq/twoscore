'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Result {
  report?: {
    files: Record<string, number>;
    ignored: string[];
    entries: number;
    rated: number;
    withDiary: number;
    withRewatch: number;
    watchlist: number;
    warnings: string[];
  };
  inserted?: number;
  updated?: number;
  unchanged?: number;
  errors?: string[];
  error?: string;
}

export function ImportPanel() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setResult(null);
    const form = new FormData();
    form.append('file', file);
    try {
      const res = await fetch('/api/import', { method: 'POST', body: form });
      setResult(await res.json());
      router.refresh();
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel mt-3 p-4">
      <label className="block cursor-pointer rounded border border-dashed border-ink-600 p-6 text-center transition hover:border-signal-dim">
        <input
          type="file"
          accept=".zip,.csv"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <span className="text-xs text-ink-300">
          {busy ? 'Unpacking and parsing…' : 'Tap to choose your letterboxd export ZIP'}
        </span>
        <span className="mt-1 block text-2xs text-ink-500">
          Parsed server-side. Nothing is sent anywhere but your own database.
        </span>
      </label>

      {result?.error && <p className="mt-3 text-xs text-bad">{result.error}</p>}

      {result?.report && (
        <div className="mt-3 space-y-2 text-2xs">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
            <Row label="Titles" value={result.report.entries} />
            <Row label="Rated" value={result.report.rated} />
            <Row label="In diary" value={result.report.withDiary} />
            <Row label="Rewatched" value={result.report.withRewatch} />
            <Row label="Watchlist" value={result.report.watchlist} />
            <Row label="New rows" value={result.inserted ?? 0} />
          </div>
          <details className="text-ink-500">
            <summary className="cursor-pointer">Files parsed</summary>
            <ul className="mt-1 space-y-0.5">
              {Object.entries(result.report.files).map(([f, n]) => (
                <li key={f} className="tabular">
                  {f} — {n} rows
                </li>
              ))}
              {result.report.ignored.map((f) => (
                <li key={f} className="text-ink-600">
                  {f} — ignored
                </li>
              ))}
            </ul>
          </details>
          {result.report.warnings.map((w) => (
            <p key={w} className="text-warn">
              {w}
            </p>
          ))}
          {(result.errors ?? []).map((e) => (
            <p key={e} className="text-bad">
              {e}
            </p>
          ))}
          <p className="text-ink-400">
            Next: resolve to TMDB with <code className="text-signal">npm run backfill</code>, then
            rebuild affinities and refit.
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-ink-500">{label}</span>
      <span className="tabular font-mono text-ink-200">{value}</span>
    </div>
  );
}
