// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Management lifecycle records and gates (US-SPEC-15): phases, artifacts, change requests, risks, lessons.
import { all, first, run, iso, ensureItem } from './util.js';

const R = { pf: 'portfolio-manager', pg: 'program-manager', pj: 'project-manager', pd: 'product-manager', rv: 'reviewer', op: 'operations', st: 'staff' };
const cat = (phase, prefix, rows) => rows.map(([n, owner]) => ({ kind: `A-${prefix}-${n}`, phase, owner_role: owner }));
export const CATALOG = [
  ...cat('initiating', 'INI', [[1, R.pf], [2, R.pj], [3, R.pj], [4, R.pj], [5, R.pj], [6, R.pj]]),
  ...cat('planning', 'PLN', [[1, R.pd], [2, R.pd], [3, R.pj], [4, R.pd], [5, R.pj], [6, R.pf], [7, R.pj], [8, R.rv], [9, R.pj], [10, R.pf]]),
  ...cat('closing', 'CLO', [[1, R.pj], [2, R.pj], [3, R.pj], [4, R.op], [5, R.op]]),
];
const GATES = { G1: 'initiating', G2: 'planning', G3: 'closing' };
const NEXT = { initiating: 'planning', planning: 'executing', executing: 'closing', closing: 'closed' };
const ENTRY_GATE = { planning: 'G1', executing: 'G2', closed: 'G3' };
const GATE_TO = { G1: 'planning', G2: 'executing', G3: 'closed' };      // the phase a gate lets a project enter

// US-15-R20: one enforcement point. A module that adds a condition to a gate registers it here, and advancePhase and checkGate
// run every registered condition, so no call path reaches a phase without them. fn(db, projectId, opts) -> [[slug, owner_role, text]]
// (an empty list is a pass); opts carries the ports the host gave (readiness, config, now). Registering again under the same
// gate and name replaces the earlier one.
const GATE_EXTRAS = [];
export function registerGateExtra(gate, name, fn) {
  if (!GATES[gate]) throw new Error('gate must be G1, G2 or G3');
  if (typeof fn !== 'function' || !name) throw new Error('a gate condition has a name and a function');
  const at = GATE_EXTRAS.findIndex(e => e.gate === gate && e.name === name);
  if (at >= 0) GATE_EXTRAS[at] = { gate, name, fn }; else GATE_EXTRAS.push({ gate, name, fn });
}
export const gateExtraNames = (gate) => GATE_EXTRAS.filter(e => e.gate === gate).map(e => e.name);
// The conditions core/lifecycle-gates registers when it is loaded. The kernel does not carry them (they read that module's tables), but it does
// not let a gate pass without them either: a database that holds the module's content store while this process has not loaded the module is
// refused with one reason per missing condition, so a caller that imports only core/kernel/lifecycle.js cannot enter a phase on the artifact
// conditions alone (US-15-R20). A database with no such store has no module state to enforce, and the artifact conditions are all there are.
const MODULE_CONDITIONS = { G1: ['charter-probe', 'readiness'], G2: ['requirement-map'], G3: ['deliverable-probes', 'retrospective'] };
async function unloadedConditions(db, gate) {
  const have = gateExtraNames(gate), want = (MODULE_CONDITIONS[gate] || []).filter(n => !have.includes(n));
  if (!want.length) return [];
  if (!(await first(db, `SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = 'lifecycle_artifact_content'`))) return [];
  return want.map(n => [`condition-${n}-not-loaded`, 'operations', `the gate condition ${n} is not loaded in this process (core/lifecycle-gates is not imported), so ${gate} cannot be passed here`]);
}
export async function gateExtraReasons(db, projectId, gate, opts = {}) {
  const out = await unloadedConditions(db, gate);
  for (const e of GATE_EXTRAS.filter(x => x.gate === gate)) for (const r of (await e.fn(db, projectId, opts)) || []) out.push(r);
  return out;
}
async function fileExtras(db, projectId, gate, reasons) {
  const to = GATE_TO[gate], filed = [];
  for (const [slug, owner, text] of reasons) {
    const id = `GATE-${projectId}-${to}-${slug}`;
    if (await ensureItem(db, { id, title: text, owner_role: owner, project: projectId, done_check: text, closing_probe: `project ${projectId} enters ${to}`, priority: 20 })) filed.push(id);
  }
  return filed;
}
// US-02-R03, US-15-R07: the model family of a model id, so a reviewer and a doer can be told apart. Resolution order: an explicit
// familyOf port (the router and the model port know their providers' families), then the vendor patterns below read over the id's
// path segments ('@cf/meta/llama-3.1-8b-instruct' is meta, 'o3' and 'gpt-5' are both openai), then the first token of the id (an unknown
// vendor keeps the old rule: 'alpha-1' and 'alpha-2' are one family). A model that is not named has no family (null), never a guess.
const VENDORS = [
  [/^(claude|anthropic)/, 'anthropic'], [/^(gpt|chatgpt|openai|codex|davinci|o\d)/, 'openai'], [/^(llama|meta)/, 'meta'],
  [/^(mistral|mixtral|codestral|ministral)/, 'mistral'], [/^(gemini|gemma|palm|google)/, 'google'], [/^(qwen|qwq|alibaba)/, 'alibaba'],
  [/^deepseek/, 'deepseek'], [/^(grok|xai)/, 'xai'], [/^(command|cohere)/, 'cohere'], [/^(phi|microsoft)/, 'microsoft'],
];
export function modelFamily(model, { familyOf = null } = {}) {
  if (!model) return null;
  if (typeof familyOf === 'function') { const f = familyOf(model); if (f) return String(f).toLowerCase(); }
  const segs = String(model).toLowerCase().split('/').filter(Boolean).filter(x => !/^(@[a-z]+|workers-ai|openrouter|models)$/.test(x));
  for (const seg of segs) { const v = VENDORS.find(([re]) => re.test(seg)); if (v) return v[1]; }
  return (segs[0] ?? String(model).toLowerCase()).split(/[-:/ ]/)[0] || null;
}

