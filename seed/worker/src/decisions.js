// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DECISIONS-1 (Rowan, 2026-11-18): measure what we improve and improve what we measure. Worker-side decision points (the AI router's model pick and the
// free-tier governor's level) log each decision with the metric it optimizes, the predicted effect and, once known, the measured outcome. The repo-side
// points are in foundation/decisions.py; both are declared in doctrine/decisions.json and read at /api/decisions. Rows stay 7 days in D1 (retention.json),
// then the audit chain archives them.
export const DDL = [
  'CREATE TABLE IF NOT EXISTS decision_log (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, point TEXT NOT NULL, chosen TEXT NOT NULL, metric TEXT NOT NULL, op TEXT NOT NULL, target REAL NOT NULL, predicted REAL, basis TEXT, measured REAL, hit INTEGER, settled_at INTEGER)',
  'CREATE INDEX IF NOT EXISTS decision_log_point_at ON decision_log (point, at)',
];
export const POINTS = {
  'ai-router': { metric: 'reply_pass_rate', op: '>=', target: 1 },
  'free-tier-governor': { metric: 'worst_resource_share', op: '<', target: 0.95 },
  'orchestrator-plan': { metric: 'run_integrated', op: '>=', target: 1 },
};
const OPS = { '>=': (a, b) => a >= b, '<': (a, b) => a < b };
const ensured = new WeakSet();
export async function ensure(db) { if (ensured.has(db)) return; for (const s of DDL) await db.prepare(s).run(); ensured.add(db); }
export const stats = { errors: 0, last_error: null };

export async function logDecision(db, { point, chosen, predicted = null, basis = '', measured = null, now = Date.now() }) {
  const p = POINTS[point]; if (!p) throw new Error('unregistered decision point ' + point);
  await ensure(db);
  const hit = measured == null ? null : (OPS[p.op](measured, p.target) ? 1 : 0);
  const r = await db.prepare('INSERT INTO decision_log (at,point,chosen,metric,op,target,predicted,basis,measured,hit,settled_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)')
    .bind(now, point, String(chosen).slice(0, 80), p.metric, p.op, p.target, predicted, String(basis).slice(0, 200), measured, hit, measured == null ? null : now).run();
  return r && r.meta && r.meta.last_row_id;
}
// A logging failure never breaks the decision it measures, and is never silent: it is counted and shown at /api/decisions.
export async function safely(fn) { try { return await fn(); } catch (e) { stats.errors++; stats.last_error = String(e && e.message).slice(0, 120); return null; } }

// DECISION-METRIC: ai-router
// AI router: one decision per model call that reached a model. predicted = the model's learned pass rate before this call (0.5 prior until 8 calls).
export async function recordRoute(db, { kind, model, ok, now = Date.now() }) {
  await ensure(db);
  let predicted = 0.5, basis = 'prior (fewer than 8 calls)';
  const s = await db.prepare('SELECT calls, passes FROM airouter_stats WHERE kind=?1 AND model=?2').bind(kind, model).first().catch(() => null);
  if (s && s.calls - 1 >= 8) { predicted = (s.passes - (ok ? 1 : 0)) / (s.calls - 1); basis = `learned pass rate over ${s.calls - 1} calls`; }
  return logDecision(db, { point: 'ai-router', chosen: model + ' for ' + kind, predicted, basis, measured: ok ? 1 : 0, now });
}

// DECISION-METRIC: orchestrator-plan
// Orchestrator (ORCHESTRATE-1): one decision per accepted plan. predicted = the share of earlier planned runs that ended in a PR (0.5 prior until 4 are
// settled); measured = 1 when this run opened its PR, 0 when it ended failed. `chosen` is the run id, so the settle finds its own row.
export async function recordPlan(db, { run, steps, now = Date.now() }) {
  await ensure(db);
  const s = await db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(measured), 0) AS ok FROM decision_log WHERE point=?1 AND settled_at IS NOT NULL').bind('orchestrator-plan').first().catch(() => null);
  const known = s && s.n >= 4;
  return logDecision(db, { point: 'orchestrator-plan', chosen: run, predicted: known ? s.ok / s.n : 0.5, basis: `${steps} steps; ${known ? `share of ${s.n} settled runs that opened a PR` : 'prior (fewer than 4 settled runs)'}`, now });
}
export async function settlePlan(db, { run, ok, now = Date.now() }) {
  await ensure(db);
  const r = await db.prepare('UPDATE decision_log SET measured=?1, hit=?1, settled_at=?2 WHERE point=?3 AND chosen=?4 AND settled_at IS NULL').bind(ok ? 1 : 0, now, 'orchestrator-plan', String(run).slice(0, 80)).run();
  return (r && r.meta && r.meta.changes) || 0;
}

