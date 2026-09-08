import { NextResponse } from 'next/server';
import { runIngest } from '@/lib/ingest/run';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/** The manual refresh button. There is no polling anywhere in this app. */
export async function POST() {
  try {
    return NextResponse.json(await runIngest({ kind: 'manual' }));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
