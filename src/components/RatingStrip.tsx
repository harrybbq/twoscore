'use client';

const STARS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/** Ten big targets. One tap after the swipe — that is the whole interaction. */
export function RatingStrip({
  onRate,
  onCancel,
  busy,
}: {
  onRate: (rating: number) => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <div className="grid flex-1 grid-cols-10 gap-1">
        {STARS.map((s) => (
          <button
            key={s}
            disabled={busy}
            onClick={() => onRate(s)}
            className="tabular rounded border border-ink-600 bg-ink-800 py-2 font-mono text-2xs
                       text-ink-200 transition active:scale-95 disabled:opacity-40
                       hover:border-signal-dim hover:text-signal"
            aria-label={`Rate ${s} stars`}
          >
            {s}
          </button>
        ))}
      </div>
      {onCancel && (
        <button onClick={onCancel} className="btn px-2 py-2" aria-label="Cancel rating">
          ✕
        </button>
      )}
    </div>
  );
}
