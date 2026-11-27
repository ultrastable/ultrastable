// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The backend applies its own allow-listed, idempotent migrations on the tick, so a schema change that is merged reaches the live
// database with no person and no repo secret. Only files named in worker/self-migrate.json run (each must be safe to re-run);
// each applies once and is recorded.
// US-01-R04 (export before drop): a file that drops or rewrites data (core/export classify) is applied only through an exporter, after every table it
// touches was exported to an object store and read back; with no exporter it is refused and reported, never applied and never skipped in silence.
// What runs is what was classified: one splitter (core/export, SQLite's own statement boundaries) feeds both, each piece checked to be one statement,
// and the store's schema (tables and triggers) is read once per run and carried forward, so an insert that fires a trigger, meets a REPLACE clause
// or runs a foreign key action is judged by what SQLite does with it.
import { classify, runnable, storedSchema, schemaAfter } from '../export/index.js';

/** The statements of a migration, each ending in `;`, split where SQLite would (core/export splitStatements). */
export function splitSql(sql) {
  return runnable(sql).map(st => `${st};`);
}

// MIGRATE-GAP-1 (2026-11-25): a tenant's database was 23 migrations behind, and one statement per query would have spent a whole invocation's
// query allowance on them and starved the tick. A migration is one batched call when the database offers batch() (atomic: it lands whole, with
// its ledger row, or not at all), and at most `max` migrations are applied per run; the rest are reported as waiting and taken on the next run.
export async function applyPending(db, files, allow, nowIso, table = 'applied_migrations', { max = 4, exporter = null } = {}) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${table} (name TEXT PRIMARY KEY, at TEXT NOT NULL)`).run();
  const done = new Set(((await db.prepare(`SELECT name FROM ${table}`).all()).results || []).map(r => r.name));
  const report = [];
  let applied = 0;
  let schema = null; // read on the first file that needs it, then carried forward as files land
  for (const name of allow) {
    if (done.has(name)) continue;
    if (!(name in files)) { report.push({ name, ok: false, error: 'file not bundled' }); continue; }
    if (applied >= max) { report.push({ name, ok: false, waiting: true, error: 'waiting for the next run' }); continue; }
    // The cap counts files that were applied or that failed while being applied: a destructive file refused for want of an exporter, or by an export that
    // did not verify, spends none of the run's allowance. Counted before the refusal it let `max` refused files at the head of the list starve every
    // additive migration behind them, run after run.
    try {
      const mark = db.prepare(`INSERT OR REPLACE INTO ${table} (name, at) VALUES (?,?)`).bind(name, nowIso);
      if (schema === null) schema = await storedSchema(db);
      if (classify(files[name], { schema }).destructive) {
        if (!exporter) { report.push({ name, ok: false, refused: 'destructive migration needs an export store', error: 'drops or rewrites data and no object store was given to export it first' }); continue; }
        const r = await exporter.applyMigration(name, files[name], { also: [mark] });
        report.push(r.ok ? { name, ok: true, exported: r.exports.length } : { name, ok: false, refused: r.refusal, error: String(r.reason || r.refusal).slice(0, 200) });
        if (r.ok) { applied++; schema = schemaAfter(files[name], schema); }
        continue;
      }
      const statements = splitSql(files[name]);
      if (typeof db.batch === 'function') await db.batch([...statements.map(st => db.prepare(st)), mark]);
      else { for (const st of statements) await db.prepare(st).run(); await mark.run(); }
      report.push({ name, ok: true }); applied++;
      schema = schemaAfter(files[name], schema);
    } catch (e) { applied++; report.push({ name, ok: false, error: String(e.message).slice(0, 200) }); }
  }
  return report;
}

export const selfMigrateStep = ({ files, allow, table = 'applied_migrations', stepName = 'selfmigrate', exporter = null }) => ({
  name: stepName,
  async run(db, ctx) {
    const r = await applyPending(db, files, allow, ctx.nowIso, table, { exporter });
    if (r.length) ctx.notes.push(`selfmigrate: ${r.map(x => `${x.name} ${x.ok ? 'applied' : x.waiting ? 'waiting' : x.refused ? 'REFUSED (' + x.refused + ')' : 'FAILED ' + x.error}`).join('; ')}`);
  },
});
