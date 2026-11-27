// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Reconciliation gates (US-SPEC-08 s5 and s6): the accounting invariant as an automatic gate that blocks closure of the
// parents of unaccounted items, the visibility ratio across issue stores, and the principal-queue reroute rule.
// Ports only: ctx = { db, now(), config, stores?: [{ name, visible, list() -> [{key, status}] }] }.
import { recordLoopRun, cfg as baseCfg, nowMs, iso } from './index.js';
import { triggerStates, triggered } from './triggers.js';

const DEFAULTS = { visibility_threshold: 2, staff_role: 'staff', identity_patterns: ['identity-bound', 'money', 'payment', 'sign', 'legal', 'credential', "owner's account"] };
const cfg = ctx => ({ ...DEFAULTS, ...baseCfg(ctx) });
const TERMINAL = ['done', 'superseded', 'cancelled'];
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const hasTable = async (db, name) => !!(await first(db, `SELECT name FROM sqlite_master WHERE type='table' AND name=?`, name).catch(() => null));

// ---- triggers at dispatch (US-08-R03, R27, R28) -----------------------------------------------------

/**
 * Keep status in step with triggers, whatever the trigger form (one item, several items, `gate:<card>`). (a) An `open` item
 * whose triggers are all done becomes `ready`: the core tick's own promotion only matches one item id. (b) A `ready` item
 * whose trigger is not done (a trigger reopened by silent-drop reconcile, a relapse) goes back to `open` with an outcome
 * naming what it waits on, so no dispatch picks it. (c) A `claimed` item whose trigger is not done and whose claim is a bare row of
 * the tick's `claims` table, with no live claim of this module, was taken by a dispatcher that did not judge the trigger (a list or a
 * gate the dispatch query does not read) or kept while its trigger was reopened: its claim is released, the item goes back to `open`
 * and the outcome and a `trigger-not-done` event name what it waits on. A claim granted by `acquire`, which judged the trigger, is its
 * holder's to finish or to let expire, and an item marked claimed with no claim row is left to the reaper.
 * The scan reads triggered items in pages of `trigger_scan_max` (default 500), at most `trigger_scan_pages` pages (default 20) per
 * status, so a backlog of old items that wait on a trigger cannot starve the newer ones behind them. When the page budget ends
 * before the items do, the cut is reported and never silent: `truncated` names the statuses, `scanned` the items read, and one
 * `scan-truncated` row is written to claims_events.
 */
