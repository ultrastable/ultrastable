// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// GOALS-1 (Rowan, 2026-11-18): the system sets its own targets and turns its own knobs. "What are you working toward? What is your target? What goals, big or
// small, with knobs it can fiddle to reach them?" This module is tenant-agnostic core. It holds
//   goals    a hierarchy (mission > objective > target). A target has a metric, an op, a number and a deadline.
//   knobs    bounded parameters that may move a goal (loop stride, cadence, volume, breadth). A knob has min, max, step, a cooldown and the sign of its effect.
//   control  each tick: read every goal, sample it, and, for a goal that is off target, move at most one of its knobs one step toward it; log the change with its
//            prediction in the hash-chained audit log; after review_h compare the goal with the baseline and keep the change or revert it (a reverted direction rests).
//            A goal that stays met for achieve_after readings proposes one stretch goal; a system or tenant goal with no reading for stale_days is retired; a goal off
//            target with no knob able to move it (none, at a bound, resting) files a backlog item that closes itself when the goal is met.
// Tenants (Practical Solutions first) register their own goals and knobs through POST /api/goals/register and report readings with POST /api/goals/report; they read
// their knob values from GET /api/goals/knobs?tenant=<id> and apply them in their own code. Tenant-specific configuration stays in the tenant; core stores only
// ids, bounds and values. Config: seed/autonomy/goals.json (config.goals). Page: /goals on the site, data at /api/goals.
import { record } from './auditchain.js';
import { beatStats24h } from './beatstats.js';  // READ-BUDGET-9
import { dampedCooldown, errorBudget } from './control.js';  // CONTROL-1: knob damping, goal error budgets
import { nextTrial, upsets, accessibility, reducibility, searchBudget, jointRest, cylindrance, protocol, variety, transmission } from './ashby.js';  // ASHBY-KERNEL-1
import { varietyReading, OWN_ITEM } from './regulation.js';  // ASHBY-KERNEL-1: requisite variety read from the work queue
export const DDL = [
  `CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, tenant TEXT NOT NULL DEFAULT 'core', parent_id TEXT, level TEXT NOT NULL, statement TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'none', spec TEXT, unit TEXT, op TEXT, target REAL, deadline TEXT, status TEXT NOT NULL DEFAULT 'active', origin TEXT NOT NULL DEFAULT 'seed', last_value REAL, last_at INTEGER, met INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0, achieved_at INTEGER, stretch_id TEXT, missed_at INTEGER, retired_reason TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS goals_tenant ON goals (tenant, status)`,
  `CREATE TABLE IF NOT EXISTS goal_samples (goal_id TEXT NOT NULL, at INTEGER NOT NULL, value REAL NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS goal_samples_goal_at ON goal_samples (goal_id, at)`,
  `CREATE INDEX IF NOT EXISTS goal_samples_at ON goal_samples (at)`,  // READ-BUDGET-9: the step's own prune (DELETE ... WHERE at < ?) walked every sample; (goal_id, at) cannot answer a range on at alone
  `CREATE TABLE IF NOT EXISTS goal_knobs (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, tenant TEXT NOT NULL DEFAULT 'core', what TEXT, config_path TEXT, value REAL NOT NULL, default_value REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL, step REAL NOT NULL, effect INTEGER NOT NULL DEFAULT 1, cooldown_h REAL NOT NULL DEFAULT 24, review_h REAL NOT NULL DEFAULT 24, last_changed_at INTEGER, hold_dir INTEGER, hold_until INTEGER)`,
  `CREATE TABLE IF NOT EXISTS goal_adjustments (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, knob_id TEXT NOT NULL, goal_id TEXT NOT NULL, old REAL NOT NULL, new REAL NOT NULL, why TEXT, prediction TEXT, baseline REAL, review_after INTEGER NOT NULL, reviewed_at INTEGER, kept INTEGER, measured REAL)`,
  `CREATE INDEX IF NOT EXISTS goal_adjustments_at ON goal_adjustments (at)`,
  // ASHBY-KERNEL-1: one row for each variable a step upset. exonerated NULL = the undo is still being read (checked_at is set once the first review
  // period has passed); 0 = the variable came back when the step was undone (confirmed); 1 = it stayed out for stale_days, or was retired, so the
  // step is cleared; 2 = it came back but its own knob had moved meanwhile, so nothing is shown either way.
  `CREATE TABLE IF NOT EXISTS goal_interference (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, adjustment_id INTEGER, knob_id TEXT NOT NULL, goal_id TEXT NOT NULL, upset_goal TEXT NOT NULL, dir INTEGER NOT NULL DEFAULT 0, check_after INTEGER NOT NULL, exonerated INTEGER, checked_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS goal_interference_open ON goal_interference (exonerated, check_after)`,
  `CREATE INDEX IF NOT EXISTS goal_interference_goal ON goal_interference (goal_id, at)`,
];
const ensured = new WeakSet();
export async function ensure(db) { if (ensured.has(db)) return; for (const s of DDL) await db.prepare(s).run(); ensured.add(db); }
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '=': (a, b) => a === b };
export const LEVELS = ['mission', 'objective', 'target'];
export const DEFAULTS = { stale_days: 14, achieve_after: 12, max_adjust_per_run: 3, max_stretch_per_day: 2, keep_samples_days: 30, tenant_limits: { goals: 40, knobs: 80 },
  veto: { hold: 3, confirm: 2, lookback_h: 6 },  // ASHBY-KERNEL-1: a variable holds after 3 readings inside its limits and is upset after 2 outside them
  forget_days: 30 };  // a value that failed is not tried again for this long, or until a change is kept
