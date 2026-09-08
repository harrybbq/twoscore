'use client';

import Link from 'next/link';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TitleFilters, TitleRow } from '@/lib/titles/query';
import { toQueryString } from '@/lib/titles/query';
import { ConfidenceDot, DeltaBadge, TypeBadge, WhyPanel } from './Score';
import { RatingStrip } from './RatingStrip';

const PAGE = 100;

const COLUMNS: { key: string; label: string; sortable: boolean; align?: string; title?: string }[] = [
  { key: 'title', label: 'Title', sortable: true },
  { key: 'type', label: 'Type', sortable: false },
  { key: 'release_year', label: 'Year', sortable: true, align: 'text-right' },
  { key: 'runtime', label: 'Run', sortable: true, align: 'text-right' },
  { key: 'score_b', label: 'B', sortable: true, align: 'text-right', title: 'Rewatch probability' },
  { key: 'score_a', label: 'A', sortable: true, align: 'text-right', title: 'Predicted admiration, 0–100' },
  { key: 'public_rating', label: 'Public', sortable: true, align: 'text-right' },
  { key: 'delta', label: 'Δ', sortable: true, align: 'text-right', title: 'Score A − public × 10' },
  { key: 'confidence', label: 'Conf', sortable: true, align: 'text-right' },
  { key: 'vote_count', label: 'Votes', sortable: true, align: 'text-right' },
  { key: 'director', label: 'Director', sortable: false },
  { key: 'collection', label: 'Collection', sortable: false },
  { key: 'keywords', label: 'Keywords', sortable: false },
  { key: 'scored_at', label: 'Scored', sortable: true, align: 'text-right' },
];

const SHORTCUTS = 'j/k move · x select · a all · w watched · d not interested · r rate · enter detail · e export';

