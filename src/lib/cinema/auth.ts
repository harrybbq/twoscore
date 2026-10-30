import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

/**
 * Gate for the /api/cinema routes, which hand scores and the viewing history to
 * CaptureDeck's Cinema tab.  Unlike the cron route, an unset token does not mean
 * "open": the routes refuse everything until CINEMA_TOKEN is set, because they
 * return personal data.
 *
 * Returns a response to send back when the request is refused, or null to go on.
 */
export function cinemaAuth(req: Request): NextResponse | null {
  const token = env.cinemaToken;
  if (!token) {
    return NextResponse.json(
      { error: 'CINEMA_TOKEN is not set on the twoscore server, so the cinema API is off.' },
      { status: 503 },
    );
  }
  const got = Buffer.from(req.headers.get('authorization') ?? '');
  const want = Buffer.from(`Bearer ${token}`);
  if (got.length !== want.length || !timingSafeEqual(got, want)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