const cfgOf0 = c => ({ ...DEFAULTS, ...((c && c.control) || {}) });
const cfgOf = c => { const o = cfgOf0(c); return { ...o, veto: { ...DEFAULTS.veto, ...(o.veto || {}) } }; };
const ID = /^[a-z0-9][a-z0-9._+-]{1,60}$/;
const needOf = op => (op === '>=' || op === '>') ? 1 : (op === '<=' || op === '<') ? -1 : 0;
const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v))) ? null : Number(v);

// ---- registration (seed file and the tenant interface) ----
async function upsertGoal(db, g, tenant, origin, now) {
  const ex = await first(db, 'SELECT id, tenant FROM goals WHERE id=?', g.id);
  if (ex && ex.tenant !== tenant) return { id: g.id, skipped: 'id belongs to another tenant' };
  if (ex) { await run(db, `UPDATE goals SET statement=?, parent_id=?, level=?, source=?, spec=?, unit=?, op=?, target=?, deadline=? WHERE id=? AND origin != 'system'`,
    g.statement, g.parent_id || null, g.level, g.source || 'none', g.spec || null, g.unit || null, g.op || null, num(g.target), g.deadline || null, g.id); return { id: g.id, updated: true }; }
  await run(db, `INSERT INTO goals (id, tenant, parent_id, level, statement, source, spec, unit, op, target, deadline, origin, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    g.id, tenant, g.parent_id || null, g.level, g.statement, g.source || 'none', g.spec || null, g.unit || null, g.op || null, num(g.target), g.deadline || null, origin, now);
  return { id: g.id, created: true };
}
async function upsertKnob(db, k, tenant, now) {
  const ex = await first(db, 'SELECT id, tenant FROM goal_knobs WHERE id=?', k.id);
  if (ex && ex.tenant !== tenant) return { id: k.id, skipped: 'id belongs to another tenant' };
  if (ex) { await run(db, `UPDATE goal_knobs SET goal_id=?, what=?, config_path=?, min=?, max=?, step=?, effect=?, cooldown_h=?, review_h=? WHERE id=?`,
    k.goal_id, k.what || null, k.config_path || null, k.min, k.max, k.step, k.effect < 0 ? -1 : 1, k.cooldown_h ?? 24, k.review_h ?? 24, k.id);
    await run(db, `UPDATE goal_knobs SET value=MIN(MAX(value, min), max) WHERE id=?`, k.id); return { id: k.id, updated: true }; }
  await run(db, `INSERT INTO goal_knobs (id, goal_id, tenant, what, config_path, value, default_value, min, max, step, effect, cooldown_h, review_h) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    k.id, k.goal_id, tenant, k.what || null, k.config_path || null, k.value, k.value, k.min, k.max, k.step, k.effect < 0 ? -1 : 1, k.cooldown_h ?? 24, k.review_h ?? 24);
  return { id: k.id, created: true };
}
export function validate(body, tenant, lim = DEFAULTS.tenant_limits) {
  const errs = [], goals = Array.isArray(body && body.goals) ? body.goals : [], knobs = Array.isArray(body && body.knobs) ? body.knobs : [];
  if (goals.length > lim.goals) errs.push(`at most ${lim.goals} goals`); if (knobs.length > lim.knobs) errs.push(`at most ${lim.knobs} knobs`);
  const gid = new Set(goals.map(g => g && g.id));
  for (const g of goals) {
    if (!g || !ID.test(String(g.id)) || !String(g.id).startsWith(tenant + '.')) errs.push(`goal id must be "${tenant}.<name>": ${g && g.id}`);
    else if (!LEVELS.includes(g.level)) errs.push(`${g.id}: level must be one of ${LEVELS.join(', ')}`);
    else if (!String(g.statement || '').trim()) errs.push(`${g.id}: statement is required`);
    else if (g.level === 'target' && (!OPS[g.op] || num(g.target) === null || !['tenant', 'url'].includes(g.source || 'tenant'))) errs.push(`${g.id}: a target needs op, target and source tenant (the tenant reports readings)`);
    else if (g.parent_id && !gid.has(g.parent_id) && !String(g.parent_id).startsWith(tenant + '.') && !String(g.parent_id).startsWith('core.')) errs.push(`${g.id}: parent must be a ${tenant}. or core. goal`);
  }
  for (const k of knobs) {
    if (!k || !ID.test(String(k.id)) || !String(k.id).startsWith(tenant + '.')) errs.push(`knob id must be "${tenant}.<name>": ${k && k.id}`);
    else if (![k.min, k.max, k.step, k.value].every(v => num(v) !== null) || !(k.min <= k.value && k.value <= k.max) || !(k.step > 0)) errs.push(`${k.id}: min <= value <= max and step > 0 are required`);
    else if (!gid.has(k.goal_id) && !String(k.goal_id || '').startsWith(tenant + '.')) errs.push(`${k.id}: goal_id must be one of the tenant's goals`);
  }
  return errs;
}
export async function seedGoals(db, cfg, { now = Date.now() } = {}) {
  await ensure(db); let n = 0;
  for (const g of (cfg && cfg.goals) || []) { await upsertGoal(db, g, 'core', 'seed', now); n++; }
  for (const k of (cfg && cfg.knobs) || []) { await upsertKnob(db, k, 'core', now); n++; }
  return n;
}
export async function registerTenant(db, tenant, body, { now = Date.now(), limits } = {}) {
  if (!/^[a-z0-9-]{2,32}$/.test(String(tenant)) || tenant === 'core') return { ok: false, errors: ['tenant must be 2-32 lowercase letters, digits or dashes and not "core"'] };
  const errs = validate(body, tenant, limits); if (errs.length) return { ok: false, errors: errs };
  await ensure(db); const out = [];
  for (const g of body.goals || []) out.push(await upsertGoal(db, { ...g, source: g.level === 'target' ? (g.source || 'tenant') : 'none' }, tenant, 'tenant', now));
  for (const k of body.knobs || []) out.push(await upsertKnob(db, k, tenant, now));
  const created = out.filter(x => x.created).length;
  if (created) await record(db, { kind: 'goals.register', actor: 'tenant:' + tenant, ref: tenant, summary: `${tenant} registered ${created} new goals or knobs (${(body.goals || []).length} goals and ${(body.knobs || []).length} knobs offered)`, data: { tenant } }, { now });  // only a change is audited, not every re-read of the same feed
  return { ok: true, tenant, registered: out, created };
}
export async function reportReadings(db, tenant, readings, { now = Date.now() } = {}) {
  await ensure(db); const out = {};
  for (const [id, raw] of Object.entries(readings || {}).slice(0, 80)) {
    const v = num(raw); const g = await first(db, `SELECT id, source FROM goals WHERE id=? AND tenant=? AND status != 'retired'`, id, tenant);
    if (!g || v === null || !['tenant', 'url'].includes(g.source)) { out[id] = 'ignored'; continue; }
    await run(db, 'UPDATE goals SET last_value=?, last_at=? WHERE id=?', v, now, id); out[id] = 'recorded';
  }
  return out;
}
export async function knobValues(db, tenant) {
  await ensure(db);
  const rows = await all(db, 'SELECT id, value, default_value, min, max, config_path FROM goal_knobs WHERE tenant=?', tenant);
  return Object.fromEntries(rows.map(r => [r.id, { value: r.value, default: r.default_value, min: r.min, max: r.max, config_path: r.config_path }]));
}
// A copy of config with every core knob that names a config_path ("pace.idle_runs") applied. The tick reads this, so a knob turns a real parameter.
export async function withKnobs(db, config, tenant = 'core') {
  let rows = []; try { await ensure(db); rows = await all(db, `SELECT value, config_path FROM goal_knobs WHERE tenant=? AND config_path IS NOT NULL`, tenant); } catch (e) { console.error('goals: knobs unread:', e && e.message); return config; }
  if (!rows.length) return config;
  const out = { ...config };
  for (const r of rows) { const [a, b] = String(r.config_path).split('.'); if (a && b) out[a] = { ...(out[a] || {}), [b]: r.value }; }
  return out;
}

