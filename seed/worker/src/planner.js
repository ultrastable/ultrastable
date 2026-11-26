// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// PLAN-1 (Rowan 2026-11-26): "You break up big tasks into small tasks, and then you tackle the small tasks ... From a vague instruction like get better,
// Claude Code knows how to do that pretty well. But how does an ultra-stable system know how to do it? How to dial those knobs to make itself better?"
// "Better" here is not a feeling. It is a goal in goals.js (a measured essential variable with an op and a target) moving toward its target. This step:
//   pick       the active target goal furthest out of bounds (relative gap, wrong side of its target) that has no live plan; or a goal asked for by id
//   decompose  one plan = a task tree of small items in the existing `items` table, each with an owner role, a done check, a closing probe and the PR size
//              limit: audit > implement (one per lever: every free knob of the goal, plus one code change) > adversarial verify by a different role >
//              fix (filed only if verify refutes) > integrate > gate. Edges live in plan_tasks; a task with unfinished predecessors stays 'blocked'
//              and this step makes it 'ready' when they are all done, so dispatch hands each to its manager in order.
//   gate       after integrate, wait review_h, read the goal again: moved toward target beyond noise = kept; else missed, and the next plan for that goal
//              mutates its approach (levers, then code, then orchestrated); a third miss files one incident item instead of a fourth plan.
// Implement items that need more than one change are taken by the step orchestrator (orchestrate.js) when the single-shot executor fails them, so the
// plan/implement/verify/fix/integrate phases also run inside each task. Every transition is a CloudEvent in the hash-chained audit log.
import { record } from './auditchain.js';
import { envelope } from './cloudevents.js';
import { ensure as ensureGoals, readGoal } from './goals.js';

export const DDL = [
  `CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL, tenant TEXT NOT NULL DEFAULT 'core', attempt INTEGER NOT NULL DEFAULT 1, approach TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', baseline REAL, target REAL, op TEXT, gap REAL, prediction TEXT, measured REAL, verdict TEXT, created_at INTEGER NOT NULL, integrated_at INTEGER, closed_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS plans_goal ON plans (goal_id, status)`,
  `CREATE TABLE IF NOT EXISTS plan_tasks (plan_id TEXT NOT NULL, item_id TEXT NOT NULL, phase TEXT NOT NULL, after TEXT NOT NULL DEFAULT '[]', knob TEXT, PRIMARY KEY (plan_id, item_id))`,
];
export const PHASES = ['audit', 'implement', 'verify', 'fix', 'integrate', 'gate'];
export const APPROACHES = ['levers', 'code', 'orchestrated'];
export const DEFAULTS = { max_active: 1, review_h: 24, max_attempts: 3, pr_files: 60, noise: 0.01 };
const ROLE = { audit: 'product-manager', implement: 'staff', verify: 'reviewer', fix: 'staff', integrate: 'project-manager', gate: 'portfolio-manager' };
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const cfgOf = c => ({ ...DEFAULTS, ...(c || {}) });
const need = op => (op === '>=' || op === '>') ? 1 : (op === '<=' || op === '<') ? -1 : 0;
const ensured = new WeakSet();
export async function ensure(db) { if (ensured.has(db)) return; await ensureGoals(db); for (const s of DDL) await db.prepare(s).run(); ensured.add(db); }

// How far a goal is out of bounds, relative to its target. 0 when met; only the wrong side counts.
export function gap(g, v) {
  const d = need(g.op); if (v == null || g.target == null || !d) return 0;
  const short = d * (Number(g.target) - Number(v));
  return short > 0 ? short / Math.max(Math.abs(Number(g.target)), 1e-6) : 0;
}

async function emit(db, kind, plan, summary, data, now) {
  const ce = envelope({ area: 'plan', event: kind, source: '/planner', subject: plan, data, time: now });
  await record(db, { kind: 'plan.' + kind, actor: 'planner', ref: plan, summary, data: ce }, { now });
}

