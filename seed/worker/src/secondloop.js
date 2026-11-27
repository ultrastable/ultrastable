// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SECOND-LOOP-KERNEL-1 (Rowan, 2026-11-27): "Implement Ashby's journal and concept index into working parts of an autonomous AI system."
// Every concept in seed/autonomy/secondloop.json names one export of this file (test/secondloop.test.js fails when it does not), with the page of
// W. Ross Ashby's journal (ashby.info) or the published source it comes from. The archive forbids reproduction, so the register holds page
// numbers, addresses and our own statements only: no image, no transcription.
// Pure functions first (a tenant vendors them unchanged); the tick step `second_goal` at the end is the one part that reads a database.
// What is deliberately not Ashby's: the search. His uniselector draws blindly and his own arithmetic shows that it does not scale; selectStep
// is guided by a model, keeps a share of blind draws for when the model is wrong, and never draws a candidate that cannot be undone.

// ---- 1. Essential variables (journal 4015: they must be several; Perez Lopez 1974: a system dies when it does not know one is disturbed) ----
// ev: { id, partition, lower, upper, severity: 'hard'|'soft' }. A missing or non-numeric reading is outside limits: unmeasured is never ok.
export function inLimits(ev, value) {
  if (value === null || value === undefined || typeof value !== 'number' || Number.isNaN(value)) return false;
  if (ev.lower != null && value < ev.lower) return false;
  if (ev.upper != null && value > ev.upper) return false;
  return true;
}
export const bounded = ev => ev.lower != null || ev.upper != null;   // ASHBY-1: a variable with no limit can never start the second loop

// values: this variable's readings, oldest first. A hard limit breaches on the newest reading alone; a soft one must stay out for
// `persistence` further readings, so the slow loop does not chase the noise the fast loop is already correcting (timescale separation).
export function breached(ev, values, { persistence = 2 } = {}) {
  if (!values || !values.length) return true;
  const need = ev.severity === 'hard' ? 1 : persistence + 1;
  if (values.length < need) return ev.severity === 'hard' ? !inLimits(ev, values[values.length - 1]) : false;
  return values.slice(-need).every(v => !inLimits(ev, v));
}

// ---- 2. Step mechanism: the second feedback (journal 0995, 1041, 5775; a step usable once is spent, 3436) ----
// A seeded generator, so every draw in a test or a trial can be replayed.
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const STEP_DEFAULTS = { budget_per_day: 5, cooldown_ticks: 1, settle_ticks: 3, epsilon: 0.2 };

// repertoire: [{ id, reversible, action_classes: [] }]. tried: ids already drawn in this episode. cleared: action classes the trust ledger
// allows for irreversible effects. predict(candidate) -> expected share of essential variables back in limits (0..1), or null when unmodelled.
// Returns { candidate, why } or { candidate: null, why } when the repertoire is spent (the caller escalates; it never re-draws a spent step).
export function selectStep({ repertoire = [], tried = [], cleared = [], predict = null, random = Math.random, epsilon = STEP_DEFAULTS.epsilon } = {}) {
  const open = repertoire.filter(c => !tried.includes(c.id));
  if (!open.length) return { candidate: null, why: 'repertoire spent' };
  const safe = open.filter(c => c.reversible !== false || (c.action_classes || []).every(a => cleared.includes(a)));
  if (!safe.length) return { candidate: null, why: 'every untried step is irreversible and not cleared' };
  const scored = predict ? safe.map(c => ({ c, p: predict(c) })).filter(x => typeof x.p === 'number' && !Number.isNaN(x.p)) : [];
  if (!scored.length || random() < epsilon) return { candidate: safe[Math.floor(random() * safe.length)], why: scored.length ? 'blind draw (epsilon)' : 'blind draw (no model)' };
  scored.sort((a, b) => b.p - a.p || (a.c.id < b.c.id ? -1 : 1));
  return { candidate: scored[0].c, why: `model: ${scored[0].p}` };
}

// state: { steps_today, last_step_tick, trial: { id, start_tick } | null }. One decision per partition per tick.
// 'hold' = a trial is settling or the cooldown runs; 'step' = draw now; 'escalate' = the day's budget is spent (thrash guard).
export function stepDecision(state = {}, tick, isBreached, cfg = {}) {
  const c = { ...STEP_DEFAULTS, ...cfg };
  if (state.trial) return { act: 'hold', why: 'trial settling' };
  if (!isBreached) return { act: 'none', why: 'essential variables in limits' };
  if ((state.steps_today || 0) >= c.budget_per_day) return { act: 'escalate', why: `step budget ${c.budget_per_day} spent` };
  if (state.last_step_tick != null && tick - state.last_step_tick <= c.cooldown_ticks) return { act: 'hold', why: 'cooldown' };
  return { act: 'step', why: 'essential variable out of limits' };
}