// A tenant may publish its goals as a public JSON feed instead of calling POST /api/goals/register, so it needs no credential for core at all:
// { tenant, goals, knobs, readings }. Core reads each feed named in config.tenant_feeds (one fetch each, 8 s, 64 KB), registers it under the same rules and records its readings.
export async function pullFeeds(db, feeds, { fetchFn = fetch, now = Date.now() } = {}) {
  const out = {};
  for (const f of (feeds || []).slice(0, 8)) {
    try {
      const res = await fetchFn(f.url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) { out[f.tenant] = `http ${res.status}`; continue; }
      const text = await res.text(); if (text.length > 65536) { out[f.tenant] = 'feed over 64 KB'; continue; }
      const body = JSON.parse(text);
      if (body.tenant !== f.tenant) { out[f.tenant] = 'feed names another tenant'; continue; }
      const reg = await registerTenant(db, f.tenant, body, { now });
      if (!reg.ok) { out[f.tenant] = 'rejected: ' + reg.errors.slice(0, 2).join('; '); continue; }
      out[f.tenant] = { registered: reg.created, readings: Object.values(await reportReadings(db, f.tenant, body.readings, { now })).filter(x => x === 'recorded').length };
    } catch (e) { out[f.tenant] = 'unreadable: ' + String(e && e.message).slice(0, 80); }
  }
  return out;
}

// ---- reading and trend ----
export async function readGoal(db, g, { builtins = {}, now = Date.now(), stale_days = DEFAULTS.stale_days } = {}) {
  if (g.source === 'builtin') { const f = builtins[g.spec]; if (!f) return null; const v = Number(await f(db, now)); return Number.isFinite(v) ? v : null; }
  if (g.source === 'metric') { const m = await first(db, 'SELECT last_value, last_at FROM metrics WHERE id=?', g.spec); return m && m.last_value != null ? Number(m.last_value) : null; }
  if (g.source === 'tenant' || g.source === 'url') return g.last_at && now - g.last_at <= stale_days * 86400e3 && g.last_value != null ? Number(g.last_value) : null;
  return null;
}
export function trend(samples) {  // samples oldest first: [{at, value}]; slope per day by least squares, verdict against the goal's need
  const s = samples.slice(-24); if (s.length < 3) return { slope_per_day: null, n: s.length };
  const t0 = s[0].at, xs = s.map(p => (p.at - t0) / 86400e3), ys = s.map(p => p.value), n = s.length, mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0); if (den === 0) return { slope_per_day: null, n };
  return { slope_per_day: Math.round(1e6 * xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den) / 1e6, n };
}
const eps = g => 0.01 * Math.max(Math.abs(g.target || 0), 0.01);

// ASHBY-KERNEL-1: the variables of the same tenant that were holding inside their limits before the step at a.at and have left them since.
async function vetoers(db, g, a, c) {
  const rows = await all(db, `SELECT s.goal_id, s.at, s.value, o.op, o.target FROM goal_samples s JOIN goals o ON o.id = s.goal_id WHERE s.at >= ? AND o.tenant = ? AND o.status = 'active' AND o.level = 'target' AND o.id != ? ORDER BY s.at`, a.at - c.veto.lookback_h * 3600e3, g.tenant, g.id);
  const series = {};
  for (const r of rows) if (OPS[r.op]) (series[r.goal_id] ||= []).push({ at: r.at, ok: OPS[r.op](r.value, r.target) });
  return upsets({ at: a.at, own: g.id }, series, c.veto);
}

