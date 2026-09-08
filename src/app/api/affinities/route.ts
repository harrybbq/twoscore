import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { GLOBALS_KIND } from '@/lib/affinity/store';

export const dynamic = 'force-dynamic';

const SORTS = new Set(['affinity', 'rewatch_affinity', 'n', 'mean_rating', 'rewatch_rate', 'entity_name']);

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get('kind') ?? 'director';
  const minN = Number(sp.get('minN') ?? 1);
  const sort = SORTS.has(sp.get('sort') ?? '') ? sp.get('sort')! : 'affinity';
  const dir = sp.get('dir') === 'asc';
  const q = sp.get('q');
  const limit = Math.min(Number(sp.get('limit') ?? 200), 1000);

  let query = db()
    .from('affinities')
    .select('*', { count: 'exact' })
    .eq('kind', kind)
    .neq('kind', GLOBALS_KIND)
    .gte('n', Number.isFinite(minN) ? minN : 1);
  if (q) query = query.ilike('entity_name', `%${q}%`);

  const { data, error, count } = await query.order(sort, { ascending: dir }).limit(limit);
  if (error) return NextResponse.json({ error: error.message, rows: [] }, { status: 500 });

  const { data: globals } = await db()
    .from('affinities')
    .select('entity_name')
    .eq('kind', GLOBALS_KIND)
    .maybeSingle();

  return NextResponse.json({
    rows: data ?? [],
    total: count ?? 0,
    globals: globals ? JSON.parse(globals.entity_name) : null,
  });
}
