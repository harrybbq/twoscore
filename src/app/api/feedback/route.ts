import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const ACTIONS = new Set(['watched', 'rated', 'dismissed', 'not_interested', 'watchlist', 'undismiss']);

/**
 * Every decision is stored with the prediction that was on screen when it was
 * made, so /calibration measures the model that actually ran rather than
 * whatever is fitted today.
 */
export async function POST(req: Request) {
  const body = await req.json();
  const { tmdbId, mediaType, action, rating, note } = body ?? {};
  if (!tmdbId || !mediaType || !ACTIONS.has(action)) {
    return NextResponse.json({ error: 'tmdbId, mediaType and a valid action are required' }, { status: 400 });
  }

  const { data: title } = await db()
    .from('titles')
    .select('score_a, score_b, confidence, model_version')
    .eq('tmdb_id', tmdbId)
    .eq('media_type', mediaType)
    .maybeSingle();

  const { error } = await db().from('feedback').insert({
    tmdb_id: tmdbId,
    media_type: mediaType,
    action,
    rating: rating ?? null,
    predicted_a: title?.score_a ?? null,
    predicted_b: title?.score_b ?? null,
    confidence: title?.confidence ?? null,
    model_version: title?.model_version ?? null,
    note: note ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Watched / dismissed titles leave the feed; undismiss puts one back.
  if (action === 'undismiss') {
    await db().from('titles').update({ in_history: false }).eq('tmdb_id', tmdbId).eq('media_type', mediaType);
  } else if (action !== 'watchlist') {
    await db().from('titles').update({ in_history: true }).eq('tmdb_id', tmdbId).eq('media_type', mediaType);
  }
  return NextResponse.json({ ok: true });
}
