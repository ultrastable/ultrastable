// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Shared helpers of the ladder modules: time, db calls, work items (filed once, re-opened on recurrence, closed with evidence).
export const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
export const msOf = v => (typeof v === 'function' ? msOf(v()) : v instanceof Date ? v.getTime() : Number(v));
export const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
export const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
export const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
export async function fileItem(db, { id, title, done_check, closing_probe, priority = 20, owner_role = 'operations' }, ts) {
  const r = await run(db, `INSERT OR IGNORE INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,'ready',?,?)`,
    id, String(title).slice(0, 300), 'fix', owner_role, done_check, closing_probe, priority, ts, ts);
  if (r.meta.changes) return true;
  return (await run(db, `UPDATE items SET status='ready', disposition=NULL, title=?, updated_at=? WHERE id=? AND status='done'`, String(title).slice(0, 300), ts, id)).meta.changes > 0;
}
export const closeItem = async (db, id, disposition, ts) =>
  (await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, String(disposition).slice(0, 300), ts, id)).meta.changes > 0;
/** An exemption covers a model for a role while it has evidence and has not expired; a reader-facing role is never exempt. */
export function exempts(exemptions, { kind, model, role, field = null, nowIso }) {
  if (role === 'reader-facing') return null;
  return exemptions.find(e => e.kind === kind && String(e.evidence || '').trim() && (e.role === '*' || e.role === role) && (e.field || null) === (field || null)
    && (!e.expires_at || e.expires_at > nowIso) && (e.model === model || (() => { try { return new RegExp(e.model, 'i').test(model); } catch { return false; } })())) || null;
}
