import Link from 'next/link';

/** What is missing and the exact command that fixes it. */
export function Setup({ missing }: { missing: 'db' | 'models' | 'titles' }) {
  const steps: Record<string, { title: string; body: React.ReactNode }> = {
    db: {
      title: 'Supabase is not configured',
      body: (
        <>
          Set <code className="text-signal">NEXT_PUBLIC_SUPABASE_URL</code> and{' '}
          <code className="text-signal">SUPABASE_SERVICE_ROLE_KEY</code>, then run{' '}
          <code className="text-signal">supabase/schema.sql</code> in the SQL editor.
        </>
      ),
    },
    models: {
      title: 'The models are not fitted yet',
      body: (
        <>
          Import the export, resolve it against TMDB, then fit:
          <pre className="mt-2 overflow-x-auto rounded bg-ink-950 p-2 text-2xs text-ink-300">
{`npm run import      # or upload at /import
npm run backfill    # resolve to TMDB ids
npm run affinities  # build the affinity tables
npm run frame       # leave-one-out design matrix
.venv/bin/python py/fit.py`}
          </pre>
          <span className="mt-2 block">
            fit.py prints the held-out metrics. If Model B&apos;s AUC is not meaningfully above 0.5,
            stop there — the two-score premise needs rethinking before any of this is worth using.
          </span>
        </>
      ),
    },
    titles: {
      title: 'Nothing has been ingested yet',
      body: (
        <>
          The nightly cron has not run. Hit refresh in the feed, or call{' '}
          <code className="text-signal">POST /api/refresh</code>.
        </>
      ),
    },
  };
  const s = steps[missing];
  return (
    <div className="panel mx-auto mt-8 max-w-lg p-5">
      <h1 className="text-sm font-semibold text-ink-100">{s.title}</h1>
      <div className="mt-2 text-xs leading-relaxed text-ink-400">{s.body}</div>
      <div className="mt-4 flex gap-2">
        <Link href="/import" className="btn btn-primary">
          Import
        </Link>
        <Link href="/unresolved" className="btn">
          Unresolved queue
        </Link>
      </div>
    </div>
  );
}
