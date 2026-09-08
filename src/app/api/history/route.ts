import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Manual exclusion of an imported row — the "joke rating" flag.
 * Deliberately manual: a rating that is a joke is not detectable from the
 * number, and guessing would quietly delete real taste.
 */
export async function PATCH(req: Request) {
  const { id, excluded, reason } = await req.json();
  if (typeof id !== 'number' || typeof excluded !== 'boolean') {
    return NextResponse.json({ error: 'id and excluded are required' }, { status: 400 });
  }
  const { error } = await db()
    .from('history_entries')
    .update({
      excluded,
      exclude_reason: excluded ? (reason ?? 'joke rating') : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, note: 'Re-run affinities and refit for this to affect scores.' });
}
