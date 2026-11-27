// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// BOOT-KNOWS-1: how the system knows, from its own tables and nothing else, how far it is from bootstrap to criticality.
// A ladder of stages; each stage is a condition computed from evidence the system itself recorded. The stage is the highest one whose
// condition and every condition below it hold. Nothing is declared: a stage is reached when the tick reads it, and lost when the tick reads
// that it no longer holds. Every change is appended to ignition_log with the evidence. The first unmet stage is filed as IGNITE-<stage>
// with the numbers that block it, and only the same reading can close it.
//   seeded            the schema this code needs exists and at least one role can take work
//   ticking           the heartbeat completed every step for min_streak ticks in a row and missed no slot in the last hour
//   looping           every loop is ticking and good-slot coverage over 24 h is at least min_coverage (LOOPPROOF-1), watched by a second producer
//   closing           the system closed items with independently verified outcomes in the window, with no silent drop
//   instrumented      every objective has a probe-backed target and no metric is only declared
//   critical          k_eff has been at or above k_min for min_streak ticks in a row
//   self-sustaining   critical for sustained_ticks, with 0 open ignition gaps and 0 human touches
// bootstrapped = instrumented or above: the system stands, runs and measures itself. Criticality is the two stages above that.
import { ensurePulseSchema, readOrg } from './pulse.js';

const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export const STAGES = ['unseeded', 'seeded', 'ticking', 'looping', 'closing', 'instrumented', 'critical', 'self-sustaining'];
export const BOOTSTRAPPED_AT = 'instrumented';
export const REQUIRED_TABLES = ['org', 'roles', 'items', 'claims', 'gate_cards', 'predictions', 'outcomes', 'trust_ledger', 'dispatches', 'tick_runs',
  'objectives', 'metrics', 'criticality_samples', 'ignition_gaps', 'failure_probe_runs', 'loop_beats', 'loop_clock', 'ignition_log'];
export const DEFAULTS = {
  ticking: { min_streak: 6 }, looping: { min_coverage: 0.95, require_watchdog: true }, closing: { window_days: 7, min_verified: 1 },
  critical: { min_streak: 6 }, sustained_ticks: 144, owner_roles: { default: 'operations', critical: 'portfolio-manager', 'self-sustaining': 'portfolio-manager' },
};
const merge = (d, o = {}) => Object.fromEntries(Object.keys({ ...d, ...o }).map(k => [k, d[k] && typeof d[k] === 'object' && !Array.isArray(d[k]) ? { ...d[k], ...(o[k] || {}) } : (o[k] ?? d[k])]));

// Pure: evidence -> { stage, holds, blocking }. Every condition carries the numbers it was judged on.
export function judge(e, t = DEFAULTS) {
  const c = e.criticality || {}, p = e.pulse || null;
  const holds = {
    seeded: { ok: e.missing_tables.length === 0 && e.roles >= 1,
      why: e.missing_tables.length ? `missing tables: ${e.missing_tables.join(', ')}` : `${e.roles} role(s), schema complete` },
    ticking: { ok: e.tick_streak >= t.ticking.min_streak && e.tick_missed_1h === 0,
      why: `${e.tick_streak} complete tick(s) in a row (need ${t.ticking.min_streak}), ${e.tick_missed_1h} slot(s) missed in the last hour` },
    looping: { ok: Boolean(p) && p.not_ticking.length === 0 && p.warming === 0 && p.coverage_24h != null && p.coverage_24h >= t.looping.min_coverage && (!t.looping.require_watchdog || p.watchdog),
      why: !p ? 'no pulse reading: loop execution is unmeasured'
        : p.not_ticking.length ? `not ticking: ${p.not_ticking.map(x => `${x.loop} (${x.state})`).join(', ')}`
        : p.warming ? `${p.warming} declared loop(s) have no recorded run yet`
        : p.coverage_24h == null || p.coverage_24h < t.looping.min_coverage ? `good-slot coverage ${p.coverage_24h ?? 'unmeasured'} over 24 h (need ${t.looping.min_coverage}); ${p.missed_24h} slot(s) missed`
        : t.looping.require_watchdog && !p.watchdog ? 'no second producer is watching the tick: the watchdog loop has no current beat'
        : `${p.ticking}/${p.loops} loops ticking, coverage ${p.coverage_24h}, watchdog present` },
    closing: { ok: e.closed_verified >= t.closing.min_verified && e.silent_drops === 0,
      why: `${e.closed_verified} item(s) closed with a verified outcome in ${t.closing.window_days} d (need ${t.closing.min_verified}), ${e.silent_drops} silent drop(s)` },
    instrumented: { ok: e.metrics >= 1 && e.objectives_without_probe === 0 && e.declared_metrics === 0,
      why: `${e.metrics} metric(s), ${e.objectives_without_probe} objective(s) without a probe, ${e.declared_metrics} metric(s) only declared` },
    critical: { ok: e.k_streak >= t.critical.min_streak,
      why: c.k_eff == null ? 'k_eff is unmeasured' : `k_eff ${c.k_eff} against k_min ${c.k_min} for ${e.k_streak} tick(s) in a row (need ${t.critical.min_streak}): ${(c.credited_deploys ?? 0) + (c.originated_credited ?? 0)} credited over ${(c.spend_units ?? 0) + (c.human_touches ?? 0)} spent; ${e.dispatches} dispatch(es) produced ${e.dispatch_verified} verified outcome(s) in the window` },
    'self-sustaining': { ok: e.k_streak >= t.sustained_ticks && c.open_ignition_gaps === 0 && (c.human_touches ?? 1) === 0,
      why: `critical for ${e.k_streak} tick(s) (need ${t.sustained_ticks}), ${c.open_ignition_gaps ?? 'unmeasured'} open ignition gap(s), ${c.human_touches ?? 'unmeasured'} human touch(es)` },
  };
  let stage = STAGES[0], blocking = null;
  for (const s of STAGES.slice(1)) {
    if (holds[s].ok) stage = s;
    else { blocking = { stage: s, why: holds[s].why }; break; }
  }
  return { stage, holds, blocking, bootstrapped: STAGES.indexOf(stage) >= STAGES.indexOf(BOOTSTRAPPED_AT), critical: STAGES.indexOf(stage) >= STAGES.indexOf('critical') };
}