// okByTick: for each tick since the trial began, whether every essential variable of the partition was in limits. A step is kept only when the
// variables held for settle_ticks in a row; a window that ends without that is rolled back, so no change survives on hope.
export function settle(trial, tick, okByTick = [], cfg = {}) {
  const c = { ...STEP_DEFAULTS, ...cfg };
  const tail = okByTick.slice(-c.settle_ticks);
  if (tail.length === c.settle_ticks && tail.every(Boolean)) return 'commit';
  return tick - trial.start_tick >= 2 * c.settle_ticks ? 'rollback' : 'wait';
}

// ---- 3. Multistable system: gating and discriminative feedback (journal 5436, 5345, 5369, 5410) ----
// Only a partition whose own essential variable is out of limits may step. A partition coupled to a breached one and itself in limits is
// spared: correcting it would undo an adaptation that works (5360).
export function gate(breachedByPartition = {}, couplings = []) {
  const step = Object.keys(breachedByPartition).filter(p => breachedByPartition[p]).sort();
  const near = new Set();
  for (const e of couplings) { if (step.includes(e.src) && !step.includes(e.dst)) near.add(e.dst); if (step.includes(e.dst) && !step.includes(e.src)) near.add(e.src); }
  return { step, spared: [...near].sort() };
}

// commits: [{ partition, tick }], breaches: [{ partition, tick }]. The share of commits followed within `window` ticks by a breach in a
// different partition: how often one part's adaptation upset another's (retention; the hidden channel is the shared environment, 3924).
export function interference(commits = [], breaches = [], window = 3) {
  if (!commits.length) return { rate: null, n: 0, hits: [] };
  const hits = commits.filter(c => breaches.some(b => b.partition !== c.partition && b.tick > c.tick && b.tick - c.tick <= window));
  return { rate: hits.length / commits.length, n: commits.length, hits };
}

// ---- 4. Coupling guard (Gardner and Ashby 1970; May 1972; journal 1905: few, simple joins) ----
const matmul = (A, B) => A.map((r, i) => B[0].map((_, j) => r.reduce((s, _v, k) => s + A[i][k] * B[k][j], 0)));
const norm1 = A => Math.max(...A[0].map((_, j) => A.reduce((s, r) => s + Math.abs(r[j]), 0)));
// The largest real part among the eigenvalues of A, read as the growth rate of exp(At): exp(A) by scaling and squaring, then squared 24
// times with the norm taken out at every step. Negative means every disturbance of the linear system dies out.
export function spectralAbscissa(A) {
  const n = A.length; if (!n) return -Infinity;
  const s = Math.max(0, Math.ceil(Math.log2(Math.max(norm1(A), 1e-12))) + 1), k = 2 ** s;
  const I = A.map((_, i) => A.map((__, j) => (i === j ? 1 : 0)));
  const As = A.map(r => r.map(v => v / k));
  let E = I.map(r => r.slice()), term = I.map(r => r.slice());
  for (let i = 1; i <= 14; i++) { term = matmul(term, As).map(r => r.map(v => v / i)); E = E.map((r, a) => r.map((v, b) => v + term[a][b])); }
  for (let i = 0; i < s; i++) E = matmul(E, E);
  let log = 0, pow = 1;
  for (let i = 0; i < 24; i++) {
    const m = norm1(E); if (m === 0) return -Infinity;
    log += Math.log(m) / pow; E = matmul(E.map(r => r.map(v => v / m)), E.map(r => r.map(v => v / m))); pow *= 2;
  }
  return log + Math.log(norm1(E)) / pow;
}
export const connectance = (n, edges) => (n < 2 ? 0 : edges / (n * (n - 1)));

