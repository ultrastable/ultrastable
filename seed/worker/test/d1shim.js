// Minimal D1-compatible wrapper over node:sqlite, for tests only.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function makeDb() {
  const raw = new DatabaseSync(':memory:');
  for (const f of ['0001_init.sql', '0004_objectives.sql', '0005_criticality.sql']) raw.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const db = {
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
  };
  return db;
}
