import { NextResponse } from 'next/server';
import { cinemaAuth } from '@/lib/cinema/auth';
import { loadCinemaHistory } from '@/lib/cinema/history';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The resolved Letterboxd history, for the cinema's "put something on" rail:
 * seen titles are what twoscore's own feed drops, and exactly what a rewatch
 * shelf wants.  Rewatch counts are a floor (the diary starts June 2020).
 */
export async function GET(req: Request) {
  const refused = cinemaAuth(req);
  if (refused) return refused;
  try {
    const history = await loadCinemaHistory();
    return NextResponse.json({ titles: [...history.values()] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
