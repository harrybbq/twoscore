import { ImportPanel } from '@/components/ImportPanel';
import { Setup } from '@/components/Setup';
import { db, dbConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  if (!dbConfigured()) return <Setup missing="db" />;

  const [{ count: total }, { count: resolved }, { count: unresolved }, { count: excluded }] =
    await Promise.all([
      db().from('history_entries').select('*', { count: 'exact', head: true }),
      db().from('history_entries').select('*', { count: 'exact', head: true }).not('tmdb_id', 'is', null),
      db().from('history_entries').select('*', { count: 'exact', head: true }).is('tmdb_id', null),
      db().from('history_entries').select('*', { count: 'exact', head: true }).eq('excluded', true),
    ]);

  const rate = total ? ((resolved ?? 0) / total) * 100 : 0;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-sm font-semibold text-ink-100">Import your Letterboxd export</h1>
      <p className="mt-1 text-xs leading-relaxed text-ink-400">
        Upload the ZIP straight from your phone, or drop it in <code className="text-signal">data/</code>{' '}
        and run <code className="text-signal">npm run import</code>. Re-importing is additive: it
        refreshes ratings and diary counts and leaves your TMDB matches and exclusions alone.
      </p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Metric label="Titles" value={String(total ?? 0)} />
        <Metric label="Resolved" value={String(resolved ?? 0)} />
        <Metric
          label="Match rate"
          value={`${rate.toFixed(1)}%`}
          warn={total ? rate < 95 : false}
        />
        <Metric label="Excluded" value={String(excluded ?? 0)} />
      </div>

      {total !== null && total > 0 && rate < 95 && (
        <p className="mt-2 text-2xs text-warn">
          Below the 95% you should expect. {unresolved} row{unresolved === 1 ? '' : 's'} need a hand —
          work the queue at <a className="underline" href="/unresolved">/unresolved</a>.
        </p>
      )}

      <ImportPanel />

      <div className="panel mt-4 p-3 text-2xs leading-relaxed text-ink-400">
        <div className="label mb-1.5">What is read, and what is not</div>
        <p>
          <code>ratings.csv</code>, <code>diary.csv</code>, <code>watched.csv</code>,{' '}
          <code>watchlist.csv</code>, <code>likes/films.csv</code> and <code>reviews.csv</code> are
          read. <code>lists/gammon.csv</code> is ignored entirely.
        </p>
        <p className="mt-2">
          Your diary begins mid-2020, so a title with no logged rewatch may well have been rewatched
          before then — the label is a floor, not a measurement, and Model B is fitted knowing that.
          A rating that was a joke has to be excluded by hand; nothing here tries to detect one.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="panel p-2.5">
      <div className="label">{label}</div>
      <div className={`tabular mt-0.5 font-mono text-lg ${warn ? 'text-warn' : 'text-ink-100'}`}>
        {value}
      </div>
    </div>
  );
}