export async function enforceTriggers(ctx) {
  const at = iso(nowMs(ctx)), out = { promoted: [], demoted: [], released: [], scanned: 0, truncated: [] };
  const limit = Number(cfg(ctx).trigger_scan_max) > 0 ? Number(cfg(ctx).trigger_scan_max) : 500;
  const pages = Number(cfg(ctx).trigger_scan_pages) > 0 ? Math.floor(Number(cfg(ctx).trigger_scan_pages)) : 20;
  const scan = async status => {
    const rows = [];
    let after = null, page = await triggered(ctx, status, limit);
    for (let n = 1; ; n++) {
      rows.push(...page);
      if (page.length < limit) return rows;
      after = { created_at: page[page.length - 1].created_at, id: page[page.length - 1].id };
      if (n >= pages) { if ((await triggered(ctx, status, 1, after)).length) out.truncated.push(status); return rows; }
      page = await triggered(ctx, status, limit, after);
    }
  };
  const open = await scan('open'), ready = await scan('ready'), claimed = await scan('claimed');
  out.scanned = open.length + ready.length + claimed.length;
  if (out.truncated.length) await run(ctx.db, `INSERT INTO claims_events (at, kind, key, holder, event, detail) VALUES (?, 'work', 'triggers:scan', NULL, 'scan-truncated', ?)`,
    at, `trigger scan stopped after ${pages} page(s) of ${limit} for status ${out.truncated.join(', ')}; ${out.scanned} item(s) read`);
  const states = await triggerStates(ctx, [...open, ...ready, ...claimed].map(i => i.trigger_on));   // a handful of statements, not two per item
  for (const it of open) {
    if (!states.get(it.trigger_on).done) continue;
    const r = await run(ctx.db, `UPDATE items SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'open'`, at, it.id);
    if (r.meta.changes) out.promoted.push(it.id);
  }
  for (const it of ready) {
    const t = states.get(it.trigger_on);
    if (t.done) continue;
    const r = await run(ctx.db, `UPDATE items SET status = 'open', updated_at = ? WHERE id = ? AND status = 'ready'`, at, it.id);
    if (!r.meta.changes) continue;
    await run(ctx.db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'work_tracker', 'trigger_guard', 'failed', ?)`,
      it.id, `demoted to open: trigger not done (${t.waiting_on.map(w => `${w}: ${t.reasons[w]}`).join('; ')})`.slice(0, 500));
    out.demoted.push(it.id);
  }
  const tickClaims = claimed.some(it => !states.get(it.trigger_on).done) && await hasTable(ctx.db, 'claims');
  for (const it of claimed) {
    const t = states.get(it.trigger_on);
    if (t.done || !tickClaims) continue;
    const held = await first(ctx.db, `SELECT agent FROM claims WHERE item_id = ?`, it.id);
    if (!held) continue;                                                                  // no claim row: the reaper's, not this step's
    if (await first(ctx.db, `SELECT id FROM claims_lock WHERE kind = 'work' AND item_id = ? AND released_at IS NULL`, it.id)) continue;   // granted by acquire
    const r = await run(ctx.db, `UPDATE items SET status = 'open', updated_at = ? WHERE id = ? AND status = 'claimed'`, at, it.id);
    if (!r.meta.changes) continue;
    await run(ctx.db, `DELETE FROM claims WHERE item_id = ?`, it.id);
    const waits = t.waiting_on.map(w => `${w}: ${t.reasons[w]}`).join('; ');
    await run(ctx.db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'work_tracker', 'trigger_guard', 'failed', ?)`,
      it.id, `claim of ${held.agent} released, back to open: trigger not done (${waits})`.slice(0, 500));
    await run(ctx.db, `INSERT INTO claims_events (at, kind, key, holder, event, detail) VALUES (?, 'work', ?, ?, 'trigger-not-done', ?)`,
      at, `item:${it.id}`, held.agent, `claim released: trigger not done (${waits})`.slice(0, 500));
    out.released.push(it.id);
  }
  return out;
}

// ---- a held item returns when its gate card closes (US-08-R29) ---------------------------------

/**
 * An item blocked with `gate card <id>` (written by escalateToGate and routeToPrincipal) returns to `ready` when that card
 * is closed, whether the card's probe closed it or a reroute did. An item blocked for any other reason is never touched.
 */
