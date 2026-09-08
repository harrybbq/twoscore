'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { RatingStrip } from './RatingStrip';

/** Mark watched, rate, or dismiss — the same three from the detail view. */
export function FeedbackControls({
  tmdbId,
  mediaType,
  title,
}: {
  tmdbId: number;
  mediaType: string;
  title: string;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const send = async (action: string, value?: number) => {
    setBusy(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tmdbId, mediaType, action, rating: value ?? null }),
      });
      const json = await res.json();
      setDone(json.error ? json.error : `${title}: ${action.replace('_', ' ')}${value ? ` (${value}★)` : ''}`);
      router.refresh();
    } finally {
      setBusy(false);
      setRating(false);
    }
  };

  return (
    <section className="panel sticky bottom-3 mt-4 p-3">
      {rating ? (
        <RatingStrip busy={busy} onRate={(v) => send('rated', v)} onCancel={() => setRating(false)} />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          <button className="btn btn-primary" disabled={busy} onClick={() => setRating(true)}>
            Rate
          </button>
          <button className="btn" disabled={busy} onClick={() => send('watched')}>
            Mark watched
          </button>
          <button className="btn" disabled={busy} onClick={() => send('watchlist')}>
            Watchlist
          </button>
          <button className="btn" disabled={busy} onClick={() => send('not_interested')}>
            Not interested
          </button>
        </div>
      )}
      {done && <p className="mt-2 text-2xs text-ink-400">{done}</p>}
    </section>
  );
}
