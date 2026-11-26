// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// CLEANROOM-1: run N ticks of a freshly booted seed against a SQLite file, the clock moving 10 minutes per tick.
// usage: node --no-warnings platform/selfhost/day.mjs <seed-root> <db> <config.json> [ticks=144]
// Prints one JSON line: {ticks, completed, errors:[{tick, error}], tick_runs}. Exit 1 when any tick reported an error.
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from '../adapters/sqlite/d1-sqlite.js';

const [seedRoot, dbPath, cfgPath, n = '144'] = process.argv.slice(2);
if (!seedRoot || !dbPath || !cfgPath) { console.error('usage: day.mjs <seed-root> <db> <config.json> [ticks]'); process.exit(2); }
// The tick comes from the sandbox copy of the seed, not from this repository, so the clean room tests what a new system really gets.
const { runTick } = await import(pathToFileURL(join(seedRoot, 'worker/src/tick.js')).href);
const db = openDb(dbPath, join(seedRoot, 'worker/migrations'));
const config = JSON.parse(readFileSync(cfgPath, 'utf8'));
const start = Date.parse('2026-01-05T00:00:00Z');  // a fixed Monday: the run is the same every time it is replayed
const errors = []; let completed = 0;
for (let i = 0; i < Number(n); i++) {
  try {
    const r = await runTick(db, { config, now: start + i * 600_000 });
    if (r.errors && r.errors.length) errors.push({ tick: i, error: String(r.errors[0]).slice(0, 300) });
    else completed++;
  } catch (e) {
    errors.push({ tick: i, error: `${e && e.name}: ${String(e && e.message).slice(0, 300)}` });
  }
}
const rows = await db.prepare('SELECT COUNT(*) AS c FROM tick_runs').first();
let ignition = null;
try { const m = await import(pathToFileURL(join(seedRoot, 'worker/src/ignition.js')).href); ignition = await m.readIgnition(db); } catch (e) { ignition = { error: String(e && e.message).slice(0, 200) }; }
db.close();
console.log(JSON.stringify({ ticks: Number(n), completed, errors: errors.slice(0, 10), error_count: errors.length, tick_runs: rows ? rows.c : 0, ignition }));
process.exit(errors.length ? 1 : 0);
