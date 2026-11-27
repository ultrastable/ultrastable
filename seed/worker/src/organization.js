// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// ORG-THEORY-1 (Rowan, 2026-11-27): "Implement ORGANIZATIONAL THEORY: A CYBERNETIC Approach in code."
// Juan A. Perez Lopez, IESE Working Paper 5 (July 1974). The paper's model as pure functions; every concept is a row of
// seed/autonomy/secondloop.json and test/organization.test.js holds each to the paper's own statements.
// Reading for a fleet of agents: a member is a role or loop; a task is an action class the control system prescribes; the reward is what the
// organisation spends to get the task done; individual efficiency is what doing the task does to the member's other essential variables,
// which nobody knows beforehand and the member learns by doing it.
// The paper's point, kept as the design rule: an organisation is not given the second feedback by nature. It must build the sensing of
// individual efficiency on purpose, or it dies without knowing why.

const num = v => typeof v === 'number' && !Number.isNaN(v);
const sum = a => a.reduce((s, v) => s + v, 0);

// ---- Ch. III: the three values of an action, for the one who acts ----
// effectiveness: the consequences sought, known beforehand (the reward as the member values it).
// efficiency: the consequences for the member's other needs; `expected` at the moment of deciding, `observed` after doing it.
// consistency: what experience did to efficiency (observed minus expected). Negative: the member learnt the task costs more than it thought.
export function actionValues({ effectiveness, expected_efficiency = 0, observed_efficiency = null }) {
  const efficiency = num(observed_efficiency) ? observed_efficiency : expected_efficiency;
  return {
    effectiveness, efficiency, known: num(observed_efficiency),
    consistency: num(observed_efficiency) ? observed_efficiency - expected_efficiency : null,
    motivation: num(effectiveness) ? effectiveness + efficiency : null,
  };
}

// The two things experience can teach (ch. III). `incorrect`: the sought satisfaction did not come, so the model predicts wrongly and is
// re-fitted. `incomplete`: it came, with a consequence the model never contained, so a variable is missing and must be added to what is sensed.
export function learningKind({ predicted, observed, unmodelled = 0, tolerance = 0.1 }) {
  if (!num(predicted) || !num(observed)) return { kind: 'unmeasured', remedy: 'measure the outcome' };
  if (Math.abs(observed - predicted) > tolerance * Math.max(1, Math.abs(predicted))) return { kind: 'incorrect', remedy: 'recalibrate the model' };
  if (Math.abs(unmodelled) > tolerance) return { kind: 'incomplete', remedy: 'add an essential variable for the consequence the model left out' };
  return { kind: 'none', remedy: null };
}

// ---- Ch. IV and V: the control system (tasks and their immediate rewards), judged at three levels ----
// tasks: [{ id, member, contribution, reward, valued_reward?, expected_efficiency?, observed_efficiency? }]
//   contribution and reward are in the organisation's own measure; valued_reward is the reward as the member values it (default: reward).
// effectiveness = what the tasks bring minus what it costs to motivate them (the paper's "profit"); it must be positive to exist at all.
// attractiveness, per member = valued reward plus individual efficiency; at or above `threshold` the member cooperates.
// consistency, per member = the change in attractiveness that learning produced. Falling means the organisation is teaching its members to leave.
// There is no single score: any one number that mixes these is an unstated definition of the organisation's purpose.
export function controlSystem(tasks = [], { threshold = 0 } = {}) {
  const members = new Map();
  for (const t of tasks) {
    const v = actionValues({ effectiveness: num(t.valued_reward) ? t.valued_reward : t.reward, expected_efficiency: t.expected_efficiency || 0, observed_efficiency: t.observed_efficiency });
    const m = members.get(t.member) || { member: t.member, attractiveness: 0, consistency: 0, known: 0, tasks: 0 };
    m.attractiveness += v.motivation; m.tasks++;
    if (v.known) { m.known++; m.consistency += v.consistency; }
    members.set(t.member, m);
  }
  const rows = [...members.values()].map(m => ({ ...m, consistency: m.known ? m.consistency : null, attractive: m.attractiveness >= threshold })).sort((a, b) => (a.member < b.member ? -1 : 1));
  const effectiveness = sum(tasks.map(t => (t.contribution || 0) - (t.reward || 0)));
  const sensed = tasks.filter(t => num(t.observed_efficiency)).length;
  const levels = {
    effective: tasks.length > 0 && effectiveness > 0,
    attractive: rows.length > 0 && rows.every(m => m.attractive),
    consistent: rows.length > 0 && rows.every(m => m.consistency !== null && m.consistency >= 0),
  };
  return {
    effectiveness, members: rows, levels,
    // An organisation is "blind" to the share of its tasks whose effect on the member it has never read. Unread is not consistent.
    blind_share: tasks.length ? 1 - sensed / tasks.length : null,
    survives: levels.effective && levels.attractive && levels.consistent,
    alienated: rows.filter(m => m.attractive && m.consistency !== null && m.consistency < 0).map(m => m.member),
    identified: rows.filter(m => m.consistency !== null && m.consistency > 0).map(m => m.member),
  };
}

