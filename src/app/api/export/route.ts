import { parseFilters, queryTitles } from '@/lib/titles/query';

export const dynamic = 'force-dynamic';

const COLUMNS = [
  'title', 'media_type', 'release_year', 'runtime', 'score_b', 'score_b_lo', 'score_b_hi',
  'score_a', 'score_a_sigma', 'public_rating', 'public_source', 'delta', 'confidence',
  'vote_count', 'directors', 'collection', 'genres', 'scored_at',
];

function esc(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Desktop CSV export. Honours whatever filters the table is showing. */
export async function GET(req: Request) {
  const f = parseFilters(new URL(req.url).searchParams);
  const { rows } = await queryTitles({ ...f, limit: 5000, offset: 0 });

  const lines = [COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      [
        r.title, r.media_type, r.release_year, r.runtime, r.score_b, r.score_b_lo, r.score_b_hi,
        r.score_a, r.score_a_sigma, r.public_rating, r.public_source, r.delta, r.confidence,
        r.vote_count, (r.director_names ?? []).join('; '), r.collection_name,
        (r.genres ?? []).map((g) => g.name).join('; '), r.scored_at,
      ].map(esc).join(','),
    );
  }

  return new Response(lines.join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="twoscore-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
