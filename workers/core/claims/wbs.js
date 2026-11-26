// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Optional WBS codes (US-SPEC-08 s2, US-08-R26): `<portfolio>.<program>.<project>.<phase>[.<task>]`. Nothing calls this by
// default. Pure helpers plus a module table; ports only: ctx = { db }.
import { setParent } from './gate.js';

const SEGMENT = /^[A-Za-z0-9_-]{1,40}$/;
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;

/** Split and validate a WBS code: 4 or 5 segments of [A-Za-z0-9_-], 1 to 40 characters each. Returns the parts or null. */
export function parseWbs(code) {
  if (typeof code !== 'string') return null;
  const parts = code.split('.');
  if (parts.length < 4 || parts.length > 5 || !parts.every(p => SEGMENT.test(p))) return null;
  const [portfolio, program, project, phase, task = null] = parts;
  return { portfolio, program, project, phase, task, parts };
}
export function formatWbs({ portfolio, program, project, phase, task } = {}) {
  const parts = [portfolio, program, project, phase, task].filter(p => p !== undefined && p !== null);
  const code = parts.join('.');
  if (!parseWbs(code)) throw new Error('a WBS code has portfolio, program, project and phase, and optionally a task');
  return code;
}
/** The code one level up, down to `portfolio.program`; null above that. The parent of a phase is a project prefix, not a full code. */
export function wbsParent(code) {
  const parts = String(code).split('.');
  return parts.length > 2 ? parts.slice(0, -1).join('.') : null;
}

/** Attach a code to an item (idempotent; a second call replaces the code). Refuses an invalid code or an unknown item. */
export async function attachWbs(ctx, item_id, code) {
  if (!parseWbs(code)) throw new Error(`not a WBS code: ${code}`);
  if (!(await first(ctx.db, `SELECT id FROM items WHERE id = ?`, item_id))) throw new Error(`no such item: ${item_id}`);
  await ctx.db.prepare(`INSERT INTO claims_wbs (item_id, code) VALUES (?,?) ON CONFLICT(item_id) DO UPDATE SET code = excluded.code`).bind(item_id, code).run();
  return { item_id, code };
}

/** Counts by status of every item whose code is `prefix` or lies under it. */
export async function wbsRollup(ctx, prefix) {
  const p = String(prefix);
  const rows = await all(ctx.db, `SELECT i.status AS status, COUNT(*) AS n FROM claims_wbs w JOIN items i ON i.id = w.item_id
    WHERE w.code = ? OR substr(w.code, 1, ?) = ? GROUP BY i.status ORDER BY i.status`, p, p.length + 1, `${p}.`);
  const by_status = Object.fromEntries(rows.map(r => [r.status, r.n]));
  return { prefix: p, total: rows.reduce((s, r) => s + r.n, 0), by_status };
}

/**
 * Link each coded item to the item whose code is exactly one level above it (parent links used by the closure gate in
 * gate.js). A link that is already right is left alone; a parent code no item carries links nothing.
 */
export async function linkParentsByWbs(ctx) {
  const linked = [];
  const coded = await all(ctx.db, `SELECT item_id, code FROM claims_wbs ORDER BY code, item_id`);
  const byCode = new Map(coded.map(c => [c.code, c.item_id]));
  for (const c of coded) {
    const parent = byCode.get(wbsParent(c.code));
    if (!parent || parent === c.item_id) continue;
    const cur = await first(ctx.db, `SELECT parent_id FROM claims_parents WHERE item_id = ?`, c.item_id);
    if (cur && cur.parent_id === parent) continue;
    await setParent(ctx, c.item_id, parent);
    linked.push([c.item_id, parent]);
  }
  return { linked };
}
