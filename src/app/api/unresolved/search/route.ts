import { NextResponse } from 'next/server';
import { search } from '@/lib/tmdb/client';
import type { MediaType } from '@/lib/tmdb/types';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q');
  const type = (url.searchParams.get('type') ?? 'movie') as MediaType;
  const year = Number(url.searchParams.get('year')) || null;
  if (!q) return NextResponse.json({ results: [] });
  try {
    const results = await search(q, type, year);
    return NextResponse.json({ results: results.slice(0, 12) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, results: [] }, { status: 502 });
  }
}