// The task tree for one goal, as plain data before anything is stored (tested on its own).
export function decompose(g, { id, attempt, approach, knobs = [], pr_files = DEFAULTS.pr_files, value }) {
  const T = (phase, k = '') => `${id}-${phase}${k}`;
  const probe = `goal ${g.id} ${g.op} ${g.target} (read by the planner gate)`;
  const size = `one PR under ${pr_files} files (prsize)`;
  const tasks = [{ id: T('audit'), phase: 'audit', after: [], title: `Audit why ${g.id} is ${value} against ${g.op} ${g.target}`,
    done: `a comment naming the cause and the lever most likely to move ${g.id}, citing the rows or files read`, probe: `item ${T('audit')} done with a disposition` }];
  const levers = [];
  if (approach === 'levers') for (const k of knobs) levers.push({ id: T('implement', '-' + k.id.replace(/[^a-z0-9]+/gi, '-').toLowerCase()), phase: 'implement', after: [T('audit')],
    knob: k.id, title: `Turn knob ${k.id} (${k.what || k.config_path || 'knob'}) one step toward ${g.id}`, done: `goal_adjustments has a row for ${k.id} with a prediction`, probe });
  levers.push({ id: T('implement', '-code'), phase: 'implement', after: [T('audit')], kind: 'fix',
    title: `${approach === 'orchestrated' ? 'Plan in steps and change' : 'Change'} the code that drives ${g.id}: ${g.statement}`.slice(0, 200),
    done: `${size}, tests pass, merged by the lane; ${approach === 'orchestrated' ? 'worked by the step orchestrator' : 'single change'}`, probe });
  tasks.push(...levers);
  const impl = levers.map(l => l.id);
  tasks.push({ id: T('verify'), phase: 'verify', after: impl, title: `Try to refute that ${impl.length} change(s) move ${g.id}`,
    done: 'disposition starts with "confirmed" or "refuted: <finding>"; the reviewer is not the author', probe });
  tasks.push({ id: T('integrate'), phase: 'integrate', after: [T('verify')], title: `Integrate plan ${id}: every change merged and deployed`, done: 'every implement PR merged and its deploy probed live', probe });
  tasks.push({ id: T('gate'), phase: 'gate', after: [T('integrate')], title: `Gate: did ${g.id} move toward ${g.op} ${g.target}?`, done: 'closed by the planner from a fresh reading', probe });
  return tasks.map(t => ({ ...t, role: ROLE[t.phase] }));
}

async function insertTask(db, plan, t, ensureItem, now) {
  const blocked = t.after.length > 0;
  const ok = await ensureItem(db, { id: t.id, title: t.title, kind: t.kind || 'work', owner_role: t.role, done_check: t.done, closing_probe: t.probe, priority: 5 }, { now });
  if (!ok) return false;
  await run(db, `UPDATE items SET project=?, status=?, blocker=? WHERE id=?`, plan, blocked ? 'blocked' : 'ready', blocked ? `waits on ${t.after.join(', ')}` : null, t.id);
  await run(db, `INSERT OR REPLACE INTO plan_tasks (plan_id, item_id, phase, after, knob) VALUES (?,?,?,?,?)`, plan, t.id, t.phase, JSON.stringify(t.after), t.knob || null);
  return true;
}

