// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Triggers (US-SPEC-08 s2, s3, US-08-R03, US-08-R16): an item's trigger names the items, or the gate cards, that must be done
// first. `items.trigger_on` holds one item id, a comma list of item ids, or `gate:<card id>` tokens mixed into that list.
// Pure reads here; the step that acts on them is enforceTriggers in gate.js. Ports: ctx = { db }.

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;

/** Split a trigger specification into its item ids and gate card ids. An empty or null trigger names nothing. */
export function parseTriggers(spec) {
  const items = [], gates = [];
  for (const raw of String(spec == null ? '' : spec).split(',')) {
    const t = raw.trim();
    if (!t) continue;
    if (/^gate:/i.test(t)) { const g = t.slice(5).trim(); if (g && !gates.includes(g)) gates.push(g); }
    else if (!items.includes(t)) items.push(t);
  }
  return { items, gates };
}

const CHUNK = 80; // a D1 statement binds at most 100 values

function judge({ items, gates }, itemRows, gateRows) {
  const waiting_on = [], reasons = {};
  for (const id of items) {
    const row = itemRows.get(id);
    if (!row) { waiting_on.push(id); reasons[id] = 'missing'; }
    else if (row.status !== 'done') { waiting_on.push(id); reasons[id] = `status ${row.status}`; }
    else if (!row.disposition || !String(row.disposition).trim()) { waiting_on.push(id); reasons[id] = 'done without a disposition'; }
  }
  for (const id of gates) {
    const row = gateRows.get(id), key = `gate:${id}`;
    if (!row) { waiting_on.push(key); reasons[key] = 'missing'; }
    else if (row.status !== 'closed') { waiting_on.push(key); reasons[key] = `gate ${row.status}`; }
  }
  return { done: waiting_on.length === 0, waiting_on, reasons };
}
async function load(ctx, table, cols, ids) {
  const rows = new Map();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const part = ids.slice(i, i + CHUNK);
    for (const r of await all(ctx.db, `SELECT id, ${cols} FROM ${table} WHERE id IN (${part.map(() => '?').join(',')})`, ...part)) rows.set(r.id, r);
  }
  return rows;
}

/**
 * Is every trigger done? An item trigger is done only when its status is `done` and it carries a disposition (an item that
 * left the active set without one is not accounted for, so it does not release its dependants); a gate trigger is done when
 * the card is closed. A trigger that names nothing that exists is not done. Returns { done, waiting_on: [...], reasons }.
 */
export async function triggerState(ctx, spec) {
  const t = parseTriggers(spec);
  return judge(t, await load(ctx, 'items', 'status, disposition', t.items), await load(ctx, 'gate_cards', 'status', t.gates));
}

/**
 * The same judgement for many specifications at once, in a number of statements that does not grow with the number of items
 * (a free-tier D1 allows few statements per invocation). Returns a Map from each specification to its state.
 */
export async function triggerStates(ctx, specs) {
  const parsed = new Map([...new Set(specs)].map(s => [s, parseTriggers(s)]));
  const items = [...new Set([...parsed.values()].flatMap(t => t.items))], gates = [...new Set([...parsed.values()].flatMap(t => t.gates))];
  const itemRows = await load(ctx, 'items', 'status, disposition', items), gateRows = await load(ctx, 'gate_cards', 'status', gates);
  return new Map([...parsed].map(([spec, t]) => [spec, judge(t, itemRows, gateRows)]));
}

/**
 * Items whose trigger is set, by status, for the step in gate.js: oldest first, at most `limit`, starting after the cursor
 * `after` ({ created_at, id } of the last row of the previous page) so a caller can page to the end instead of stopping at the first page.
 */
export const triggered = (ctx, status, limit = 500, after = null) => after
  ? all(ctx.db, `SELECT id, trigger_on, created_at FROM items WHERE status = ? AND trigger_on IS NOT NULL AND trim(trigger_on) <> '' AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at, id LIMIT ?`,
    status, after.created_at, after.created_at, after.id, limit)
  : all(ctx.db, `SELECT id, trigger_on, created_at FROM items WHERE status = ? AND trigger_on IS NOT NULL AND trim(trigger_on) <> '' ORDER BY created_at, id LIMIT ?`, status, limit);
