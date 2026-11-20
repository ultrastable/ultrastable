// Minimal D1-compatible wrapper over node:sqlite, for tests only.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
export function makeDb() {
  const raw = new DatabaseSync(':memory:');
  for (const f of readdirSync(new URL('../migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL('../migrations/' + f, import.meta.url), 'utf8'));
  const db = {
    raw,
    prepare(sql) {
      let _st = null; const st = { get s() { return _st || (_st = raw.prepare(sql)); }, all: (...a) => st.s.all(...a), get: (...a) => st.s.get(...a), run: (...a) => st.s.run(...a) };  // compiled on first use, like D1 (a batch may prepare a statement on a table an earlier statement creates)
      let args = [];
      const o = {
        bind(...a) { args = a; return o; },
        async all() { return { results: st.all(...args).map(r => ({ ...r })) }; },
        async first() { const r = st.get(...args); return r ? { ...r } : null; },
        async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
      };
      o.runSync = () => st.run(...args);
      return o;
    },
    // D1 batch: one transaction, all or nothing
    async batch(stmts) {
      raw.exec('BEGIN');
      try { const out = stmts.map(s => { const r = s.runSync(); return { meta: { changes: Number(r.changes) } }; }); raw.exec('COMMIT'); return out; }
      catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  return db;
}