// Start a plan for one goal. Returns the plan id, or null when the goal is met, unreadable or already planned.
export async function startPlan(db, g, { builtins = {}, now = Date.now(), cfg, ensureItem } = {}) {
  const c = cfgOf(cfg); await ensure(db);
  if (await first(db, `SELECT id FROM plans WHERE goal_id=? AND status='active'`, g.id)) return null;
  const v = await readGoal(db, g, { builtins, now }); const gp = gap(g, v);
  if (!(gp > 0)) return null;
  const misses = (await first(db, `SELECT COUNT(*) n FROM plans WHERE goal_id=? AND verdict='missed'`, g.id)).n;
  if (misses >= c.max_attempts) {
    await ensureItem(db, { id: `INCIDENT-PLAN-${g.id}`, title: `${misses} plans for ${g.id} missed; redesign`, kind: 'fix', owner_role: 'portfolio-manager',
      done_check: `a plan for ${g.id} reaches verdict kept`, closing_probe: `goal ${g.id} ${g.op} ${g.target}`, priority: 1 }, { now });
    return null;
  }
  const attempt = (await first(db, `SELECT COUNT(*) n FROM plans WHERE goal_id=?`, g.id)).n + 1, approach = APPROACHES[Math.min(misses, APPROACHES.length - 1)];
  const id = `PLAN-${g.id.replace(/[^a-z0-9]+/gi, '-')}-${attempt}`;
  if (await first(db, `SELECT id FROM plans WHERE id=?`, id)) return null;
  const knobs = await all(db, `SELECT id, what, config_path FROM goal_knobs WHERE goal_id=? AND (hold_until IS NULL OR hold_until < ?) AND value > min - 1e-9 ORDER BY id LIMIT 4`, g.id, now);
  const tasks = decompose(g, { id, attempt, approach, knobs, pr_files: c.pr_files, value: v });
  const due = new Date(now + (c.review_h * 3 + 24) * 3600e3).toISOString();
  const prediction = `${g.spec || g.id} ${g.op} ${g.target} within ${c.review_h * 3 + 24} h`;
  await run(db, `INSERT INTO plans (id, goal_id, tenant, attempt, approach, baseline, target, op, gap, prediction, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    id, g.id, g.tenant || 'core', attempt, approach, v, g.target, g.op, gp, prediction, now);
  for (const t of tasks) await insertTask(db, id, t, ensureItem, now);
  if (g.source === 'builtin') await run(db, `INSERT OR IGNORE INTO predictions (id, item_id, metric, op, target, due_at) VALUES (?,?,?,?,?,?)`, `${id}-pred`, `${id}-gate`, g.spec, g.op, g.target, due);
  await emit(db, 'started', id, `plan ${id}: ${g.id} is ${v} against ${g.op} ${g.target}; ${tasks.length} tasks, approach ${approach}`, { goal: g.id, baseline: v, gap: gp, approach, tasks: tasks.map(t => ({ id: t.id, phase: t.phase, after: t.after, role: t.role })) }, now);
  return id;
}

// One tick of the planner: advance every live plan, then start one for the goal furthest out of bounds.
export async function planStep(db, ctx, cfg, { builtins = {}, ensureItem } = {}) {
  const c = cfgOf(cfg), now = ctx.now || Date.now(), out = { promoted: [], fixes: [], closed: [], started: null };
  await ensure(db);
  for (const p of await all(db, `SELECT * FROM plans WHERE status='active'`)) {
    const tasks = await all(db, `SELECT t.item_id, t.phase, t.after, i.status, i.disposition, i.updated_at FROM plan_tasks t JOIN items i ON i.id = t.item_id WHERE t.plan_id=?`, p.id);
    const byId = Object.fromEntries(tasks.map(t => [t.item_id, t]));
    const done = id => byId[id] && byId[id].status === 'done';
    // a refuted verify files one fix task the integrate step then waits on
    const ver = tasks.find(t => t.phase === 'verify');
    if (ver && done(ver.item_id) && /^refuted/i.test(ver.disposition || '') && !tasks.some(t => t.phase === 'fix')) {
      const fix = { id: `${p.id}-fix`, phase: 'fix', role: ROLE.fix, kind: 'fix', after: [], title: `Fix what the verifier refuted in ${p.id}`.slice(0, 200), done: `the finding is answered in code: ${ver.disposition}`.slice(0, 400), probe: `item ${ver.item_id} finding no longer holds` };
      if (await insertTask(db, p.id, fix, ensureItem, now)) {
        const integ = tasks.find(t => t.phase === 'integrate');
        if (integ) await run(db, `UPDATE plan_tasks SET after=? WHERE plan_id=? AND item_id=?`, JSON.stringify([...JSON.parse(integ.after), fix.id]), p.id, integ.item_id);
        out.fixes.push(fix.id); await emit(db, 'fix', p.id, `verify refuted ${p.id}; filed ${fix.id}`, { finding: ver.disposition }, now);
      }
      continue;  // re-read the edges next tick
    }
    for (const t of tasks) {
      if (t.status !== 'blocked' || t.phase === 'gate') continue;
      if (JSON.parse(t.after).every(done)) { await run(db, `UPDATE items SET status='ready', blocker=NULL, updated_at=? WHERE id=? AND status='blocked'`, ctx.nowIso || new Date(now).toISOString(), t.item_id); out.promoted.push(t.item_id); }
    }
    // A knob is the planner's own lever: it turns it itself, no agent and no person (Rowan 2026-11-26: "control these knobs yourself, completely on
    // your own"). One step toward the goal within bounds, logged in goal_adjustments so goals.js reviews and reverts it like any other move.
    for (const t of await all(db, `SELECT t.item_id, t.knob FROM plan_tasks t JOIN items i ON i.id=t.item_id WHERE t.plan_id=? AND t.knob IS NOT NULL AND i.status='ready'`, p.id)) {
      const r = await turnKnob(db, t.knob, p, now);
      await run(db, `UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=?`, r, new Date(now).toISOString(), t.item_id);
      if (byId[t.item_id]) byId[t.item_id].status = 'done';
      out.turned = [...(out.turned || []), t.knob];
    }
    const integ = tasks.find(t => t.phase === 'integrate'), gate = tasks.find(t => t.phase === 'gate');
    if (integ && done(integ.item_id) && !p.integrated_at) { await run(db, `UPDATE plans SET integrated_at=? WHERE id=?`, now, p.id); p.integrated_at = now; }
    if (!gate || !p.integrated_at || now - p.integrated_at < c.review_h * 3600e3) continue;
    // the gate is the planner's own reading, never an agent's word
    const g = await first(db, `SELECT * FROM goals WHERE id=?`, p.goal_id);
    const v = g ? await readGoal(db, g, { builtins, now }) : null;
    const moved = v != null && p.baseline != null && need(p.op) * (v - p.baseline) > c.noise * Math.max(Math.abs(p.target || 0), 0.01);
    const verdict = v == null ? 'missed' : (moved ? 'kept' : 'missed');
    const why = v == null ? 'no reading at the gate (unmeasured is not met)' : `${p.goal_id} ${p.baseline} -> ${v} (target ${p.op} ${p.target})`;
    await run(db, `UPDATE plans SET status='closed', verdict=?, measured=?, closed_at=? WHERE id=?`, verdict, v, now, p.id);
    await run(db, `UPDATE items SET status='done', blocker=NULL, disposition=?, updated_at=? WHERE id=?`, `${verdict}: ${why}`, new Date(now).toISOString(), gate.item_id);
    out.closed.push({ plan: p.id, verdict });
    await emit(db, 'closed', p.id, `plan ${p.id} ${verdict}: ${why}`, { verdict, baseline: p.baseline, measured: v }, now);
  }
  const live = (await first(db, `SELECT COUNT(*) n FROM plans WHERE status='active'`)).n;
  if (live >= c.max_active) return out;
  const goals = await all(db, `SELECT * FROM goals WHERE status='active' AND level='target' AND op IS NOT NULL AND target IS NOT NULL`);
  const ranked = [];
  for (const g of goals) { const v = await readGoal(db, g, { builtins, now }); const gp = gap(g, v); if (gp > 0) ranked.push([gp, g]); }
  ranked.sort((a, b) => b[0] - a[0] || a[1].id.localeCompare(b[1].id));
  for (const [, g] of ranked) { const id = await startPlan(db, g, { builtins, now, cfg: c, ensureItem }); if (id) { out.started = id; break; } }
  return out;
}

export async function turnKnob(db, knobId, p, now) {
  const k = await first(db, `SELECT * FROM goal_knobs WHERE id=?`, knobId);
  if (!k) return `superseded: knob ${knobId} no longer exists`;
  const dir = need(p.op) * (k.effect < 0 ? -1 : 1);
  const nv = Math.min(k.max, Math.max(k.min, Number(k.value) + dir * Number(k.step)));
  if (nv === Number(k.value)) return `done: ${knobId} already at its bound ${k.value}; the code task carries the plan`;
  await run(db, `UPDATE goal_knobs SET value=?, last_changed_at=? WHERE id=?`, nv, now, knobId);
  await run(db, `INSERT INTO goal_adjustments (at, knob_id, goal_id, old, new, why, prediction, baseline, review_after) VALUES (?,?,?,?,?,?,?,?,?)`,
    now, knobId, p.goal_id, k.value, nv, `plan ${p.id}`, p.prediction, p.baseline, now + (k.review_h || 24) * 3600e3);
  await emit(db, 'knob', p.id, `${p.id} turned ${knobId} ${k.value} -> ${nv}`, { knob: knobId, old: k.value, new: nv }, now);
  return `done: turned ${knobId} ${k.value} -> ${nv} by the planner itself`;
}

export async function readPlans(db, { limit = 20 } = {}) {
  await ensure(db);
  const plans = await all(db, `SELECT * FROM plans ORDER BY created_at DESC LIMIT ?`, limit);
  const out = [];
  for (const p of plans) {
    const tasks = await all(db, `SELECT t.item_id, t.phase, t.after, i.title, i.owner_role, i.status, i.disposition FROM plan_tasks t JOIN items i ON i.id = t.item_id WHERE t.plan_id=? ORDER BY t.rowid`, p.id);
    out.push({ id: p.id, goal: p.goal_id, attempt: p.attempt, approach: p.approach, status: p.status, verdict: p.verdict, baseline: p.baseline, measured: p.measured, op: p.op, target: p.target, prediction: p.prediction,
      created_at: new Date(p.created_at).toISOString(), tasks: tasks.map(t => ({ id: t.item_id, phase: t.phase, after: JSON.parse(t.after), title: t.title, role: t.owner_role, status: t.status, disposition: t.disposition })) });
  }
  return { phases: PHASES, approaches: APPROACHES, plans: out };
}