// ---- the control loop ----
export async function goalsStep(db, ctx, cfg, { builtins = {}, ensureItem = null } = {}) {
  await ensure(db); const c = cfgOf(cfg), now = ctx.now || Date.now(), out = { read: 0, met: 0, off: 0, adjusted: [], reviewed: [], stretch: [], retired: [], filed: [], vetoed: [], settled: [] };
  if (cfg) await seedGoals(db, cfg, { now });
  if (cfg && cfg.tenant_feeds && cfg.tenant_feeds.length) out.feeds = await pullFeeds(db, cfg.tenant_feeds, { fetchFn: ctx.fetch || (ctx.env && ctx.env.fetch) || fetch, now });
  // ASHBY-KERNEL-1: settle each veto, before any step-function moves in this tick. For one review period after the undo the step-function does not
  // move, so the undo is read alone. If the upset variable is back inside its limits then, or at any reading in the stale_days after (a metric over a
  // rolling window cannot return in a day), the step was the cause: its direction rests for a week and the step-function is offered less readily.
  // If the variable's own knob moved in between, nothing is shown (confounded) and the value stays rejected for the episode. If the variable never
  // returns, or is retired, the step is cleared and its value may be tried again.
  for (const i of await all(db, `SELECT i.*, u.met AS umet, u.last_at AS uat, u.status AS ustatus FROM goal_interference i LEFT JOIN goals u ON u.id = i.upset_goal WHERE i.exonerated IS NULL AND i.check_after <= ?`, now)) {
    const gone = i.ustatus !== 'active', expired = now - i.at > c.stale_days * 86400e3, read = i.uat > i.at;
    let verdict = null;
    if (gone || (expired && !(read && i.umet === 1))) verdict = 1;
    else if (read && i.umet === 1) verdict = (await first(db, 'SELECT COUNT(*) AS n FROM goal_adjustments WHERE goal_id=? AND at > COALESCE((SELECT at FROM goal_adjustments WHERE id=?), ?)', i.upset_goal, i.adjustment_id, i.at)).n ? 2 : 0;  // any move of the variable's own knob since the step
    if (verdict === null) { if (read && i.checked_at == null) await run(db, 'UPDATE goal_interference SET checked_at=? WHERE id=?', now, i.id); continue; }
    await run(db, 'UPDATE goal_interference SET exonerated=?, checked_at=? WHERE id=?', verdict, now, i.id);
    if (verdict === 0) await run(db, 'UPDATE goal_knobs SET hold_dir=?, hold_until=? WHERE id=?', i.dir, now + 7 * 86400e3, i.knob_id);
    const said = verdict === 0 ? 'confirmed, the variable returned inside its limits once the step was undone' : verdict === 2 ? 'not shown, the variable returned but its own knob had moved meanwhile' : gone ? 'cleared, the variable is no longer read' : `cleared, the variable stayed outside its limits for ${c.stale_days} days after the step was undone`;
    await record(db, { kind: 'goal.veto.settled', actor: 'goals', ref: i.knob_id, summary: `${i.knob_id} and ${i.upset_goal}: ${said}`, data: { goal: i.goal_id, upset: i.upset_goal, confirmed: verdict === 0, verdict } }, { now });
    out.settled.push({ knob: i.knob_id, upset: i.upset_goal, confirmed: verdict === 0, ...(verdict === 2 ? { confounded: true } : {}) });
  }
  // PEREZ-LOPEZ-1: essential variables come before the objective. Essential goals are read first; while one is off target,
  // no other goal may move a knob this pass (seed/scripts/perezlopez.py admit()).
  const ess = new Set(c.essential || []);
  const goals = (await all(db, `SELECT * FROM goals WHERE status='active' AND level='target'`)).sort((a, b) => ess.has(b.id) - ess.has(a.id));
  let adjusts = 0, evBreach = [];
  for (const g of goals) {
    const v = await readGoal(db, g, { builtins, now, stale_days: c.stale_days });
    if (v === null) {  // no reading: retire a system or tenant goal that has had none for stale_days; a seed goal files its own item
      const since = g.last_at || g.created_at;
      if (now - since > c.stale_days * 86400e3) {
        if (g.origin !== 'seed') { await run(db, `UPDATE goals SET status='retired', retired_reason=? WHERE id=?`, `no reading for ${c.stale_days} days`, g.id); out.retired.push(g.id); await record(db, { kind: 'goal.retire', actor: 'goals', ref: g.id, summary: `retired ${g.id}: no reading for ${c.stale_days} days`, data: { origin: g.origin } }, { now }); }
        else if (ensureItem) { const f = await ensureItem(db, { id: `GOAL-NOREAD-${g.id}`.slice(0, 80), kind: 'fix', priority: 5, owner_role: 'operations', title: `Goal ${g.id} has had no reading for ${c.stale_days} days. Restore its probe (${g.source}: ${g.spec || 'reported by the tenant'}).`.slice(0, 400), done_check: `goal ${g.id} has a reading`, closing_probe: `SELECT COUNT(*) FROM goals WHERE id='${g.id}' AND last_at > ${now - 86400e3}` }); if (f) out.filed.push(`GOAL-NOREAD-${g.id}`); }
      }
      continue;
    }
    out.read++;
    await run(db, 'INSERT INTO goal_samples (goal_id, at, value) VALUES (?,?,?)', g.id, now, v);
    const need = needOf(g.op), met = OPS[g.op] ? OPS[g.op](v, g.target) : false;
    const streak = met ? g.streak + 1 : 0;
    await run(db, 'UPDATE goals SET last_value=?, last_at=?, met=?, streak=? WHERE id=?', v, now, met ? 1 : 0, streak, g.id);
    met ? out.met++ : out.off++;
    if (!met && ess.has(g.id)) evBreach.push(g.id);
    // review: the last unreviewed change of each knob of this goal, once its review time has passed
    const due = await all(db, `SELECT a.*, k.value AS kval, k.cooldown_h, k.review_h AS krev, k.effect AS keff, k.hold_dir AS khold, k.hold_until AS kuntil FROM goal_adjustments a JOIN goal_knobs k ON k.id = a.knob_id WHERE a.goal_id=? AND a.reviewed_at IS NULL AND a.review_after <= ?`, g.id, now);
    for (const a of due) {
      const improved = met || (need !== 0 && need * (v - a.baseline) > eps(g));
      // ASHBY-KERNEL-1: every essential variable holds a veto. A step that moved its own goal but knocked out a variable that was holding is undone,
      // and the undo is itself a trial: the upset variable is read again after one review period (settled below).
      const veto = improved && a.kval === a.new ? await vetoers(db, g, a, c) : [];
      const kept = improved && !veto.length, sdir = Math.sign(a.new - a.old);
      if (!kept) {
        // A step in the declared direction that failed rests that direction for a week; a vetoed step rests its direction until the veto is settled.
        // A failed step on the searched side is remembered by its value alone, so it does not wipe out a rest that is still running.
        const rests = veto.length || sdir === need * (a.keff < 0 ? -1 : 1) || !(a.khold && a.kuntil && now < a.kuntil);
        if (a.kval === a.new) await run(db, 'UPDATE goal_knobs SET value=?, last_changed_at=?, hold_dir=?, hold_until=? WHERE id=?', a.old, now, rests ? sdir : a.khold, rests ? now + (veto.length ? Math.max(a.krev, 1) * 3600e3 : 7 * 86400e3) : a.kuntil, a.knob_id);
        await run(db, 'UPDATE goal_adjustments SET reviewed_at=?, kept=0, measured=? WHERE id=?', now, v, a.id);
      } else await run(db, 'UPDATE goal_adjustments SET reviewed_at=?, kept=1, measured=? WHERE id=?', now, v, a.id);
      for (const u of veto) await run(db, 'INSERT INTO goal_interference (at, adjustment_id, knob_id, goal_id, upset_goal, dir, check_after) VALUES (?,?,?,?,?,?,?)', now, a.id, a.knob_id, g.id, u, sdir, now + Math.max(a.krev, 1) * 3600e3);
      if (veto.length) { out.vetoed.push({ knob: a.knob_id, goal: g.id, upset: veto }); await record(db, { kind: 'goal.veto', actor: 'goals', ref: a.knob_id, summary: `${a.knob_id} change ${a.old} -> ${a.new} undone: it moved ${g.id} (${a.baseline} -> ${v}) and ${veto.join(', ')} left its limits; ${veto.join(', ')} returns inside its limits within ${Math.max(a.krev, 1)} h`, data: { goal: g.id, upset: veto } }, { now }); }
      await record(db, { kind: 'goal.review', actor: 'goals', ref: g.id, summary: `${a.knob_id} change ${a.old} -> ${a.new} ${kept ? 'kept' : 'reverted'}: ${g.id} ${a.baseline} -> ${v}`, data: { knob: a.knob_id, kept } }, { now });
      out.reviewed.push({ knob: a.knob_id, kept });
    }
    // item that closes itself
    const itemId = `GOAL-${g.id}`.slice(0, 80);
    if (met) { await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, `fixed: goal ${g.id} met (${v} ${g.op} ${g.target})`, ctx.nowIso || new Date(now).toISOString(), itemId).catch(() => {}); }
    const knobs = await all(db, 'SELECT * FROM goal_knobs WHERE goal_id=?', g.id);
    if (!met && need !== 0) {
      let moved = false, searching = false;
      const pending = await first(db, `SELECT COUNT(*) AS n FROM goal_adjustments WHERE goal_id=? AND reviewed_at IS NULL`, g.id);
      const held = evBreach.length && !ess.has(g.id);
      if (held) (out.held ||= []).push({ goal: g.id, essential_off: evBreach.slice() });
      if (!held && !(pending && pending.n) && adjusts < c.max_adjust_per_run) {
        const cand = [];
        const recent = await all(db, `SELECT id, knob_id, at, old, new, kept FROM goal_adjustments WHERE goal_id=? AND at >= ? ORDER BY at`, g.id, now - 90 * 86400e3);
        // ASHBY-KERNEL-1: the step-function search. The episode runs from the last change that was kept and is forgotten when no trial has been made
        // for forget_days: a value that failed in it is not tried again, a step cleared of every upset is, a step-function whose undo is still
        // being read alone does not move, and one with confirmed upsets is offered less readily.
        const inter = await all(db, `SELECT adjustment_id, knob_id, exonerated, checked_at FROM goal_interference WHERE goal_id=? AND at >= ?`, g.id, now - 90 * 86400e3);
        const verdicts = new Map(); for (const i of inter) verdicts.set(i.adjustment_id, [...(verdicts.get(i.adjustment_id) || []), i.exonerated]);
        const cleared = new Set([...verdicts].filter(([, v]) => v.every(x => x === 1)).map(([id]) => id));
        const lastKept = Math.max(0, ...recent.filter(m => m.kept === 1).map(m => m.at)), lastTrial = Math.max(0, ...recent.map(m => m.at));
        const episode = now - lastTrial <= c.forget_days * 86400e3 ? recent.filter(m => m.kept === 0 && m.at > lastKept && !cleared.has(m.id)) : [];
        for (const k of knobs) {
          if (inter.some(i => i.knob_id === k.id && i.exonerated == null && i.checked_at == null)) continue;  // its undo is being read alone
          const mine = recent.filter(m => m.knob_id === k.id);
          const damp = dampedCooldown(k.cooldown_h, mine.filter(m => m.kept !== 0 && m.at >= now - 30 * 86400e3));  // CONTROL-1: a knob whose kept changes chatter slows down; a trial that failed left no change
          if (k.last_changed_at && now - k.last_changed_at < damp.cooldown_h * 3600e3) { if (damp.damped) (out.damped ||= []).push({ knob: k.id, reversals: damp.reversals, cooldown_h: damp.cooldown_h }); continue; }
          const declared = need * (k.effect < 0 ? -1 : 1), last = mine.filter(m => m.kept === 1 && m.new !== m.old).pop();
          const dir = last ? Math.sign(last.new - last.old) : declared;  // the direction that last held is the memory of this step-function
          const t = nextTrial(k, { dir, rejected: episode.filter(m => m.knob_id === k.id).map(m => m.new), heldDir: k.hold_dir && k.hold_until && now < k.hold_until ? k.hold_dir : 0 });
          if (!t) continue;
          const open = accessibility(inter.filter(i => i.knob_id === k.id && i.exonerated === 0).length);
          cand.push({ k, dir, nv: t.value, search: t.exploratory, far: t.distance / open, room: open * (Math.abs(t.value - k.value) / Math.max(k.max - k.min, 1e-9) + Math.abs(k.max - k.min) * 1e-6) });
        }
        cand.sort((x, y) => (x.search - y.search) || (x.search ? x.far - y.far : y.room - x.room));  // a declared step before any searched one; among searched ones the nearest
        if (cand.length) {
          const { k, nv, search } = cand[0], pred = `${g.id} moves toward ${g.op} ${g.target} (from ${v}) within ${k.review_h} h`;
          await run(db, 'UPDATE goal_knobs SET value=?, last_changed_at=? WHERE id=?', nv, now, k.id);
          const r = await run(db, `INSERT INTO goal_adjustments (at, knob_id, goal_id, old, new, why, prediction, baseline, review_after) VALUES (?,?,?,?,?,?,?,?,?)`, now, k.id, g.id, k.value, nv, `${g.id} reads ${v}; target ${g.op} ${g.target}${search ? '; the declared direction is spent, searching the remaining values' : ''}`, pred, v, now + k.review_h * 3600e3);
          await record(db, { kind: 'goal.knob', actor: 'goals', ref: k.id, summary: `${k.id}: ${k.value} -> ${nv} to move ${g.id} (${v} vs ${g.op} ${g.target}); ${pred}`, data: { goal: g.id, old: k.value, new: nv, adjustment: r && r.meta && r.meta.last_row_id } }, { now });
          out.adjusted.push({ knob: k.id, old: k.value, new: nv, goal: g.id, ...(search ? { search: true } : {}) }); adjusts++; moved = true; searching = search;
        }
      }
      const resting = pending && pending.n;
      if (!held && ((!moved && !resting) || searching) && ensureItem && g.tenant === 'core') {  // searching: the designed lever failed, so the lever is filed for while the search goes on
        const f = await ensureItem(db, { id: itemId, kind: 'fix', priority: 6, owner_role: 'product-manager', title: `Goal ${g.id} reads ${v}; target ${g.op} ${g.target}${g.deadline ? ' by ' + g.deadline : ''}. ${searching ? 'The declared direction of its knobs is spent and the remaining values are being searched' : `No knob can move it now (${knobs.length ? 'every value tried, resting after a revert, or cooling down' : 'none attached'})`}. Build a lever for it: ${g.statement}`.slice(0, 400), done_check: `goal ${g.id} reads ${g.op} ${g.target}`, closing_probe: `SELECT COUNT(*) FROM goals WHERE id='${g.id}' AND met=1`, surface: 'goals' });
        if (f) out.filed.push(itemId);
      }
    }
    if (g.deadline && !met && !g.missed_at && Date.parse(g.deadline) < now) {
      await run(db, 'UPDATE goals SET missed_at=? WHERE id=?', now, g.id);
      await record(db, { kind: 'goal.missed', actor: 'goals', ref: g.id, summary: `${g.id} missed its deadline ${g.deadline}: reads ${v}, target ${g.op} ${g.target}`, data: {} }, { now });
    }
    // achieved: one stretch goal, at most max_stretch_per_day a day across the system
    if (met && streak >= c.achieve_after && !g.stretch_id && need !== 0 && g.target) {
      const day = await first(db, `SELECT COUNT(*) AS n FROM goals WHERE origin='system' AND created_at >= ?`, now - 86400e3);
      if (!(day && day.n >= c.max_stretch_per_day)) {
        const nt = Math.round(1e6 * (need > 0 ? g.target * 1.25 : g.target * 0.8)) / 1e6, sid = (g.id.replace(/\+$/, '') + '+').slice(0, 60);
        if (!(await first(db, 'SELECT id FROM goals WHERE id=?', sid))) {
          await run(db, `INSERT INTO goals (id, tenant, parent_id, level, statement, source, spec, unit, op, target, deadline, origin, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'system',?)`,
            sid, g.tenant, g.parent_id, 'target', `Stretch: ${g.statement} (set by the system after ${streak} readings at or past ${g.target})`.slice(0, 300), g.source, g.spec, g.unit, g.op, nt, null, now);
          await run(db, 'UPDATE goals SET achieved_at=?, stretch_id=? WHERE id=?', now, sid, g.id);
          for (const k of knobs) await run(db, `UPDATE goal_knobs SET goal_id=? WHERE id=? AND goal_id=?`, sid, k.id, g.id).catch(() => {});
          await record(db, { kind: 'goal.propose', actor: 'goals', ref: sid, summary: `proposed ${sid}: ${g.op} ${nt} after ${g.id} stayed met for ${streak} readings`, data: { from: g.id } }, { now });
          out.stretch.push(sid);
        }
      }
    }
  }
  if (ensureItem) out.regulator = await regulatorItems(db, ctx, now, ensureItem).catch(e => ({ error: String(e && e.message).slice(0, 120) }));
  await run(db, 'DELETE FROM goal_samples WHERE at < ?', now - c.keep_samples_days * 86400e3);
  return out;
}