export async function gather(db, ctx, t, prev) {
  const have = new Set((await all(db, `SELECT name FROM sqlite_master WHERE type='table'`)).map(r => r.name));
  const c = ctx.criticality || null;
  const recent = await all(db, `SELECT started_at, finished_at, steps_completed, steps_total FROM tick_runs WHERE id <> ? ORDER BY id DESC LIMIT 200`, ctx.tickId);
  let streak = 0;
  for (const r of recent) { if (r.finished_at && r.steps_completed === r.steps_total) streak++; else break; }
  const every = (ctx.pulse && ctx.pulse.every_min) || 10, w = every * 60e3, cur = Math.floor(ctx.now / w);
  const firstTick = recent.length ? Date.parse(recent[recent.length - 1].started_at.replace(' ', 'T') + 'Z') : ctx.now;
  const from = Math.max(cur - Math.max(1, Math.round(60 / every)), Math.floor(firstTick / w));
  const seen = new Set(recent.map(r => Math.floor(Date.parse(r.started_at.replace(' ', 'T') + 'Z') / w)));
  let missed = 0;
  for (let s = from; s < cur; s++) if (!seen.has(s)) missed++;
  const since = iso(ctx.now - t.closing.window_days * 86400e3);
  const n = async (sql, ...a) => { const r = await first(db, sql, ...a); return r ? Number(Object.values(r)[0]) || 0 : 0; };
  const win = iso(ctx.now - ((c && c.window_days) || 14) * 86400e3);
  const kOk = Boolean(c && c.k_eff != null && c.k_eff >= c.k_min);
  return {
    missing_tables: REQUIRED_TABLES.filter(x => !have.has(x)),
    roles: have.has('roles') ? await n(`SELECT COUNT(*) FROM roles`) : 0,
    tick_streak: streak, tick_missed_1h: missed, pulse: ctx.pulse || null,
    closed_verified: await n(`SELECT COUNT(DISTINCT i.id) FROM items i JOIN outcomes o ON o.item_id = i.id WHERE i.status='done' AND o.result='verified' AND o.at >= ? AND COALESCE(o.surface, '') <> 'ignition'`, since),  // US-26-R75: the ladder's own closures (surface ignition) are bookkeeping, not work
    silent_drops: await n(`SELECT COUNT(*) FROM outcomes WHERE result='silent_drop' AND at >= ?`, since),
    metrics: have.has('metrics') ? await n(`SELECT COUNT(*) FROM metrics WHERE tenant_id IS NULL`) : 0,
    declared_metrics: have.has('metrics') ? await n(`SELECT COUNT(*) FROM metrics WHERE tenant_id IS NULL AND source='declared'`) : 0,
    objectives_without_probe: have.has('objectives') ? await n(`SELECT COUNT(*) FROM objectives o WHERE o.tenant_id IS NULL AND NOT EXISTS (SELECT 1 FROM metrics m WHERE m.tenant_id IS NULL AND m.objective_id = o.id AND m.kind = 'target' AND m.source IN ('builtin','sql','http'))`) : 0,
    dispatches: await n(`SELECT COUNT(*) FROM dispatches WHERE at >= ?`, win),
    dispatch_verified: await n(`SELECT COUNT(DISTINCT d.item_id) FROM dispatches d JOIN outcomes o ON o.item_id = d.item_id WHERE d.at >= ? AND o.result='verified'`, win),
    criticality: c, k_streak: kOk ? ((prev && prev.k_streak) || 0) + 1 : 0,
  };
}

