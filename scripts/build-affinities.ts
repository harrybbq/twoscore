/** `npm run affinities` — recompute every affinity table from the history. */
import { loadEnv } from './lib/loadEnv';
loadEnv();

import { AffinityTables } from '../src/lib/affinity/compute';
import { loadTrainingTitles } from '../src/lib/affinity/loadTraining';
import { affinityToRow, globalsToRow } from '../src/lib/affinity/store';
import { ALL_KINDS } from '../src/lib/affinity/compute';
import { db } from '../src/lib/supabase/server';

async function main() {
  const titles = await loadTrainingTitles();
  if (!titles.length) throw new Error('No resolved, rated titles. Run import + backfill first.');

  const tables = new AffinityTables(titles);
  const g = tables.globals;
  console.log(`${titles.length} rated titles`);
  console.log(`global mean rating   ${g.globalMean.toFixed(3)}`);
  console.log(`global rewatch rate  ${(g.globalRewatchRate * 100).toFixed(1)}%`);
  console.log(`shrinkage m          ${g.m}\n`);

  const rows = [...tables.rows.values()].map(affinityToRow);
  rows.push(globalsToRow(g) as any);

  const { error: delErr } = await db().from('affinities').delete().neq('entity_id', '');
  if (delErr) throw new Error(delErr.message);
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db().from('affinities').upsert(rows.slice(i, i + 500), { onConflict: 'kind,entity_id' });
    if (error) throw new Error(error.message);
  }

  for (const kind of ALL_KINDS) {
    const list = tables.byKind(kind);
    const top = list
      .filter((r) => r.n >= 3)
      .sort((a, b) => b.affinity - a.affinity)
      .slice(0, 5);
    console.log(`${kind.padEnd(11)} ${String(list.length).padStart(5)} entities`);
    for (const t of top) {
      console.log(
        `             ${t.entityName.slice(0, 34).padEnd(34)} aff ${t.affinity.toFixed(2)}  n=${String(t.n).padStart(3)}  rw ${(t.rewatchRate * 100).toFixed(0)}%`,
      );
    }
  }
  console.log(`\nWrote ${rows.length} rows. Next: npm run frame && npm run fit`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
