// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Service levels and the loops around them (US-SPEC-13 sections 4 and 5):
//  - every open row has a severity and a due date, recomputed each tick (R07), under the 14-day hard cap with its three
//    exemptions (R08); a row past due is raised one priority level and its manager notified, once per missed date (R09);
//  - the count of items waiting on a person is a metric with target zero (R10);
//  - a weekly audit checks each open row has a due date or an executor;
//  - step runs are timed against per-step budgets and handed to the breach procedure of core/console-l3 (R11); a process
//    defines its done check once and a step with fewer than two paths is a gap (R12);
//  - the six-term F is computed from tables and stored with its weights, never adopted as the objective (R06 stays in force);
//  - the autonomy card and the systems card (six rubrics) are recomputed monthly from tables, with evidence, limits and, for the autonomy
//    card, the three largest gaps filed; each card is audited by a second computation and an optional attestor (R23);
//  - the weights of F are calibrated by regression over the stored history and proposed, never adopted (R20);
//  - a breach item or question is filed again when the same breach recurs after it was closed (R16).
// Ports: db, now, config. The report-card writer is passed in (l3 = createConsoleL3(...)), so this module owns no card logic.
import { fileOrReopen } from '../_shared/items.js';
import { calibrateWeights } from './calibrate.js';
import { secondPath, phantomClosures } from './card-audit.js';
import { systemsDimensions, SYSTEMS_CARD_NAME, SYSTEMS_LIMITS } from './systems-card.js';
import { processesFor, derivedRuns } from './processes.js';
export const SEVERITY_HOURS = { SEV1: 24, SEV2: 72, SEV3: 168, SEV4: 336 };
export const EXEMPTIONS = ['calendar', 'external_event', 'rate_limited_drain'];
export const F_TERMS = ['loop_closure_rate', 'drift_count', 'human_interventions', 'cost_overrun', 'integration_gap', 'throughput'];
export const F_SIGN = { loop_closure_rate: 1, drift_count: -1, human_interventions: -1, cost_overrun: -1, integration_gap: -1, throughput: 1 };
export { SYSTEMS_CARD_NAME, SYSTEMS_LIMITS };
export const CARD_NAME = 'autonomy';
export const CARD_LIMITS = 'Self-measurement bias: the system grades itself. Rubric mismatch: the scale is applied by analogy. Evidence is point-in-time, read from the tables at the stated time. A top score is reported as a gap, not accepted.';
const TERMINAL = `('done','superseded','cancelled')`;
const PARKED = 'waiting on probe:%';
const WAITING_ITEM = 'SLA-WAITING-ON-A-PERSON';
const H = 3600e3;
const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const parse = s => Date.parse(String(s).replace(' ', 'T').replace(/Z?$/, 'Z'));
const slug = s => String(s).toUpperCase().replace(/[^A-Z0-9-]+/g, '-');

