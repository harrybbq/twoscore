'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TitleFilters, TitleRow } from '@/lib/titles/query';
import { toQueryString } from '@/lib/titles/query';
import { FeedCard, type FeedAction } from './FeedCard';
import { FilterBar } from './FilterBar';

const PAGE = 20;
const STORE_KEY = 'twoscore.filters.v1';

export function Feed({ genres, publicLabel }: { genres: string[]; publicLabel: string }) {
  const [filters, setFilters] = useState<TitleFilters>({ sort: 'score_b', dir: 'desc' });
  const [rows, setRows] = useState<TitleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const offset = useRef(0);
  const reqId = useRef(0);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE_KEY);
      if (saved) setFilters((f) => ({ ...f, ...JSON.parse(saved) }));
    } catch {
      /* a stale filter is not worth a crash */
    }
  }, []);

  const load = useCallback(
    async (reset: boolean) => {
      const id = ++reqId.current;
      setLoading(true);
      setError(null);
      const from = reset ? 0 : offset.current;
      try {
        const qs = toQueryString({ ...filters, limit: PAGE, offset: from });
        const res = await fetch(`/api/titles?${qs}`);
        const json = await res.json();
        if (id !== reqId.current) return; // a newer request already won
        if (json.error) throw new Error(json.error);
        setTotal(json.total ?? 0);
        setRows((prev) => (reset ? json.rows : [...prev, ...json.rows]));
        offset.current = from + (json.rows?.length ?? 0);
        setDone((json.rows?.length ?? 0) < PAGE);
      } catch (e) {
        if (id === reqId.current) setError((e as Error).message);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    },
    [filters],
  );

  useEffect(() => {
    offset.current = 0;
    setDone(false);
    void load(true);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(filters));
    } catch {
      /* private mode */
    }
  }, [filters, load]);

  // Infinite scroll. Nothing here polls; new titles arrive from cron or the
  // refresh button only.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || done || loading) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void load(false);
      },
      { rootMargin: '400px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [done, loading, load]);

  const onAction = async (row: TitleRow, action: FeedAction, rating?: number) => {
    setRows((prev) => prev.filter((r) => !(r.tmdb_id === row.tmdb_id && r.media_type === row.media_type)));
    setToast(
      action === 'rated'
        ? `${row.title} rated ${rating} — predicted ${(row.score_a / 20).toFixed(1)}`
        : `${row.title}: ${action.replace('_', ' ')}`,
    );
    try {
      await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tmdbId: row.tmdb_id,
          mediaType: row.media_type,
          action,
          rating: rating ?? null,
        }),
      });
    } catch {
      setToast('Could not save that — check your connection.');
    }
    setTimeout(() => setToast(null), 3200);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const json = await res.json();
      setToast(json.error ? json.error : `Scored ${json.scored} of ${json.discovered} discovered`);
      offset.current = 0;
      await load(true);
    } catch (e) {
      setToast((e as Error).message);
    } finally {
      setRefreshing(false);
      setTimeout(() => setToast(null), 4000);
    }
  };

  return (
    <div>
      <FilterBar
        filters={filters}
        genres={genres}
        count={total}
        refreshing={refreshing}
        onRefresh={refresh}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
      />

      {error && (
        <div className="panel mt-3 border-bad/40 p-3 text-xs text-bad">
          {error}
        </div>
      )}

      {/* The feed is the phone surface; on a wide screen it stops sprawling
          and the table takes over. */}
      <div className="mt-3 space-y-2 lg:max-w-3xl">
        {rows.map((r) => (
          <FeedCard
            key={`${r.media_type}:${r.tmdb_id}`}
            row={r}
            publicLabel={publicLabel}
            onAction={onAction}
          />
        ))}
      </div>

      {!loading && rows.length === 0 && !error && (
        <div className="panel mt-3 p-5 text-center text-xs text-ink-400">
          Nothing matches those filters. Loosen them, or hit Refresh to pull tonight&apos;s trending.
        </div>
      )}

      <div ref={sentinel} className="h-8" />
      {loading && <p className="py-4 text-center text-2xs text-ink-500">Loading…</p>}
      {done && rows.length > 0 && (
        <p className="py-4 text-center text-2xs text-ink-600">That is everything scored.</p>
      )}

      {toast && (
        <div className="fixed inset-x-3 bottom-4 z-50 mx-auto max-w-md rounded border border-ink-600 bg-ink-800 px-3 py-2 text-center text-xs text-ink-100 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