// DECISION-METRIC: free-tier-governor
// Free-tier governor: settle the earlier decisions at least an hour old with the worst share now, then log the level just set (on a change, or every 6 h).
export async function recordGovernor(db, ft, now = Date.now()) {
  if (!ft || !ft.resources) return { status: 'unmeasured' };
  const fracs = Object.values(ft.resources).map(r => Number(r.frac)).filter(Number.isFinite);
  if (!fracs.length) return { status: 'unmeasured' };
  const worst = Math.max(...fracs);
  await ensure(db);
  const open = (await db.prepare('SELECT id FROM decision_log WHERE point=?1 AND settled_at IS NULL AND at<=?2').bind('free-tier-governor', now - 3600e3).all()).results || [];
  for (const o of open) await db.prepare('UPDATE decision_log SET measured=?1, hit=?2, settled_at=?3 WHERE id=?4').bind(worst, worst < POINTS['free-tier-governor'].target ? 1 : 0, now, o.id).run();
  const last = await db.prepare('SELECT at, chosen FROM decision_log WHERE point=?1 ORDER BY at DESC LIMIT 1').bind('free-tier-governor').first();
  if (last && last.chosen === ft.level && now - last.at < 6 * 3600e3) return { status: 'kept', settled: open.length };
  await logDecision(db, { point: 'free-tier-governor', chosen: ft.level, predicted: worst, basis: `worst share ${worst.toFixed(3)} now; level ${ft.level}`, now });
  return { status: 'logged', settled: open.length };
}

// Public read: per point, decisions in the last 7 days, scored, hit rate, mean absolute prediction error, a daily series and the improvement verdict.
export async function readDecisions(db, now = Date.now()) {
  await ensure(db);
  const since = now - 7 * 864e5, out = {};
  for (const point of Object.keys(POINTS)) {
    const rows = (await db.prepare('SELECT at, predicted, measured, hit FROM decision_log WHERE point=?1 AND at>=?2 ORDER BY at').bind(point, since).all()).results || [];
    const sc = rows.filter(r => r.measured != null), days = {};
    for (const r of rows) { const d = new Date(r.at).toISOString().slice(0, 10), x = days[d] ??= { day: d, decisions: 0, scored: 0, hits: 0 }; x.decisions++; if (r.measured != null) { x.scored++; x.hits += r.hit ? 1 : 0; } }
    const h = Math.floor(sc.length / 2), mean = a => a.reduce((s, r) => s + r.measured, 0) / (a.length || 1);
    let trend = { verdict: 'insufficient', need: 4, have: sc.length };
    if (sc.length >= 4) { const a = mean(sc.slice(0, h)), b = mean(sc.slice(h)), d = (b - a) / (Math.abs(a) || 1); trend = { verdict: d > 0.05 ? 'improving' : d < -0.05 ? 'worse' : 'flat', older_mean: +a.toFixed(4), newer_mean: +b.toFixed(4) }; }
    out[point] = { decisions: rows.length, scored: sc.length, hits: sc.filter(r => r.hit).length, hit_rate: sc.length ? +(sc.filter(r => r.hit).length / sc.length).toFixed(3) : null,
      mean_abs_error: sc.length && sc.every(r => r.predicted != null) ? +(sc.reduce((s, r) => s + Math.abs(r.measured - r.predicted), 0) / sc.length).toFixed(3) : null,
      last_at: rows.length ? new Date(rows[rows.length - 1].at).toISOString() : null, by_day: Object.values(days).slice(-14), trend };
  }
  return { as_of: new Date(now).toISOString(), window_days: 7, logging_errors: stats.errors, last_logging_error: stats.last_error, points: out };
}
