import type { WhyRow } from '@/lib/titles/query';

export function ConfidenceDot({ value, showLabel = false }: { value: number; showLabel?: boolean }) {
  const tone = value >= 0.66 ? 'bg-good' : value >= 0.4 ? 'bg-warn' : 'bg-bad';
  return (
    <span className="inline-flex items-center gap-1" title={`Confidence ${(value * 100).toFixed(0)}%`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone}`} />
      {showLabel && <span className="tabular text-2xs text-ink-400">{(value * 100).toFixed(0)}%</span>}
    </span>
  );
}

/**
 * The primary number, always with its band. A score without a stated accuracy
 * is worse than no score, so the interval is not optional and not a tooltip.
 */
export function ScoreB({
  value,
  lo,
  hi,
  size = 'lg',
}: {
  value: number;
  lo: number;
  hi: number;
  size?: 'lg' | 'sm';
}) {
  return (
    <div className="flex flex-col items-end">
      <div
        className={`tabular font-mono font-semibold leading-none text-signal ${
          size === 'lg' ? 'text-4xl' : 'text-xl'
        }`}
      >
        {value.toFixed(0)}
      </div>
      <div className="tabular mt-1 text-2xs text-ink-400">
        {lo.toFixed(0)}–{hi.toFixed(0)}
      </div>
    </div>
  );
}

export function ScoreA({ value, sigma }: { value: number; sigma: number }) {
  return (
    <span className="tabular font-mono text-ink-200">
      {value.toFixed(0)}
      <span className="text-ink-500"> ±{sigma.toFixed(0)}</span>
    </span>
  );
}

export function DeltaBadge({ value }: { value: number | null }) {
  if (value === null) return <span className="text-ink-500">—</span>;
  const tone = value > 8 ? 'text-good' : value < -8 ? 'text-bad' : 'text-ink-300';
  return (
    <span className={`tabular font-mono ${tone}`} title="Score A minus the public rating × 10">
      {value > 0 ? '+' : ''}
      {value.toFixed(0)}
    </span>
  );
}

export function TypeBadge({ type }: { type: 'movie' | 'tv' }) {
  return (
    <span
      className={`chip ${type === 'tv' ? 'border-warn/40 text-warn' : ''}`}
      title={type === 'tv' ? 'TV — lower confidence: the Letterboxd export covers TV patchily' : 'Film'}
    >
      {type === 'tv' ? 'TV' : 'FILM'}
    </span>
  );
}

/**
 * The mandatory "why" panel. If a score cannot be audited it will not be
 * trusted, so every term carries its number and its sample size.
 */
export function WhyPanel({
  terms,
  unit,
  title,
  empty = 'No contributing terms — this title has nothing in common with your history.',
}: {
  terms: WhyRow[];
  unit: string;
  title: string;
  empty?: string;
}) {
  if (!terms?.length) return <p className="text-2xs text-ink-500">{empty}</p>;
  const max = Math.max(...terms.map((t) => Math.abs(t.effect)), 0.01);
  return (
    <div>
      <div className="label mb-1.5">{title}</div>
      <ul className="space-y-1">
        {terms.map((t, i) => (
          <li key={`${t.label}-${i}`} className="flex items-baseline gap-2 text-2xs">
            <span className="tabular w-12 shrink-0 text-right font-mono">
              <span className={t.effect >= 0 ? 'text-good' : 'text-bad'}>
                {t.effect > 0 ? '+' : ''}
                {t.effect.toFixed(1)}
              </span>
            </span>
            <span className="relative h-3 w-10 shrink-0 overflow-hidden rounded-sm bg-ink-800">
              <span
                className={`absolute inset-y-0 ${t.effect >= 0 ? 'left-1/2 bg-good/60' : 'right-1/2 bg-bad/60'}`}
                style={{ width: `${(Math.abs(t.effect) / max) * 50}%` }}
              />
              <span className="absolute inset-y-0 left-1/2 w-px bg-ink-600" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-ink-200">{t.label}</span>
              <span className="text-ink-500"> — {t.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1.5 text-2xs text-ink-600">
        Effect = {unit} the score moves if that term is removed.
      </p>
    </div>
  );
}

export function Poster({ path, alt, size = 'sm' }: { path: string | null; alt: string; size?: 'sm' | 'md' }) {
  const w = size === 'sm' ? 'w-10' : 'w-20';
  if (!path) {
    return (
      <div className={`${w} aspect-[2/3] shrink-0 rounded border border-ink-700 bg-ink-850`} />
    );
  }
  return (
    /* Posters are secondary here; plain <img> keeps them out of the layout path. */
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://image.tmdb.org/t/p/w154${path}`}
      alt={alt}
      loading="lazy"
      className={`${w} aspect-[2/3] shrink-0 rounded border border-ink-700 object-cover`}
    />
  );
}