// parts: ids. couplings: [{ src, dst, strength }]. damping: how fast a part settles alone. A new coupling is admitted only when the graph
// stays sparse and the linearised whole still settles. The 0.10 limit is a conservative default taken from random linear systems; it is a
// heuristic for agent loops, not a theorem about them.
export function couplingGuard({ parts = [], couplings = [], damping = 1, max_connectance = 0.10 } = {}) {
  const n = parts.length, ix = Object.fromEntries(parts.map((p, i) => [p, i]));
  const A = parts.map((_, i) => parts.map((__, j) => (i === j ? -damping : 0)));
  const reasons = [];
  for (const e of couplings) {
    if (!(e.src in ix) || !(e.dst in ix)) { reasons.push(`coupling names an unknown part: ${e.src} -> ${e.dst}`); continue; }
    if (e.src !== e.dst) A[ix[e.dst]][ix[e.src]] += Number(e.strength) || 0;
  }
  const pairs = new Set(couplings.filter(e => e.src !== e.dst && e.src in ix && e.dst in ix).map(e => `${e.src}>${e.dst}`)).size;
  const C = connectance(n, pairs), a = spectralAbscissa(A);
  if (C > max_connectance + 1e-12) reasons.push(`connectance ${C.toFixed(3)} is above ${max_connectance}`);
  if (!(a < 0)) reasons.push(`the coupled whole does not settle (growth rate ${a.toFixed(4)})`);
  return { ok: !reasons.length, connectance: C, growth_rate: a, reasons };
}

// ---- 5. Requisite variety (An Introduction to Cybernetics, ch. 11) ----
// The law is a bound, not a method: outcomes cannot be held to fewer than V(D) - V(R) bits. Counted in distinct disturbance classes, never in
// tools: two responses to the same disturbance add redundancy, not coverage.
export const varietyBound = (disturbances, responses) => Math.max(0, Math.log2(Math.max(1, disturbances)) - Math.log2(Math.max(1, responses)));
// disturbances: [{ id, frequency }], responses: [{ disturbance, action, success_rate }].
export function varietyLedger(disturbances = [], responses = [], theta = 0.8) {
  const good = new Map();
  for (const r of responses) if (r.success_rate >= theta) good.set(r.disturbance, [...(good.get(r.disturbance) || []), r.action]);
  const total = disturbances.reduce((s, d) => s + (d.frequency || 0), 0);
  const open = disturbances.filter(d => !good.has(d.id));
  return {
    coverage: disturbances.length ? (disturbances.length - open.length) / disturbances.length : null,
    residual: total ? open.reduce((s, d) => s + (d.frequency || 0), 0) / total : null,
    uncovered: open.map(d => d.id).sort(),
    redundant: [...good].filter(([, a]) => a.length > 1).map(([d, a]) => ({ disturbance: d, actions: a.length })),
    bound_bits: varietyBound(disturbances.length, new Set([...good.values()].flat()).size),
  };
}

// ---- 6. The regulator's model (Conant and Ashby 1970; journal 3499) ----
// predictions: [{ p, outcome }], p = stated chance that the essential variables return to limits, outcome 0 or 1. The theorem promises less
// than its slogan, so the model is not trusted: it is scored, and selectStep falls back to blind draws when it is no better than a coin.
export function calibration(predictions = [], { coin = 0.25, least = 5 } = {}) {
  const ok = predictions.filter(x => typeof x.p === 'number' && (x.outcome === 0 || x.outcome === 1));
  if (ok.length < least) return { brier: null, n: ok.length, usable: false };
  const brier = ok.reduce((s, x) => s + (x.p - x.outcome) ** 2, 0) / ok.length;
  return { brier, n: ok.length, usable: brier < coin };
}

// ---- 7. Habituation and forgetting (journal 3706, 4529, 3860) ----
// How loudly a repeated disturbance that never breached still alerts. It halves every half_life_days of harmless repeats; a hard essential
// variable never habituates, which is the guard against a slow drift nobody reacts to.
export function sensitivity({ harmless_days = 0, half_life_days = 7, severity = 'soft' } = {}) {
  return severity === 'hard' ? 1 : 0.5 ** (Math.max(0, harmless_days) / half_life_days);
}

