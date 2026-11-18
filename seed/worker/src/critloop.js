// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// CRITICALITY-LOOP-1: the loop around k_eff, closed inside the tick Worker. criticality.js measures; this file acts on the measurement and
// grades its own action, every tick, with no collector, workflow or person in the path:
//   beat      one criticality_history row per tick (the loop's clock; doctrine/clocks.json reads it)
//   act       k_eff under k_min for control.subcritical_ticks beats in a row -> the dispatch lever moves to 'raise-only': each role takes
//             an item that raises k_eff first (control.raises_id_prefixes / raises_kinds) and falls back to its full queue, so nothing starves
//   predict   the move is logged with "k_eff > <k at the move> within <N> h"
//   grade     when the prediction is due: hit -> the lever is kept; miss -> the lever is reverted, CRIT-LEVER-<day> is filed at the head
//             of the queue and the lever is not retried for control.cooldown_hours
//   release   k_eff back at or over k_min -> the lever returns to 'open' and the open prediction is graded hit
//   stall     subcritical and k_eff no higher than control.stall_ticks beats ago -> CRIT-STALL-<day> is filed at the head of the queue
// Thresholds come from autonomy/criticality.json (`control`), never from this file. A config without `control` leaves the lever open.
import { rankRows } from './pace.js';
import { tenantOf } from './tenant.js';  // Q-TENANT-row-isolation

async function all(db, sql, ...args) { return (await db.prepare(sql).bind(...args).all()).results || []; }
async function first(db, sql, ...args) { return (await db.prepare(sql).bind(...args).first()) || null; }
async function run(db, sql, ...args) { return db.prepare(sql).bind(...args).run(); }
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const ms = s => Date.parse(String(s).replace(' ', 'T') + 'Z');
const KEY = 'criticality_control';
export const OPEN = 'open', RAISE = 'raise-only';