export async function releaseHeld(ctx) {
  const at = iso(nowMs(ctx)), released = [];
  for (const r of await all(ctx.db, `SELECT i.id AS item, g.id AS card, g.closing_probe AS probe FROM items i JOIN gate_cards g ON i.blocker = 'gate card ' || g.id
      WHERE i.status = 'blocked' AND g.status = 'closed' ORDER BY i.id`)) {
    const u = await run(ctx.db, `UPDATE items SET status = 'ready', blocker = NULL, updated_at = ? WHERE id = ? AND status = 'blocked' AND blocker = ?`, at, r.item, `gate card ${r.card}`);
    if (!u.meta.changes) continue;
    await run(ctx.db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'work_tracker', 'gate_release', 'verified', ?)`, r.item, `gate card ${r.card} closed by probe ${r.probe}`.slice(0, 300));
    await run(ctx.db, `INSERT INTO claims_events (at, kind, key, holder, event, detail) VALUES (?, 'work', ?, NULL, 'gate-released', ?)`, at, `item:${r.item}`, `gate card ${r.card} closed`);
    released.push(r.item);
  }
  return { released };
}

// ---- parents and the closure gate (US-08-R11) --------------------------------------------------

export async function setParent(ctx, item_id, parent_id) {
  if (!item_id || !parent_id || item_id === parent_id) throw new Error('a parent link names two different items');
  for (let p = parent_id, i = 0; p && i < 50; i++) {            // refuse a cycle
    if (p === item_id) throw new Error('a parent link must not form a cycle');
    p = (await first(ctx.db, `SELECT parent_id FROM claims_parents WHERE item_id = ?`, p))?.parent_id;
  }
  await run(ctx.db, `INSERT INTO claims_parents (item_id, parent_id) VALUES (?,?) ON CONFLICT(item_id) DO UPDATE SET parent_id = excluded.parent_id`, item_id, parent_id);
}
async function ancestors(ctx, id) {
  const out = [];
  for (let p = id, i = 0; i < 50; i++) {
    const row = await first(ctx.db, `SELECT parent_id FROM claims_parents WHERE item_id = ?`, p);
    if (!row || out.includes(row.parent_id)) break;
    out.push(row.parent_id); p = row.parent_id;
  }
  return out;
}

/**
 * Record a loop run and enforce the invariant `scanned = executed + failed + needs_human + no_action` as a gate: on a gap
 * the incident opens and the unaccounted items reopen (core recordLoopRun), and every ancestor of an unaccounted item is
 * blocked from closing until the item is accounted for.
 */
export async function recordLoopRunGated(ctx, lr = {}) {
  const res = await recordLoopRun(ctx, lr);
  const blocked = [];
  if (res.incident_id && !res.replayed) {
    const at = iso(nowMs(ctx));
    for (const child of res.reopened || []) for (const parent of await ancestors(ctx, child)) {
      const r = await run(ctx.db, `INSERT OR IGNORE INTO claims_closure_blocks (parent_id, child_id, incident_id, at) VALUES (?,?,?,?)`, parent, child, res.incident_id, at);
      if (r.meta.changes && !blocked.includes(parent)) blocked.push(parent);
    }
  }
  return { ...res, blocked_parents: blocked };
}

/** May this item close? Not while an unaccounted child holds a block, and not while its own loop has an open gap incident. */
export async function closureAllowed(ctx, item_id) {
  const rows = await all(ctx.db, `SELECT child_id, incident_id FROM claims_closure_blocks WHERE parent_id = ? AND cleared_at IS NULL ORDER BY child_id`, item_id);
  return rows.length ? { allowed: false, reason: 'unaccounted_children', blocked_by: rows.map(r => r.child_id), incidents: [...new Set(rows.map(r => r.incident_id))] } : { allowed: true };
}
/** The loop-level gate: a loop with an open accounting-gap incident does not pass. */
export async function loopGate(ctx, loop) {
  const inc = await first(ctx.db, `SELECT id, detail FROM claims_incidents WHERE kind = 'accounting_gap' AND ref = ? AND status = 'open' ORDER BY id DESC LIMIT 1`, String(loop));
  return inc ? { pass: false, reason: 'accounting_gap', incident_id: inc.id, detail: inc.detail } : { pass: true };
}

/** Close an item through the gate: a disposition is required and a blocked parent is refused. */
export async function closeItem(ctx, { item_id, status = 'done', disposition } = {}) {
  if (!TERMINAL.includes(status)) return { ok: false, reason: 'bad_status' };
  if (!disposition || !String(disposition).trim()) return { ok: false, reason: 'disposition_required' };
  const gate = await closureAllowed(ctx, item_id);
  if (!gate.allowed) return { ok: false, reason: gate.reason, blocked_by: gate.blocked_by };
  const r = await run(ctx.db, `UPDATE items SET status = ?, disposition = ?, updated_at = ? WHERE id = ?`, status, String(disposition), iso(nowMs(ctx)), item_id);
  return r.meta.changes ? { ok: true, item_id, status } : { ok: false, reason: 'no_item' };
}

/**
 * Run every tick. (1) A block clears when its child left the active set with a disposition. (2) A blocked parent that was
 * closed around the gate is reopened and the breach recorded. (3) A gap incident closes when the loop's newest run
 * balances and none of its blocks remain.
 */
export async function enforceGate(ctx) {
  const at = iso(nowMs(ctx)), out = { cleared: 0, reopened: [], incidents_closed: 0 };
  const ph = TERMINAL.map(() => '?').join(',');
  const done = await run(ctx.db, `UPDATE claims_closure_blocks SET cleared_at = ? WHERE cleared_at IS NULL AND child_id IN
    (SELECT id FROM items WHERE status IN (${ph}) AND disposition IS NOT NULL AND disposition <> '')`, at, ...TERMINAL);
  out.cleared = done.meta.changes;
  for (const p of await all(ctx.db, `SELECT DISTINCT b.parent_id AS id FROM claims_closure_blocks b JOIN items i ON i.id = b.parent_id WHERE b.cleared_at IS NULL AND i.status IN (${ph})`, ...TERMINAL)) {
    await run(ctx.db, `UPDATE items SET status = 'open', updated_at = ? WHERE id = ?`, at, p.id);
    await run(ctx.db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'work_tracker', 'closure_gate', 'silent_drop', 'reopened: closed while a child was unaccounted by a loop run')`, p.id);
    out.reopened.push(p.id);
  }
  for (const inc of await all(ctx.db, `SELECT id, ref FROM claims_incidents WHERE kind = 'accounting_gap' AND status = 'open'`)) {
    const last = await first(ctx.db, `SELECT gap FROM claims_loop_runs WHERE loop = ? ORDER BY id DESC LIMIT 1`, inc.ref);
    const open = await first(ctx.db, `SELECT COUNT(*) AS n FROM claims_closure_blocks WHERE incident_id = ? AND cleared_at IS NULL`, inc.id);
    if (last && last.gap === 0 && open.n === 0) { await run(ctx.db, `UPDATE claims_incidents SET status = 'closed' WHERE id = ?`, inc.id); out.incidents_closed++; }
  }
  return out;
}