// ---- 8. Perez Lopez 1974: experience is not wisdom; the explicit goal is subordinate to the essential variables ----
// history: per evaluation window, oldest first, { effectiveness, efficiency }. effectiveness is what the action does for its explicit goal;
// efficiency is what it does to everything else the actor needs, learnt only by doing it. An action whose efficiency fell in each of the last
// `windows` steps is retired from the repertoire: the built-in mechanism an ultrastable system has and an organisation must be given.
export function actionEval(history = [], { windows = 5 } = {}) {
  const e = history.map(h => h.efficiency).filter(v => typeof v === 'number');
  const d = e.slice(1).map((v, i) => v - e[i]);
  const tail = d.slice(-windows);
  const retire = tail.length === windows && tail.every(x => x < 0);
  let falling = 0; for (let i = d.length - 1; i >= 0 && d[i] < 0; i--) falling++;
  return { consistency: d.length ? d[d.length - 1] : null, falling_for: falling, retire };
}
// Negative learning: the measured goal rose while the efficiency of the actions that produced it fell. The score improved and the system got worse.
export function negativeLearning(objective = [], efficiency = []) {
  if (objective.length < 2 || efficiency.length < 2) return null;
  return objective[objective.length - 1] > objective[0] && efficiency[efficiency.length - 1] < efficiency[0];
}
// Lexicographic choice: a candidate predicted to push any essential variable out of limits is not eligible, whatever it does for the goal.
// candidates: [{ id, objective, ev: { <ev id>: predicted value } }], evs: [{ id, lower, upper }].
export function lexicographic(candidates = [], evs = []) {
  const eligible = candidates.filter(c => evs.every(v => !(c.ev && v.id in c.ev) || inLimits(v, c.ev[v.id])));
  eligible.sort((a, b) => (b.objective || 0) - (a.objective || 0) || (a.id < b.id ? -1 : 1));
  return { choice: eligible[0] || null, refused: candidates.filter(c => !eligible.includes(c)).map(c => c.id).sort() };
}
// "Pride": removing from what is recalled the memories that show a past action was wrong. rollbacks: [{ action_class }] on record;
// evoked: the same records as retrieved when that action class is proposed again. Below 1.0 the system is forgetting its own failures.
export function failureRecall(rollbacks = [], evoked = []) {
  if (!rollbacks.length) return { rate: null, n: 0, missing: [] };
  const got = new Set(evoked.map(r => r.id));
  const missing = rollbacks.filter(r => !got.has(r.id)).map(r => r.id);
  return { rate: (rollbacks.length - missing.length) / rollbacks.length, n: rollbacks.length, missing };
}
// rows: metrics as the tick stores them ({ id, objective_id, kind: 'target'|'guard'|'liveness', breached, owner_role }). Per objective:
// uncovered = it has a target and no guard of its own, so its only measure is the one it is optimising; inverted = every target is healthy
// while a guard is out of limits, the state in which a goal-seeking system reports success.
export function twoGoal(rows = []) {
  const by = new Map();
  for (const r of rows) { if (!r.objective_id) continue; const o = by.get(r.objective_id) || { targets: [], guards: [] }; (r.kind === 'target' ? o.targets : r.kind === 'guard' ? o.guards : []).push(r); by.set(r.objective_id, o); }
  const uncovered = [], inverted = [];
  for (const [id, o] of [...by].sort()) {
    if (!o.targets.length) continue;
    if (!o.guards.length) { uncovered.push({ objective: id, owner_role: o.targets[0].owner_role }); continue; }
    const out = o.guards.filter(g => g.breached);
    if (out.length && o.targets.every(t => !t.breached)) inverted.push({ objective: id, guards: out.map(g => g.id).sort() });
  }
  const withTarget = [...by.values()].filter(o => o.targets.length).length;
  return { objectives: withTarget, coverage: withTarget ? (withTarget - uncovered.length) / withTarget : null, uncovered, inverted };
}