// The tick step, after criticality. Writes org.ignition every tick, ignition_log on every change of stage, and keeps IGNITE-<stage> true.
export async function ignitionStep(db, ctx, ensureItem) {
  await ensurePulseSchema(db);
  const t = merge(DEFAULTS, ctx.config.ignition);
  const prev = await readOrg(db, 'ignition');
  const e = await gather(db, ctx, t, prev);
  const j = judge(e, t);
  const was = prev ? prev.stage : null, changed = was !== j.stage;
  const dir = was == null ? 'first' : STAGES.indexOf(j.stage) > STAGES.indexOf(was) ? 'up' : 'down';
  if (changed) {
    await run(db, `INSERT INTO ignition_log (at, stage, prev, direction, evidence) VALUES (?,?,?,?,?)`, ctx.nowIso, j.stage, was, dir,
      JSON.stringify({ holds: Object.fromEntries(Object.entries(j.holds).map(([k, v]) => [k, v.ok])), blocking: j.blocking, k_eff: e.criticality ? e.criticality.k_eff : null }).slice(0, 2000));
    if (dir === 'down') await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'ignition', 'probe', 'failed', ?)`, `IGNITE-${was}`.slice(0, 80), `stage fell from ${was} to ${j.stage}: ${j.blocking ? j.blocking.why : ''}`.slice(0, 300));
  }
  for (const s of STAGES.slice(1)) {  // IGNITE-<stage>: open for the first unmet stage, closed by the same reading for every stage that holds
    const id = `IGNITE-${s}`;
    if (j.blocking && j.blocking.stage === s) {
      const title = `Reach stage ${s}: ${j.blocking.why}. Fix the cause the numbers name; the tick closes this when the stage holds.`.slice(0, 400);
      const made = await ensureItem(db, { id, kind: 'fix', owner_role: t.owner_roles[s] || t.owner_roles.default, priority: -1, title, done_check: `org.ignition.stage is ${s} or above`, closing_probe: `ignition:${s}` });
      if (!made) await run(db, `UPDATE items SET title=?, updated_at=?, status=CASE WHEN status IN ('done','superseded','cancelled') THEN 'ready' ELSE status END, disposition=CASE WHEN status IN ('done','superseded','cancelled') THEN NULL ELSE disposition END WHERE id=? AND (title<>? OR status IN ('done','superseded','cancelled'))`, title, ctx.nowIso, id, title);
    } else if (STAGES.indexOf(s) <= STAGES.indexOf(j.stage)) {
      const r = await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, `probe green: ignition:${s} holds`, ctx.nowIso, id);
      if (r.meta && r.meta.changes) {
        await run(db, `DELETE FROM claims WHERE item_id=?`, id);
        await run(db, `INSERT INTO outcomes (item_id, surface, action_class, result, evidence) VALUES (?, 'ignition', 'probe', 'verified', ?)`, id, `probe:ignition:${s} holds at ${ctx.nowIso}`);
      }
    }
  }
  const stamp = (key, on) => on ? ((prev && prev[key]) || ctx.nowIso) : null;  // when the property was first read true in the current unbroken run
  const snap = { stage: j.stage, since: changed || !prev ? ctx.nowIso : prev.since, at: ctx.nowIso, bootstrapped: j.bootstrapped, bootstrapped_since: stamp('bootstrapped_since', j.bootstrapped),
    critical: j.critical, critical_since: stamp('critical_since', j.critical), k_streak: e.k_streak, tick_streak: e.tick_streak, blocking: j.blocking,
    holds: Object.fromEntries(Object.entries(j.holds).map(([k, v]) => [k, v])) };
  ctx.ignition = snap;
  await run(db, `INSERT INTO org (key, value) VALUES ('ignition', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, JSON.stringify(snap));
  ctx.notes.push(`ignition: stage ${j.stage}${changed && was ? ` (${dir} from ${was})` : ''}${j.blocking ? `; next ${j.blocking.stage} blocked: ${j.blocking.why}` : ''}`.slice(0, 500));
  return snap;
}

export async function readIgnition(db) {
  const snap = await readOrg(db, 'ignition');
  if (!snap) return null;
  const log = await all(db, `SELECT at, stage, prev, direction FROM ignition_log ORDER BY id DESC LIMIT 20`).catch(() => []);
  return { ...snap, log };
}