// ---- ASHBY-KERNEL-1: two readings of the regulator itself ----
// Neither has a step-function that could move it, so neither is a goal: each files its lever as work and closes it by the same reading.
// VARIETY-DEFICIT: disturbance classes no response held (requisite variety). JOINT-TOO-LARGE: more step-functions than can come right together.
export const JOINT_ITEM = 'JOINT-TOO-LARGE';
async function regulatorItems(db, ctx, now, ensureItem) {
  const nowIso = ctx.nowIso || new Date(now).toISOString(), out = {};
  const settle = async (id, bad, item, fixed) => {
    if (bad) { await run(db, `UPDATE items SET status='ready', disposition=NULL, updated_at=? WHERE id=? AND status='done'`, nowIso, id); if (await ensureItem(db, { id, kind: 'fix', priority: 6, ...item })) out[id] = 'filed'; }
    else { const r = await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, fixed, nowIso, id); if (r && r.meta && r.meta.changes) out[id] = 'closed'; }
  };
  const v = await varietyReading(db, now);
  await settle(OWN_ITEM, v.uncovered_n > 0, { owner_role: 'portfolio-manager', surface: 'goals',
    title: `${v.uncovered_n} disturbance classes met no response that held within ${v.grace_h} h: ${v.uncovered.slice(0, 8).join(', ')}. What was tried did not hold, so trying it again will not: give each class a different response (requisite variety).`.slice(0, 400),
    done_check: `no fix item a detector filed stands open past ${v.grace_h} h`, closing_probe: `SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM items WHERE kind='fix' AND id != '${OWN_ITEM}' AND status IN ('open','ready','claimed','blocked') AND datetime(created_at) < datetime('now','-${v.grace_h} hours')` },
    'fixed: every disturbance class of the window met a response that held');
  const red = reducibility((await jointLinks(db, now)).links), big = red.irreducible[0] || [];
  await settle(JOINT_ITEM, red.irreducible.length > 0, { owner_role: 'product-manager', surface: 'goals',
    title: `${big.length} step-functions can only be judged together (${big.slice(0, 6).join(', ')}): more than ${red.max_joint} that must come right at once adapt too slowly. Split the goal into parts that each keep their own knobs.`.slice(0, 400),
    done_check: `no set of more than ${red.max_joint} knobs is joined through its goals`, closing_probe: `SELECT CASE WHEN COALESCE(MAX(n),0) <= ${red.max_joint} THEN 1 ELSE 0 END FROM (SELECT COUNT(*) AS n FROM goal_knobs GROUP BY goal_id)` },
    `fixed: the largest joint set is ${red.largest_joint} step-functions`);
  return out;
}