// ---- visibility ratio across issue stores (US-08 s5) -------------------------------------------

const isOpen = s => !TERMINAL.includes(String(s || 'open').toLowerCase()) && String(s).toLowerCase() !== 'closed';
/** The seed work tracker as a store. */
export const itemsStore = (ctx, { visible = true } = {}) => ({ name: 'items', visible, list: async () => (await all(ctx.db, `SELECT id AS key, status FROM items`)) });

/**
 * Union the stores by key and compare the open items in all stores with the open items the operations tools can see.
 * The ratio fires above the threshold (default 2); a store that cannot be read is reported and never counted as empty.
 */
export async function visibilityRatio(ctx, { stores = ctx.stores } = {}) {
  const c = cfg(ctx), at = iso(nowMs(ctx));
  if (!Array.isArray(stores) || !stores.length) return { ok: false, reason: 'no_stores' };
  const allOpen = new Set(), visibleOpen = new Set(), report = [];
  for (const s of stores) {
    try {
      const open = (await s.list()).filter(r => isOpen(r.status)).map(r => String(r.key));
      open.forEach(k => { allOpen.add(k); if (s.visible) visibleOpen.add(k); });
      report.push({ name: s.name, visible: !!s.visible, open: open.length });
    } catch (e) { report.push({ name: s.name, visible: !!s.visible, open: null, error: String((e && e.message) || e).slice(0, 200) }); }
  }
  const unread = report.filter(r => r.open === null).map(r => r.name);
  const ratio = visibleOpen.size ? allOpen.size / visibleOpen.size : null;
  const fired = unread.length === 0 && allOpen.size > 0 && (ratio === null || ratio > c.visibility_threshold);
  await run(ctx.db, `INSERT INTO claims_visibility (at, open_all, open_visible, ratio, threshold, fired, stores) VALUES (?,?,?,?,?,?,?)`,
    at, allOpen.size, visibleOpen.size, ratio, c.visibility_threshold, fired ? 1 : 0, JSON.stringify(report));
  let incident_id = null;
  if (fired && !(await first(ctx.db, `SELECT id FROM claims_incidents WHERE kind = 'visibility_ratio' AND status = 'open'`))) {
    const detail = `open in all stores ${allOpen.size}, visible to operations tools ${visibleOpen.size}, ratio ${ratio === null ? 'undefined (nothing visible)' : ratio.toFixed(2)}`;
    incident_id = (await run(ctx.db, `INSERT INTO claims_incidents (at, kind, ref, detail) VALUES (?, 'visibility_ratio', 'issue-stores', ?)`, at, detail)).meta.last_row_id;
    await run(ctx.db, `INSERT OR IGNORE INTO items (id,title,kind,owner_role,done_check,closing_probe,priority,status) VALUES ('VISIBILITY-RATIO', ?, 'fix', ?, ?, ?, 5, 'open')`,
      `Operations tools under-report open work: ${detail}`, c.escalation_role, 'every issue store is read by the operations tools', `visibility ratio <= ${c.visibility_threshold}`);
  }
  if (!fired && unread.length === 0) await run(ctx.db, `UPDATE claims_incidents SET status = 'closed' WHERE kind = 'visibility_ratio' AND status = 'open'`);
  return { ok: true, open_all: allOpen.size, open_visible: visibleOpen.size, ratio, threshold: c.visibility_threshold, fired, incident_id, stores: report, unread };
}