export async function createProject(db, p) {
  if (!p.id || !p.name) throw new Error('project id and name required');
  if (!['predictive', 'agile', 'hybrid'].includes(p.delivery_mode)) throw new Error('delivery_mode must be predictive, agile or hybrid'); // US-15-R01
  if (!p.mode_reason || !String(p.mode_reason).trim()) throw new Error('delivery_mode needs a recorded reason');
  const now = iso(p.now ?? Date.now());
  await run(db, `INSERT INTO kernel_projects (id, name, program_id, delivery_mode, mode_reason, created_at) VALUES (?,?,?,?,?,?)`, p.id, p.name, p.program_id ?? null, p.delivery_mode, p.mode_reason, now);
  await run(db, `INSERT INTO phases (project_id, phase, entered_at) VALUES (?, 'initiating', ?)`, p.id, now);
}

const gatePassed = async (db, project, phase) => Boolean((await first(db, `SELECT gate_passed_at FROM phases WHERE project_id = ? AND phase = ?`, project, phase))?.gate_passed_at);

// US-15-R05: an artifact is a file or record, never chat.
export async function submitArtifact(db, a) {
  const spec = CATALOG.find(c => c.kind === a.kind);
  if (!spec) throw new Error(`unknown artifact kind ${a.kind}`);
  if (!a.path_or_ref || /^\s*(chat|conversation)\b/i.test(a.path_or_ref)) throw new Error('artifact must be a file or record, not chat');
  if (await gatePassed(db, a.project_id, spec.phase)) throw new Error('gate already passed: use amendArtifact (change request, US-15-R06)');
  await run(db, `INSERT INTO artifacts (id, project_id, phase, kind, path_or_ref, owner_role, status, produced_by, produced_model, done_check, done_check_passed, evidence, updated_at)
      VALUES (?,?,?,?,?,?,'submitted',?,?,?,?,?,?)
      ON CONFLICT(project_id, kind) DO UPDATE SET path_or_ref=excluded.path_or_ref, status='submitted', reviewed_by=NULL, produced_by=excluded.produced_by,
        produced_model=excluded.produced_model, done_check=excluded.done_check, done_check_passed=excluded.done_check_passed, evidence=excluded.evidence, updated_at=excluded.updated_at`,
    `${a.project_id}:${a.kind}`, a.project_id, spec.phase, a.kind, a.path_or_ref, spec.owner_role, a.produced_by ?? null, a.produced_model ?? null,
    a.done_check ?? null, a.done_check_passed ? 1 : 0, a.evidence ?? null, iso(a.now ?? Date.now()));
}

// US-15-R07: reviewer differs from the doer by agent and, where both models are known, by model family.
export async function reviewArtifact(db, { project_id, kind, reviewer, reviewer_model = null, verdict, evidence = null, familyOf = null }) {
  const a = await first(db, `SELECT * FROM artifacts WHERE project_id = ? AND kind = ?`, project_id, kind);
  if (!a) throw new Error('no such artifact');
  if (!reviewer || reviewer === a.produced_by) throw new Error('reviewer must differ from doer');
  const fr = modelFamily(reviewer_model, { familyOf }), fd = modelFamily(a.produced_model, { familyOf });
  if (fr && fd && fr === fd) throw new Error('reviewer must differ from doer by model family');
  if (!['approved', 'rejected'].includes(verdict)) throw new Error('verdict must be approved or rejected');
  await run(db, `UPDATE artifacts SET status=?, reviewed_by=?, reviewer_model=?, evidence=COALESCE(?, evidence) WHERE id=?`,
    verdict === 'approved' ? 'reviewed' : 'rejected', verdict === 'approved' ? reviewer : null, reviewer_model, evidence, a.id);
}

