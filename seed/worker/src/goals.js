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
export const DDL = [
  `CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, tenant TEXT NOT NULL DEFAULT 'core', parent_id TEXT, level TEXT NOT NULL, statement TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'none', spec TEXT, unit TEXT, op TEXT, target REAL, deadline TEXT, status TEXT NOT NULL DEFAULT 'active', origin TEXT NOT NULL DEFAULT 'seed', last_value REAL, last_at INTEGER, met INTEGER NOT NULL DEFAULT 0, streak INTEGER NOT NULL DEFAULT 0, achieved_at INTEGER, stretch_id TEXT, missed_at INTEGER, retired_reason TEXT, created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS goals_tenant ON goals (tenant, status)`,
  `CREATE TABLE IF NOT EXISTS goal_samples (goal_id TEXT NOT NULL, at INTEGER NOT NULL, value REAL NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS goal_samples_goal_at ON goal_samples (goal_id, at)`,
  `CREATE TABLE IF NOT EXISTS goal_knobs (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, tenant TEXT NOT NULL DEFAULT 'core', what TEXT, config_path TEXT, value REAL NOT NULL, default_value REAL NOT NULL, min REAL NOT NULL, max REAL NOT NULL, step REAL NOT NULL, effect INTEGER NOT NULL DEFAULT 1, cooldown_h REAL NOT NULL DEFAULT 24, review_h REAL NOT NULL DEFAULT 24, last_changed_at INTEGER, hold_dir INTEGER, hold_until INTEGER)`,
  `CREATE TABLE IF NOT EXISTS goal_adjustments (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, knob_id TEXT NOT NULL, goal_id TEXT NOT NULL, old REAL NOT NULL, new REAL NOT NULL, why TEXT, prediction TEXT, baseline REAL, review_after INTEGER NOT NULL, reviewed_at INTEGER, kept INTEGER, measured REAL)`,
  `CREATE INDEX IF NOT EXISTS goal_adjustments_at ON goal_adjustments (at)`,
];
const ensured = new WeakSet();
export async function ensure(db) { if (ensured.has(db)) return; for (const s of DDL) await db.prepare(s).run(); ensured.add(db); }
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '=': (a, b) => a === b };
export const LEVELS = ['mission', 'objective', 'target'];
export const DEFAULTS = { stale_days: 14, achieve_after: 12, max_adjust_per_run: 3, max_stretch_per_day: 2, keep_samples_days: 30, tenant_limits: { goals: 40, knobs: 80 } };
const cfgOf = c => ({ ...DEFAULTS, ...((c && c.control) || {}) });
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