// ---- principal queue (US-08 s6) ----------------------------------------------------------------

// A card whose probe waits for a credential is identity-bound by its nature: only the principal can create the credential
// (the same rule as core/trust, so the two modules never disagree about a card either of them opened).
const inferredLine = card => (/^env:\w+$/.test(card.closing_probe || '') ? `the credential ${String(card.closing_probe).slice(4)} can be created only by the principal` : null);
function findLine(card, line, patterns) {
  if (line && String(line).trim()) return String(line).trim();
  const inferred = inferredLine(card);
  if (inferred) return inferred;
  const text = String(card.why_gated || '');
  const hit = text.split(/(?<=[.;\n])\s*/).find(s => patterns.some(p => s.toLowerCase().includes(String(p).toLowerCase())));
  return hit ? hit.trim() : null;
}

/**
 * Route a step to the principal. With an identity-bound line the step is held as one gate card with its default and
 * closing probe. Without one it is rerouted: no card, and the item goes back to the staff, who execute the step.
 */
export async function routeToPrincipal(ctx, g = {}) {
  const c = cfg(ctx), at = iso(nowMs(ctx));
  const line = g.identity_bound_line && String(g.identity_bound_line).trim();
  if (!line) {
    if (g.item_id) await run(ctx.db, `UPDATE items SET status = 'ready', owner_role = ?, blocker = NULL, updated_at = ? WHERE id = ? AND status NOT IN ('done','superseded','cancelled')`, c.staff_role, at, g.item_id);
    return { held: false, rerouted: true, card: null, owner_role: c.staff_role };
  }
  if (!g.default_in_effect || !g.closing_probe) throw new Error('a held card carries its default in effect and a closing probe');
  const id = g.card_id || `gate-${g.item_id}`;
  await run(ctx.db, `INSERT OR IGNORE INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES (?,?,?,?,?)`, id, g.what, g.why_gated || line, g.default_in_effect, g.closing_probe);
  await run(ctx.db, `INSERT OR REPLACE INTO claims_gate_lines (card_id, item_id, identity_bound_line) VALUES (?,?,?)`, id, g.item_id ?? null, line);
  if (g.item_id) await run(ctx.db, `UPDATE items SET status = 'blocked', blocker = ?, updated_at = ? WHERE id = ?`, `gate card ${id}`, at, g.item_id);
  return { held: true, rerouted: false, card: id };
}

