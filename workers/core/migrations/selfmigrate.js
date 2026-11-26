// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The backend applies its own allow-listed, idempotent migrations on the tick, so a schema change that is merged reaches the live
// database with no person and no repo secret. Only files named in worker/self-migrate.json run (each must be safe to re-run);
// each applies once and is recorded.
export function splitSql(sql) {
  const text = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  const out = []; let cur = '', depth = 0;
  for (const line of text.split('\n')) {
    cur += line + '\n';
    if (/^\s*BEGIN\b/i.test(line) && /TRIGGER/i.test(cur)) depth = 1;
    if (depth && /^\s*END;?\s*$/i.test(line)) { depth = 0; out.push(cur.trim().replace(/;?$/, ';')); cur = ''; continue; }
    if (!depth && /;\s*$/.test(line)) { out.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter(s => s && s !== ';');
}

// MIGRATE-GAP-1 (2026-11-25): a tenant's database was 23 migrations behind, and one statement per query would have spent a whole invocation's
// query allowance on them and starved the tick. A migration is one batched call when the database offers batch() (atomic: it lands whole, with
// its ledger row, or not at all), and at most `max` migrations are applied per run; the rest are reported as waiting and taken on the next run.
export async function applyPending(db, files, allow, nowIso, table = 'applied_migrations', { max = 4 } = {}) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (name TEXT PRIMARY KEY, at TEXT NOT NULL)`).run();
  const done = new Set(((await db.prepare(`SELECT name FROM ${table}`).all()).results || []).map(r => r.name));
  const report = [];
  let applied = 0;
  for (const name of allow) {
    if (done.has(name)) continue;
    if (!(name in files)) { report.push({ name, ok: false, error: 'file not bundled' }); continue; }
    if (applied >= max) { report.push({ name, ok: false, waiting: true, error: 'waiting for the next run' }); continue; }
    applied++;
    try {
      const mark = db.prepare(`INSERT OR REPLACE INTO ${table} (name, at) VALUES (?,?)`).bind(name, nowIso);
      if (typeof db.batch === 'function') await db.batch([...splitSql(files[name]).map(st => db.prepare(st)), mark]);
      else { for (const st of splitSql(files[name])) await db.prepare(st).run(); await mark.run(); }
      report.push({ name, ok: true });
    } catch (e) { report.push({ name, ok: false, error: String(e.message).slice(0, 200) }); }
  }
  return report;
}

export const selfMigrateStep = ({ files, allow, table = 'applied_migrations', stepName = 'selfmigrate' }) => ({
  name: stepName,
  async run(db, ctx) {
    const r = await applyPending(db, files, allow, ctx.nowIso, table);
    if (r.length) ctx.notes.push(`selfmigrate: ${r.map(x => `${x.name} ${x.ok ? 'applied' : x.waiting ? 'waiting' : 'FAILED ' + x.error}`).join('; ')}`);
  },
});