// ---- Ch. V: how an inconsistent organisation disappears ----
// While a task's efficiency for the member falls by `drift` each period, the reward needed to keep the member at the threshold rises by the
// same amount, and the margin between contribution and reward shrinks. Returns how many whole periods remain before motivating the task
// costs more than the task brings (null: it never happens, the task is consistent). Compensating with reward buys time and nothing else.
export function horizon({ contribution, valued_reward_per_unit = 1, efficiency = 0, drift = 0, threshold = 0 }) {
  const need = e => Math.max(0, (threshold - e) / valued_reward_per_unit);   // the reward that just holds the member
  if (need(efficiency) >= contribution) return 0;
  if (!(drift < 0)) return null;
  return Math.max(0, Math.ceil((contribution * valued_reward_per_unit - threshold + efficiency) / -drift) - 1);
}

// ---- Ch. V, the closing theorem: organisational values ----
// Values are the criteria applied before a task may be prescribed: a task that does not satisfy the needs of the one who performs it is
// forbidden, even when its reward would get it done and the member cannot yet know. Among what remains, the organisation's goal decides.
// A task whose effect on the member is unknown is admitted only as a trial (`probation`), so that it gets read; it is never assumed harmless.
export function prescribe(tasks = [], { floor = 0 } = {}) {
  const eff = t => (num(t.observed_efficiency) ? t.observed_efficiency : num(t.expected_efficiency) ? t.expected_efficiency : null);
  const rank = (a, b) => ((b.contribution || 0) - (b.reward || 0)) - ((a.contribution || 0) - (a.reward || 0)) || (a.id < b.id ? -1 : 1);
  const allowed = tasks.filter(t => eff(t) !== null && eff(t) >= floor).sort(rank);
  return {
    prescribed: allowed.map(t => t.id),
    probation: tasks.filter(t => eff(t) === null).sort(rank).map(t => t.id),
    forbidden: tasks.filter(t => eff(t) !== null && eff(t) < floor).map(t => ({ id: t.id, margin: (t.contribution || 0) - (t.reward || 0), efficiency: eff(t) })).sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

// ---- Ch. III, footnote 3: the evoked set ----
// A freely adaptive system acts on a selected part of its memory. Selection that leaves out the records showing a past action was wrong is
// what the paper calls pride. This selection cannot do that: every failure of the proposed action class is evoked before anything else,
// and only the remainder competes for the room that is left.
export function evoke(memory = [], action_class, { room = 10 } = {}) {
  const mine = memory.filter(r => r.action_class === action_class);
  const failures = mine.filter(r => r.outcome === 'rollback' || r.outcome === 'failed');
  const rest = mine.filter(r => !failures.includes(r)).sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, Math.max(0, room - failures.length));
  return { evoked: [...failures, ...rest], failures: failures.length, truncated: mine.length - failures.length - rest.length };
}

// ---- Ch. I: the minimum organisation is two coupled ultrastable systems ----
// Each party has its own essential variables; the organisation holds while both keep theirs in limits through the same joint action.
// a, b: [{ id, lower?, upper?, value }]. Returns whose variables are out; an organisation in which only one side is in limits is not in equilibrium.
export function coupledPair(a = [], b = []) {
  const out = vs => vs.filter(v => !num(v.value) || (v.lower != null && v.value < v.lower) || (v.upper != null && v.value > v.upper)).map(v => v.id).sort();
  const oa = out(a), ob = out(b);
  return { equilibrium: a.length > 0 && b.length > 0 && !oa.length && !ob.length, out: { a: oa, b: ob }, one_sided: (oa.length === 0) !== (ob.length === 0) };
}
