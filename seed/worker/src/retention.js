// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// RETENTION-1 (2026-11-16): history tables are pruned once a day by the rules in seed/autonomy/retention.json (config.retention). Bounded: at most
// max_rows_per_run rows per table per day, oldest first, so a backlog of old rows drains over several days instead of one large delete.
// Lesson from an earlier fleet: its audit database kept every ledger row forever and every pre-delete backup table, and each tick's views and
// triggers read more rows as the tables grew. A table missing from the rules is never touched here; the plan-limits check fails instead.

export async function ensureRetentionLog(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS retention_runs (day TEXT NOT NULL, table_name TEXT NOT NULL, deleted INTEGER NOT NULL, error TEXT, PRIMARY KEY (day, table_name))").run();
}

export function cutoff(keepDays, now = Date.now()) {
  return new Date(now - keepDays * 864e5).toISOString().replace('T', ' ').slice(0, 19);
}

const SAFE = /^[a-z_][a-z0-9_]*$/;

// Runs once a day (the retention_runs row for today is the gate). Returns one entry per pruned table.
export async function pruneAll(db, { rules, now = Date.now(), archive = null } = {}) {
  if (!rules || !rules.tables) return { ran: false, reason: 'no retention rules in config' };
  await ensureRetentionLog(db);
  const day = new Date(now).toISOString().slice(0, 10);
  const done = await db.prepare("SELECT COUNT(*) AS n FROM retention_runs WHERE day = ?1").bind(day).first();
  if (done && done.n > 0) return { ran: false, reason: 'already pruned today' };
  const max = Number(rules.max_rows_per_run) || 5000;
  const out = [];
  for (const [table, r] of Object.entries(rules.tables)) {
    if (!r || !r.keep_days || !r.column) continue;
    if (!SAFE.test(table) || !SAFE.test(r.column)) { out.push({ table, error: 'unsafe name' }); continue; }
    const limit = r.unit === 'ms' ? now - Number(r.keep_days) * 864e5 : cutoff(Number(r.keep_days), now);  // unit 'ms': integer-millisecond time column (host_events)
    let deleted = 0, error = null;
    try {
      if (r.archive && archive) {
        // AUDIT-CHAIN-1: rows go into the tamper-evident chain first; if that fails nothing is deleted.
        const rows = (await db.prepare(`SELECT rowid AS _rid, * FROM ${table} WHERE ${r.column} < ?1 ORDER BY ${r.column} LIMIT ?2`).bind(limit, max).all()).results || [];
        if (rows.length) {
          await archive(table, rows.map(({ _rid, ...rest }) => rest));
          for (const x of rows) await db.prepare(`DELETE FROM ${table} WHERE rowid = ?1`).bind(x._rid).run();
          deleted = rows.length;
        }
      } else {
        const res = await db.prepare(`DELETE FROM ${table} WHERE rowid IN (SELECT rowid FROM ${table} WHERE ${r.column} < ?1 ORDER BY ${r.column} LIMIT ?2)`).bind(limit, max).run();
        deleted = Number((res && res.meta && res.meta.changes) || 0);
      }
    } catch (e) {
      const msg = String(e && e.message || e);
      if (/no such table/i.test(msg)) continue;  // a table this deployment never created
      error = msg.slice(0, 200);
    }
    await db.prepare("INSERT OR REPLACE INTO retention_runs (day, table_name, deleted, error) VALUES (?1, ?2, ?3, ?4)").bind(day, table, deleted, error).run();
    out.push({ table, deleted, ...(error ? { error } : {}) });
  }
  if (!out.length) await db.prepare("INSERT OR REPLACE INTO retention_runs (day, table_name, deleted, error) VALUES (?1, '-', 0, NULL)").bind(day).run();
  return { ran: true, day, tables: out };
}
