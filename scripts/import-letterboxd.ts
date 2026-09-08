/**
 * Local import path.  `npm run import [pathToZipOrDir]`
 * Defaults to data/letterboxd/ (a folder of CSVs) or the first ZIP in data/.
 */
import { loadEnv } from './lib/loadEnv';
loadEnv();

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { importExport, unzipExport } from '../src/lib/letterboxd/ingest';
import { isIgnored } from '../src/lib/letterboxd/parse';

function readDir(dir: string, base = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const rel = base ? `${base}/${name}` : name;
    if (statSync(full).isDirectory()) Object.assign(out, readDir(full, rel));
    else if (/\.csv$/i.test(name) && !isIgnored(rel)) out[rel] = readFileSync(full, 'utf8');
  }
  return out;
}

function locate(arg?: string): string {
  if (arg) return arg;
  if (existsSync('data/letterboxd')) return 'data/letterboxd';
  if (existsSync('data')) {
    const zip = readdirSync('data').find((f) => f.endsWith('.zip'));
    if (zip) return path.join('data', zip);
  }
  throw new Error(
    'No export found. Put the Letterboxd ZIP in data/, unzip it to data/letterboxd/, or pass a path.',
  );
}

async function main() {
  const target = locate(process.argv[2]);
  const files = statSync(target).isDirectory()
    ? readDir(target)
    : await unzipExport(readFileSync(target));

  console.log(`Reading ${target} — ${Object.keys(files).length} CSV files`);
  const result = await importExport(files);

  const r = result.report;
  console.log('\nFiles parsed:');
  for (const [f, n] of Object.entries(r.files)) console.log(`  ${f.padEnd(24)} ${n} rows`);
  if (r.ignored.length) console.log(`  ignored: ${r.ignored.join(', ')}`);
  console.log(`\nTitles:        ${r.entries}`);
  console.log(`  rated:       ${r.rated}`);
  console.log(`  in diary:    ${r.withDiary}`);
  console.log(`  rewatched:   ${r.withRewatch}  (${((r.withRewatch / Math.max(1, r.rated)) * 100).toFixed(1)}% of rated)`);
  console.log(`  watchlist:   ${r.watchlist}`);
  console.log(`\nDatabase:      +${result.inserted} new, ${result.updated} updated, ${result.unchanged} unchanged`);
  for (const w of r.warnings) console.log(`  ! ${w}`);
  for (const e of result.errors) console.error(`  ERROR ${e}`);
  console.log('\nNext: npm run backfill');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
