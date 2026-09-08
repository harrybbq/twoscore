'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import type { TitleRow } from '@/lib/titles/query';
import { ConfidenceDot, DeltaBadge, Poster, ScoreA, ScoreB, TypeBadge, WhyPanel } from './Score';
import { RatingStrip } from './RatingStrip';

export type FeedAction = 'watched' | 'rated' | 'dismissed' | 'not_interested' | 'watchlist';

const SWIPE_OPEN = 64;

export function FeedCard({
  row,
  publicLabel,
  onAction,
}: {
  row: TitleRow;
  publicLabel: string;
  onAction: (row: TitleRow, action: FeedAction, rating?: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rating, setRating] = useState(false);
  const [dx, setDx] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const locked = useRef<'x' | 'y' | null>(null);

  // Swipe right opens the rating strip, swipe left dismisses. Vertical
  // movement wins the gesture so the feed still scrolls normally.
  const onPointerDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
    locked.current = null;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!start.current) return;
    const ddx = e.clientX - start.current.x;
    const ddy = e.clientY - start.current.y;
    if (!locked.current) {
      if (Math.abs(ddx) < 8 && Math.abs(ddy) < 8) return;
      locked.current = Math.abs(ddx) > Math.abs(ddy) ? 'x' : 'y';
    }
    if (locked.current === 'x') setDx(Math.max(-120, Math.min(120, ddx)));
  };
  const onPointerUp = () => {
    if (locked.current === 'x') {
      if (dx > SWIPE_OPEN) setRating(true);
      else if (dx < -SWIPE_OPEN) act('not_interested');
    }
    setDx(0);
    start.current = null;
    locked.current = null;
  };

  const act = (action: FeedAction, value?: number) => {
    setBusy(true);
    onAction(row, action, value);
  };

  const runtime = row.runtime ? `${row.runtime} min` : '—';

  return (
    <article className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-4 text-2xs">
        <span className={dx > 20 ? 'text-signal' : 'text-ink-700'}>rate →</span>
        <span className={dx < -20 ? 'text-bad' : 'text-ink-700'}>← not interested</span>
      </div>
      <div
        className="panel relative touch-pan-y p-3 transition-transform"
        style={{ transform: `translateX(${dx}px)` }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <div className="flex gap-3">
          <Poster path={row.poster_path} alt={row.title} />

          <div className="min-w-0 flex-1">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="block w-full text-left"
              aria-expanded={expanded}
            >
              <div className="flex items-start gap-2">
                <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-100">
                  {row.title}
                </h2>
                <ScoreB value={row.score_b} lo={row.score_b_lo} hi={row.score_b_hi} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-400">
                <TypeBadge type={row.media_type} />
                <span className="tabular">{row.release_year ?? '—'}</span>
                <span className="tabular">{runtime}</span>
                <ConfidenceDot value={row.confidence} showLabel />
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-2xs text-ink-400">
                <span>
                  A <ScoreA value={row.score_a} sigma={row.score_a_sigma} />
                </span>
                <span>
                  {publicLabel}{' '}
                  <span className="tabular font-mono text-ink-200">
                    {row.public_rating === null ? '—' : (row.public_rating * 10).toFixed(0)}
                  </span>
                </span>
                <span>
                  Δ <DeltaBadge value={row.delta} />
                </span>
              </div>
            </button>
          </div>
        </div>

        {rating && (
          <div className="mt-3">
            <RatingStrip busy={busy} onRate={(r) => act('rated', r)} onCancel={() => setRating(false)} />
          </div>
        )}

        {expanded && (
          <div className="mt-3 space-y-3 border-t border-ink-800 pt-3">
            {row.director_names?.length > 0 && (
              <p className="text-2xs text-ink-400">
                <span className="text-ink-500">Directed by </span>
                {row.director_names.join(', ')}
                {row.collection_name && (
                  <span className="text-ink-500"> · {row.collection_name}</span>
                )}
              </p>
            )}
            <div className="flex flex-wrap gap-1">
              {(row.genres ?? []).map((g) => (
                <span key={g.id} className="chip">
                  {g.name}
                </span>
              ))}
            </div>
            <WhyPanel
              terms={row.contributions?.b ?? []}
              title="Why score B"
              unit="rewatch points"
            />
            <WhyPanel terms={row.contributions?.a ?? []} title="Why score A" unit="admiration points" />
            <div className="flex flex-wrap gap-1.5">
              <button className="btn" disabled={busy} onClick={() => setRating(true)}>
                Rate
              </button>
              <button className="btn" disabled={busy} onClick={() => act('watched')}>
                Watched
              </button>
              <button className="btn" disabled={busy} onClick={() => act('watchlist')}>
                Watchlist
              </button>
              <button className="btn" disabled={busy} onClick={() => act('not_interested')}>
                Not interested
              </button>
              <Link className="btn" href={`/title/${row.media_type}/${row.tmdb_id}`}>
                Detail
              </Link>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
