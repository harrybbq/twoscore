import { NextResponse } from 'next/server';
import { parseFilters, queryTitles } from '@/lib/titles/query';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const f = parseFilters(new URL(req.url).searchParams);
    return NextResponse.json(await queryTitles(f));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, rows: [], total: 0 }, { status: 500 });
  }
}