// ---- the control loop ----
export async function goalsStep(db, ctx, cfg, { builtins = {}, ensureItem = null } = {}) {
  await ensure(db); const c = cfgOf(cfg), now = ctx.now || Date.now(), out = { read: 0, met: 0, off: 0, adjusted: [], reviewed: [], stretch: [], retired: [], filed: [] };
  if (cfg) await seedGoals(db, cfg, { now });
  if (cfg && cfg.tenant_feeds && cfg.tenant_feeds.length) out.feeds = await pullFeeds(db, cfg.tenant_feeds, { fetchFn: ctx.fetch || (ctx.env && ctx.env.fetch) || fetch, now });
  const goals = await all(db, `SELECT * FROM goals WHERE status='active' AND level='target'`);
  let adjusts = 0;
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
    // review: the last unreviewed change of each knob of this goal, once its review time has passed
    const due = await all(db, `SELECT a.*, k.value AS kval, k.cooldown_h FROM goal_adjustments a JOIN goal_knobs k ON k.id = a.knob_id WHERE a.goal_id=? AND a.reviewed_at IS NULL AND a.review_after <= ?`, g.id, now);
    for (const a of due) {
      const improved = met || (need !== 0 && need * (v - a.baseline) > eps(g));
      if (!improved) {
        if (a.kval === a.new) await run(db, 'UPDATE goal_knobs SET value=?, last_changed_at=?, hold_dir=?, hold_until=? WHERE id=?', a.old, now, Math.sign(a.new - a.old), now + 7 * 86400e3, a.knob_id);
        await run(db, 'UPDATE goal_adjustments SET reviewed_at=?, kept=0, measured=? WHERE id=?', now, v, a.id);
      } else await run(db, 'UPDATE goal_adjustments SET reviewed_at=?, kept=1, measured=? WHERE id=?', now, v, a.id);
      await record(db, { kind: 'goal.review', actor: 'goals', ref: g.id, summary: `${a.knob_id} change ${a.old} -> ${a.new} ${improved ? 'kept' : 'reverted'}: ${g.id} ${a.baseline} -> ${v}`, data: { knob: a.knob_id, kept: improved } }, { now });
      out.reviewed.push({ knob: a.knob_id, kept: improved });
    }
    // item that closes itself
    const itemId = `GOAL-${g.id}`.slice(0, 80);
    if (met) { await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, `fixed: goal ${g.id} met (${v} ${g.op} ${g.target})`, ctx.nowIso || new Date(now).toISOString(), itemId).catch(() => {}); }
    const knobs = await all(db, 'SELECT * FROM goal_knobs WHERE goal_id=?', g.id);
    if (!met && need !== 0) {
      let moved = false;
      const pending = await first(db, `SELECT COUNT(*) AS n FROM goal_adjustments WHERE goal_id=? AND reviewed_at IS NULL`, g.id);
      if (!(pending && pending.n) && adjusts < c.max_adjust_per_run) {
        const cand = [];
        for (const k of knobs) {
          const dir = need * (k.effect < 0 ? -1 : 1), nv = Math.min(k.max, Math.max(k.min, k.value + dir * k.step));
          if (nv === k.value) continue;
          if (k.last_changed_at && now - k.last_changed_at < k.cooldown_h * 3600e3) continue;
          if (k.hold_dir === dir && k.hold_until && now < k.hold_until) continue;
          cand.push({ k, dir, nv, room: Math.abs(nv - k.value) / Math.max(k.max - k.min, 1e-9) + Math.abs(k.max - k.min) * 1e-6 });
        }
        cand.sort((x, y) => y.room - x.room);
        if (cand.length) {
          const { k, nv } = cand[0], pred = `${g.id} moves toward ${g.op} ${g.target} (from ${v}) within ${k.review_h} h`;
          await run(db, 'UPDATE goal_knobs SET value=?, last_changed_at=? WHERE id=?', nv, now, k.id);
          const r = await run(db, `INSERT INTO goal_adjustments (at, knob_id, goal_id, old, new, why, prediction, baseline, review_after) VALUES (?,?,?,?,?,?,?,?,?)`, now, k.id, g.id, k.value, nv, `${g.id} reads ${v}; target ${g.op} ${g.target}`, pred, v, now + k.review_h * 3600e3);
          await record(db, { kind: 'goal.knob', actor: 'goals', ref: k.id, summary: `${k.id}: ${k.value} -> ${nv} to move ${g.id} (${v} vs ${g.op} ${g.target}); ${pred}`, data: { goal: g.id, old: k.value, new: nv, adjustment: r && r.meta && r.meta.last_row_id } }, { now });
          out.adjusted.push({ knob: k.id, old: k.value, new: nv, goal: g.id }); adjusts++; moved = true;
        }
      }
      const resting = pending && pending.n;
      if (!moved && !resting && ensureItem && g.tenant === 'core') {
        const f = await ensureItem(db, { id: itemId, kind: 'fix', priority: 6, owner_role: 'product-manager', title: `Goal ${g.id} reads ${v}; target ${g.op} ${g.target}${g.deadline ? ' by ' + g.deadline : ''}. No knob can move it now (${knobs.length ? 'all at a bound, resting after a revert, or cooling down' : 'none attached'}). Build a lever for it: ${g.statement}`.slice(0, 400), done_check: `goal ${g.id} reads ${g.op} ${g.target}`, closing_probe: `SELECT COUNT(*) FROM goals WHERE id='${g.id}' AND met=1`, surface: 'goals' });
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
  await run(db, 'DELETE FROM goal_samples WHERE at < ?', now - c.keep_samples_days * 86400e3);
  return out;
}

// ---- the public view ----
export async function readGoals(db, { builtins = {}, loops = true, now = Date.now() } = {}) {
  await ensure(db);
  const gs = await all(db, `SELECT * FROM goals WHERE status != 'retired' OR retired_reason IS NOT NULL ORDER BY tenant, level, id`);
  const samples = await all(db, `SELECT goal_id, at, value FROM goal_samples WHERE at >= ? ORDER BY at`, now - 14 * 86400e3);
  const by = {}; for (const s of samples) (by[s.goal_id] ||= []).push(s);
  const knobs = await all(db, 'SELECT * FROM goal_knobs ORDER BY tenant, id');
  const adj = await all(db, 'SELECT * FROM goal_adjustments ORDER BY id DESC LIMIT 40');
  let beats = [];
  if (loops) beats = await all(db, `SELECT loop, COUNT(*) AS runs, SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) AS ok_runs, SUM(CASE WHEN ok=1 AND detail IS NOT NULL AND detail NOT IN ('null','{}','[]') AND detail NOT LIKE '{"paced"%' THEN 1 ELSE 0 END) AS acted, MAX(CASE WHEN ok=1 THEN finished_at END) AS last_ok, MAX(started_at) AS last_start FROM loop_beats WHERE started_at >= ? GROUP BY loop ORDER BY loop`, new Date(now - 86400e3).toISOString().slice(0, 19).replace('T', ' ')).catch(() => []);
  return {
    as_of: new Date(now).toISOString(),
    goals: gs.map(g => { const tr = trend((by[g.id] || []).map(s => ({ at: s.at, value: s.value }))); const need = needOf(g.op);
      return { id: g.id, tenant: g.tenant, parent_id: g.parent_id, level: g.level, statement: g.statement, op: g.op, target: g.target, unit: g.unit, deadline: g.deadline, status: g.status, origin: g.origin, value: g.last_value, read_at: g.last_at ? new Date(g.last_at).toISOString() : null, met: Boolean(g.met),
        trend: tr.slope_per_day == null ? 'not enough readings' : (need * tr.slope_per_day > 0 ? 'toward target' : need * tr.slope_per_day < 0 ? 'away from target' : 'flat'), slope_per_day: tr.slope_per_day, readings: tr.n, spark: (by[g.id] || []).slice(-24).map(s => s.value), stretch_id: g.stretch_id, retired_reason: g.retired_reason }; }),
    knobs: knobs.map(k => ({ id: k.id, tenant: k.tenant, goal_id: k.goal_id, what: k.what, value: k.value, default: k.default_value, min: k.min, max: k.max, step: k.step, effect: k.effect, cooldown_h: k.cooldown_h, config_path: k.config_path, last_changed_at: k.last_changed_at ? new Date(k.last_changed_at).toISOString() : null, resting_until: k.hold_until && k.hold_until > now ? new Date(k.hold_until).toISOString() : null })),
    adjustments: adj.map(a => ({ at: new Date(a.at).toISOString(), knob: a.knob_id, goal: a.goal_id, old: a.old, new: a.new, why: a.why, prediction: a.prediction, baseline: a.baseline, measured: a.measured, verdict: a.reviewed_at == null ? 'pending' : (a.kept ? 'kept' : 'reverted') })),
    loops: beats.map(b => ({ loop: b.loop, runs_24h: b.runs, ok_runs_24h: b.ok_runs, acted_24h: b.acted, last_ok: b.last_ok, closed: b.runs > 0 && b.ok_runs > 0 && (b.ok_runs / b.runs) >= 0.9 ? 'closing' : (b.ok_runs > 0 ? 'degraded' : 'not closing') })),
    audit: 'every knob change, review, proposal and retirement is a row in the hash-chained audit log (kinds goal.*); head at /api/audit/head',
  };
}
