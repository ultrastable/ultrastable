// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Default processes and derived step runs (US-SPEC-13 R11, R12). A process defines its done check once and maps at least two
// independent paths to every step; each step has a budget in hours. Nothing in the organisation starts a step run by hand, so the runs
// are also derived from the tables the core already keeps, with no hook installed in any other module: a claim with no heartbeat, a
// prediction past its due date with no verdict, a dispatch still queued. All of it is overridable by config.sla.processes.
export const DEFAULT_PROCESSES = {
  item: { done_check: 'the item is done with a disposition and its closing probe passes', steps: [
    { step: 'claim', budget_hours: 2, paths: ['the dispatch step claims it for the owning role', 'the executor or a person claims it by hand'] },
    { step: 'work', budget_hours: 24, paths: ['the role that holds the claim works it', 'the claim is released and the item is dispatched again'] },
    { step: 'verify', budget_hours: 12, paths: ['a different agent or an automated check verifies it', 'its closing probe is read by the tick'] }] },
  decision: { done_check: 'the decision card is closed by the answer or by its default in effect', steps: [
    { step: 'answer', budget_hours: 72, paths: ['the person answers the card', 'the default in effect applies and the probe closes the card'] }] },
  prediction: { done_check: 'the prediction has a verdict', steps: [
    { step: 'score', budget_hours: 6, paths: ['the tick scores it against a built-in metric', 'a probe closes it by hand'] }] },
  dispatch: { done_check: 'the dispatch ends done or failed', steps: [
    { step: 'execute', budget_hours: 1, paths: ['the executor works it', 'the claim is released and the item is dispatched again'] }] },
  change: { done_check: 'the change is merged and its live probe passes', steps: [
    { step: 'review', budget_hours: 4, paths: ['a reviewer agent of another model', 'an automated check'] },
    { step: 'merge', budget_hours: 24, paths: ['the lane merges a green change', 'the change is carried onto current main by a fresh branch'] },
    { step: 'deploy', budget_hours: 2, paths: ['a canary with probes', 'a direct deploy with automatic revert'] }] },
};

const parse = s => Date.parse(String(s).replace(' ', 'T').replace(/Z?$/, 'Z'));
const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

/** The processes in effect: the defaults with config.sla.processes laid over them (a process named there replaces the default of that name). */
export const processesFor = cfg => ({ ...DEFAULT_PROCESSES, ...(cfg.processes || {}) });

/** Open runs derived from tables: [{ process, step, ref, budget_hours, started_at (ms) }]. `budgetOf(process, step)` gives the budget in effect.
 *  A decision card has no creation time in the core schema, so decisions are timed only by runs a host starts; they are not derived. */
export async function derivedRuns({ db, budgetOf, asOf }) {
  const nowS = stamp(asOf);
  const rows = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const out = [];
  const age = (ms, budget) => (asOf - ms) / 3600e3 > budget;
  const claimBudget = budgetOf('item', 'claim');
  if (claimBudget > 0) for (const c of await rows(`SELECT c.item_id, c.claimed_at, c.heartbeat_at FROM claims c JOIN items i ON i.id = c.item_id WHERE i.status NOT IN ('done','superseded','cancelled')`)) {
    const last = Math.max(parse(c.claimed_at), parse(c.heartbeat_at || c.claimed_at));          // the silence starts at the newer of the two
    if (age(last, claimBudget)) out.push({ process: 'item', step: 'claim', ref: c.item_id, budget_hours: claimBudget, started_at: last });
  }
  const scoreBudget = budgetOf('prediction', 'score');
  if (scoreBudget > 0) for (const p of await rows(`SELECT id, due_at FROM predictions WHERE verdict IS NULL AND due_at <= ?`, nowS)) {
    const due = parse(p.due_at); if (age(due, scoreBudget)) out.push({ process: 'prediction', step: 'score', ref: p.id, budget_hours: scoreBudget, started_at: due });
  }
  const execBudget = budgetOf('dispatch', 'execute');
  if (execBudget > 0) for (const d of await rows(`SELECT id, at FROM dispatches WHERE status='queued'`)) {
    const at = parse(d.at); if (age(at, execBudget)) out.push({ process: 'dispatch', step: 'execute', ref: String(d.id), budget_hours: execBudget, started_at: at });
  }
  return out;
}