// ---- 9. The homeostat as a test harness (journal 2094, 2432; Design for a Brain) ----
// n units, dx_i/dt = -k x_i + sum_j w_ij x_j. Each unit's essential variable is |x_i| <= limit. A unit that leaves its limit re-draws its
// own input weights from a 25-position table (the uniselector) and is set back inside. mode 'local': only the unit in breach re-draws;
// mode 'joint': any breach re-draws every unit (the fully joined system of Ashby's adaptation-time argument). blocks: sizes of independent
// sub-systems (weights between blocks are zero), the multistable arrangement. Returns the run, replayable from its seed.
export function homeostat({ n = 4, mode = 'local', seed = 1, limit = 1, k = 1, dt = 0.02, positions = 25, stable_steps = 500, max_steps = 200000, blocks = null, W = null, x = null } = {}) {
  const r = rng(seed), table = Array.from({ length: positions }, (_, i) => -1 + (2 * i) / (positions - 1));
  const block = []; if (blocks) blocks.forEach((size, b) => { for (let i = 0; i < size; i++) block.push(b); });
  const joined = (i, j) => !blocks || block[i] === block[j];
  const draw = i => { for (let j = 0; j < n; j++) w[i][j] = i === j || !joined(i, j) ? 0 : table[Math.floor(r() * positions)]; };
  const w = W ? W.map(row => row.slice()) : Array.from({ length: n }, () => new Array(n).fill(0));
  if (!W) for (let i = 0; i < n; i++) draw(i);
  let s = x ? x.slice() : Array.from({ length: n }, () => (r() * 2 - 1) * limit * 0.5);
  let redraws = 0, calm = 0, steps = 0;
  for (; steps < max_steps && calm < stable_steps; steps++) {
    const next = s.map((v, i) => v + dt * (-k * v + w[i].reduce((a, wij, j) => a + wij * s[j], 0)));
    const out = next.map((v, i) => (Math.abs(v) > limit ? i : -1)).filter(i => i >= 0);
    if (out.length) {
      calm = 0;
      const again = mode === 'joint' ? (blocks ? [...new Set(out.flatMap(i => next.map((_, j) => j).filter(j => block[j] === block[i])))] : next.map((_, j) => j)) : out;
      for (const i of again) { draw(i); redraws++; }
      for (const i of out) next[i] = Math.sign(next[i]) * limit * 0.5;
    } else calm++;
    s = next;
  }
  return { stable: calm >= stable_steps, steps, redraws, W: w, x: s };
}

// ---- 10. The tick step: the second goal, read from the system's own metrics (one indexed read, no model call) ----
// Target metrics are the explicit goal; guard metrics are the objective's own essential variables. Two things are enforced each tick:
// (a) an objective that has a target and no guard gets one item, EV-COVERAGE, closed only by the same reading;
// (b) where every target is healthy and a guard is out of limits, the guard's open breach item goes to the head of the queue, so the
//     essential variable is repaired before the goal is pursued further. The reading is kept in org.second_goal for /health and the dashboard.
export const COVERAGE_ITEM = 'EV-COVERAGE';
export async function secondGoalStep(db, ctx, ensureItem) {
  const tenant = (ctx.config && ctx.config.org_slug) || '';
  const res = await db.prepare(`SELECT id, objective_id, kind, breached, owner_role FROM metrics WHERE tenant_id IS NULL OR tenant_id = ?`).bind(tenant).all();
  const reading = twoGoal(res.results || []);
  let raised = 0;
  for (const o of reading.inverted) for (const g of o.guards) {
    const u = await db.prepare(`UPDATE items SET priority = 0, updated_at = ? WHERE id = ? AND priority > 0 AND status NOT IN ('done','superseded','cancelled')`).bind(ctx.nowIso, `BREACH-${g}`).run();
    raised += (u.meta && u.meta.changes) || 0;
  }
  if (reading.uncovered.length) {
    await db.prepare(`UPDATE items SET status = 'ready', disposition = NULL, updated_at = ? WHERE id = ? AND status IN ('done','superseded','cancelled')`).bind(ctx.nowIso, COVERAGE_ITEM).run();
    await ensureItem(db, {
      id: COVERAGE_ITEM, kind: 'fix', priority: 20, owner_role: reading.uncovered[0].owner_role,
      title: `essential_variable_coverage: ${reading.uncovered.length} objective(s) are measured only by their own target (${reading.uncovered.map(u => u.objective).join(', ')}). Give each a probe-backed guard metric (kind guard) that its target does not move.`.slice(0, 400),
      done_check: 'every objective with a target metric has at least one guard metric', closing_probe: 'second_goal:ev_coverage',
    });
  } else {
    await db.prepare(`UPDATE items SET status = 'done', disposition = 'fixed: every objective with a target has a guard metric', updated_at = ? WHERE id = ? AND status NOT IN ('done','superseded','cancelled')`).bind(ctx.nowIso, COVERAGE_ITEM).run();
  }
  const snap = { at: ctx.nowIso, objectives: reading.objectives, ev_coverage: reading.coverage, uncovered: reading.uncovered.map(u => u.objective), inverted: reading.inverted, raised };
  await db.prepare(`INSERT INTO org (key, value) VALUES ('second_goal', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(JSON.stringify(snap)).run();
  ctx.notes.push(`second_goal: ${reading.objectives} objective(s), guard coverage ${reading.coverage === null ? 'unmeasured' : reading.coverage.toFixed(2)}, ${reading.inverted.length} goal-before-guard, ${raised} raised`);
  return snap;
}
