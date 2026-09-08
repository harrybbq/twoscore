import { NextResponse } from 'next/server';
import { env } from '@/lib/env';
import { runIngest } from '@/lib/ingest/run';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** Vercel Cron hits this nightly. Nothing else may. */
export async function GET(req: Request) {
  const secret = env.cronSecret;
  if (secret) {
    const auth = req.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }
  try {
    const result = await runIngest({ kind: 'cron' });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
