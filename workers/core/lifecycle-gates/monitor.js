// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Monitoring and controlling (US-SPEC-15 A-MON-4, A-MON-6, US-15-R15, R16): the risk and issue review, the quality metrics, and the
// per-project compliance report. Every finding is an item for its owner role and is closed by the same step when the reading clears.
import { all, first, run, iso, parseIso, assertReadOnly, ensureItem, TERMINAL_SQL } from '../kernel/util.js';
import { addRisk, CATALOG } from '../kernel/lifecycle.js';

const HOUR = 3600e3;
const filled = (v) => v !== null && v !== undefined && String(v).trim() !== '';
const slug = (x) => String(x).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
const periodH = async (db, projectId, status_period_h = 168) => (await first(db, `SELECT period_h FROM lifecycle_comm_plans WHERE project_id = ?`, projectId))?.period_h ?? status_period_h;
const PROJECT_ITEMS = `(i.project = ? OR i.project = ?)`;

// A risk's trigger that is a read-only SELECT is evaluated: a value of 1 or more sets the risk to triggered and files an item for its
// owner (the project manager when none is named), once. A trigger written as prose is a trigger for people and is left alone.
export async function evaluateRisks(db, { project_id, now = Date.now() }) {
  const triggered = [], errors = [];
  for (const r of await all(db, `SELECT * FROM risks WHERE project_id = ? AND status = 'open' ORDER BY id`, project_id)) {
    if (!filled(r.trigger) || !/^\s*select\b/i.test(r.trigger)) continue;
    let v = null;
    try { const row = await first(db, assertReadOnly(r.trigger)); v = row ? Number(row.value ?? Object.values(row)[0]) : null; }
    catch (e) { errors.push({ risk_id: r.id, why: `the trigger probe fails: ${e.message}` }); continue; }
    if (v !== null && Number.isFinite(v) && v >= 1) {
      await run(db, `UPDATE risks SET status = 'triggered' WHERE id = ?`, r.id);
      await ensureItem(db, { id: `RISK-${project_id}-${r.id}`, title: `Risk ${r.id} of ${project_id} has triggered: ${r.cause} -> ${r.effect}`, kind: 'work', owner_role: r.owner_role || 'project-manager', project: project_id, priority: 10,
        done_check: r.response || 'the named response is carried out and the risk is closed', closing_probe: `risk ${r.id} status is closed` });
      triggered.push(r.id);
    }
  }
  return { triggered, errors };
}

// US-15-R15. Adds the new risks, evaluates every trigger probe, flags what the register and the issues lack, and records the review.
export async function recordRiskReview(db, { project_id, reviewer, new_risks = [], now = Date.now() }) {
  if (!(await first(db, `SELECT 1 AS x FROM kernel_projects WHERE id = ?`, project_id))) throw new Error('unknown project');
  if (!filled(reviewer)) throw new Error('a risk review names its reviewer');
  for (const r of new_risks) await addRisk(db, { ...r, project_id });
  const ev = await evaluateRisks(db, { project_id, now });
  const flagged = ev.errors.map(e => ({ kind: 'risk', id: e.risk_id, why: e.why }));
  const active = await all(db, `SELECT * FROM risks WHERE project_id = ? AND status IN ('open','triggered') ORDER BY id`, project_id);
  for (const r of active) {
    const lacks = ['response', 'owner_role', 'trigger'].filter(f => !filled(r[f]));
    if (!lacks.length) continue;
    flagged.push({ kind: 'risk', id: r.id, why: `lacks ${lacks.join(', ')}` });
    await ensureItem(db, { id: `RISKFIX-${project_id}-${r.id}`, title: `Risk ${r.id} of ${project_id} lacks ${lacks.join(', ')}`, kind: 'work', owner_role: 'project-manager', project: project_id, priority: 30,
      done_check: `risk ${r.id} names its ${lacks.join(', ')}`, closing_probe: `risk ${r.id} has a response, an owner role and a trigger` });
  }
  const prog = (await first(db, `SELECT program_id FROM kernel_projects WHERE id = ?`, project_id)).program_id ?? project_id;
  for (const it of await all(db, `SELECT i.id, i.owner_role, i.closing_probe FROM items i WHERE i.kind = 'fix' AND i.status NOT IN ${TERMINAL_SQL} AND ${PROJECT_ITEMS} ORDER BY i.id`, project_id, prog)) {
    const lacks = [!filled(it.owner_role) && 'owner', !filled(it.closing_probe) && 'closing probe'].filter(Boolean);
    if (!lacks.length) continue;
    flagged.push({ kind: 'issue', id: it.id, why: `lacks ${lacks.join(' and ')}` });
    await ensureItem(db, { id: `ISSUEPROBE-${it.id}`, title: `Issue ${it.id} has no ${lacks.join(' and ')}`, kind: 'work', owner_role: 'project-manager', project: project_id, priority: 20,
      done_check: `issue ${it.id} has an owner and a closing probe`, closing_probe: `issue ${it.id} names both` });
  }
  const r = await run(db, `INSERT INTO lifecycle_risk_reviews (project_id, reviewer, reviewed_at, open_risks, triggered, flagged) VALUES (?,?,?,?,?,?)`,
    project_id, reviewer, iso(now), active.length, JSON.stringify(ev.triggered), JSON.stringify(flagged));
  return { id: r.meta.last_row_id, open_risks: active.length, triggered: ev.triggered, flagged };
}

