// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The systems report card (US-SPEC-13 section 5, US-13-R22): six rubrics from the published literature on systems and automation,
// each scored 0 to 5 from the organisation's own tables as the share of rows meeting a stated condition, with the evidence read, a
// confidence and a status. The rubrics were written for vehicles, people and organisations; applying them to this system is by analogy
// and the card says so in its limits. A rubric with no rows scores 0 and is marked unmeasured, never estimated. Ports: db and the
// configuration of core/sla; this module owns no card logic (core/console-l3 records the card, with the fall-of-0.5 rule).
export const SYSTEMS_CARD_NAME = 'systems';
export const SYSTEMS_LIMITS = 'Self-measurement bias: the system grades itself. Rubric mismatch: the six rubrics (levels of automation, organizational viability, decision-cycle closure, self-adaptive loops, control-loop automation, time horizon) were designed for vehicles, people and organizations and are applied here by analogy, each as a share of table rows. Evidence is point-in-time, read from the tables at the stated time. Decision-cycle closure is inferred from receipt counts, not observed loop by loop. A top score is reported as a gap, not accepted.';
const TERMINAL = `('done','superseded','cancelled')`;
const H = 3600e3;
const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const parse = s => Date.parse(String(s).replace(' ', 'T').replace(/Z?$/, 'Z'));

const confidenceOf = d => (d >= 30 ? 'high' : d >= 5 ? 'medium' : 'low');

/** ctx: { db, cfg (the sla configuration), asOf (ms) }. Returns the six dimensions in the shape core/console-l3 recordCard takes, plus `gap`. */
export async function systemsDimensions({ db, cfg, asOf }) {
  const nowS = stamp(asOf); const since = stamp(asOf - cfg.window_days * 24 * H);
  const one = async (sql, ...a) => (await db.prepare(sql).bind(...a).first()) || {};
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const rungs = cfg.rungs; const top = rungs.length - 1;
  const out = [];
  const add = (dimension, tables, what, n, d, { cap = null, basis = d, note = '' } = {}) => {
    const score = d ? Math.round((n / d) * 50) / 10 : 0;
    const gap = Math.round((5 - score) * 10) / 10;
    let confidence = confidenceOf(basis); if (cap === 'medium' && confidence === 'high') confidence = 'medium';
    const status = !d ? 'unmeasured: no rows yet, scored 0' : score >= 5 ? 'gap: a top score is not accepted on self-measurement; confirm with outside evidence' : `measured; ${Math.min(gap, 1).toFixed(1)} to the next point${note ? `; ${note}` : ''}`;
    out.push({ dimension, score, evidence: `${tables}: ${Number.isInteger(n) ? n : n.toFixed(1)} of ${d} ${what} (read ${nowS})`, confidence, status, gap: !d || score >= 5 ? Math.max(gap, 1) : gap });
  };

  // 1. Levels of automation: how far up the rungs the trust ledger has climbed, over the rungs available.
  const ledger = await all(`SELECT rung FROM trust_ledger`);
  add('levels_of_automation', 'trust_ledger', 'rungs climbed out of the rungs available, over the surfaces acted on', ledger.reduce((a, r) => a + Math.max(0, rungs.indexOf(r.rung)), 0), top * ledger.length);

  // 2. Organizational viability: how many of the five functions of a viable system leave rows (operations, coordination, control, intelligence, policy).
  const fn = {
    operations: (await one(`SELECT COUNT(*) AS n FROM roles WHERE last_tick_at IS NOT NULL AND last_tick_at >= ?`, since)).n > 0,
    coordination: (await one(`SELECT COUNT(*) AS n FROM claims WHERE heartbeat_at >= ?`, since)).n > 0,
    control: (await one(`SELECT COUNT(*) AS n FROM sla_rows s JOIN items i ON i.id = s.item_id WHERE i.status NOT IN ${TERMINAL} AND s.due_at >= ?`, nowS)).n > 0,
    intelligence: (await one(`SELECT COUNT(*) AS n FROM predictions WHERE verdict IS NOT NULL`)).n > 0,
    policy: (await one(`SELECT COUNT(*) AS n FROM gate_cards WHERE status='closed'`)).n > 0,
  };
  const present = Object.entries(fn).filter(([, v]) => v).map(([k]) => k);
  // No function leaves any row at all: that is no reading, not a reading of zero.
  add('organizational_viability', 'roles, claims, sla_rows, predictions, gate_cards', `of the five functions of a viable system leave rows in the window (${present.join(', ') || 'none'})`, present.length, present.length ? 5 : 0, { basis: 5 });

  // 3. Decision-cycle closure, inferred from receipts: predictions scored, gate cards closed and items created in the window that closed with a disposition.
  const pr = await one(`SELECT COUNT(*) AS d, SUM(CASE WHEN verdict IS NOT NULL THEN 1 ELSE 0 END) AS n FROM predictions WHERE due_at <= ?`, nowS);
  const gc = await one(`SELECT COUNT(*) AS d, SUM(CASE WHEN status='closed' THEN 1 ELSE 0 END) AS n FROM gate_cards`);
  const it = await one(`SELECT COUNT(*) AS d, SUM(CASE WHEN status IN ${TERMINAL} AND COALESCE(disposition,'') <> '' THEN 1 ELSE 0 END) AS n FROM items WHERE created_at >= ?`, since);
  add('decision_cycle_closure', 'predictions, gate_cards, items', 'loops closed, counted from receipts (predictions scored, decision cards closed, new items closed with a disposition)', (pr.n || 0) + (gc.n || 0) + (it.n || 0), (pr.d || 0) + (gc.d || 0) + (it.d || 0), { cap: 'medium', note: 'inferred from receipt counts' });

  // 4. Self-adaptive loops: the ladder and the amendments the system filed that reached done.
  const ad = await one(`SELECT COUNT(*) AS d, SUM(CASE WHEN status='done' THEN 1 ELSE 0 END) AS n FROM items WHERE kind IN ('ladder','amendment')`);
  add('self_adaptive_loops', 'items', 'ladder and amendment items filed that reached done', ad.n || 0, ad.d || 0);

  // 5. Control-loop automation: steps completed over steps run, and items closed with no console action on them.
  const tr = await one(`SELECT COALESCE(SUM(steps_completed),0) AS n, COALESCE(SUM(steps_total),0) AS d FROM tick_runs WHERE started_at >= ?`, since);
  const closed = await all(`SELECT i.id, EXISTS (SELECT 1 FROM console_actions c WHERE c.ref = i.id) AS touched FROM items i WHERE i.status='done' AND i.updated_at >= ?`, since);
  add('control_loop_automation', 'tick_runs, items, console_actions', 'tick steps completed plus items closed with no person touching them, over steps run plus items closed', tr.n + closed.filter(r => !r.touched).length, tr.d + closed.length);

  // 6. Time horizon: days the system has run since a person last touched it, over a year.
  const first = await one(`SELECT MIN(started_at) AS t FROM tick_runs`);
  const touch = await one(`SELECT MAX(at) AS t FROM console_actions`);
  if (!first.t) add('time_horizon', 'tick_runs, console_actions', 'days of a year run with no person touching it', 0, 0);
  else {
    const from = touch.t ? parse(touch.t) : parse(first.t);
    const days = Math.max(0, Math.min(365, Math.floor((asOf - from) / (24 * H))));
    const history = Math.floor((asOf - parse(first.t)) / (24 * H));
    add('time_horizon', 'tick_runs, console_actions', `days of a year run since ${touch.t ? 'a person last touched it' : 'the first check (no person has touched it)'}`, days, 365, { basis: history });
  }
  return out;
}