export function TitleTable({ genres, publicLabel }: { genres: string[]; publicLabel: string }) {
  const [filters, setFilters] = useState<TitleFilters>({ sort: 'score_b', dir: 'desc' });
  const [rows, setRows] = useState<TitleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rating, setRating] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);

  const keyOf = (r: TitleRow) => `${r.media_type}:${r.tmdb_id}`;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/titles?${toQueryString({ ...filters, limit: PAGE, offset: 0 })}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setRows(json.rows ?? []);
      setTotal(json.total ?? 0);
      setCursor(0);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortBy = (key: string) => {
    setFilters((f) => ({
      ...f,
      sort: key,
      // Δ is worth reading in both directions: crowd-loves-it-model-doesn't is
      // as interesting as the reverse, so a second click flips rather than resets.
      dir: f.sort === key && f.dir === 'desc' ? 'asc' : 'desc',
    }));
  };

  const act = useCallback(
    async (targets: TitleRow[], action: string, ratingValue?: number) => {
      const keys = new Set(targets.map(keyOf));
      setRows((prev) => prev.filter((r) => !keys.has(keyOf(r))));
      setSelected(new Set());
      setStatus(`${targets.length} × ${action.replace('_', ' ')}`);
      await Promise.all(
        targets.map((r) =>
          fetch('/api/feedback', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              tmdbId: r.tmdb_id,
              mediaType: r.media_type,
              action,
              rating: ratingValue ?? null,
            }),
          }),
        ),
      );
      setTimeout(() => setStatus(null), 2500);
    },
    [],
  );

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(keyOf(r))), [rows, selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const current = rows[cursor];
      switch (e.key) {
        case 'j':
          setCursor((c) => Math.min(rows.length - 1, c + 1));
          break;
        case 'k':
          setCursor((c) => Math.max(0, c - 1));
          break;
        case 'x':
          if (!current) return;
          setSelected((s) => {
            const next = new Set(s);
            const k = keyOf(current);
            next.has(k) ? next.delete(k) : next.add(k);
            return next;
          });
          break;
        case 'a':
          setSelected((s) => (s.size === rows.length ? new Set() : new Set(rows.map(keyOf))));
          break;
        case 'w':
          void act(selectedRows.length ? selectedRows : current ? [current] : [], 'watched');
          break;
        case 'd':
          void act(selectedRows.length ? selectedRows : current ? [current] : [], 'not_interested');
          break;
        case 'r':
          if (current) setRating(keyOf(current));
          break;
        case 'Enter':
          if (current) setExpanded((v) => (v === keyOf(current) ? null : keyOf(current)));
          break;
        case 'e':
          window.location.href = `/api/export?${toQueryString(filters)}`;
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, cursor, selectedRows, act, filters]);

  useEffect(() => {
    bodyRef.current?.querySelectorAll('tr')[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <select
          className="input"
          value={filters.type ?? 'all'}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value as TitleFilters['type'] }))}
        >
          <option value="all">All types</option>
          <option value="movie">Film</option>
          <option value="tv">TV</option>
        </select>
        <select
          className="input"
          value={filters.genre ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, genre: e.target.value || undefined }))}
        >
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g}>{g}</option>
          ))}
        </select>
        <input
          className="input w-44"
          placeholder="Search title…"
          defaultValue={filters.search ?? ''}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setFilters((f) => ({ ...f, search: (e.target as HTMLInputElement).value || undefined }));
          }}
        />
        <input
          className="input w-28"
          type="number"
          min={0}
          max={100}
          placeholder="min B"
          onKeyDown={(e) => {
            if (e.key === 'Enter')
              setFilters((f) => ({ ...f, minScoreB: Number((e.target as HTMLInputElement).value) || undefined }));
          }}
        />
        <input
          className="input w-32"
          type="number"
          step="0.05"
          min={0}
          max={1}
          placeholder="min conf"
          onKeyDown={(e) => {
            if (e.key === 'Enter')
              setFilters((f) => ({ ...f, minConfidence: Number((e.target as HTMLInputElement).value) || undefined }));
          }}
        />
        <span className="tabular text-2xs text-ink-500">
          {rows.length} of {total}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {selectedRows.length > 0 && (
            <>
              <span className="tabular text-2xs text-signal">{selectedRows.length} selected</span>
              <button className="btn" onClick={() => act(selectedRows, 'watched')}>
                Watched
              </button>
              <button className="btn" onClick={() => act(selectedRows, 'not_interested')}>
                Not interested
              </button>
            </>
          )}
          <a className="btn" href={`/api/export?${toQueryString(filters)}`}>
            Export CSV
          </a>
        </div>
      </div>

      <p className="mb-2 font-mono text-2xs text-ink-600">{SHORTCUTS}</p>

      {error && <div className="panel mb-2 border-bad/40 p-2 text-xs text-bad">{error}</div>}

      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[1200px] border-collapse text-xs">
          <thead className="sticky top-0 bg-ink-850">
            <tr className="border-b border-ink-700 text-left">
              <th className="w-8 px-2 py-1.5" />
              {COLUMNS.map((c) => (
                <th
                  key={c.key}
                  title={c.title}
                  className={`px-2 py-1.5 font-medium text-ink-400 ${c.align ?? ''} ${
                    c.sortable ? 'cursor-pointer select-none hover:text-ink-100' : ''
                  }`}
                  onClick={() => c.sortable && sortBy(c.key)}
                >
                  {c.key === 'public_rating' ? publicLabel : c.label}
                  {filters.sort === c.key && (
                    <span className="text-signal">{filters.dir === 'asc' ? ' ↑' : ' ↓'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody ref={bodyRef}>
            {rows.map((r, i) => {
              const k = keyOf(r);
              const isCursor = i === cursor;
              return (
                <Fragment key={k}>
                  <tr
                    onClick={() => setCursor(i)}
                    className={`border-b border-ink-850 transition-colors ${
                      isCursor ? 'bg-ink-800' : 'hover:bg-ink-900'
                    } ${selected.has(k) ? 'ring-1 ring-inset ring-signal-dim' : ''}`}
                  >
                    <td className="px-2 py-1">
                      <input
                        type="checkbox"
                        checked={selected.has(k)}
                        onChange={() =>
                          setSelected((s) => {
                            const next = new Set(s);
                            next.has(k) ? next.delete(k) : next.add(k);
                            return next;
                          })
                        }
                        className="accent-[#4fd1c5]"
                      />
                    </td>
                    <td className="max-w-[22rem] truncate px-2 py-1">
                      <Link href={`/title/${r.media_type}/${r.tmdb_id}`} className="hover:text-signal">
                        {r.title}
                      </Link>
                    </td>
                    <td className="px-2 py-1">
                      <TypeBadge type={r.media_type} />
                    </td>
                    <td className="tabular px-2 py-1 text-right text-ink-300">{r.release_year ?? '—'}</td>
                    <td className="tabular px-2 py-1 text-right text-ink-300">{r.runtime ?? '—'}</td>
                    <td className="tabular px-2 py-1 text-right font-mono font-semibold text-signal">
                      {r.score_b.toFixed(0)}
                      <span className="text-2xs text-ink-500">
                        {' '}
                        {r.score_b_lo.toFixed(0)}–{r.score_b_hi.toFixed(0)}
                      </span>
                    </td>
                    <td className="tabular px-2 py-1 text-right font-mono text-ink-200">
                      {r.score_a.toFixed(0)}
                      <span className="text-2xs text-ink-500"> ±{r.score_a_sigma.toFixed(0)}</span>
                    </td>
                    <td className="tabular px-2 py-1 text-right font-mono text-ink-300">
                      {r.public_rating === null ? '—' : (r.public_rating * 10).toFixed(0)}
                    </td>
                    <td className="px-2 py-1 text-right">
                      <DeltaBadge value={r.delta} />
                    </td>
                    <td className="px-2 py-1 text-right">
                      <span className="inline-flex items-center gap-1">
                        <ConfidenceDot value={r.confidence} />
                        <span className="tabular text-2xs text-ink-400">
                          {(r.confidence * 100).toFixed(0)}
                        </span>
                      </span>
                    </td>
                    <td className="tabular px-2 py-1 text-right text-ink-400">
                      {(r.vote_count ?? 0).toLocaleString()}
                    </td>
                    <td className="max-w-[12rem] truncate px-2 py-1 text-ink-300">
                      {(r.director_names ?? []).join(', ') || '—'}
                    </td>
                    <td className="max-w-[10rem] truncate px-2 py-1 text-ink-400">
                      {r.collection_name ?? '—'}
                    </td>
                    <td className="max-w-[16rem] truncate px-2 py-1">
                      <span className="flex gap-1 overflow-hidden">
                        {(r.keywords ?? []).slice(0, 4).map((kw) => (
                          <span key={kw.id} className="chip whitespace-nowrap">
                            {kw.name}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="tabular px-2 py-1 text-right text-2xs text-ink-500">
                      {r.scored_at?.slice(0, 10)}
                    </td>
                  </tr>
                  {rating === k && (
                    <tr key={`${k}-rate`} className="border-b border-ink-850 bg-ink-900">
                      <td colSpan={COLUMNS.length + 1} className="px-2 py-2">
                        <RatingStrip
                          onRate={(v) => {
                            setRating(null);
                            void act([r], 'rated', v);
                          }}
                          onCancel={() => setRating(null)}
                        />
                      </td>
                    </tr>
                  )}
                  {expanded === k && (
                    <tr key={`${k}-why`} className="border-b border-ink-850 bg-ink-900">
                      <td colSpan={COLUMNS.length + 1} className="px-4 py-3">
                        <div className="grid gap-4 md:grid-cols-2">
                          <WhyPanel terms={r.contributions?.b ?? []} title="Why score B" unit="rewatch points" />
                          <WhyPanel terms={r.contributions?.a ?? []} title="Why score A" unit="admiration points" />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {loading && <p className="py-3 text-center text-2xs text-ink-500">Loading…</p>}
      {status && (
        <div className="fixed bottom-4 right-4 z-50 rounded border border-ink-600 bg-ink-800 px-3 py-2 text-xs">
          {status}
        </div>
      )}
    </div>
  );
}
