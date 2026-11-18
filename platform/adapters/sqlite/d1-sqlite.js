// D1-compatible handle over node:sqlite. The portable core (seed/worker/src/tick.js) only calls
// db.prepare(sql).bind(...).all()/first()/run(), so any store that offers this surface can run the loops.
// Used by the GCP adapter (SQLite file on a mounted volume) and by tests.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

// Q-TENANT-row-isolation: every open re-runs every migration file, and SQLite has no ADD COLUMN IF NOT EXISTS. A file that fails only because a column it adds is already
// there is re-run statement by statement, skipping just that duplicate; any other error still throws. Same rule as seed/worker/src/migrate.js (the tick's own runner).
const ADD_COLUMN = /^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\b/i;
const DUP = /duplicate column name/i;
function statements(sql) {
  const out = []; let cur = [], trig = false;
  for (const raw of sql.split('\n')) {
    const l = raw.trim(); if (!l || l.startsWith('--')) continue;
    cur.push(raw); if (/^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(cur[0].trim())) trig = true;
    if (l.endsWith(';') && (!trig || /^END\s*;$/i.test(l))) { out.push(cur.join('\n').trim()); cur = []; trig = false; }
  }
  if (cur.length) out.push(cur.join('\n').trim());
  return out;
}
export function execIdempotent(raw, sql) {
  try { raw.exec(sql); return; } catch (e) { if (!DUP.test(String(e && e.message))) throw e; }
  for (const s of statements(sql)) {
    try { raw.exec(s); } catch (e) { if (!(ADD_COLUMN.test(s) && DUP.test(String(e && e.message)))) throw e; }
  }
}

export function openDb(path, migrationsDir) {
  const raw = new DatabaseSync(path);
  raw.exec(`PRAGMA journal_mode=${process.env.ULTRASTABLE_JOURNAL || 'DELETE'}; PRAGMA busy_timeout=5000;`); // DELETE, not WAL: WAL needs shared memory that network volumes lack
  if (migrationsDir) {
    for (const f of readdirSync(migrationsDir).filter(n => n.endsWith('.sql')).sort()) {
      execIdempotent(raw, readFileSync(`${migrationsDir}/${f}`, 'utf8')); // migrations are additive and idempotent
    }
  }
  return {
    raw,
    prepare(sql) {
      const st = raw.prepare(sql);
      let args = [];
      const o = {
        bind(...a) { args = a; return o; },
        async all() { return { results: st.all(...args).map(r => ({ ...r })) }; },
        async first() { const r = st.get(...args); return r ? { ...r } : null; },
        async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      return o;
    },
    close() { raw.close(); },
  };
}
