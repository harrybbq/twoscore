import { Setup } from '@/components/Setup';
import { UnresolvedQueue } from '@/components/UnresolvedQueue';
import { db, dbConfigured } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export default async function UnresolvedPage() {
  if (!dbConfigured()) return <Setup missing="db" />;

  const { data } = await db()
    .from('history_entries')
    .select('id, name, year, rating, has_logged_rewatch, match_method, excluded, exclude_reason')
    .is('tmdb_id', null)
    .order('rating', { ascending: false, nullsFirst: false })
    .limit(300);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-sm font-semibold text-ink-100">Unresolved</h1>
      <p className="mt-1 text-xs leading-relaxed text-ink-400">
        Titles the matcher would not guess at. A wrong match poisons the affinities of everyone
        credited on the wrong film, so anything below the threshold lands here instead. Search TMDB
        and pick — no CSV editing.
      </p>
      <UnresolvedQueue rows={(data ?? []) as any} />
    </div>
  );
}
