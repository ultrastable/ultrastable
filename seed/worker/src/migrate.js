// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// MIGRATE-SELF-1: the tick applies its own D1 migrations. Root cause closed: deploy-workers.yml applied migrations with a token for the retired
// account (it skips there), and no token exists for the live account, so 0015 and 0016 were never recorded live and 0017 needed a hand-run.
// The tick holds the D1 binding, so it needs no credential: config.migrations (file, sql) is generated at the deploy commit from
// seed/worker/migrations/index.json (a test keeps that list equal to the directory). Same ledger and rules as deploy/apply-d1-migrations.mjs:
// _migrations(file, sha256); a new file runs once, an applied file with the same sha256 is skipped, a changed one is drift: reported, never re-run.
// The pending count is written to org.migrations_pending; a failure mode probes it (instances/ultrastable/failure-modes.json).
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];

async function sha256(text) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const ADD_COLUMN = /^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\b/i;
const ATOMIC = /^\s*--\s*atomic:/i;
// Statements end at a line ending in ';' (a trigger body's inner ';' lines do not end it: it ends at its END;).
function statements(sql) {
  const out = []; let cur = [], trig = false;
  for (const raw of sql.split('\n')) {
    const l = raw.trim(); if (!l || l.startsWith('--')) continue;
    cur.push(raw); if (/^CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(cur[0].trim())) trig = true;
    if (l.endsWith(';') && (!trig || /^END\s*;$/i.test(l))) { out.push(cur.join('\n').trim().replace(/;$/, '')); cur = []; trig = false; }
  }
  if (cur.length) out.push(cur.join('\n').trim().replace(/;$/, ''));
  return out;
}

export async function migrateStep(db, ctx, migrations, ensureItem) {
  if (!Array.isArray(migrations) || !migrations.length) return { applied: [], drift: [], failed: [], pending: null };
  await run(db, `CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, sha256 TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const ledger = new Map((await all(db, `SELECT file, sha256 FROM _migrations`)).map(r => [r.file, r.sha256]));
  const applied = [], drift = [], failed = [];
  for (const m of [...migrations].sort((a, b) => (a.file < b.file ? -1 : 1))) {
    const h = await sha256(m.sql);
    if (ledger.has(m.file)) { if (ledger.get(m.file) !== h) drift.push(m.file); continue; }
    try {
      // MIGRATE-ATOMIC-1 (0027): a file whose first line starts with `-- atomic:` is a table rebuild (copy, drop, rename). Run statement by statement, a failure between
      // the drop and the rename would leave no table; D1's batch is one transaction, so the file applies whole or not at all and a retry starts from the old state.
      if (ATOMIC.test(m.sql)) await db.batch(statements(m.sql).map(s => db.prepare(s)));
      else for (const s of statements(m.sql)) {
        // Q-TENANT-row-isolation: SQLite has no ADD COLUMN IF NOT EXISTS. A column that is already there (a partly applied file, or the other runner got there first) is the state the
        // statement asks for, so it is skipped; any other error still fails the file. Every other statement kind is already idempotent (IF NOT EXISTS).
        try { await run(db, s); }
        catch (e) { if (ADD_COLUMN.test(s) && /duplicate column name/i.test(String(e && e.message))) continue; throw e; }
      }
      await run(db, `INSERT OR IGNORE INTO _migrations (file, sha256) VALUES (?, ?)`, m.file, h);
      applied.push(m.file);
    } catch (e) {
      failed.push(m.file);
      ctx.notes.push(`migrate: ${m.file} failed: ${String(e && e.message).slice(0, 160)}`);
      break;  // later files may depend on this one
    }
  }
  const pending = failed.length + drift.length;
  await run(db, `INSERT INTO org (key, value) VALUES ('migrations_pending', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, String(pending));
  for (const f of [...failed, ...drift]) {
    await ensureItem(db, { id: `MIGRATION-${f.replace(/\.sql$/, '')}`, kind: 'fix', owner_role: 'operations', priority: -1,
      title: `Migration ${f} is ${failed.includes(f) ? 'failing to apply' : 'drifted (edited after it was applied)'}: ship the change as a new migration file`,
      done_check: "org.migrations_pending = 0", closing_probe: 'selfaudit:migrations-pending' });
  }
  if (applied.length) ctx.notes.push(`migrate: applied ${applied.join(', ')}`);
  return { applied, drift, failed, pending };
}
