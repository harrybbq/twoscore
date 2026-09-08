'use client';

import type { TitleFilters } from '@/lib/titles/query';

export function FilterBar({
  filters,
  genres,
  onChange,
  onRefresh,
  refreshing,
  count,
}: {
  filters: TitleFilters;
  genres: string[];
  onChange: (patch: Partial<TitleFilters>) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
  count: number;
}) {
  return (
    <div className="sticky top-[41px] z-30 -mx-3 border-b border-ink-800 bg-ink-950/95 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        <select
          className="input shrink-0"
          value={filters.type ?? 'all'}
          onChange={(e) => onChange({ type: e.target.value as TitleFilters['type'] })}
          aria-label="Type"
        >
          <option value="all">All types</option>
          <option value="movie">Film</option>
          <option value="tv">TV</option>
        </select>

        <select
          className="input shrink-0"
          value={String(filters.minConfidence ?? '')}
          onChange={(e) => onChange({ minConfidence: e.target.value ? Number(e.target.value) : undefined })}
          aria-label="Minimum confidence"
        >
          <option value="">Any confidence</option>
          <option value="0.4">Conf ≥ 40%</option>
          <option value="0.6">Conf ≥ 60%</option>
          <option value="0.8">Conf ≥ 80%</option>
        </select>

        <select
          className="input shrink-0"
          value={String(filters.minScoreB ?? '')}
          onChange={(e) => onChange({ minScoreB: e.target.value ? Number(e.target.value) : undefined })}
          aria-label="Minimum score B"
        >
          <option value="">Any score B</option>
          <option value="25">B ≥ 25</option>
          <option value="50">B ≥ 50</option>
          <option value="75">B ≥ 75</option>
        </select>

        <select
          className="input shrink-0"
          value={filters.genre ?? ''}
          onChange={(e) => onChange({ genre: e.target.value || undefined })}
          aria-label="Genre"
        >
          <option value="">All genres</option>
          {genres.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>

        <select
          className="input shrink-0"
          value={String(filters.maxRuntime ?? '')}
          onChange={(e) => onChange({ maxRuntime: e.target.value ? Number(e.target.value) : undefined })}
          aria-label="Runtime ceiling"
        >
          <option value="">Any runtime</option>
          <option value="100">≤ 100 min</option>
          <option value="120">≤ 120 min</option>
          <option value="140">≤ 140 min</option>
          <option value="180">≤ 180 min</option>
        </select>

        <select
          className="input shrink-0"
          value={filters.releasedAfter ?? ''}
          onChange={(e) => onChange({ releasedAfter: e.target.value || undefined })}
          aria-label="Release window"
        >
          <option value="">Any release</option>
          <option value={isoDaysAgo(30)}>Last 30 days</option>
          <option value={isoDaysAgo(90)}>Last 90 days</option>
          <option value={isoDaysAgo(365)}>Last year</option>
        </select>

        <select
          className="input shrink-0"
          value={`${filters.sort ?? 'score_b'}:${filters.dir ?? 'desc'}`}
          onChange={(e) => {
            const [sort, dir] = e.target.value.split(':');
            onChange({ sort, dir: dir as 'asc' | 'desc' });
          }}
          aria-label="Sort"
        >
          <option value="score_b:desc">Score B ↓</option>
          <option value="score_a:desc">Score A ↓</option>
          <option value="delta:desc">Δ ↓ (model likes it more)</option>
          <option value="delta:asc">Δ ↑ (crowd likes it more)</option>
          <option value="confidence:desc">Confidence ↓</option>
          <option value="scored_at:desc">Newest</option>
        </select>
      </div>

      <div className="flex items-center justify-between pt-0.5 text-2xs text-ink-500">
        <span className="tabular">{count} titles</span>
        {onRefresh && (
          <button className="btn px-2 py-1" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </div>
    </div>
  );
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
