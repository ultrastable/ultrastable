// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The ladder layers around the cascade (US-SPEC-09 section 4): L0 deterministic handlers (no model call), L4 an ensemble that
// samples only free or cached components, and L7 the budget scheduler with its degradation order (cache, free tier, cheaper paid
// rung, queue for the next window) and the re-offer of queued tasks. Every answer records a ladder_attempts row, so cost per
// verified outcome counts all layers. The seed's `doer` (seed/worker/src/doer.js) is the reference L0: rules first, a model last.
import { iso, msOf, all, first, run } from './util.js';
import { recordAttempt } from './index.js';

// ---- L0: deterministic handlers ----

/** A registry of handlers per task class. A handler returns { output, ok? } to answer, or undefined / null to pass the task on. */
export function createL0(db, { now = Date.now } = {}) {
  const handlers = new Map();
  return {
    register(task_class, fn) { if (typeof fn !== 'function') throw new Error('an L0 handler is a function'); handlers.set(task_class, fn); },
    has: task_class => handlers.has(task_class),
    /** { answered: true, layer: 'L0', output, cost: 0 } with no model call, or { answered: false }. */
    async answer({ task_id, task_class, input }) {
      const h = handlers.get(task_class);
      if (!h) return { answered: false };
      let r;
      try { r = await h(input); } catch (e) { return { answered: false, error: String(e?.message || e).slice(0, 160) }; }
      if (r === undefined || r === null) return { answered: false };
      const ok = r.ok !== false;
      await recordAttempt(db, { task_id, task_class, layer: 'L0', model: null, cost: 0, verified: ok, signal: ok ? null : (r.signal || 'schema') }, iso(msOf(now)));
      return { answered: true, layer: 'L0', output: r.output, cost: 0, verified: ok };
    },
  };
}

// ---- L4: an ensemble that never spends ----

/**
 * Sample `n` answers across `components` ([{ model, unit_cost, cached? }]) only when every component is free or served from cache;
 * otherwise refuse with 'ensemble_not_free'. The most common validated answer wins; `agreement` is its share of the valid answers.
 */
export async function ensembleSample(db, { task_id, task_class, components, n = 3, run: runModel, validate }, { now = Date.now } = {}) {
  if (!components?.length) return { ok: false, refusal: 'no_components' };
  if (!components.every(c => c.unit_cost === 0 || c.cached === true)) return { ok: false, refusal: 'ensemble_not_free' };
  const votes = new Map(); let valid = 0;
  for (let i = 0; i < n; i++) {
    const c = components[i % components.length];
    let out = null, v;
    try { out = await runModel(c, i); v = validate(out.output); } catch (e) { v = { ok: false, signal: 'provider_error' }; }
    await recordAttempt(db, { task_id, task_class, layer: 'L4', model: c.model, cost: 0, verified: v.ok, signal: v.ok ? null : v.signal }, iso(msOf(now)));
    if (!v.ok) continue;
    const key = JSON.stringify(out.output), cur = votes.get(key) || { output: out.output, n: 0 };
    cur.n++; votes.set(key, cur); valid++;
  }
  if (!valid) return { ok: false, refusal: 'no_valid_answer', samples: n };
  const win = [...votes.values()].sort((a, b) => b.n - a.n)[0];
  return { ok: true, output: win.output, agreement: win.n / valid, valid, samples: n };
}

// ---- L7: the budget scheduler ----

const dayStart = t => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };

/**
 * Daily cap per task class and for the organization, read from ladder_attempts. `config = { classes: { <class>: { daily_usd } },
 * org_daily_usd }`. `available = { cache, free, cheaper }` says which degradation steps exist for this task. Returns
 * { capBreached, scope, spent, degrade, queue_until }: `degrade` is the first available step of the order cache, free, cheaper,
 * queue (a cap never ends a task while a path exists, US-09-R07); `queue_until` is the next UTC midnight.
 */
export async function budgetScheduler({ db, now = Date.now, config = {}, task_class, available = {} }) {
  const t = msOf(now), since = iso(dayStart(t));
  const cls = (await first(db, `SELECT COALESCE(SUM(cost),0) AS usd FROM ladder_attempts WHERE task_class = ? AND at >= ?`, task_class, since)).usd;
  const org = (await first(db, `SELECT COALESCE(SUM(cost),0) AS usd FROM ladder_attempts WHERE at >= ?`, since)).usd;
  const capCls = config.classes?.[task_class]?.daily_usd, capOrg = config.org_daily_usd;
  const scope = capCls != null && cls >= capCls ? 'class' : capOrg != null && org >= capOrg ? 'org' : null;
  if (!scope) return { capBreached: false, scope: null, spent: { class: cls, org }, degrade: null, queue_until: null };
  const degrade = ['cache', 'free', 'cheaper'].find(k => available[k]) || 'queue';
  return { capBreached: true, scope, spent: { class: cls, org }, degrade, queue_until: iso(dayStart(t) + 86400000) };
}

/** Store a task for the next window (degradation order, last step). Idempotent by task id. */
export async function queueNextWindow(db, { task_id, task_class, payload = null, not_before }, { now = Date.now } = {}) {
  const t = msOf(now);
  await run(db, `INSERT OR IGNORE INTO ladder_queue (task_id, task_class, payload, queued_at, not_before, status) VALUES (?,?,?,?,?,'queued')`,
    task_id, task_class, payload == null ? null : JSON.stringify(payload), iso(t), not_before || iso(dayStart(t) + 86400000));
}

/** Tasks whose window has opened: marked offered once and returned, oldest first. */
export async function reofferQueued(db, { now = Date.now } = {}) {
  const rows = await all(db, `SELECT * FROM ladder_queue WHERE status = 'queued' AND not_before <= ? ORDER BY queued_at, task_id`, iso(msOf(now)));
  for (const r of rows) await run(db, `UPDATE ladder_queue SET status = 'offered' WHERE task_id = ?`, r.task_id);
  return rows.map(r => ({ task_id: r.task_id, task_class: r.task_class, payload: r.payload ? JSON.parse(r.payload) : null, queued_at: r.queued_at }));
}
