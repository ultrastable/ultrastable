// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Operator console L3 (US-SPEC-13, US-SPEC-18; issue #46): the fleet view over the L1 console. One state function feeds the
// JSON routes and the digest, so they cannot disagree (US-13-R02). Report cards refuse a score without evidence (R03), carry
// their limits (R04), turn a fall of 0.5 or more without a cause into a work item (R05), and never adopt a change to the
// objective function (R06). Step budgets file one item and, past twice the budget, exactly one blocking question (R11).
// Ports only: db, now, config { version, stale_after_minutes }, tracker (optional: openIssues() -> { issues, complete }).
import { fileOrReopen } from '../_shared/items.js';
export const LIMITS_MUST_MENTION = /self-measurement|grades itself|self-grad/i;
const CONFIDENCE = ['low', 'medium', 'high'];
const iso = ms => new Date(ms).toISOString();

export function createConsoleL3({ db, now = () => Date.now(), config = {}, tracker = null } = {}) {
  const clock = typeof now === 'function' ? now : () => now;
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const one = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const version = config.version || 'unversioned';

  /** The one view of the organization (US-13-R01, R02). Everything below is derived from this. */
  async function state() {
    const counts = Object.fromEntries((await all(`SELECT status, COUNT(*) AS n FROM items GROUP BY status`)).map(r => [r.status, r.n]));
    const cards = await all(`SELECT id, what, default_in_effect FROM gate_cards WHERE status='open' ORDER BY id`);
    const tick = await one(`SELECT started_at, finished_at, steps_completed, steps_total FROM tick_runs ORDER BY id DESC LIMIT 1`);
    const pred = await one(`SELECT SUM(verdict='hit') AS hit, SUM(verdict IS NOT NULL) AS scored FROM predictions`);
    const trust = await all(`SELECT surface, action_class, rung, reliability FROM trust_ledger ORDER BY surface, action_class`);
    const waiting = await one(`SELECT COUNT(*) AS n FROM items WHERE status='blocked'`);
    return {
      version, at: iso(clock()),
      items: { open: (counts.open || 0) + (counts.ready || 0), claimed: counts.claimed || 0, blocked: counts.blocked || 0, done: counts.done || 0, total: Object.values(counts).reduce((a, b) => a + b, 0) },
      gate_cards: { open: cards.length, list: cards },
      last_tick: tick ? { ...tick, ok: tick.steps_completed === tick.steps_total, finished: !!tick.finished_at } : null,
      predictions: { hit: pred.hit || 0, scored: pred.scored || 0 },
      trust, waiting_on_a_person: cards.length + (waiting.n || 0),
    };
  }

  const has = async table => !!(await one(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, table).catch(() => null));

  /** The panels read straight from the tables other modules keep: the audit chain, open work by role (and the tracker's open issues
   *  when a tracker port is given), drift divergence from the latest wiring analysis, per-worker runs and next runs, and loop clocks.
   *  A table or port that is not there gives { available: false }, never a zero (US-13-R24). The dashboard page and the digest both
   *  read this one function (US-13-R02). */
  async function panels() {
    const out = {};
    if (await has('audit_events')) {
      const head = await one(`SELECT seq, at, hash FROM audit_events ORDER BY seq DESC LIMIT 1`);
      const n = await one(`SELECT COUNT(*) AS n FROM audit_events`);
      const days = (await has('audit_days')) ? await one(`SELECT COUNT(*) AS n, MAX(day) AS last FROM audit_days`) : { n: 0, last: null };
      out.audit = { available: true, events: n.n, head_seq: head?.seq ?? null, head_hash: head ? String(head.hash).slice(0, 12) : null, last_event_at: head?.at ?? null, days_rolled: days.n, last_rolled_day: days.last, chain_verified: false };
    } else out.audit = { available: false };
    const byRole = await all(`SELECT owner_role AS role, kind, COUNT(*) AS n FROM items WHERE status NOT IN ('done','superseded','cancelled') GROUP BY owner_role, kind ORDER BY owner_role, kind`);
    out.agent_issues = { available: true, open: byRole.reduce((a, r) => a + r.n, 0), by_role: byRole, tracker: { available: false } };
    if (tracker && typeof tracker.openIssues === 'function') {
      try { const r = await tracker.openIssues(); out.agent_issues.tracker = { available: true, count: r.issues.length, complete: !!r.complete }; }
      catch (e) { out.agent_issues.tracker = { available: false, reason: String(e?.message || e).slice(0, 120) }; }
    }
    if (await has('graph_wiring_analyses')) {
      const a = await one(`SELECT sweep_id, at, nodes, edges, islands, ghosts, unregistered, unversioned, orphan_tables, integration_score FROM graph_wiring_analyses ORDER BY id DESC LIMIT 1`);
      out.drift = a ? { available: true, ...a } : { available: false, reason: 'no wiring analysis has run' };
    } else out.drift = { available: false };
    const since = new Date(clock() - 864e5).toISOString().replace('T', ' ').slice(0, 19);
    const runs = { available: false, workers: [], next: [], loops: [] };
    if (await has('fleet_runs')) {
      runs.available = true;
      const last = Object.fromEntries((await all(`SELECT worker, status FROM fleet_runs r WHERE run_id = (SELECT MAX(run_id) FROM fleet_runs WHERE worker = r.worker)`)).map(r => [r.worker, r.status]));
      runs.workers = (await all(`SELECT worker, COUNT(*) AS runs, SUM(status='failed') AS failed FROM fleet_runs WHERE replace(queued_at,'T',' ') >= ? GROUP BY worker ORDER BY worker`, since)).map(r => ({ ...r, failed: r.failed || 0, last_status: last[r.worker] ?? null }));
    }
    if (await has('fleet_crons')) runs.next = await all(`SELECT name, expr, next_fire, last_fired FROM fleet_crons WHERE enabled=1 ORDER BY COALESCE(next_fire, '9'), name`);
    if (await has('loop_clock')) runs.loops = await all(`SELECT loop, state, coverage, expected_24h, ran_24h, good_24h, missed_24h FROM loop_clock ORDER BY loop`);
    runs.available = runs.available || runs.next.length > 0 || runs.loops.length > 0;
    out.runs = runs;
    return out;
  }

  const parseTime = t => Date.parse(String(t).includes('T') ? String(t) : String(t).replace(' ', 'T') + 'Z');
  const stale_after_s = (config.stale_after_minutes ?? 25) * 60;

  /** Liveness and counts (US-13-T01), graded (US-13-R21): `verdict` is healthy, degraded or stalled with `reasons`. Stalled when no
   *  check ever ran or the newest one is older than the bound (config.stale_after_minutes, default 25 for a 10-minute check);
   *  degraded when the last check did not finish or recorded errors, when every dispatch of the last check is still queued, or when
   *  something waits on a person. `ok` keeps its first meaning (the last check finished all its steps) so callers that read it
   *  keep working; `healthy` is the strict form: ok and no reason. */
  async function health() {
    const s = await state();
    const last = await one(`SELECT id, started_at, finished_at, errors FROM tick_runs ORDER BY id DESC LIMIT 1`);
    const reasons = [];
    let verdict = 'healthy'; let age = null;
    if (!last) { verdict = 'stalled'; reasons.push('no check has ever run'); }
    else {
      age = Math.max(0, Math.round((clock() - parseTime(last.finished_at || last.started_at)) / 1000));
      if (age > stale_after_s) { verdict = 'stalled'; reasons.push(`the newest check is ${Math.round(age / 60)} minutes old; the bound is ${Math.round(stale_after_s / 60)}`); }
      if (!s.last_tick.ok) reasons.push('the last check did not finish all its steps');
      let errs = []; try { errs = JSON.parse(last.errors || '[]'); } catch { errs = last.errors ? [String(last.errors)] : []; }
      if (Array.isArray(errs) && errs.length) reasons.push(`the last check recorded ${errs.length} error(s)`);
      const d = await one(`SELECT COUNT(*) AS n, SUM(status='queued') AS q FROM dispatches WHERE tick_id=?`, last.id);
      if (d.n > 0 && d.q === d.n) reasons.push('every dispatch of the last check is still queued');
      if (s.waiting_on_a_person > 0) reasons.push(`${s.waiting_on_a_person} item(s) wait on a person`);
      if (verdict !== 'stalled' && reasons.length) verdict = 'degraded';
    }
    return { ok: !!s.last_tick?.ok, healthy: verdict === 'healthy', verdict, reasons, tick_age_s: age, version: s.version, at: s.at,
      counts: { items: s.items.total, open_gate_cards: s.gate_cards.open, blocked: s.items.blocked } };
  }

  /** The digest is the state, worded. It reads the same function the dashboard reads (US-13-R02). */
  async function digest() {
    const s = await state();
    const lines = [
      `Items: ${s.items.open} open, ${s.items.claimed} in progress, ${s.items.blocked} blocked, ${s.items.done} done.`,
      `Decisions waiting on a person: ${s.waiting_on_a_person}.`,
      s.last_tick ? `Last check: ${s.last_tick.ok ? 'finished all steps' : 'did not finish'} (${s.last_tick.steps_completed} of ${s.last_tick.steps_total}).` : 'The first check has not run yet.',
      `Predictions: ${s.predictions.hit} of ${s.predictions.scored} called right.`,
    ];
    const p = await panels();
    if (p.agent_issues.tracker.available) lines.push(`Open issues on the tracker: ${p.agent_issues.tracker.count}${p.agent_issues.tracker.complete ? '' : ' (the read was cut off)'}.`);
    if (p.drift.available) lines.push(`Wiring: ${p.drift.ghosts} named but not registered, ${p.drift.unregistered} registered but unnamed, integration score ${p.drift.integration_score}.`);
    if (p.runs.workers.length) lines.push(`Runs in 24 hours: ${p.runs.workers.reduce((a, w) => a + w.runs, 0)}, ${p.runs.workers.reduce((a, w) => a + w.failed, 0)} failed.`);
    const missing = ['audit', 'drift'].filter(k => !p[k].available).concat(p.runs.available ? [] : ['runs']);
    if (missing.length) lines.push(`Not measured here: ${missing.join(', ')}.`);
    return { state: s, panels: p, text: lines.join('\n') };
  }

  /** Record a report card. Every score needs evidence, a confidence and a status; the card must state its limits including
   *  self-measurement bias (R03, R04). A dimension that fell 0.5 or more since its last score, with no cause, files a work item (R05). */
  async function recordCard({ name, rubric, limits, scores = [] } = {}) {
    const errors = [];
    if (!name || !rubric) errors.push('name and rubric are required');
    if (!limits || !LIMITS_MUST_MENTION.test(limits)) errors.push('limits must state self-measurement bias (the system grades itself)');
    if (!scores.length) errors.push('at least one score is required');
    scores.forEach((s, i) => {
      const at = `score ${i} (${s?.dimension ?? '?'})`;
      if (!s?.dimension) errors.push(`${at}: dimension is required`);
      if (typeof s?.score !== 'number' || !Number.isFinite(s.score)) errors.push(`${at}: score must be a number`);
      if (!String(s?.evidence || '').trim()) errors.push(`${at}: evidence pointer is required, a score without evidence is not accepted`);
      if (!CONFIDENCE.includes(s?.confidence)) errors.push(`${at}: confidence must be one of ${CONFIDENCE.join(', ')}`);
      if (!String(s?.status || '').trim()) errors.push(`${at}: status is required`);
    });
    if (errors.length) return { ok: false, errors };
    const t = iso(clock());
    const card = await run(`INSERT INTO l3_cards (name, rubric, limits, at) VALUES (?,?,?,?)`, name, rubric, limits, t);
    const cardId = card.meta.last_row_id;
    const items = [];
    for (const s of scores) {
      const prev = await one(`SELECT score FROM l3_scores WHERE name=? AND dimension=? ORDER BY id DESC LIMIT 1`, name, s.dimension);
      await run(`INSERT INTO l3_scores (card_id, name, dimension, score, evidence, confidence, status, cause, at) VALUES (?,?,?,?,?,?,?,?,?)`,
        cardId, name, s.dimension, s.score, s.evidence, s.confidence, s.status, s.cause ?? null, t);
      // Scores are one-decimal numbers, so compare in integer millionths: 2.3 - 1.8 is 0.4999999999999998 in IEEE arithmetic (US-13-R05).
      if (prev && Math.round((prev.score - s.score) * 1e6) >= 5e5 && !String(s.cause || '').trim()) {
        const id = `L3-DROP-${name}-${s.dimension}`.toUpperCase().replace(/[^A-Z0-9-]+/g, '-');
        await run(`INSERT INTO items (id, title, kind, project, owner_role, done_check, closing_probe, priority, status) VALUES (?,?,'work','report-card','portfolio-manager',?,'manual',20,'open')
          ON CONFLICT(id) DO UPDATE SET status='open', updated_at=datetime('now')`, id, `${name}: ${s.dimension} fell from ${prev.score} to ${s.score} with no documented cause`, `cause of the fall in ${s.dimension} recorded with evidence`);
        items.push(id);
      }
    }
    return { ok: true, card_id: cardId, items };
  }

  /** The latest score per dimension for a card name, with limits attached. */
  async function reportCard(name) {
    const card = await one(`SELECT id, name, rubric, limits, at FROM l3_cards WHERE name=? ORDER BY id DESC LIMIT 1`, name);
    if (!card) return null;
    const scores = await all(`SELECT dimension, score, evidence, confidence, status, cause FROM l3_scores WHERE card_id=? ORDER BY dimension`, card.id);
    const mean = scores.length ? scores.reduce((a, s) => a + s.score, 0) / scores.length : null;
    // US-13-R23: a card nobody attested says it is self-measured. The audits are kept by core/sla (sla_card_audits); without that table the card is self-measured too.
    const att = (await has('sla_card_audits')) ? await one(`SELECT attestor, agree, at FROM sla_card_audits WHERE card_id=? AND attestor IS NOT NULL ORDER BY id DESC LIMIT 1`, card.id) : null;
    const attestation = att ? { state: att.agree ? 'attested' : 'attested with disagreement', by: att.attestor, at: att.at } : { state: 'self-measured, not independently attested' };
    return { ...card, scores, overall: mean, attestation };
  }

  /** The system MAY propose a change to its objective function; it never adopts one (US-13-R06). */
  async function proposeObjectiveChange(text) {
    const t = String(text || '').trim();
    if (!t) return { ok: false, error: 'proposal text required' };
    const r = await run(`INSERT INTO l3_proposals (text, status, at) VALUES (?, 'proposed', ?)`, t, iso(clock()));
    return { ok: true, id: r.meta.last_row_id, status: 'proposed' };
  }
  const adoptObjectiveChange = async () => ({ ok: false, refusal: 'objective_function_is_not_self_adoptable', error: 'the system may propose a change to its objective function but may not adopt it' });

  /** Per-step budgets (US-13-R11, T04). runs: [{ process, step, started_at (ms or ISO), budget_hours, done? }].
   *  Over budget: one item keyed (process, step), reopened when a later run breaches after it was closed. Over twice the budget: exactly
   *  one blocking question per run (a gate card keyed by the run's start), so a closed question of an earlier run never hides this
   *  run's, and the same run swept twice asks once. The returned list names every breach seen (item) and every question written;
   *  `result.changed` (not enumerable, so existing equality checks on the list stand) names only the filings that really changed a row. */
  async function sweepStepBudgets(runs = []) {
    const filed = []; const changedOnly = [];
    const at = new Date(clock()).toISOString().replace('T', ' ').slice(0, 19);
    for (const r of runs) {
      if (r.done) continue;
      const started = typeof r.started_at === 'number' ? r.started_at : Date.parse(r.started_at);
      const hours = (clock() - started) / 3600e3;
      const key = `${r.process}-${r.step}`.toUpperCase().replace(/[^A-Z0-9-]+/g, '-');
      if (hours > r.budget_hours) {
        const changed = await fileOrReopen(db, { id: `STEPBUDGET-${key}`, title: `${r.process} / ${r.step} is over its ${r.budget_hours} h budget`, kind: 'fix', project: 'step-budget',
          owner_role: 'portfolio-manager', done_check: `${r.process} / ${r.step} finishes or its budget is justified`, closing_probe: 'manual', priority: 25, at });
        filed.push({ key, kind: 'item' }); if (changed) changedOnly.push({ key, kind: 'item' });
      }
      if (hours > 2 * r.budget_hours) {
        // One blocking question per run: the first run's card keeps the plain id; a run that follows a closed one gets its own,
        // and a run that already asked (open or answered) never asks twice.
        const run_key = Math.floor(started / 60e3);
        const tag = `console-l3 run=${run_key}`;
        const mine = await one(`SELECT id FROM gate_cards WHERE id LIKE ? AND prepared_by_fleet = ? LIMIT 1`, `stepq-${key.toLowerCase()}%`, tag);
        const open = await one(`SELECT id FROM gate_cards WHERE id LIKE ? AND status='open' LIMIT 1`, `stepq-${key.toLowerCase()}%`);
        if (!mine && !open) {
          const plain = `stepq-${key}`.toLowerCase();
          const id = (await one(`SELECT id FROM gate_cards WHERE id=?`, plain)) ? `${plain}-${run_key}` : plain;
          const w = await run(`INSERT OR IGNORE INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES (?,?,?,?,?,?)`,
            id, `${r.process} / ${r.step} has run ${hours.toFixed(1)} h against a ${r.budget_hours} h budget: what is blocking it?`,
            'The step is past twice its time budget.', 'the step keeps running; the item stays open', tag, `item_done:STEPBUDGET-${key}`);
          if (w.meta.changes) { filed.push({ key, kind: 'question' }); changedOnly.push({ key, kind: 'question' }); }
        }
      }
    }
    Object.defineProperty(filed, 'changed', { value: changedOnly, enumerable: false });
    return filed;
  }

  /** Routes: GET /health, /api/state, /api/report-card?name=. Returns null for other paths. Auth is the caller's job
   *  (the console routes the /api/console/fleet prefix behind its sign-in). */
  async function handle(request) {
    const url = new URL(request.url);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    if (request.method !== 'GET') return null;
    if (url.pathname === '/health') { const h = await health(); return json(h, h.verdict === 'stalled' ? 503 : 200); }
    if (url.pathname === '/api/state') return json(await state());
    if (url.pathname === '/api/digest') return json(await digest());
    if (url.pathname === '/api/report-card') {
      const c = await reportCard(url.searchParams.get('name') || '');
      return c ? json(c) : json({ error: 'no such report card' }, 404);
    }
    return null;
  }

  return { state, panels, health, digest, recordCard, reportCard, proposeObjectiveChange, adoptObjectiveChange, sweepStepBudgets, handle };
}