/** Open cards without an identity-bound line: the metric whose target is zero. */
export async function cardsWithoutIdentityLine(ctx) {
  const c = cfg(ctx), out = [];
  const trust = await hasTable(ctx.db, 'trust_gate_meta'); // US-08-R23: a line stored by core/trust counts
  for (const card of await all(ctx.db, `SELECT g.*, l.identity_bound_line AS line, l.item_id AS item_id${trust ? ', t.identity_bound_line AS trust_line' : ''} FROM gate_cards g
      LEFT JOIN claims_gate_lines l ON l.card_id = g.id ${trust ? 'LEFT JOIN trust_gate_meta t ON t.card_id = g.id' : ''} WHERE g.status = 'open' ORDER BY g.id`))
    if (!findLine(card, card.line || card.trust_line, c.identity_patterns)) out.push(card);
  return out;
}

/**
 * Reroute every open card that has no identity-bound line: the card closes, and the step goes to the staff (the held item
 * is released to them, or a new item carries the step). Returns the metric before and after.
 */
export async function rerouteCards(ctx) {
  const c = cfg(ctx), at = iso(nowMs(ctx));
  const cards = await cardsWithoutIdentityLine(ctx), rerouted = [];
  for (const card of cards) {
    await run(ctx.db, `UPDATE gate_cards SET status = 'closed', closed_at = ? WHERE id = ? AND status = 'open'`, at, card.id);
    const itemId = card.item_id || (card.id.startsWith('gate-') ? card.id.slice(5) : null);
    const held = itemId ? await first(ctx.db, `SELECT id FROM items WHERE id = ? AND status = 'blocked'`, itemId) : null;
    let staffItem;
    if (held) { staffItem = held.id; await run(ctx.db, `UPDATE items SET status = 'ready', owner_role = ?, blocker = NULL, updated_at = ? WHERE id = ?`, c.staff_role, at, held.id); }
    else {
      staffItem = `REROUTE-${card.id}`.slice(0, 120);
      await run(ctx.db, `INSERT OR IGNORE INTO items (id,title,kind,owner_role,done_check,closing_probe,priority,status) VALUES (?,?,'work',?,?,?,30,'ready')`,
        staffItem, `Rerouted from the principal queue (no identity-bound line): ${String(card.what).slice(0, 200)}`, c.staff_role, `the step is done: ${String(card.what).slice(0, 200)}`, card.closing_probe);
    }
    await run(ctx.db, `INSERT INTO claims_events (at, kind, key, holder, event, detail) VALUES (?, 'work', ?, ?, 'rerouted', ?)`, at, `card:${card.id}`, c.staff_role, `no identity-bound line; step moved to ${staffItem}`);
    rerouted.push({ card: card.id, item: staffItem });
  }
  return { cards_without_identity_line_before: cards.length, rerouted, cards_without_identity_line: (await cardsWithoutIdentityLine(ctx)).length };
}

/** One tick of the gates. Wire after the loops that report runs. */
export async function step(ctx) {
  const held = await releaseHeld(ctx);
  const triggers = await enforceTriggers(ctx);
  const gate = await enforceGate(ctx);
  // rerouting closes cards, so it is opt-in: cards filed by other modules must carry an identity-bound line first
  const queue = cfg(ctx).reroute_cards === true ? await rerouteCards(ctx) : { rerouted: [], cards_without_identity_line: (await cardsWithoutIdentityLine(ctx)).length };
  const vis = Array.isArray(ctx.stores) && ctx.stores.length ? await visibilityRatio(ctx) : null;
  // the trigger and held-item counts appear only when the step did something, so an idle tick keeps the shape it always had
  const acted = {};
  if (held.released.length) acted.held_released = held.released;
  if (triggers.promoted.length) acted.triggers_promoted = triggers.promoted;
  if (triggers.demoted.length) acted.triggers_demoted = triggers.demoted;
  if (triggers.released.length) acted.triggers_released = triggers.released;
  if (triggers.truncated.length) acted.triggers_truncated = triggers.truncated;
  return { ...acted, gate, rerouted: queue.rerouted.length, cards_without_identity_line: queue.cards_without_identity_line, visibility: vis && { ratio: vis.ratio, fired: vis.fired } };
}
