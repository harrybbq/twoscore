import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';
import { getTitle } from '@/lib/tmdb/client';
import type { MediaType } from '@/lib/tmdb/types';

export const dynamic = 'force-dynamic';

/** Attach a hand-picked TMDB id to a history row. No CSV editing anywhere. */
export async function POST(req: Request) {
  const body = await req.json();
  const { id, tmdbId, mediaType } = body as { id: number; tmdbId: number; mediaType: MediaType };
  if (!id || !tmdbId) return NextResponse.json({ error: 'id and tmdbId required' }, { status: 400 });

  try {
    await getTitle(tmdbId, mediaType ?? 'movie');
  } catch (e) {
    return NextResponse.json({ error: `TMDB fetch failed: ${(e as Error).message}` }, { status: 502 });
  }

  const { error } = await db()
    .from('history_entries')
    .update({
      tmdb_id: tmdbId,
      media_type: mediaType ?? 'movie',
      match_method: 'manual',
      match_score: 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
