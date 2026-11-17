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

export async function applyPending(db, files, allow, nowIso, table = 'applied_migrations') {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (name TEXT PRIMARY KEY, at TEXT NOT NULL)`).run();
  const done = new Set(((await db.prepare(`SELECT name FROM ${table}`).all()).results || []).map(r => r.name));
  const report = [];
  for (const name of allow) {
    if (done.has(name)) continue;
    if (!(name in files)) { report.push({ name, ok: false, error: 'file not bundled' }); continue; }
    try {
      for (const st of splitSql(files[name])) await db.prepare(st).run();
      await db.prepare(`INSERT OR REPLACE INTO ${table} (name, at) VALUES (?,?)`).bind(name, nowIso).run();
      report.push({ name, ok: true });
    } catch (e) { report.push({ name, ok: false, error: String(e.message).slice(0, 200) }); }
  }
  return report;
}

export const selfMigrateStep = ({ files, allow, table = 'applied_migrations', stepName = 'selfmigrate' }) => ({
  name: stepName,
  async run(db, ctx) {
    const r = await applyPending(db, files, allow, ctx.nowIso, table);
    if (r.length) ctx.notes.push(`selfmigrate: ${r.map(x => `${x.name} ${x.ok ? 'applied' : 'FAILED ' + x.error}`).join('; ')}`);
  },
});