// ---- ASHBY-KERNEL-1: the structure of the regulator, read from its own tables ----
// parts: the irreducible wholes the goals and step-functions fall into (declared links plus confirmed upsets), with the trials each would take at
// once and part by part, and whether its settings can be searched inside a year. rest: how often every goal is inside its limits at once against
// the product of the parts. joint_order: how many goals must be looked at together to account for the states seen. black_box: knob moves whose
// result is not fixed by what is recorded. variety: the disturbance classes the work queue let through. states_seen: the variety of joint states
// the goals passed through. dependence: the pairs of goals between which most variety passes. Every reading is null when unmeasured.
export async function jointLinks(db, now = Date.now()) {
  await ensure(db);
  const knobs = await all(db, `SELECT id, goal_id, min, max, step, review_h, cooldown_h FROM goal_knobs`);
  const upset = await all(db, `SELECT DISTINCT knob_id, upset_goal FROM goal_interference WHERE exonerated = 0 AND at >= ?`, now - 90 * 86400e3);
  return { knobs, links: [...knobs.map(k => ({ knob: k.id, goal: k.goal_id })), ...upset.map(u => ({ knob: u.knob_id, goal: u.upset_goal }))] };
}
export const largestJoint = (db, now) => jointLinks(db, now).then(j => reducibility(j.links).largest_joint);
export async function structureOf(db, { now = Date.now(), samples = null, max_joint } = {}) {
  const { knobs, links } = await jointLinks(db, now), red = reducibility(links, max_joint ? { max_joint } : {}), kb = Object.fromEntries(knobs.map(k => [k.id, k]));
  const parts = red.components.map(c => { const ks = c.knobs.map(id => kb[id]).filter(Boolean);
    return { ...c, search: searchBudget(ks.map(k => Math.round((k.max - k.min) / k.step) + 1), { trial_h: Math.max(1, ...ks.map(k => k.review_h + k.cooldown_h)) }) }; });
  const gs = await all(db, `SELECT id, op, target FROM goals WHERE status = 'active' AND level = 'target'`), spec = Object.fromEntries(gs.filter(g => OPS[g.op]).map(g => [g.id, g]));
  const rowsAt = new Map();
  for (const x of samples || await all(db, `SELECT goal_id, at, value FROM goal_samples WHERE at >= ? ORDER BY at`, now - 14 * 86400e3)) { const g = spec[x.goal_id]; if (!g) continue; const r = rowsAt.get(x.at) || {}; r[x.goal_id] = OPS[g.op](x.value, g.target); rowsAt.set(x.at, r); }
  const ids = Object.keys(spec).sort(), full = [...rowsAt.values()].filter(r => ids.every(i => i in r)), over = ids.slice(0, 10);
  const dep = [];
  if (full.length >= 24) for (let i = 0; i < over.length; i++) for (let j = i + 1; j < over.length; j++) { const t = transmission(full.map(r => [r[over[i]], r[over[j]]])); if (t.bits >= 0.1) dep.push({ a: over[i], b: over[j], bits: t.bits }); }
  const moves = await all(db, `SELECT knob_id, old, new, kept FROM goal_adjustments WHERE reviewed_at IS NOT NULL ORDER BY id DESC LIMIT 200`);
  const box = protocol(moves.map(m => ({ state: 'off target', input: `${m.knob_id} ${m.old} -> ${m.new}`, next: m.kept ? 'kept' : 'reverted' })));
  const inter = await all(db, `SELECT at, knob_id, goal_id, upset_goal, exonerated FROM goal_interference ORDER BY id DESC LIMIT 20`);
  return { source: "W. Ross Ashby's journal, https://ashby.info/journal/index/index.html (ASHBY-KERNEL-1); each reading is computed from this system's own tables",
    parts, largest_joint: red.largest_joint, max_joint: red.max_joint, irreducible: red.irreducible,
    rest: jointRest(full), joint_order: full.length >= 12 && over.length ? { goals: over, k: cylindrance(full.map(r => over.map(i => r[i]))), readings: full.length } : null,
    states_seen: full.length ? { ...variety(full.map(r => JSON.stringify(ids.map(i => r[i])))), readings: full.length } : null,
    dependence: full.length >= 24 ? dep.sort((x, y) => y.bits - x.bits).slice(0, 5) : null,
    black_box: { repeated: box.repeated, determinate_share: box.determinate_share, hidden: box.hidden.slice(0, 10) },
    variety: await varietyReading(db, now).then(v => ({ disturbances: v.disturbances, covered: v.covered, uncovered: v.uncovered, uncovered_n: v.uncovered_n, pending: v.pending, regulated_share: v.regulated_share, deficit_bits: v.deficit_bits, window_d: v.window_d, grace_h: v.grace_h }), () => null),
    interference: inter.map(i => ({ at: new Date(i.at).toISOString(), knob: i.knob_id, goal: i.goal_id, upset: i.upset_goal, verdict: i.exonerated == null ? 'pending' : i.exonerated === 0 ? 'confirmed' : i.exonerated === 2 ? 'confounded' : 'cleared' })) };
}