export async function recordReadback(db, projectId, now = Date.now()) {
  await run(db, `UPDATE kernel_projects SET readback_at = ? WHERE id = ?`, iso(now), projectId);
}

// The gate check function. Existence is not enough: reviewed by a different agent, done check passed.
export async function checkGate(db, projectId, gate, opts = {}) {
  const phase = GATES[gate];
  if (!phase) throw new Error('gate must be G1, G2 or G3');
  const have = await all(db, `SELECT * FROM artifacts WHERE project_id = ?`, projectId);
  const missing = [], unreviewed = [], failing = [], reasons = [];
  for (const spec of CATALOG.filter(c => c.phase === phase)) {
    const a = have.find(x => x.kind === spec.kind);
    if (!a || !a.path_or_ref) missing.push(spec.kind);
    else if (a.status !== 'reviewed' || !a.reviewed_by || a.reviewed_by === a.produced_by) unreviewed.push(spec.kind);
    else if (!a.done_check_passed) failing.push(spec.kind);
  }
  if (gate === 'G2') {
    const p = await first(db, `SELECT readback_at FROM kernel_projects WHERE id = ?`, projectId);
    if (!p?.readback_at) reasons.push('read-back of scope and spec not recorded');
    const n = (await first(db, `SELECT COUNT(*) AS n FROM items WHERE project = ? AND id NOT LIKE 'GATE-%'`, projectId)).n;
    if (!n) reasons.push('no work items break the plan down');
    const noProbe = (await first(db, `SELECT COUNT(*) AS n FROM items WHERE project = ? AND id NOT LIKE 'GATE-%' AND (closing_probe IS NULL OR closing_probe = '')`, projectId)).n;
    if (noProbe) reasons.push(`${noProbe} item(s) have no closing probe`);
  }
  if (gate === 'G3') {
    const n = (await first(db, `SELECT COUNT(*) AS n FROM items WHERE project = ? AND id NOT LIKE 'GATE-%' AND (disposition IS NULL OR disposition = '')`, projectId)).n;
    if (n) reasons.push(`${n} item(s) have no disposition`);
  }
  // registered conditions (US-15-R20); opts.extras === false asks for the artifact conditions alone (the tick's own gap filing does)
  const extras = opts.extras === false ? [] : await gateExtraReasons(db, projectId, gate, opts);
  return { gate, pass: !missing.length && !unreviewed.length && !failing.length && !reasons.length && !extras.length, missing, unreviewed, failing, reasons, extras };
}

// Unmet gates become items for the owners, not errors (US-15-T1, spec s7).
export async function fileGateGaps(db, projectId, gate, opts = {}) {
  const g = await checkGate(db, projectId, gate, opts);
  const filed = [];
  const mk = async (id, title, owner, check) => { if (await ensureItem(db, { id, title, owner_role: owner, project: projectId, done_check: check, closing_probe: check, priority: 20 })) filed.push(id); };
  for (const k of g.missing) await mk(`GATE-${projectId}-${k}`, `Produce artifact ${k} for ${projectId}`, CATALOG.find(c => c.kind === k).owner_role, `artifact ${k} exists with a file or record reference and a passing done check`);
  for (const k of g.unreviewed) await mk(`GATE-${projectId}-${k}-review`, `Review artifact ${k} for ${projectId}`, 'reviewer', `artifact ${k} reviewed by an agent other than its producer`);
  for (const k of g.failing) await mk(`GATE-${projectId}-${k}-check`, `Artifact ${k} fails its done check`, CATALOG.find(c => c.kind === k).owner_role, `artifact ${k} done check passes`);
  for (const [i, r] of g.reasons.entries()) await mk(`GATE-${projectId}-${gate}-r${i}`, `${gate}: ${r}`, R.pj, r);
  filed.push(...await fileExtras(db, projectId, gate, g.extras));
  return { gate: g, filed };
}