export async function readControl(db) {
  const r = await first(db, `SELECT value FROM org WHERE key=?`, KEY);
  try { return r ? JSON.parse(r.value) : { mode: OPEN }; } catch { return { mode: OPEN }; }  // an unreadable lever reads as open: dispatch never blocks on it
}
const writeControl = (db, c) => run(db, `INSERT INTO org (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, KEY, JSON.stringify(c));

export const regimeOf = (k, t) => k < t.k_min ? 'subcritical' : k > t.k_max ? 'supercritical' : 'critical';

// Pure: does this item raise k_eff (a verified deploy or a cost cut), by the declared prefixes and kinds?
export function raisesK(item, c) {
  return (c.raises_id_prefixes || []).some(p => String(item.id).startsWith(p)) || (c.raises_kinds || []).includes(item.kind);
}

// The dispatch step's view of the lever: the role's next item under the current mode. Raising items first while the lever is 'raise-only';
// the role's ordinary head when none qualifies, so the queue cannot starve.
export async function pickForRole(db, role, t, rank = [], tenant = '') {  // Q-TENANT-row-isolation: only the runtime's own rows (tenant_id NULL or its slug) are ever picked
  const rows = rankRows(await all(db, `SELECT id, kind, priority FROM items WHERE status='ready' AND owner_role=?
      AND (project IS NULL OR project = ? OR ? IS NULL) AND (tenant_id IS NULL OR tenant_id = ?)
      AND id NOT IN (SELECT item_id FROM claims) ORDER BY priority, created_at LIMIT 50`, role.role, role.project, role.project, tenantOf(tenant)), rank);  // PACE-2: reach per cost within one priority
  if (!rows.length) return null;
  const c = t && t.control;
  if (!c || (await readControl(db)).mode !== RAISE) return rows[0];
  return rows.find(r => raisesK(r, c)) || rows[0];
}

async function act(db, c, at, from, to, reason, k, predictionHours) {
  const prediction = predictionHours ? `k_eff > ${k} within ${predictionHours} h` : null;
  await run(db, `INSERT INTO criticality_actions (at, lever, from_value, to_value, reason, k_at_action, prediction, due_at) VALUES (?,?,?,?,?,?,?,?)`,
    at, 'dispatch_mode', from, to, reason, k, prediction, predictionHours ? iso(ms(at) + predictionHours * 3600e3) : null);
  const id = (await first(db, `SELECT MAX(id) AS id FROM criticality_actions`)).id;
  await writeControl(db, { ...c, mode: to, since: at, action_id: id });
  return { id, from, to, reason, prediction };
}

// The step: called by criticalityStep after it measured `snap`. Returns what is merged into the published snapshot under `control`.
export async function controlStep(db, ctx, t, snap, ensureItem) {
  const c = t.control;
  if (!c) return { mode: OPEN, configured: false };
  const at = ctx.nowIso, k = snap.k_eff, regime = regimeOf(k, t);
  let ctl = await readControl(db), action = null, graded = null;

  // grade: the open prediction of the lever now in effect
  const open = await first(db, `SELECT * FROM criticality_actions WHERE result IS NULL AND prediction IS NOT NULL ORDER BY id DESC LIMIT 1`);
  if (open) {
    const hit = k > open.k_at_action;
    if (k >= t.k_min || (ms(at) >= ms(open.due_at) && hit)) {
      await run(db, `UPDATE criticality_actions SET graded_at=?, result='hit' WHERE id=?`, at, open.id);
      graded = { id: open.id, result: 'hit' };
    } else if (ms(at) >= ms(open.due_at)) {
      await run(db, `UPDATE criticality_actions SET graded_at=?, result='miss' WHERE id=?`, at, open.id);
      graded = { id: open.id, result: 'miss' };
      if (ctl.mode === RAISE) {
        action = await act(db, { ...ctl, blocked_until: iso(ms(at) + c.cooldown_hours * 3600e3) }, at, RAISE, OPEN, 'prediction missed: lever reverted', k, null);
        ctl = await readControl(db);
        await ensureItem(db, { id: `CRIT-LEVER-${at.slice(0, 10)}`, kind: 'fix', owner_role: c.owner_role, priority: t.origination.head_priority,
          title: `Criticality lever missed: raise-only dispatch did not lift k_eff above ${open.k_at_action} in ${c.prediction_hours} h (now ${k}). Find the largest spender with no verified deploy and cut it.`.slice(0, 400),
          done_check: `k_eff > ${open.k_at_action}`, closing_probe: 'criticality:lever' });
      }
    }
  }

  // act: move the lever on the measured regime
  if (!action) {
    if (regime !== 'subcritical' && ctl.mode === RAISE) {
      action = await act(db, ctl, at, RAISE, OPEN, 'k_eff at or over k_min: lever released', k, null);
    } else if (regime === 'subcritical' && ctl.mode !== RAISE && !(ctl.blocked_until && ms(at) < ms(ctl.blocked_until))) {
      const last = await all(db, `SELECT k_eff FROM criticality_history ORDER BY id DESC LIMIT ?`, Math.max(c.subcritical_ticks - 1, 0));
      if (last.length >= c.subcritical_ticks - 1 && last.every(r => r.k_eff < t.k_min))
        action = await act(db, ctl, at, OPEN, RAISE, `k_eff under k_min for ${c.subcritical_ticks} beats`, k, c.prediction_hours);
    }
    if (action) ctl = await readControl(db);
  }

  // stall: subcritical and no higher than stall_ticks beats ago
  const back = await first(db, `SELECT k_eff FROM criticality_history ORDER BY id DESC LIMIT 1 OFFSET ?`, Math.max(c.stall_ticks - 1, 0));
  const stalled = regime === 'subcritical' && Boolean(back) && k <= back.k_eff;
  if (stalled) await ensureItem(db, { id: `CRIT-STALL-${at.slice(0, 10)}`, kind: 'fix', owner_role: c.owner_role, priority: t.origination.head_priority,
    title: `Criticality stalled: k_eff ${k} has not risen in ${c.stall_ticks} beats (min ${t.k_min}). Ship one verified deploy or remove one spender, then re-measure.`.slice(0, 400),
    done_check: `k_eff > ${back.k_eff}`, closing_probe: 'criticality:stall' });

  // beat: the loop's own clock, then prune
  await run(db, `INSERT INTO criticality_history (tick_id, at, k_eff, regime, mode, credited_deploys, spend_units, open_ignition_gaps, stalled) VALUES (?,?,?,?,?,?,?,?,?)`,
    ctx.tickId, at, k, regime, ctl.mode, snap.credited_deploys || 0, snap.spend_units || 0, snap.open_ignition_gaps || 0, stalled ? 1 : 0);
  await run(db, `DELETE FROM criticality_history WHERE at < ?`, iso(ms(at) - c.history_keep_days * 86400e3));
  const beats = await first(db, `SELECT COUNT(*) AS n FROM criticality_history WHERE at >= ?`, iso(ms(at) - 86400e3));
  return { configured: true, mode: ctl.mode, since: ctl.since || null, regime, stalled, beats_24h: beats.n, action, graded,
    blocked_until: ctl.blocked_until && ms(at) < ms(ctl.blocked_until) ? ctl.blocked_until : null };
}

// The loop's health, for /metrics/criticality.json and the live probe: is the clock beating, what is the lever, how did its predictions grade.
export async function loopHealth(db, t, now) {
  const last = await first(db, `SELECT at, k_eff, regime, mode, stalled FROM criticality_history ORDER BY id DESC LIMIT 1`);
  const g = await first(db, `SELECT SUM(result='hit') AS hit, SUM(result='miss') AS miss, SUM(result IS NULL AND prediction IS NOT NULL) AS open FROM criticality_actions`);
  const age = last ? Math.round((now - ms(last.at)) / 1000) : null;
  const max = ((t && t.control && t.control.beat_interval_s) || 600) * 2;
  return { beating: age !== null && age <= max, last_beat: last ? last.at : null, age_s: age, max_age_s: max, mode: last ? last.mode : OPEN,
    regime: last ? last.regime : null, stalled: last ? Boolean(last.stalled) : false,
    predictions: { hit: (g && g.hit) || 0, miss: (g && g.miss) || 0, open: (g && g.open) || 0 } };
}