// ---- the public view ----
export async function readGoals(db, { builtins = {}, loops = true, now = Date.now(), slo = 0.9 } = {}) {
  await ensure(db);
  const gs = await all(db, `SELECT * FROM goals WHERE status != 'retired' OR retired_reason IS NOT NULL ORDER BY tenant, level, id`);
  const samples = await all(db, `SELECT goal_id, at, value FROM goal_samples WHERE at >= ? ORDER BY at`, now - 14 * 86400e3);
  const by = {}; for (const s of samples) (by[s.goal_id] ||= []).push(s);
  const knobs = await all(db, 'SELECT * FROM goal_knobs ORDER BY tenant, id');
  const adj = await all(db, 'SELECT * FROM goal_adjustments ORDER BY id DESC LIMIT 40');
  let beats = [];
  if (loops) beats = await beatStats24h(db, now).then(r => r.loops).catch(() => []);  // READ-BUDGET-9: the shared cached reading, not a 24 h scan per page view
  return {
    as_of: new Date(now).toISOString(),
    slo: { objective: slo, period_d: 14, method: 'multiwindow burn rate, Site Reliability Workbook ch. 5 (CONTROL-1)' },
    goals: gs.map(g => { const tr = trend((by[g.id] || []).map(s => ({ at: s.at, value: s.value }))); const need = needOf(g.op);
      return { id: g.id, tenant: g.tenant, parent_id: g.parent_id, level: g.level, statement: g.statement, op: g.op, target: g.target, unit: g.unit, deadline: g.deadline, status: g.status, origin: g.origin, value: g.last_value, read_at: g.last_at ? new Date(g.last_at).toISOString() : null, met: Boolean(g.met),
        trend: tr.slope_per_day == null ? 'not enough readings' : (need * tr.slope_per_day > 0 ? 'toward target' : need * tr.slope_per_day < 0 ? 'away from target' : 'flat'), slope_per_day: tr.slope_per_day, readings: tr.n, spark: (by[g.id] || []).slice(-24).map(s => s.value), error_budget: OPS[g.op] ? errorBudget((by[g.id] || []).map(s => ({ at: s.at, ok: OPS[g.op](s.value, g.target) })), slo, { now, period_d: 14 }) : null, stretch_id: g.stretch_id, retired_reason: g.retired_reason }; }),
    knobs: knobs.map(k => ({ id: k.id, tenant: k.tenant, goal_id: k.goal_id, what: k.what, value: k.value, default: k.default_value, min: k.min, max: k.max, step: k.step, effect: k.effect, cooldown_h: k.cooldown_h, config_path: k.config_path, last_changed_at: k.last_changed_at ? new Date(k.last_changed_at).toISOString() : null, resting_until: k.hold_until && k.hold_until > now ? new Date(k.hold_until).toISOString() : null })),
    adjustments: adj.map(a => ({ at: new Date(a.at).toISOString(), knob: a.knob_id, goal: a.goal_id, old: a.old, new: a.new, why: a.why, prediction: a.prediction, baseline: a.baseline, measured: a.measured, verdict: a.reviewed_at == null ? 'pending' : (a.kept ? 'kept' : 'reverted') })),
    loops: beats.map(b => ({ loop: b.loop, runs_24h: b.runs, ok_runs_24h: b.ok_runs, acted_24h: b.acted, last_ok: b.last_ok, closed: b.runs > 0 && b.ok_runs > 0 && (b.ok_runs / b.runs) >= 0.9 ? 'closing' : (b.ok_runs > 0 ? 'degraded' : 'not closing') })),
    structure: await structureOf(db, { now, samples }).catch(e => ({ error: String(e && e.message).slice(0, 120) })),
    audit: 'every knob change, review, veto, proposal and retirement is a row in the hash-chained audit log (kinds goal.*); head at /api/audit/head',
  };
}