// A review that is due (older than the project's period) is one item for the project manager, numbered after the reviews so far.
export async function riskReviewDue(db, { now = Date.now(), status_period_h = 168 } = {}) {
  const filed = [];
  for (const p of await all(db, `SELECT id, created_at FROM kernel_projects WHERE current_phase IN ('planning','executing','closing') ORDER BY id`)) {
    const last = (await first(db, `SELECT MAX(reviewed_at) AS at FROM lifecycle_risk_reviews WHERE project_id = ?`, p.id))?.at || p.created_at;
    if ((now - parseIso(last)) / HOUR < await periodH(db, p.id, status_period_h)) continue;
    const n = (await first(db, `SELECT COUNT(*) AS n FROM lifecycle_risk_reviews WHERE project_id = ?`, p.id)).n + 1, id = `RISKREVIEW-${p.id}-${n}`;
    if (await ensureItem(db, { id, title: `Review the risk and issue register of ${p.id} (review ${n})`, kind: 'work', owner_role: 'project-manager', project: p.id, priority: 30,
      done_check: 'a risk review is recorded: new risks added, triggers read, issues with an owner and a probe', closing_probe: `a lifecycle_risk_reviews row exists for ${p.id} after ${last}` })) filed.push(id);
  }
  return filed;
}

// US-15-R16. Three values from the project's own records; a value with nothing to measure is null, never 0.
export async function computeQuality(db, project_id, { now = Date.now() } = {}) {
  const p = await first(db, `SELECT * FROM kernel_projects WHERE id = ?`, project_id);
  if (!p) throw new Error('unknown project');
  const prog = p.program_id ?? project_id, n = async (sql, ...a) => (await first(db, sql, ...a)).n;
  const rejected = await n(`SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ? AND status = 'rejected'`, project_id);
  const reviewed = await n(`SELECT COUNT(*) AS n FROM artifacts WHERE project_id = ? AND status IN ('reviewed','rejected')`, project_id);
  const probesRun = await n(`SELECT COUNT(*) AS n FROM lifecycle_deliverables WHERE project_id = ? AND probe_passed IS NOT NULL`, project_id);
  const probesPassed = await n(`SELECT COUNT(*) AS n FROM lifecycle_deliverables WHERE project_id = ? AND probe_passed = 1`, project_id);
  const reverted = await n(`SELECT COUNT(*) AS n FROM kernel_decisions WHERE program_id IN (?, ?) AND status = 'reverted'`, project_id, prog);
  const scored = await n(`SELECT COUNT(*) AS n FROM kernel_decisions WHERE program_id IN (?, ?) AND status IN ('kept','scored','reverted')`, project_id, prog);
  const denom = reviewed + probesRun + scored;
  const closedAt = (await first(db, `SELECT entered_at AS at FROM phases WHERE project_id = ? AND phase = 'closing'`, project_id))?.at ?? null;
  const firstPass = (await first(db, `SELECT MIN(probe_at) AS at FROM lifecycle_deliverables WHERE project_id = ? AND probe_passed = 1`, project_id))?.at ?? null;
  const since = [closedAt, firstPass].filter(Boolean).sort()[0] ?? null;      // nothing escaped from a project that has delivered nothing yet
  const escaped = since === null ? null : await n(`SELECT COUNT(*) AS n FROM items i WHERE i.kind = 'fix' AND ${PROJECT_ITEMS} AND i.created_at > ?`, project_id, prog, since);
  const q = { rework_rate: denom ? (rejected + (probesRun - probesPassed) + reverted) / denom : null, defects_escaped: escaped, probe_pass_rate: probesRun ? probesPassed / probesRun : null };
  const inputs = { rejected, reviewed, probes_run: probesRun, probes_passed: probesPassed, decisions_reverted: reverted, decisions_scored: scored, escaped_since: since };
  const r = await run(db, `INSERT INTO lifecycle_quality (project_id, at, rework_rate, defects_escaped, probe_pass_rate, inputs) VALUES (?,?,?,?,?,?)`, project_id, iso(now), q.rework_rate, q.defects_escaped, q.probe_pass_rate, JSON.stringify(inputs));
  return { id: r.meta.last_row_id, ...q, inputs };
}
export const qualityLine = (q) => `quality: rework ${q?.rework_rate == null ? 'unmeasured' : q.rework_rate.toFixed(2)}, escaped ${q?.defects_escaped ?? 'unmeasured'}, probes passed ${q?.probe_pass_rate == null ? 'unmeasured' : q.probe_pass_rate.toFixed(2)}`;

