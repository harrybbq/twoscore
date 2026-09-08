import Link from 'next/link';
import { notFound } from 'next/navigation';
import { FeedbackControls } from '@/components/FeedbackControls';
import { ConfidenceDot, DeltaBadge, Poster, TypeBadge, WhyPanel } from '@/components/Score';
import { Setup } from '@/components/Setup';
import { loadAffinities } from '@/lib/affinity/store';
import { PUBLIC_RATING_SOURCE_LABEL } from '@/lib/env';
import { db, dbConfigured } from '@/lib/supabase/server';
import { rowToMeta } from '@/lib/tmdb/client';
import { directorsOf, writersOf } from '@/lib/tmdb/normalise';
import type { TitleRow } from '@/lib/titles/query';

export const dynamic = 'force-dynamic';

interface Person {
  id: number;
  name: string;
  role: string;
  affinity: number | null;
  rewatchRate: number | null;
  n: number;
}

export default async function TitleDetail({
  params,
}: {
  params: { type: string; id: string };
}) {
  if (!dbConfigured()) return <Setup missing="db" />;
  const mediaType = params.type === 'tv' ? 'tv' : 'movie';
  const tmdbId = Number(params.id);
  if (!Number.isFinite(tmdbId)) notFound();

  const [{ data: title }, { data: metaRow }, tables] = await Promise.all([
    db().from('titles').select('*').eq('tmdb_id', tmdbId).eq('media_type', mediaType).maybeSingle(),
    db().from('tmdb_titles').select('*').eq('tmdb_id', tmdbId).eq('media_type', mediaType).maybeSingle(),
    loadAffinities(),
  ]);
  if (!title) notFound();
  const row = title as TitleRow;
  const meta = metaRow ? rowToMeta(metaRow) : null;

  const people: Person[] = [];
  if (meta && tables) {
    const add = (id: number, name: string, role: string, kind: 'director' | 'writer' | 'actor') => {
      const v = tables.lookup(kind, `p${id}`);
      people.push({
        id,
        name,
        role,
        affinity: v.n ? v.affinity : null,
        rewatchRate: v.n ? v.rewatchRate : null,
        n: v.n,
      });
    };
    for (const d of directorsOf(meta)) add(d.id, d.name, 'Director', 'director');
    for (const w of writersOf(meta)) add(w.id, w.name, 'Writer', 'writer');
    for (const c of meta.cast.slice(0, 8)) add(c.id, c.name, `Cast ${c.order + 1}`, 'actor');
  }

  const publicLabel = PUBLIC_RATING_SOURCE_LABEL();

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/" className="text-2xs text-ink-500 hover:text-ink-200">
        ← back to the feed
      </Link>

      <header className="mt-2 flex gap-4">
        <Poster path={row.poster_path} alt={row.title} size="md" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold leading-tight text-ink-100">{row.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-2xs text-ink-400">
            <TypeBadge type={row.media_type} />
            <span className="tabular">{row.release_year ?? '—'}</span>
            <span className="tabular">{row.runtime ? `${row.runtime} min` : 'runtime unknown'}</span>
            {row.collection_name && <span className="chip">{row.collection_name}</span>}
            <ConfidenceDot value={row.confidence} showLabel />
          </div>
          {meta?.overview && (
            <p className="mt-2 max-w-2xl text-xs leading-relaxed text-ink-400">{meta.overview}</p>
          )}
        </div>
      </header>

      <section className="mt-4 grid gap-2 sm:grid-cols-4">
        <Stat
          label="Score B · rewatch"
          value={row.score_b.toFixed(0)}
          sub={`${row.score_b_lo.toFixed(0)}–${row.score_b_hi.toFixed(0)} interval`}
          strong
        />
        <Stat
          label="Score A · admiration"
          value={row.score_a.toFixed(0)}
          sub={`±${row.score_a_sigma.toFixed(0)} · ${row.score_a_stars.toFixed(1)}★ predicted`}
        />
        <Stat
          label={`${publicLabel} rating`}
          value={row.public_rating === null ? '—' : (row.public_rating * 10).toFixed(0)}
          sub={`${(row.vote_count ?? 0).toLocaleString()} votes`}
        />
        <Stat
          label="Δ vs crowd"
          value={row.delta === null ? '—' : `${row.delta > 0 ? '+' : ''}${row.delta.toFixed(0)}`}
          sub={row.delta === null ? 'no public rating' : row.delta > 0 ? 'model likes it more' : 'crowd likes it more'}
        />
      </section>

      <section className="panel mt-4 grid gap-5 p-4 md:grid-cols-2">
        <WhyPanel terms={row.contributions?.b ?? []} title="Why score B" unit="rewatch points" />
        <WhyPanel terms={row.contributions?.a ?? []} title="Why score A" unit="admiration points" />
      </section>

      <section className="panel mt-3 p-4">
        <div className="label mb-2">Confidence breakdown</div>
        <div className="grid gap-x-6 gap-y-1 text-2xs sm:grid-cols-2 md:grid-cols-3">
          {Object.entries(row.confidence_parts ?? {}).map(([k, v]) => (
            <div key={k} className="flex items-center gap-2">
              <span className="w-20 text-ink-400">{k}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded bg-ink-800">
                <span
                  className="block h-full bg-signal-dim"
                  style={{ width: `${Math.min(100, Number(v) * 100)}%` }}
                />
              </span>
              <span className="tabular w-8 text-right text-ink-300">{(Number(v) * 100).toFixed(0)}</span>
            </div>
          ))}
        </div>
      </section>

      {people.length > 0 && (
        <section className="panel mt-3 overflow-x-auto p-0">
          <table className="w-full min-w-[520px] text-xs">
            <thead>
              <tr className="border-b border-ink-800 text-left text-ink-400">
                <th className="px-3 py-2 font-medium">Person</th>
                <th className="px-3 py-2 font-medium">Role</th>
                <th className="px-3 py-2 text-right font-medium">Affinity</th>
                <th className="px-3 py-2 text-right font-medium">Rewatched</th>
                <th className="px-3 py-2 text-right font-medium">n</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p, i) => (
                <tr key={`${p.id}-${i}`} className="border-b border-ink-850">
                  <td className="px-3 py-1.5 text-ink-200">{p.name}</td>
                  <td className="px-3 py-1.5 text-ink-500">{p.role}</td>
                  <td className="tabular px-3 py-1.5 text-right font-mono">
                    {p.affinity === null ? (
                      <span className="text-ink-600">not in your history</span>
                    ) : (
                      p.affinity.toFixed(2)
                    )}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right font-mono text-ink-300">
                    {p.rewatchRate === null ? '—' : `${(p.rewatchRate * 100).toFixed(0)}%`}
                  </td>
                  <td className="tabular px-3 py-1.5 text-right text-ink-400">{p.n || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {(row.keywords ?? []).length > 0 && (
        <section className="mt-3 flex flex-wrap gap-1">
          {row.keywords.map((k) => (
            <span key={k.id} className="chip">
              {k.name}
            </span>
          ))}
        </section>
      )}

      <FeedbackControls tmdbId={row.tmdb_id} mediaType={row.media_type} title={row.title} />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  strong,
}: {
  label: string;
  value: string;
  sub: string;
  strong?: boolean;
}) {
  return (
    <div className="panel p-3">
      <div className="label">{label}</div>
      <div
        className={`tabular mt-1 font-mono font-semibold leading-none ${
          strong ? 'text-3xl text-signal' : 'text-2xl text-ink-100'
        }`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-2xs text-ink-500">{sub}</div>
    </div>
  );
}