export function createSla({ db, now = () => Date.now(), config = {} } = {}) {
  const clock = typeof now === 'function' ? now : () => now;
  const cfg = {
    severity_hours: SEVERITY_HOURS, default_severity: 'SEV3', hard_cap_days: 14, accelerate: true, manager_role: 'portfolio-manager',
    person_roles: ['owner', 'principal'], audit_every_days: 7, card_every_days: 30, window_days: 30,
    rungs: ['observed', 'assisted', 'delegated', 'autonomous', 'self-directed', 'self-modifying', 'self-extending'],
    weights: { loop_closure_rate: 1, drift_count: 1, human_interventions: 1, cost_overrun: 1, integration_gap: 1, throughput: 1 },
    max_rows_per_tick: 500, seed_default_processes: true, systems_card: true, calibration_min_rows: 12, adopted_calibration: null, ...config,
  };
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const one = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const hours = sev => cfg.severity_hours[sev] ?? cfg.severity_hours[cfg.default_severity];
  // Files the item, or reopens it when the same breach recurs after it was closed (US-13-R16); an open item is left alone.
  const fileItem = (id, title, done_check, { kind = 'fix', project = 'sla', probe = 'manual', priority = 20, owner = cfg.manager_role } = {}) =>
    fileOrReopen(db, { id, title, kind, project, owner_role: owner, done_check, closing_probe: probe, priority, at: stamp(clock()) });

  /** Set a row's severity, due date or exemption. An exemption needs one of the three kinds and a reason; a rate-limited drain
   *  must state its running checkpoint in the reason (section 4). */
  async function classify(itemId, { severity, due_at, exempt = null, exempt_reason = null } = {}) {
    const item = await one(`SELECT id, created_at FROM items WHERE id=?`, itemId);
    if (!item) return { ok: false, error: 'no such item' };
    if (severity && !cfg.severity_hours[severity]) return { ok: false, error: `severity must be one of ${Object.keys(cfg.severity_hours).join(', ')}` };
    if (exempt && !EXEMPTIONS.includes(exempt)) return { ok: false, error: `exemption must be one of ${EXEMPTIONS.join(', ')}` };
    if (exempt && !String(exempt_reason || '').trim()) return { ok: false, error: 'an exemption needs a reason' };
    if (exempt === 'rate_limited_drain' && !/\d/.test(exempt_reason)) return { ok: false, error: 'a rate-limited drain must state its checkpoint (records left and the rate)' };
    const cur = await one(`SELECT * FROM sla_rows WHERE item_id=?`, itemId);
    const sev = severity || cur?.severity || cfg.default_severity;
    const opened = cur?.opened_at || item.created_at || stamp(clock());
    const due = due_at ? stamp(typeof due_at === 'number' ? due_at : parse(due_at)) : cur?.due_at || stamp(parse(opened) + hours(sev) * H);
    await run(`INSERT INTO sla_rows (item_id, severity, opened_at, due_at, exempt, exempt_reason, updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(item_id) DO UPDATE SET severity=excluded.severity, due_at=excluded.due_at, exempt=excluded.exempt, exempt_reason=excluded.exempt_reason, updated_at=excluded.updated_at`,
    itemId, sev, opened, due, exempt, exempt_reason, stamp(clock()));
    await run(`DELETE FROM sla_register WHERE name='recompute_pass'`);                  // a changed row needs the next recompute to visit rows
    return { ok: true, item_id: itemId, severity: sev, due_at: due, exempt };
  }

  /** The policy of section 4, run over every open row. Idempotent: a second run in the same instant changes nothing. At most
   *  config.max_rows_per_tick rows are visited per call, from a stored cursor, so a large backlog rotates and every row is visited within
   *  the rotation. After a complete pass, with no open item lacking a row and no row past a due date it has not been raised for (two
   *  counts, plus the open total), no row is read at all; classify() and a change of the policy configuration clear that mark. */
  async function recompute() {
    const t = clock(); const nowS = stamp(t);
    const sev3 = stamp(t + hours('SEV3') * H); const cap = stamp(t + cfg.hard_cap_days * 24 * H);
    const out = { rows: 0, added: 0, tightened: 0, capped: 0, accelerated: 0, raised: 0, notified: 0 };
    const fingerprint = JSON.stringify([cfg.severity_hours, cfg.hard_cap_days, cfg.accelerate, cfg.person_roles]);
    const pass = await one(`SELECT last_run_at, next_due_at FROM sla_register WHERE name='recompute_pass'`);
    if (pass && pass.next_due_at === fingerprint) {
      const fresh = (await one(`SELECT COUNT(*) AS n FROM items i LEFT JOIN sla_rows s ON s.item_id = i.id WHERE i.status NOT IN ${TERMINAL} AND s.item_id IS NULL`)).n;
      const overdue = (await one(`SELECT COUNT(*) AS n FROM sla_rows s JOIN items i ON i.id = s.item_id WHERE i.status NOT IN ${TERMINAL} AND s.due_at < ? AND COALESCE(s.raised_for_due,'') <> s.due_at`, nowS)).n;
      if (!fresh && !overdue) {
        out.rows = (await one(`SELECT COUNT(*) AS n FROM items WHERE status NOT IN ${TERMINAL}`)).n;
        Object.defineProperty(out, 'skipped', { value: 'nothing is new, changed or past due', enumerable: false });   // not enumerable: the counters of a pass that did visit rows are unchanged
        return out;
      }
    }
    const cursor = (await one(`SELECT last_run_at FROM sla_register WHERE name='recompute_cursor'`))?.last_run_at || '';
    let items = await all(`SELECT i.id, i.title, i.owner_role, i.priority, i.created_at, s.severity, s.opened_at, s.due_at, s.exempt, s.raised_for_due
      FROM items i LEFT JOIN sla_rows s ON s.item_id = i.id WHERE i.status NOT IN ${TERMINAL} AND i.id > ? ORDER BY i.id LIMIT ?`, cursor, cfg.max_rows_per_tick);
    let wrapped = false;
    if (items.length < cfg.max_rows_per_tick) {                                                  // end of the rotation: finish it and start from the top
      const more = await all(`SELECT i.id, i.title, i.owner_role, i.priority, i.created_at, s.severity, s.opened_at, s.due_at, s.exempt, s.raised_for_due
        FROM items i LEFT JOIN sla_rows s ON s.item_id = i.id WHERE i.status NOT IN ${TERMINAL} AND i.id <= ? ORDER BY i.id LIMIT ?`, cursor, cfg.max_rows_per_tick - items.length);
      items = items.concat(more); wrapped = true;
    }
    const partial = items.length >= cfg.max_rows_per_tick && !wrapped;
    for (const it of items) {
      out.rows++;
      const sev = it.severity || cfg.default_severity;
      const opened = it.opened_at || it.created_at || nowS;
      const limit = stamp(parse(opened) + hours(sev) * H);
      let due = it.due_at || limit;
      if (!it.due_at) out.added++;
      if (!it.exempt) {
        if (due > limit) { due = limit; out.tightened++; }                                          // R07
        if (due > cap) { due = sev3; out.capped++; }                                                // R08, the hard cap
        else if (cfg.accelerate && due > sev3 && !cfg.person_roles.includes(it.owner_role)) { due = sev3; out.accelerated++; } // acceleration rule
      }
      let raisedFor = it.raised_for_due || null;
      if (due < nowS && raisedFor !== due) {                                                        // R09
        const top = !(it.priority > 0);                                                              // already at priority 0: noticed, not lowered
        if (!top) await run(`UPDATE items SET priority = priority - 1, updated_at=? WHERE id=?`, nowS, it.id);
        await run(`INSERT INTO sla_notices (item_id, role, text, at) VALUES (?,?,?,?)`, it.id, cfg.manager_role,
          `${it.id} (${sev}) was due ${due} and is still open: ${top ? 'already at top priority' : 'priority raised one level'}`, nowS);
        raisedFor = due; out.notified++; out.raised++; if (top) out.at_top = (out.at_top || 0) + 1; // `raised` counts every row handled; at_top appears only when some were already at priority 0
      }
      if (due !== it.due_at || raisedFor !== (it.raised_for_due || null)) {
        await run(`INSERT INTO sla_rows (item_id, severity, opened_at, due_at, raised_for_due, updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(item_id) DO UPDATE SET due_at=excluded.due_at, raised_for_due=excluded.raised_for_due, updated_at=excluded.updated_at`, it.id, sev, opened, due, raisedFor, nowS);
      }
    }
    // The cursor is the last row visited when the rotation is partial, and empty (start again) when it finished.
    const nextCursor = partial ? items[items.length - 1].id : '';
    await run(`INSERT INTO sla_register (name, last_run_at, next_due_at) VALUES ('recompute_cursor', ?, ?) ON CONFLICT(name) DO UPDATE SET last_run_at=excluded.last_run_at, next_due_at=excluded.next_due_at`, nextCursor, nowS);
    if (!partial) await run(`INSERT INTO sla_register (name, last_run_at, next_due_at) VALUES ('recompute_pass', ?, ?) ON CONFLICT(name) DO UPDATE SET last_run_at=excluded.last_run_at, next_due_at=excluded.next_due_at`, nowS, fingerprint);
    if (partial) out.rotating = { visited: items.length, next_after: nextCursor };
    return out;
  }

  /** Items waiting on a person: open gate cards plus blocked items that are not parked on a probe (R10). Stored as a reading with
   *  target 0; above zero one item is filed whose probe closes it when the count is back to zero. */
  async function waitingOnPerson() {
    const cards = (await one(`SELECT COUNT(*) AS n FROM gate_cards WHERE status='open'`)).n;
    const blocked = (await one(`SELECT COUNT(*) AS n FROM items WHERE status='blocked' AND COALESCE(blocker,'') NOT LIKE ? AND id <> ?`, PARKED, WAITING_ITEM)).n;
    const value = cards + blocked;
    await run(`INSERT INTO sla_metrics (name, value, target, at) VALUES ('items_waiting_on_a_person', ?, 0, ?)`, value, stamp(clock()));
    if (value > 0) {
      await fileItem(WAITING_ITEM, `${value} item(s) are waiting on a person; the target is zero`, 'no open gate card and no blocked item that waits on a person', {
        probe: `SELECT ((SELECT COUNT(*) FROM gate_cards WHERE status='open') + (SELECT COUNT(*) FROM items WHERE status='blocked' AND COALESCE(blocker,'') NOT LIKE '${PARKED}' AND id <> '${WAITING_ITEM}')) = 0 AS ok FROM (SELECT 1)`, priority: 10 });
    }
    return { name: 'items_waiting_on_a_person', value, target: 0, breach: value > 0, gate_cards: cards, blocked };
  }

  /** The weekly audit: each open row has a due date (a dated trigger) or a durable executor (a role instance for its owner role,
   *  or a live claim). A row with neither fails and gets one item. */
  async function weeklyAudit() {
    const rows = await all(`SELECT i.id, i.owner_role, i.trigger_on, s.due_at,
        (SELECT COUNT(*) FROM roles r WHERE r.role = i.owner_role OR r.id = i.owner_role) AS executors,
        (SELECT COUNT(*) FROM claims c WHERE c.item_id = i.id) AS claims
      FROM items i LEFT JOIN sla_rows s ON s.item_id = i.id WHERE i.status NOT IN ${TERMINAL} ORDER BY i.id`);
    const nowS = stamp(clock());
    const findings = [];
    for (const r of rows) {
      const dated = !!r.due_at; const executor = r.executors > 0 || r.claims > 0;
      if (!dated && !executor) {
        findings.push({ item_id: r.id, problem: 'no due date and no executor' });
        await fileItem(`SLA-AUDIT-${slug(r.id)}`, `${r.id} has no due date and no role that would work it`, `${r.id} has a due date or an executor`, { probe: `SELECT COUNT(*) FROM sla_rows WHERE item_id='${String(r.id).replace(/'/g, "''")}'` });
      } else if (dated && r.due_at < nowS) findings.push({ item_id: r.id, problem: 'past due', due_at: r.due_at });
      else if (!executor) findings.push({ item_id: r.id, problem: 'no executor for its owner role', owner_role: r.owner_role });
    }
    const failing = findings.filter(f => f.problem === 'no due date and no executor').length;
    const waiting = await waitingOnPerson();
    await run(`INSERT INTO sla_audits (at, checked, failing, waiting_on_a_person, findings) VALUES (?,?,?,?,?)`, nowS, rows.length, failing, waiting.value, JSON.stringify(findings));
    return { at: nowS, checked: rows.length, failing, waiting_on_a_person: waiting.value, findings };
  }

  /** A process defines its done check once and maps paths to each step (R12). */
  async function defineProcess({ process, done_check, steps = [] } = {}) {
    if (!process || !String(done_check || '').trim()) return { ok: false, error: 'process and done_check are required' };
    if (!steps.length || steps.some(s => !s.step || !(s.budget_hours > 0))) return { ok: false, error: 'every step needs a name and a budget in hours' };
    await run(`INSERT INTO sla_processes (process, done_check, steps, updated_at) VALUES (?,?,?,?) ON CONFLICT(process) DO UPDATE SET done_check=excluded.done_check, steps=excluded.steps, updated_at=excluded.updated_at`,
      process, done_check, JSON.stringify(steps.map(s => ({ step: s.step, budget_hours: s.budget_hours, paths: s.paths || [] }))), stamp(clock()));
    return { ok: true };
  }
  /** Steps with fewer than two independent paths. Each is filed once. */
  async function processGaps() {
    const gaps = [];
    for (const p of await all(`SELECT process, steps FROM sla_processes ORDER BY process`)) {
      for (const s of JSON.parse(p.steps)) {
        if (new Set(s.paths).size >= 2) continue;
        gaps.push({ process: p.process, step: s.step, paths: s.paths.length });
        await fileItem(`SLA-PATHGAP-${slug(p.process)}-${slug(s.step)}`, `${p.process} / ${s.step} has ${s.paths.length} path(s) to done; it needs at least two`, `${p.process} / ${s.step} maps a second independent path`);
      }
    }
    return gaps;
  }
  /** Start timing a step. The budget comes from the process definition unless given. */
  async function startStep({ process, step, ref = null, budget_hours } = {}) {
    let b = budget_hours;
    if (!(b > 0)) {
      const p = await one(`SELECT steps FROM sla_processes WHERE process=?`, process);
      b = p ? JSON.parse(p.steps).find(s => s.step === step)?.budget_hours : null;
    }
    if (!(b > 0)) return { ok: false, error: 'no budget for this step: define the process or pass budget_hours' };
    const r = await run(`INSERT INTO sla_step_runs (process, step, ref, budget_hours, started_at) VALUES (?,?,?,?,?)`, process, step, ref, b, stamp(clock()));
    return { ok: true, id: r.meta.last_row_id };
  }
  const finishStep = id => run(`UPDATE sla_step_runs SET finished_at=? WHERE id=? AND finished_at IS NULL`, stamp(clock()), id);
  /** The budget in hours of a step: the stored definition when there is one, else the default or configured process. */
  async function budgetOf(process, step) {
    const p = await one(`SELECT steps FROM sla_processes WHERE process=?`, process);
    const fromStore = p ? JSON.parse(p.steps).find(s => s.step === step)?.budget_hours : null;
    return fromStore ?? processesFor(cfg)[process]?.steps.find(s => s.step === step)?.budget_hours ?? 0;
  }
  /** Seed the default processes once, when no process is defined yet, so every stage has a budget and no path gap (US-13-R11, R12). */
  async function seedDefaultProcesses() {
    if (!cfg.seed_default_processes) return 0;
    if ((await one(`SELECT COUNT(*) AS n FROM sla_processes`)).n > 0) return 0;
    let n = 0; for (const [process, def] of Object.entries(processesFor(cfg))) { if ((await defineProcess({ process, done_check: def.done_check, steps: def.steps })).ok) n++; }
    return n;
  }
  /** Open runs read from the tables the core already keeps (a claim with no heartbeat, a prediction past due, a queued dispatch). */
  async function derivedStepRuns() {
    const budgets = new Map();
    for (const [process, def] of Object.entries(processesFor(cfg))) for (const s of def.steps) budgets.set(`${process}/${s.step}`, await budgetOf(process, s.step));
    return derivedRuns({ db, budgetOf: (p, s) => budgets.get(`${p}/${s}`) ?? 0, asOf: clock() });
  }
  /** Open step runs in the shape core/console-l3 sweepStepBudgets takes: stored runs and derived runs, one (process, step, ref) once. */
  async function stepRuns() {
    const stored = (await all(`SELECT process, step, ref, budget_hours, started_at FROM sla_step_runs WHERE finished_at IS NULL`)).map(r => ({ ...r, started_at: parse(r.started_at) }));
    const once = new Map();                                                                  // one (process, step, ref) once: the earlier start wins
    for (const r of [...stored, ...(await derivedStepRuns())]) { const k = `${r.process}/${r.step}/${r.ref ?? ''}`; if (!once.has(k) || r.started_at < once.get(k).started_at) once.set(k, r); }
    const groups = new Map();
    for (const r of once.values()) {
      const g = `${r.process}/${r.step}/${r.budget_hours}`; const cur = groups.get(g);
      if (!cur || r.started_at < cur.started_at) groups.set(g, { process: r.process, step: r.step, budget_hours: r.budget_hours, started_at: r.started_at });
    }
    return [...groups.values()].sort((a, b) => a.process.localeCompare(b.process) || a.step.localeCompare(b.step));
  }

  /** True only when configuration names a calibration run (sla.adopted_calibration) and the weights in effect are exactly the weights that
   *  run proposed: a person or a deploy adopted them through configuration. Nothing here ever writes the weights (US-13-R06, R20). */
  async function adoptedCalibration() {
    if (!cfg.adopted_calibration) return false;
    const row = await one(`SELECT id, weights, adopted_at FROM sla_calibrations WHERE id=?`, cfg.adopted_calibration).catch(() => null);
    if (!row) return false;
    const proposed = JSON.parse(row.weights);
    if (!F_TERMS.every(k => Math.abs(Number(proposed[k]) - Number(cfg.weights[k])) < 1e-9)) return false;
    if (!row.adopted_at) await run(`UPDATE sla_calibrations SET adopted_at=? WHERE id=? AND adopted_at IS NULL`, stamp(clock()), row.id);
    return true;
  }

  /** Fit the weights of F to the stored history and propose them (US-13-R20). Never writes cfg.weights; see calibrate.js. */
  const calibrate = ({ l3 = null, minRows = cfg.calibration_min_rows } = {}) =>
    calibrateWeights({ db, l3, terms: F_TERMS, sign: F_SIGN, weights: cfg.weights, minRows, at: stamp(clock()) });

  /** The six-term F and the triad, from tables. drift_count, cost_overrun and integration_gap have no L1 table: pass readings in
   *  `measured`, otherwise they count as 0 and are marked unmeasured. Stored, never used to steer: weights come from config only. */
  async function objective(measured = {}) {
    const t = clock(); const since = stamp(t - cfg.window_days * 24 * H);
    const ticks = await one(`SELECT COUNT(*) AS n, SUM(CASE WHEN finished_at IS NOT NULL AND steps_completed = steps_total THEN 1 ELSE 0 END) AS ok FROM tick_runs WHERE started_at >= ?`, since);
    const human = (await one(`SELECT COUNT(*) AS n FROM console_actions WHERE at >= ? AND kind IN ('card_done','card_default')`, since)).n;
    const done = (await one(`SELECT COUNT(*) AS n FROM items WHERE status='done' AND updated_at >= ?`, since)).n;
    const table = {
      loop_closure_rate: { value: ticks.n ? (ticks.ok || 0) / ticks.n : 0, source: `tick_runs: ${ticks.ok || 0} of ${ticks.n} finished all steps` },
      human_interventions: { value: human, source: `console_actions: ${human} card presses` },
      throughput: { value: done, source: `items: ${done} done` },
    };
    const terms = {};
    for (const k of F_TERMS) {
      if (table[k]) terms[k] = { ...table[k], measured: true };
      else if (Number.isFinite(measured[k])) terms[k] = { value: measured[k], source: 'reading passed by the caller', measured: true };
      else terms[k] = { value: 0, source: 'no table holds this term', measured: false };
    }
    const f = F_TERMS.reduce((s, k) => s + F_SIGN[k] * Number(cfg.weights[k] ?? 0) * terms[k].value, 0);
    const last = await one(`SELECT steps_completed, steps_total, finished_at FROM tick_runs ORDER BY id DESC LIMIT 1`);
    const cards = (await one(`SELECT COUNT(*) AS n FROM gate_cards WHERE status='open'`)).n;
    const triad = { human_gated: cards, drift: terms.drift_count.value, self_healing: !!(last && last.finished_at && last.steps_completed === last.steps_total) };
    const prev = await one(`SELECT triad FROM sla_objective ORDER BY id DESC LIMIT 1`);
    let good = null;
    if (prev) {
      const p = JSON.parse(prev.triad);
      const worse = triad.human_gated > p.human_gated || triad.drift > p.drift || (p.self_healing && !triad.self_healing);
      const better = triad.human_gated < p.human_gated || triad.drift < p.drift || (!p.self_healing && triad.self_healing);
      const atGoal = triad.human_gated === 0 && triad.drift === 0 && triad.self_healing;
      good = worse ? 0 : (better || atGoal) ? 1 : 0;
    }
    const unmeasured = F_TERMS.filter(k => !terms[k].measured);
    const calibrated = await adoptedCalibration();
    await run(`INSERT INTO sla_objective (at, f, terms, weights, calibrated, triad, good) VALUES (?,?,?,?,?,?,?)`, stamp(t), f, JSON.stringify(terms), JSON.stringify(cfg.weights), calibrated ? 1 : 0, JSON.stringify(triad), good);
    return { f, terms, weights: cfg.weights, calibrated, triad, good, unmeasured, window_days: cfg.window_days };
  }

  /** Ten dimensions, each a ratio read from tables, scored 0 to 5 with the evidence it was read from. */
  async function autonomyDimensions() {
    const since = stamp(clock() - cfg.window_days * 24 * H); const nowS = stamp(clock());
    const q = async (table, okExpr, where = '1=1', ...a) => { const r = await one(`SELECT COUNT(*) AS d, SUM(CASE WHEN ${okExpr} THEN 1 ELSE 0 END) AS n FROM ${table} WHERE ${where}`, ...a); return { n: r.n || 0, d: r.d || 0 }; };
    const rungs = cfg.rungs; const top = rungs.length - 1;
    const ledger = await all(`SELECT rung FROM trust_ledger`);
    const trust = { d: ledger.length, sum: ledger.reduce((a, r) => a + Math.max(0, rungs.indexOf(r.rung)), 0) };
    const waiting = (await one(`SELECT COUNT(*) AS n FROM gate_cards WHERE status='open'`)).n;
    const active = (await one(`SELECT COUNT(*) AS n FROM items WHERE status NOT IN ${TERMINAL}`)).n;
    const dims = [
      ['check_completion', 'tick_runs', 'checks that finished every step', await q('tick_runs', 'finished_at IS NOT NULL AND steps_completed = steps_total', 'started_at >= ?', since)],
      ['verified_outcomes', 'outcomes', 'outcomes verified by a probe', await q('outcomes', `result = 'verified'`, 'at >= ?', since)],
      ['prediction_scoring', 'predictions', 'due predictions that were scored', await q('predictions', 'verdict IS NOT NULL', 'due_at <= ?', nowS)],
      ['prediction_accuracy', 'predictions', 'scored predictions that were right', await q('predictions', `verdict = 'hit'`, 'verdict IS NOT NULL')],
      ['disposition_hygiene', 'items', 'closed items that carry a disposition', await q('items', `COALESCE(disposition,'') <> ''`, `status IN ${TERMINAL}`)],
      ['dispatch_success', 'dispatches', 'dispatches that ended done', await q('dispatches', `status = 'done'`, `status IN ('done','failed')`)],
      ['work_without_a_person', 'gate_cards, items', 'active work not held by an open decision card', { n: Math.max(0, active - waiting), d: active + (active ? 0 : waiting) }],
      ['unblocked_flow', 'items', 'active items that are not blocked', await q('items', `status <> 'blocked'`, `status NOT IN ${TERMINAL}`)],
      ['on_time', 'sla_rows', 'open rows not past their due date', await q('sla_rows s JOIN items i ON i.id = s.item_id', 's.due_at >= ?', `i.status NOT IN ${TERMINAL}`, nowS)],
      ['earned_trust', 'trust_ledger', 'rungs climbed out of the rungs available, over the surfaces acted on', { n: trust.sum, d: top * trust.d }],
    ];
    return dims.map(([dimension, table, what, { n, d }]) => {
      const score = d ? Math.round((n / d) * 50) / 10 : 0;
      const shown = Number.isInteger(n) ? n : n.toFixed(1);
      const gap = Math.round((5 - score) * 10) / 10;
      const status = !d ? 'unmeasured: no rows yet, scored 0' : score >= 5 ? 'gap: a top score is not accepted on self-measurement; confirm with outside evidence' : `measured; ${Math.min(gap, 1).toFixed(1)} to the next point`;
      return { dimension, score, evidence: `${table}: ${shown} of ${d} ${what} (read ${nowS})`, confidence: d >= 30 ? 'high' : d >= 5 ? 'medium' : 'low', status, gap: !d || score >= 5 ? Math.max(gap, 1) : gap };
    });
  }

  /** Recompute the autonomy card from tables and record it through the report-card writer (evidence, limits and the fall-of-0.5
   *  rule are enforced there). The three largest gaps become kaizen items. */
  async function recomputeAutonomyCard({ l3, causes = {} } = {}) {
    if (!l3 || typeof l3.recordCard !== 'function') return { ok: false, error: 'a report-card writer (core/console-l3) is required' };
    const dims = await autonomyDimensions();
    const rec = await l3.recordCard({ name: CARD_NAME, rubric: 'ten dimensions, each the share of rows meeting the stated condition, scaled 0 to 5', limits: CARD_LIMITS,
      scores: dims.map(({ gap, ...s }) => ({ ...s, cause: causes[s.dimension] })) });
    if (!rec.ok) return rec;
    const month = stamp(clock()).slice(0, 7);
    const kaizen = [];
    for (const g of [...dims].sort((a, b) => b.gap - a.gap || a.dimension.localeCompare(b.dimension)).slice(0, 3)) {
      const id = `KAIZEN-${slug(CARD_NAME)}-${slug(g.dimension)}-${month}`;
      await fileItem(id, `Autonomy card: ${g.dimension} scored ${g.score} of 5 (${g.status})`, `${g.dimension} scores higher on the next monthly card, or the gap is dispositioned with a reason`, { kind: 'plus', project: 'report-card' });
      kaizen.push(id);
    }
    const overall = Math.round((dims.reduce((s, d) => s + d.score, 0) / dims.length) * 100) / 100;
    return { ok: true, card_id: rec.card_id, overall, dimensions: dims, fell: rec.items, kaizen };
  }

  /** The systems card: six rubrics from tables, recorded through the same report-card writer (US-13-R22). */
  async function recomputeSystemsCard({ l3, causes = {} } = {}) {
    if (!l3 || typeof l3.recordCard !== 'function') return { ok: false, error: 'a report-card writer (core/console-l3) is required' };
    const dims = await systemsDimensions({ db, cfg, asOf: clock() });
    const rec = await l3.recordCard({ name: SYSTEMS_CARD_NAME, rubric: 'six rubrics, each the share of rows meeting the stated condition, scaled 0 to 5', limits: SYSTEMS_LIMITS,
      scores: dims.map(({ gap, ...x }) => ({ ...x, cause: causes[x.dimension] })) });
    if (!rec.ok) return rec;
    return { ok: true, card_id: rec.card_id, overall: Math.round((dims.reduce((a, d) => a + d.score, 0) / dims.length) * 100) / 100, dimensions: dims, fell: rec.items };
  }

  /** Audit the latest autonomy card (US-13-R23): the ten dimensions again by a second path, the phantom-touch check, and the attestor's
   *  verdicts when an attestor port is given. A difference above 0.05 on a dimension, a phantom closure or a disagreement files an item
   *  (reopened when it recurs). Every audit is stored; core/console-l3 reads the table to label a card attested or self-measured. */
  async function auditCard({ name = CARD_NAME, attestor = null } = {}) {
    const card = await one(`SELECT id, at FROM l3_cards WHERE name=? ORDER BY id DESC LIMIT 1`, name);
    if (!card) return { ok: false, error: 'no such card' };
    const stored = await all(`SELECT dimension, score, evidence FROM l3_scores WHERE card_id=? ORDER BY dimension`, card.id);
    const second = name === CARD_NAME ? await secondPath({ db, cfg, asOf: clock() }) : {};
    const diffs = [];
    for (const s of stored) {
      const r = second[s.dimension];
      if (r && Math.abs(r.score - s.score) > 0.05) {
        diffs.push({ dimension: s.dimension, stored: s.score, second_path: r.score, n: r.n, d: r.d });
        await fileItem(`AUDIT-CARD-${slug(name)}-${slug(s.dimension)}`, `${name} card: ${s.dimension} is stored as ${s.score} but a second computation gives ${r.score} (${r.n} of ${r.d})`, `${s.dimension} agrees between the two computations, or the difference is explained`, { project: 'report-card', priority: 15 });
      }
    }
    const phantom = name === CARD_NAME ? await phantomClosures({ db, cfg, asOf: clock() }) : [];
    if (phantom.length) await fileItem('AUDIT-CARD-PHANTOM', `${phantom.length} item(s) closed by a person role have no console action: the human-touch count is too low (${phantom.slice(0, 5).join(', ')})`, 'every closure by a person role has a console action', { project: 'report-card', priority: 15 });
    let attested = null; const verdicts = [];
    if (typeof attestor === 'function') {
      try {
        const res = await attestor({ card: { name, id: card.id, at: card.at }, evidence: stored });
        for (const v of res?.verdicts || []) {
          verdicts.push({ dimension: v.dimension, agree: !!v.agree, note: String(v.note || '').slice(0, 200) });
          if (!v.agree) await fileItem(`AUDIT-CARD-ATTEST-${slug(name)}-${slug(v.dimension)}`, `${name} card: the attestor disagrees on ${v.dimension}: ${String(v.note || 'no reason given').slice(0, 160)}`, `${v.dimension} is re-measured or the disagreement is explained`, { project: 'report-card', priority: 15 });
        }
        attested = { by: String(attestor.name || res?.by || 'attestor').slice(0, 60), agree: verdicts.length > 0 && verdicts.every(v => v.agree) && stored.every(s => verdicts.some(v => v.dimension === s.dimension)) };
      } catch (e) { verdicts.push({ error: `the attestor failed: ${String(e?.message || e).slice(0, 120)}` }); attested = { by: String(attestor.name || 'attestor'), agree: false }; }
    }
    await run(`INSERT INTO sla_card_audits (card_id, name, at, dimensions, disagree, phantom, attestor, agree, detail) VALUES (?,?,?,?,?,?,?,?,?)`,
      card.id, name, stamp(clock()), stored.length, diffs.length, phantom.length, attested?.by ?? null, attested ? (attested.agree ? 1 : 0) : null, JSON.stringify({ diffs, phantom, verdicts }));
    return { ok: true, card_id: card.id, dimensions: stored.length, disagree: diffs, phantom, attested, verdicts, self_measured: !attested };
  }

  // `due` only reads the register. The next-due date moves in `markRan`, after the guarded work succeeded, so a throw or a not-ok result leaves the
  // row due and the next tick retries (a failed weekly audit used to be skipped for 7 days and a failed card for 30).
  const due = async name => {
    const r = await one(`SELECT next_due_at FROM sla_register WHERE name=?`, name);
    return !(r && r.next_due_at > stamp(clock()));
  };
  const markRan = (name, everyDays) => run(`INSERT INTO sla_register (name, last_run_at, next_due_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET last_run_at=excluded.last_run_at, next_due_at=excluded.next_due_at`,
    name, stamp(clock()), stamp(clock() + everyDays * 24 * H));

  // A part after the card that throws is recorded as an item (reopened when it recurs) and reported in the result; the tick goes on.
  const guarded = async (id, what, fn) => {
    try { return await fn(); }
    catch (e) {
      const reason = String(e?.message || e).slice(0, 160);
      await fileItem(id, `Computing ${what} failed: ${reason}`, `${what} is computed on a tick`, { project: 'report-card', priority: 15 });
      return { ok: false, error: reason };
    }
  };

  /** One tick of the service-level loops. `l3` (core/console-l3) is optional: with it, step-budget breaches are filed and the
   *  monthly card is recomputed. Returns what ran, and pushes one line to ctx.notes when there is a ctx. */
  async function step(ctx = {}, { l3 = null, measured = {}, attestor = null } = {}) {
    const out = {};
    await seedDefaultProcesses();
    out.sla = await recompute();
    if (await due('weekly_audit')) { out.audit = await weeklyAudit(); await markRan('weekly_audit', cfg.audit_every_days); }
    if (!out.audit) out.waiting = await waitingOnPerson();
    out.path_gaps = (await processGaps()).length;
    if (l3) out.step_budget = await l3.sweepStepBudgets(await stepRuns());
    if (l3 && await due('autonomy_card')) {
      out.objective = await objective(measured); out.card = await recomputeAutonomyCard({ l3 });
      if (out.card.ok) {
        // The card is recorded: its month is spent. The parts after it are retried by an item, never by a second card in the same month.
        await markRan('autonomy_card', cfg.card_every_days);
        if (cfg.systems_card) out.systems_card = await guarded('SLA-SYSTEMS-CARD-FAILED', 'the systems card', () => recomputeSystemsCard({ l3 }));
        out.card_audit = await guarded('SLA-CARD-AUDIT-FAILED', 'the card audit', () => auditCard({ name: CARD_NAME, attestor }));
      } else {
        await fileItem('SLA-AUTONOMY-CARD-FAILED', `The autonomy card was not recorded: ${String(out.card.errors?.join('; ') || out.card.error || 'no reason given').slice(0, 200)}`, 'the autonomy card is recorded on a tick', { project: 'report-card', priority: 15 });
      }
    }
    ctx.notes?.push(`sla: ${out.sla.rows} open rows, ${out.sla.raised} raised past due, ${out.sla.capped + out.sla.accelerated + out.sla.tightened} due dates pulled in${out.audit ? `, weekly audit ${out.audit.failing} failing` : ''}${out.card ? `, autonomy card ${out.card.overall}` : ''}`);
    return out;
  }

  /** Read side for dashboards and digests. */
  async function summary() {
    const nowS = stamp(clock());
    const by = await all(`SELECT s.severity, COUNT(*) AS n, SUM(CASE WHEN s.due_at < ? THEN 1 ELSE 0 END) AS past_due FROM sla_rows s JOIN items i ON i.id = s.item_id WHERE i.status NOT IN ${TERMINAL} GROUP BY s.severity ORDER BY s.severity`, nowS);
    const w = await one(`SELECT value, at FROM sla_metrics WHERE name='items_waiting_on_a_person' ORDER BY id DESC LIMIT 1`);
    const a = await one(`SELECT at, checked, failing FROM sla_audits ORDER BY id DESC LIMIT 1`);
    const f = await one(`SELECT at, f, calibrated, triad, good FROM sla_objective ORDER BY id DESC LIMIT 1`);
    return { by_severity: by, past_due: by.reduce((s, r) => s + (r.past_due || 0), 0), waiting_on_a_person: w ? { value: w.value, target: 0, at: w.at } : null, last_audit: a || null,
      objective: f ? { at: f.at, f: f.f, calibrated: !!f.calibrated, triad: JSON.parse(f.triad), good: f.good } : null,
      notices: await all(`SELECT item_id, role, text, at FROM sla_notices ORDER BY id DESC LIMIT 3`) };
  }

  return { config: cfg, classify, recompute, waitingOnPerson, weeklyAudit, defineProcess, processGaps, startStep, finishStep, stepRuns, derivedStepRuns, objective, calibrate, autonomyDimensions, recomputeAutonomyCard, recomputeSystemsCard, auditCard, step, summary };
}