// The per-project compliance report (the project-level twin of the management compliance check): what the lifecycle requires of the
// project now and does not find. One item per finding for its owner role, closed by this function when the finding clears.
export async function complianceReport(db, { project_id, now = Date.now(), status_period_h = 168 }) {
  const p = await first(db, `SELECT * FROM kernel_projects WHERE id = ?`, project_id);
  if (!p) throw new Error('unknown project');
  const period = await periodH(db, project_id, status_period_h), findings = [];
  const add = (slugText, owner, text) => findings.push({ slug: slugText, owner, text });
  const order = ['initiating', 'planning', 'executing', 'closing', 'closed'], at = order.indexOf(p.current_phase);
  for (const c of CATALOG) { // an artifact of a phase whose gate was passed stays required, reviewed by another agent
    if (!(await first(db, `SELECT 1 AS x FROM phases WHERE project_id = ? AND phase = ? AND gate_passed_at IS NOT NULL`, project_id, c.phase))) continue;
    const a = await first(db, `SELECT status, reviewed_by, produced_by FROM artifacts WHERE project_id = ? AND kind = ?`, project_id, c.kind);
    if (!a) add(`artifact-${c.kind}`, c.owner_role, `artifact ${c.kind} is missing although its gate was passed`);
    else if (a.status !== 'reviewed' || !a.reviewed_by || a.reviewed_by === a.produced_by) add(`review-${c.kind}`, 'reviewer', `artifact ${c.kind} has no fresh review by another agent`);
  }
  if (at >= 2 && at <= 3) {
    const lastReport = (await first(db, `SELECT MAX(at) AS at FROM lifecycle_status_reports WHERE project_id = ?`, project_id))?.at || p.created_at;
    if ((now - parseIso(lastReport)) / HOUR >= 2 * period) add('status-report', 'project-manager', `no status report for ${Math.floor((now - parseIso(lastReport)) / HOUR)} h; the plan says every ${period} h`);
    const lastReview = (await first(db, `SELECT MAX(reviewed_at) AS at FROM lifecycle_risk_reviews WHERE project_id = ?`, project_id))?.at || p.created_at;
    if ((now - parseIso(lastReview)) / HOUR >= 2 * period) add('risk-review', 'project-manager', `no risk review for ${Math.floor((now - parseIso(lastReview)) / HOUR)} h`);
    if (!(await first(db, `SELECT 1 AS x FROM lifecycle_quality WHERE project_id = ?`, project_id))) add('quality-metrics', 'reviewer', 'quality metrics have never been computed');
  }
  for (const cr of await all(db, `SELECT id, summary FROM change_requests WHERE project_id = ? AND decision IS NULL ORDER BY id`, project_id)) add(`change-request-${cr.id}`, 'portfolio-manager', `change request ${cr.id} has no decision: ${cr.summary}`);
  for (const g of await all(db, `SELECT id FROM lifecycle_scope_gate WHERE project_id = ? AND status = 'held' AND (answer IS NULL OR answer = '') ORDER BY id`, project_id)) add(`scope-gate-${g.id}`, 'portfolio-manager', `scope-gate entry ${g.id} has no answer`);
  const now_slugs = new Set(findings.map(f => `COMPLIANCE-${project_id}-${slug(f.slug)}`)), filed = [];
  for (const f of findings) { const id = `COMPLIANCE-${project_id}-${slug(f.slug)}`; if (await ensureItem(db, { id, title: f.text, owner_role: f.owner, project: project_id, priority: 25, done_check: f.text, closing_probe: `the compliance report of ${project_id} no longer lists it` })) filed.push(id); }
  const prefix = `COMPLIANCE-${project_id}-`, closed = [];
  for (const it of await all(db, `SELECT id FROM items WHERE substr(id, 1, ?) = ? AND status NOT IN ${TERMINAL_SQL}`, prefix.length, prefix)) {
    if (now_slugs.has(it.id)) continue;
    await run(db, `UPDATE items SET status = 'done', disposition = 'done: the finding cleared', updated_at = ? WHERE id = ?`, iso(now), it.id); closed.push(it.id);
  }
  return { project_id, findings, filed, closed };
}

// One pass of the monitoring, for the tick step: triggers, due reviews, quality rows for executing and closing projects, compliance.
export async function monitorStep(db, { now = Date.now(), config = {} } = {}) {
  const out = { triggered: [], review_items: [], quality: 0, compliance: [] }, sp = config.status_period_h ?? 168;
  for (const p of await all(db, `SELECT id, current_phase FROM kernel_projects WHERE current_phase <> 'closed' ORDER BY id`)) {
    out.triggered.push(...(await evaluateRisks(db, { project_id: p.id, now })).triggered);
    if (['executing', 'closing'].includes(p.current_phase)) {   // one row per period, not one per tick
      const last = (await first(db, `SELECT MAX(at) AS at FROM lifecycle_quality WHERE project_id = ?`, p.id))?.at;
      if (!last || (now - parseIso(last)) / HOUR >= await periodH(db, p.id, sp)) { await computeQuality(db, p.id, { now }); out.quality++; }
    }
    const c = await complianceReport(db, { project_id: p.id, now, status_period_h: sp });
    out.compliance.push(...c.filed);
  }
  out.review_items = await riskReviewDue(db, { now, status_period_h: sp });
  return out;
}
