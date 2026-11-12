// Runs one tick of the seed's own heartbeat against a SQLite file prepared by `python3 -m foundation selfhost`.
// usage: node --no-warnings platform/selfhost/tick.mjs <db> <config.json>   prints the tick result as JSON.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from '../adapters/sqlite/d1-sqlite.js';
import { runTick } from '../../seed/worker/src/tick.js';

const [dbPath, cfgPath] = process.argv.slice(2);
if (!dbPath || !cfgPath) { console.error('usage: tick.mjs <db> <config.json>'); process.exit(2); }
// fileURLToPath, not .pathname: pathname is percent-encoded and puts a slash before a Windows drive letter.
const db = openDb(dbPath, fileURLToPath(new URL('../../seed/worker/migrations', import.meta.url)));
const config = JSON.parse(readFileSync(cfgPath, 'utf8'));
const r = await runTick(db, { config });
db.close();
console.log(JSON.stringify(r));
process.exit(r.errors.length ? 1 : 0);