export async function advancePhase(db, projectId, to, { now = Date.now(), ...opts } = {}) {
  const p = await first(db, `SELECT * FROM kernel_projects WHERE id = ?`, projectId);
  if (!p) throw new Error('unknown project');
  if (NEXT[p.current_phase] !== to) throw new Error(`cannot move from ${p.current_phase} to ${to}`);
  const gate = ENTRY_GATE[to];
  if (gate) { // US-15-R04
    // The registered conditions come first (US-15-R20): unmet ones are items for their owners, not errors (US-15-T1).
    const extras = await gateExtraReasons(db, projectId, gate, { ...opts, now });
    if (extras.length) return { ok: false, reasons: extras.map(r => r[2]), filed: await fileExtras(db, projectId, gate, extras) };
    const g = await checkGate(db, projectId, gate, { ...opts, now, extras: false });
    if (!g.pass) return { ok: false, ...(await fileGateGaps(db, projectId, gate, { ...opts, now, extras: false })) };
    await run(db, `UPDATE phases SET gate_id = ?, gate_passed_at = ? WHERE project_id = ? AND phase = ?`, gate, iso(now), projectId, p.current_phase);
  }
  await run(db, `UPDATE kernel_projects SET current_phase = ? WHERE id = ?`, to, projectId);
  await run(db, `INSERT OR IGNORE INTO phases (project_id, phase, entered_at) VALUES (?,?,?)`, projectId, to, iso(now));
  return { ok: true, phase: to };
}

// US-15-R06: after its gate, a change to a REQUIRED artifact is a change request with a revert path and a decision.
export async function amendArtifact(db, { project_id, kind, new_ref, summary, effect = null, revert_path, requested_by, now = Date.now() }) {
  const a = await first(db, `SELECT * FROM artifacts WHERE project_id = ? AND kind = ?`, project_id, kind);
  if (!a) throw new Error('no such artifact');
  if (!(await gatePassed(db, project_id, a.phase))) {
    await run(db, `UPDATE artifacts SET path_or_ref=?, status='submitted', reviewed_by=NULL, updated_at=? WHERE id=?`, new_ref, iso(now), a.id);
    return { applied: true };
  }
  if (!revert_path) throw new Error('a change request needs a revert path');
  const r = await run(db, `INSERT INTO change_requests (project_id, summary, effect, revert_path, artifact_kind, new_ref, requested_by, requested_at) VALUES (?,?,?,?,?,?,?,?)`,
    project_id, summary, effect, revert_path, kind, new_ref, requested_by ?? null, iso(now));
  return { applied: false, change_request_id: r.meta.last_row_id };
}

export async function decideChangeRequest(db, id, { decision, decided_by, now = Date.now() }) {
  const c = await first(db, `SELECT * FROM change_requests WHERE id = ?`, id);
  if (!c || c.decision) throw new Error('no pending change request');
  if (!decided_by || decided_by === c.requested_by) throw new Error('decider must differ from requester');
  await run(db, `UPDATE change_requests SET decision=?, decided_by=?, decided_at=? WHERE id=?`, decision, decided_by, iso(now), id);
  if (decision === 'approved' && c.artifact_kind) { // applied artifact needs a fresh review
    await run(db, `UPDATE artifacts SET path_or_ref=?, status='submitted', reviewed_by=NULL, updated_at=? WHERE project_id=? AND kind=?`, c.new_ref, iso(now), c.project_id, c.artifact_kind);
  }
}

export async function addRisk(db, r) {
  return (await run(db, `INSERT INTO risks (project_id, cause, effect, likelihood, impact, response, owner_role, trigger) VALUES (?,?,?,?,?,?,?,?)`,
    r.project_id, r.cause, r.effect, r.likelihood ?? null, r.impact ?? null, r.response ?? null, r.owner_role ?? null, r.trigger ?? null)).meta.last_row_id;
}

// A-CLO-3: every lesson is filed into the plus queue.
export async function addLesson(db, { project_id, text }) {
  const r = await run(db, `INSERT INTO lessons (project_id, text) VALUES (?, ?)`, project_id, text);
  const id = r.meta.last_row_id, item = `LESSON-${project_id}-${id}`;
  await ensureItem(db, { id: item, title: `Apply lesson: ${text}`, kind: 'plus', owner_role: R.pd, project: project_id, done_check: 'the lesson is applied and its effect measured', priority: 30 });
  await run(db, `UPDATE lessons SET plus_item_id = ? WHERE id = ?`, item, id);
  return { id, plus_item_id: item };
}

// Tick activity: for projects in a gated phase, file the missing artifacts as items.
// opts: { extras, readiness, config, now }. The kernel's own step passes none and files the artifact conditions only; a host that
// holds the ports the registered conditions need (core/lifecycle-gates' step) passes extras: true and files those too.
export async function lifecycleGaps(db, opts = {}) {
  const filed = [];
  const gateOf = { initiating: 'G1', planning: 'G2', closing: 'G3' };
  for (const p of await all(db, `SELECT id, current_phase FROM kernel_projects WHERE current_phase IN ('initiating','planning','closing')`)) {
    filed.push(...(await fileGateGaps(db, p.id, gateOf[p.current_phase], { ...opts, extras: opts.extras === true })).filed);
  }
  return filed;
}
