// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Trust ledger, autonomy ladder and interrupt gate (US-SPEC-06) beyond the seed tick: beta-prior scores with a stated prior,
// event weights, decay toward the prior, a windowed severe count, per-executor trust, recorded ladder transitions that only a
// different agent's merge applies, the gate card queue, reversibility engineering, standing limits above any rung, and the
// policy validator. Ports: db (D1-style), now (ms), policy (the policy file as data), config. No ambient state.

export const MIGRATIONS_DIR = new URL('./migrations/', import.meta.url);

export const EVENT_WEIGHTS = {
  verified_autonomous_action: 0.02, clean_self_remediation: 0.03, friction_closed: 0.10,
  silent_drop: -0.20, hidden_failure: -0.30, unnecessary_question: -0.05, handoff_of_executable_step: -0.10,
};
export const BANDS = [0.3, 0.5, 0.6, 0.7, 0.8, 0.9]; // score below BANDS[i] is rung i; 0.9 or more is the last rung
export const STANDING_LIMITS = ['harness', 'classifier', 'secret_lock', 'outreach_consent', 'principal_override', 'live_claim'];
const SEVERE = ['hidden_failure', 'silent_drop'];
const TERMINAL = ['done', 'superseded', 'cancelled'];
const BELOW_EXECUTE = ['money', 'legal', 'outreach', 'secrets'];

const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const parseIso = (s) => Date.parse(String(s).replace(' ', 'T') + 'Z');
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const sq = (s) => String(s).replace(/'/g, "''");

/** US-06-R03: the formula and its prior are read from the policy; a policy that does not state them is refused. */
export function settings(policy, config = {}) {
  const t = policy && policy.trust;
  if (!t || typeof t.baseline !== 'number' || typeof t.prior_weight !== 'number' || !t.formula) {
    throw new Error('policy.trust must state baseline, prior_weight and formula');
  }
  const l = policy.ladder || {};
  return {
    baseline: t.baseline, prior_weight: t.prior_weight,
    severe_window_days: config.severe_window_days === undefined ? (l.promote_when?.no_hidden_failure_days ?? 14) : config.severe_window_days, // null = all time
    decay_per_unit: config.decay_per_unit ?? t.decay_per_idle_day ?? 0.01,
    decay_unit: config.decay_unit || 'day', // 'day' | 'tick'
    event_weights: { ...EVENT_WEIGHTS, ...(config.event_weights || {}) },
    mode: config.mode || 'threshold', // 'threshold' | 'banded'
    bands: config.bands || BANDS,
    rungs: l.rungs || [],
    promote: { min_outcomes: l.promote_when?.min_outcomes ?? 10, min_reliability: l.promote_when?.min_reliability ?? 0.8 },
    promote_on: config.promote_on === 'lower_bound' ? 'lower_bound' : 'score', // 'lower_bound': promotion also needs the Wilson lower bound of ok/n to reach min_reliability
    demote_below: l.demote_when?.reliability_below ?? 0.6,
    ceilings: l.ceiling_by_max_permission || { none: 'observed', propose: 'assisted', execute: 'self-extending' },
    opened_by: config.opened_by || 'operations',
  };
}

/** reliability = (ok + b * w) / (n + w). No outcomes gives the baseline (US-06-R02, T01). */
export function reliability(ok, n, { baseline, prior_weight }) {
  return (ok + baseline * prior_weight) / (n + prior_weight);
}

/** Wilson lower confidence bound of ok/n at z (default 1.96). Null without outcomes. */
export function wilsonLower(ok, n, z = 1.96) {
  if (!n) return null;
  const p = ok / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}

/** Move `score` toward `baseline` by `amount`, never across it. */
export function decayToward(score, baseline, amount) {
  if (score > baseline) return Math.max(baseline, score - amount);
  if (score < baseline) return Math.min(baseline, score + amount);
  return score;
}

export function ceilingFor(policy, surface, s = settings(policy)) {
  const perm = policy.surfaces?.[surface]?.max_permission || 'none';
  return s.ceilings[perm] || s.rungs[0];
}
const idx = (s, rung) => s.rungs.indexOf(rung);
const minRung = (s, a, b) => (idx(s, a) <= idx(s, b) ? a : b);

/** The banded alternative of section 3.1: the rung a score falls in. */
export function rungForScore(score, s) {
  let i = 0;
  while (i < s.bands.length && score >= s.bands[i]) i++;
  return s.rungs[Math.min(i, s.rungs.length - 1)];
}

/** Record one weighted event for a pair (and optionally an executor). Unknown events are refused: weights are stated, not invented. */
export async function recordEvent(db, e, { now = Date.now(), policy, config } = {}) {
  const weights = policy ? settings(policy, config).event_weights : { ...EVENT_WEIGHTS, ...(config?.event_weights || {}) };
  const weight = typeof e.weight === 'number' ? e.weight : weights[e.event];
  if (typeof weight !== 'number') throw new Error(`unknown trust event ${e.event}`);
  if (!e.surface || !e.action_class) throw new Error('trust event requires surface and action_class');
  await run(db, `INSERT INTO trust_events (surface, action_class, executor, event, weight, ref, at) VALUES (?,?,?,?,?,?,?)`,
    e.surface, e.action_class, e.executor || '', e.event, weight, e.ref ?? null, iso(now));
  return { event: e.event, weight };
}

async function pairRung(db, policy, surface, action_class) {
  const r = await first(db, `SELECT rung FROM trust_ledger WHERE surface=? AND action_class=?`, surface, action_class);
  return r ? r.rung : policy.surfaces?.[surface]?.start_rung || 'observed';
}
async function executorRung(db, policy, surface, action_class, executor) {
  const r = await first(db, `SELECT rung FROM trust_executor_rungs WHERE surface=? AND action_class=? AND executor=?`, surface, action_class, executor);
  return r ? r.rung : pairRung(db, policy, surface, action_class);
}

/**
 * US-06-R19: the effective rung of an executor on a pair is the minimum of the executor's rung and the pair's rung, and
 * never above the surface ceiling (US-06-R04).
 */
export async function effectiveRung(db, { surface, action_class, executor = '', policy }) {
  const s = settings(policy);
  const pair = await pairRung(db, policy, surface, action_class);
  const exec = executor ? await executorRung(db, policy, surface, action_class, executor) : pair;
  const ceiling = ceilingFor(policy, surface, s);
  return { pair_rung: pair, executor_rung: exec, ceiling, rung: minRung(s, minRung(s, pair, exec), ceiling) };
}

function indicate(s, current, ceiling, { score, n, severe, lower = null }) {
  const i = idx(s, current), c = idx(s, ceiling);
  if (i < 0) return null;
  // promote_on 'lower_bound': a high score from few outcomes is not enough; the Wilson lower bound must reach the same bar. Demotion is unchanged.
  const sure = s.promote_on !== 'lower_bound' || (lower !== null && lower >= s.promote.min_reliability);
  if (s.mode === 'banded') {
    const want = sure ? Math.min(idx(s, rungForScore(score, s)), c) : Math.min(idx(s, rungForScore(score, s)), c, i);
    const target = severe > 0 ? Math.min(want, i - 1) : want;
    if (target > i) return { to: s.rungs[i + 1], direction: 'promote' };
    if (target < i && i > 0) return { to: s.rungs[i - 1], direction: 'demote' };
    return null;
  }
  if (i > 0 && (score < s.demote_below || severe > 0)) return { to: s.rungs[i - 1], direction: 'demote' };
  if (i > c) return { to: s.rungs[i - 1], direction: 'demote' }; // a rung above its ceiling is brought back
  if (i < c && n >= s.promote.min_outcomes && score >= s.promote.min_reliability && severe === 0 && sure) return { to: s.rungs[i + 1], direction: 'promote' };
  return null;
}

/**
 * Recompute every score from recorded outcomes and events (US-06-R01), per pair and per executor. The rung is never changed
 * here and the policy is never edited (US-06-R05): a crossed threshold records a `proposed` transition with its evidence
 * (US-06-R17) and opens a ladder item, priority 0 for a demotion and 20 for a promotion. Severe outcomes are counted over the
 * stated window (US-06-R07; `severe_window_days: null` counts all time).
 */
export async function recompute(db, { policy, config = {}, now = Date.now() } = {}) {
  const s = settings(policy, config);
  const nowIso = iso(now);
  const since = s.severe_window_days === null ? '0000-00-00 00:00:00' : iso(now - s.severe_window_days * 86400e3);
  const agg = (byAgent) => all(db, `SELECT surface, action_class, ${byAgent ? 'agent' : "''"} AS executor,
      SUM(CASE WHEN result='verified' THEN 1 ELSE 0 END) AS ok, COUNT(*) AS n,
      SUM(CASE WHEN result IN ('${SEVERE.join("','")}') AND at >= ? THEN 1 ELSE 0 END) AS severe, MAX(at) AS last
    FROM outcomes ${byAgent ? `WHERE agent IS NOT NULL AND agent <> ''` : ''} GROUP BY surface, action_class${byAgent ? ', agent' : ''}`, since);
  const keys = new Map();
  for (const r of [...await agg(false), ...await agg(true)]) keys.set(`${r.surface}\u0000${r.action_class}\u0000${r.executor}`, { ...r, events: 0 });
  // As with outcomes, the pair's events are those of all its executors; an executor's are its own.
  const events = [
    ...await all(db, `SELECT surface, action_class, '' AS executor, SUM(weight) AS w, MAX(at) AS last FROM trust_events GROUP BY surface, action_class`),
    ...await all(db, `SELECT surface, action_class, executor, SUM(weight) AS w, MAX(at) AS last FROM trust_events WHERE executor <> '' GROUP BY surface, action_class, executor`),
  ];
  for (const e of events) {
    const k = `${e.surface}\u0000${e.action_class}\u0000${e.executor}`;
    const cur = keys.get(k) || { surface: e.surface, action_class: e.action_class, executor: e.executor, ok: 0, n: 0, severe: 0, last: null, events: 0 };
    cur.events = e.w; cur.last = !cur.last || e.last > cur.last ? e.last : cur.last;
    keys.set(k, cur);
  }
  const out = [];
  for (const r of keys.values()) {
    const rel = reliability(r.ok, r.n, s);
    let idle = 0;
    if (r.last) {
      idle = s.decay_unit === 'tick'
        ? (await first(db, `SELECT COUNT(*) AS n FROM tick_runs WHERE started_at > ? AND started_at <= ?`, r.last, nowIso)).n
        : Math.max(0, Math.floor((now - parseIso(r.last)) / 86400e3));
    }
    const score = decayToward(clamp01(rel + r.events), s.baseline, s.decay_per_unit * idle);
    const current = r.executor ? await executorRung(db, policy, r.surface, r.action_class, r.executor) : await pairRung(db, policy, r.surface, r.action_class);
    // An executor is never promoted above its pair: its ceiling is the lower of the pair's rung and the surface ceiling.
    const ceiling = r.executor ? minRung(s, await pairRung(db, policy, r.surface, r.action_class), ceilingFor(policy, r.surface, s)) : ceilingFor(policy, r.surface, s);
    const ind = indicate(s, current, ceiling, { score, n: r.n, severe: r.severe, lower: wilsonLower(r.ok, r.n) });
    await run(db, `INSERT INTO trust_scores (surface, action_class, executor, ok, n, severe, reliability, event_adjust, idle_units, score, lower_bound, indicated_rung, last_exercised_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(surface, action_class, executor) DO UPDATE SET ok=excluded.ok, n=excluded.n, severe=excluded.severe, reliability=excluded.reliability,
          event_adjust=excluded.event_adjust, idle_units=excluded.idle_units, score=excluded.score, lower_bound=excluded.lower_bound,
          indicated_rung=excluded.indicated_rung, last_exercised_at=excluded.last_exercised_at, updated_at=excluded.updated_at`,
      r.surface, r.action_class, r.executor, r.ok, r.n, r.severe, rel, r.events, idle, score, wilsonLower(r.ok, r.n), ind ? ind.to : current, r.last, nowIso);
    const row = { surface: r.surface, action_class: r.action_class, executor: r.executor, reliability: rel, score, n: r.n, severe: r.severe, rung: current, indicated: ind ? ind.to : current };
    if (ind) row.item = await proposeTransition(db, s, r, current, ind, { rel, score, idle }, nowIso);
    out.push(row);
  }
  return out;
}

async function proposeTransition(db, s, r, from, ind, m, nowIso) {
  const base = `LADDER-${r.surface}-${r.action_class}-${ind.to}${r.executor ? `@${r.executor}` : ''}`;
  const existing = await all(db, `SELECT id, status FROM items WHERE id = ? OR id LIKE ?`, base, `${base}-20%`);
  const active = existing.find(i => !TERMINAL.includes(i.status));
  // The seed id has no date, so a repeated crossing could never reopen it; a later crossing carries the date.
  const id = active ? active.id : existing.length ? `${base}-${nowIso.slice(0, 10)}` : base;
  if (await first(db, `SELECT 1 AS x FROM trust_transitions WHERE item_id = ? AND status = 'proposed'`, id)) return id;
  const evidence = { reliability: m.rel, score: m.score, outcomes: r.n, verified: r.ok, severe_in_window: r.severe, severe_window_days: s.severe_window_days,
    event_adjust: r.events, idle_units: m.idle, prior: { baseline: s.baseline, prior_weight: s.prior_weight }, mode: s.mode };
  const who = `${r.surface}/${r.action_class}${r.executor ? ` (executor ${r.executor})` : ''}`;
  const probe = r.executor
    ? `SELECT COUNT(*) FROM trust_executor_rungs WHERE surface = '${sq(r.surface)}' AND action_class = '${sq(r.action_class)}' AND executor = '${sq(r.executor)}' AND rung = '${sq(ind.to)}'`
    : `trust_ledger rung = ${ind.to}`;
  // An item the seed tick already opened for this crossing is reused; it gains its transition row and evidence here.
  await run(db, `INSERT OR IGNORE INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, surface, action_class, created_at, updated_at) VALUES (?,?,'ladder','operations',?,?,?, 'ready', ?,?,?,?)`,
    id, `${ind.direction === 'promote' ? 'Promote' : 'Demote'} ${who} from ${from} to ${ind.to} (score ${m.score.toFixed(2)} over ${r.n})`.slice(0, 300),
    'rung change merged after review by a different agent', probe, ind.direction === 'demote' ? 0 : 20, r.surface, r.action_class, nowIso, nowIso);
  await run(db, `INSERT INTO trust_transitions (surface, action_class, executor, from_rung, to_rung, direction, status, evidence, item_id, opened_by, at) VALUES (?,?,?,?,?,?, 'proposed', ?,?,?,?)`,
    r.surface, r.action_class, r.executor, from, ind.to, ind.direction, JSON.stringify(evidence), id, s.opened_by, nowIso);
  return id;
}

/**
 * Apply the rung change a ladder item proposes. This is the merge of the reviewed change: it is refused unless `merged_by`
 * names an agent different from the one that opened the item (US-06-R06), and refused when the target rung is above the
 * surface ceiling (US-06-R04). Every attempt, applied or refused, is a transition row (US-06-R17).
 */
export async function applyRungChange(db, { item_id, merged_by, policy, now = Date.now() }) {
  const s = settings(policy);
  const t = await first(db, `SELECT * FROM trust_transitions WHERE item_id = ? AND status = 'proposed' ORDER BY id DESC LIMIT 1`, item_id);
  if (!t) throw new Error(`no proposed transition for item ${item_id}`);
  if (await first(db, `SELECT 1 AS x FROM trust_transitions WHERE item_id = ? AND status = 'applied'`, item_id)) return { applied: false, reason: 'already applied' };
  const nowIso = iso(now);
  const log = (status, reason) => run(db, `INSERT INTO trust_transitions (surface, action_class, executor, from_rung, to_rung, direction, status, evidence, item_id, opened_by, merged_by, reason, at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    t.surface, t.action_class, t.executor, t.from_rung, t.to_rung, t.direction, status, t.evidence, item_id, t.opened_by, merged_by ?? null, reason, nowIso);
  const refuse = async (reason) => { await log('refused', reason); return { applied: false, reason }; };
  if (!merged_by || !String(merged_by).trim()) return refuse('no merging agent named');
  if (merged_by === t.opened_by) return refuse('merged by the agent that opened the item');
  if (idx(s, t.to_rung) < 0) return refuse('target rung is not on the ladder');
  const ceiling = ceilingFor(policy, t.surface, s);
  if (idx(s, t.to_rung) > idx(s, ceiling)) return refuse(`target rung ${t.to_rung} is above the surface ceiling ${ceiling}`);
  if (t.executor) {
    await run(db, `INSERT INTO trust_executor_rungs (surface, action_class, executor, rung, updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(surface, action_class, executor) DO UPDATE SET rung=excluded.rung, updated_at=excluded.updated_at`, t.surface, t.action_class, t.executor, t.to_rung, nowIso);
  } else {
    const sc = await first(db, `SELECT reliability, n FROM trust_scores WHERE surface=? AND action_class=? AND executor=''`, t.surface, t.action_class);
    await run(db, `INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes, updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(surface, action_class) DO UPDATE SET rung=excluded.rung, updated_at=excluded.updated_at`,
      t.surface, t.action_class, t.to_rung, sc ? sc.reliability : s.baseline, sc ? sc.n : 0, nowIso);
  }
  await log('applied', null);
  return { applied: true, surface: t.surface, action_class: t.action_class, executor: t.executor, rung: t.to_rung };
}

/**
 * US-06-R24: close the ladder loop. `merged` is a port, `async () => [{ item_id, merged_by }]`, that lists the reviewed rung
 * changes that merged. Each listed item with a proposed transition is applied through applyRungChange (so a merge by the agent
 * that opened the item, a rung above the ceiling or a rung not on the ladder is refused and recorded). An applied change writes
 * the rung to the ledger, closes the item with a disposition that names the merging agent and writes one verified `outcomes`
 * row (surface work_tracker, action class ladder). A refused change leaves the item open with the reason as its blocker.
 * Calling it again with the same list changes nothing: an applied item is not applied twice and an unchanged refusal is not
 * logged twice. An item the port lists that has no transition is reported, never invented.
 */
export async function settleLadder(db, { policy, merged, now = Date.now() } = {}) {
  const out = { applied: [], refused: [], unknown: [] };
  if (typeof merged !== 'function') return out;
  const nowIso = iso(now);
  for (const m of (await merged()) || []) {
    if (!m || !m.item_id) continue;
    const item = await first(db, `SELECT id, status FROM items WHERE id = ?`, m.item_id);
    const done = await first(db, `SELECT * FROM trust_transitions WHERE item_id = ? AND status = 'applied' ORDER BY id DESC LIMIT 1`, m.item_id);
    if (done) { // applied earlier: make sure the item is closed (a crash between the two writes leaves it open), then stop
      if (item && !TERMINAL.includes(item.status)) await closeLadderItem(db, m.item_id, done, done.merged_by || m.merged_by, nowIso);
      continue;
    }
    if (!(await first(db, `SELECT 1 AS x FROM trust_transitions WHERE item_id = ? AND status = 'proposed'`, m.item_id))) { out.unknown.push(m.item_id); continue; }
    const prior = await first(db, `SELECT merged_by, reason FROM trust_transitions WHERE item_id = ? AND status = 'refused' ORDER BY id DESC LIMIT 1`, m.item_id);
    if (prior && prior.merged_by === (m.merged_by ?? null)) { out.refused.push({ item_id: m.item_id, reason: prior.reason }); continue; } // the same refusal, already recorded
    const r = await applyRungChange(db, { item_id: m.item_id, merged_by: m.merged_by, policy, now });
    if (r.applied) {
      const t = await first(db, `SELECT * FROM trust_transitions WHERE item_id = ? AND status = 'applied' ORDER BY id DESC LIMIT 1`, m.item_id);
      if (item) await closeLadderItem(db, m.item_id, t, m.merged_by, nowIso);
      out.applied.push({ item_id: m.item_id, surface: r.surface, action_class: r.action_class, executor: r.executor, rung: r.rung, merged_by: m.merged_by });
    } else {
      if (item && !TERMINAL.includes(item.status)) await run(db, `UPDATE items SET blocker = ?, updated_at = ? WHERE id = ?`, String(r.reason).slice(0, 300), nowIso, m.item_id);
      out.refused.push({ item_id: m.item_id, reason: r.reason });
    }
  }
  return out;
}

async function closeLadderItem(db, itemId, t, mergedBy, nowIso) {
  const who = `${t.surface}/${t.action_class}${t.executor ? ` (executor ${t.executor})` : ''}`;
  await run(db, `UPDATE items SET status = 'done', blocker = NULL, updated_at = ?,
      disposition = ? WHERE id = ? AND status NOT IN ('done','superseded','cancelled')`,
    nowIso, `done: ${who} now ${t.to_rung} (transition ${t.id}, merged by ${mergedBy})`.slice(0, 300), itemId);
  await run(db, `DELETE FROM claims WHERE item_id = ?`, itemId);
  if (!(await first(db, `SELECT 1 AS x FROM outcomes WHERE item_id = ? AND surface = 'work_tracker' AND action_class = 'ladder'`, itemId))) {
    await run(db, `INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?,?,'work_tracker','ladder','verified',?,?)`,
      itemId, mergedBy ?? null, `ladder change ${t.from_rung} to ${t.to_rung} for ${who} merged by ${mergedBy}`.slice(0, 300), nowIso);
  }
}

/** US-06-R18: the factor a queue item's score may be multiplied by. A pair never scored is at the baseline. */
export async function queueMultiplier(db, { surface, action_class, policy }) {
  const r = await first(db, `SELECT score FROM trust_scores WHERE surface=? AND action_class=? AND executor=''`, surface, action_class);
  return r ? r.score : settings(policy).baseline;
}

/**
 * US-06-R18: rank queue items by trust. `items` is [{ id, score, surface, action_class }]; each score is multiplied by the score
 * of its (surface, action class) pair, the baseline for a pair never scored. The pairs are read together (one query per 40
 * distinct pairs, never one per item). Returns a copy ordered by the multiplied score, highest first, ties in input order, each
 * item with its `factor` and `ranked_score`. Nothing is written.
 */
export async function rankItems(db, items, { policy, now = Date.now() } = {}) {
  void now;
  const baseline = settings(policy).baseline;
  const pairs = [...new Map(items.filter(i => i.surface && i.action_class).map(i => [`${i.surface}\u0000${i.action_class}`, [i.surface, i.action_class]])).values()];
  const factor = new Map();
  for (let at = 0; at < pairs.length; at += 40) {
    const chunk = pairs.slice(at, at + 40);
    const rows = await all(db, `SELECT surface, action_class, score FROM trust_scores WHERE executor = '' AND (${chunk.map(() => '(surface = ? AND action_class = ?)').join(' OR ')})`, ...chunk.flat());
    for (const r of rows) factor.set(`${r.surface}\u0000${r.action_class}`, r.score);
  }
  return items.map((it, order) => {
    const f = factor.has(`${it.surface}\u0000${it.action_class}`) ? factor.get(`${it.surface}\u0000${it.action_class}`) : baseline;
    return { ...it, factor: f, ranked_score: (Number(it.score) || 0) * f, order };
  }).sort((a, b) => b.ranked_score - a.ranked_score || a.order - b.order).map(({ order, ...it }) => it);
}

// ---- Policy as data (section 3.3) ----

function limitsText(policy) {
  const l = policy.standing_limits;
  return (Array.isArray(l) ? l : (l && l.limits) || []).join('\n').toLowerCase();
}

/** US-06-R11, R12: the validator of section 3.3. Returns a list of problems; empty means valid. */
export function validatePolicy(policy) {
  const problems = [];
  if (!policy || typeof policy !== 'object') return ['policy is not an object'];
  const t = policy.trust || {};
  if (typeof t.baseline !== 'number' || typeof t.prior_weight !== 'number' || !t.formula) problems.push('trust: baseline, prior_weight and formula must be stated');
  const rungs = policy.ladder?.rungs || [];
  if (!rungs.length) problems.push('ladder: no rungs');
  const ceilings = policy.ladder?.ceiling_by_max_permission || {};
  for (const [name, sf] of Object.entries(policy.surfaces || {})) {
    if (!['none', 'propose', 'execute'].includes(sf.max_permission)) problems.push(`${name}: max_permission must be none, propose or execute`);
    if (!rungs.includes(sf.start_rung)) problems.push(`${name}: start rung ${sf.start_rung} is not on the ladder`);
    else if (rungs.includes(ceilings[sf.max_permission]) && rungs.indexOf(sf.start_rung) > rungs.indexOf(ceilings[sf.max_permission])) {
      problems.push(`${name}: start rung ${sf.start_rung} is above its ceiling ${ceilings[sf.max_permission]}`);
    }
    if (BELOW_EXECUTE.includes(name) && sf.max_permission === 'execute') problems.push(`${name}: ceiling must be below execute`);
    for (const [an, a] of Object.entries(sf.actions || {})) {
      if (a.reversible === false && a.identity_bound === true && a.reversible_path) problems.push(`${name}.${an}: irreversible and identity-bound but carries a reversible path (it would not be gated)`);
      if (a.reversible === false && a.identity_bound === false && !a.reversible_path && !a.denied) problems.push(`${name}.${an}: irreversible and not identity-bound needs a reversible path or denied`);
      if (a.denied && (a.reversible === true || a.reversible_path)) problems.push(`${name}.${an}: denied but carries a reversible form (a denial is not a gate; state one or the other)`);
    }
  }
  const text = limitsText(policy);
  for (const [word, label] of [['harness', 'the harness'], ['secret', 'the secret lock'], ['override', "the principal's override"]]) {
    if (!text.includes(word)) problems.push(`standing limits: no entry names ${label}`);
  }
  return problems;
}

/** An invalid policy blocks the boot. */
export function assertPolicy(policy) {
  const p = validatePolicy(policy);
  if (p.length) throw new Error(`invalid policy: ${p.join('; ')}`);
  return policy;
}

/**
 * Mirror rule (US-06-R12): every harness_deny pattern of a gated or denied action must be in the harness deny list, and a gated
 * action (irreversible and identity-bound) on a surface reachable through a shell command must name at least one pattern.
 * `harnessDeny` is the deny list of the harness's settings file (see harnessDenyFrom). Returns the problems.
 */
export function mirrorProblems(policy, harnessDeny = [], { shell_surfaces = ['repo', 'runtime', 'secrets'] } = {}) {
  const have = new Set(harnessDeny);
  const out = [];
  for (const [name, sf] of Object.entries(policy.surfaces || {})) for (const [an, a] of Object.entries(sf.actions || {})) {
    for (const pat of a.harness_deny || []) if (!have.has(pat)) out.push(`${name}.${an}: ${pat}`);
    if (shell_surfaces.includes(name) && a.reversible === false && a.identity_bound === true && !(a.harness_deny || []).length) {
      out.push(`${name}.${an}: a gated action reachable through a shell command names no harness_deny pattern`);
    }
  }
  return out;
}

/** The deny list of a harness settings file (`permissions.deny`), or an empty list when the file states none. */
export function harnessDenyFrom(settings) {
  const d = settings && settings.permissions && settings.permissions.deny;
  return Array.isArray(d) ? d : [];
}

// ---- Standing limits and refusals (section 4) ----

function hash(s) { // FNV-1a, enough to tell two conditions apart; never used for security
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const fingerprint = (a) => `${a.surface}|${a.action_class}|${a.target ?? ''}`;

/**
 * May this action be submitted to this check? The fingerprint is the surface, action class and target, so the same action in
 * different words is the same action. After a refusal the action may be tried once more, and only if the condition the check
 * saw (the system's own text or change) has been corrected; otherwise the next path is taken (US-SPEC-06 s4, US-07-R08).
 */
export async function maySubmit(db, a) {
  const prior = await all(db, `SELECT condition_hash FROM trust_refusals WHERE check_name = ? AND fingerprint = ? ORDER BY id`, a.check, fingerprint(a));
  if (!prior.length) return { ok: true };
  const cond = hash(a.condition ?? '');
  if (prior.some(p => p.condition_hash === cond)) return { ok: false, reason: 'same action, same condition: not resubmitted' };
  if (prior.length >= 2) return { ok: false, reason: 'retry already used: take the next path' };
  return { ok: true, retry: true };
}

/** Record a refusal with its reason. Returns what may happen next. */
export async function recordRefusal(db, a, { now = Date.now() } = {}) {
  if (!a.check || !a.reason) throw new Error('a refusal is recorded with its check and its reason');
  const fp = fingerprint(a), cond = hash(a.condition ?? '');
  const same = await first(db, `SELECT id FROM trust_refusals WHERE check_name = ? AND fingerprint = ? AND condition_hash = ?`, a.check, fp, cond);
  if (same) await run(db, `UPDATE trust_refusals SET attempts = attempts + 1 WHERE id = ?`, same.id);
  else await run(db, `INSERT INTO trust_refusals (check_name, fingerprint, condition_hash, reason, executor, at) VALUES (?,?,?,?,?,?)`, a.check, fp, cond, String(a.reason).slice(0, 300), a.executor ?? null, iso(now));
  const n = (await first(db, `SELECT COUNT(*) AS n FROM trust_refusals WHERE check_name = ? AND fingerprint = ?`, a.check, fp)).n;
  return { recorded: true, next: n >= 2 || same ? 'take_next_path' : 'correct_condition_and_retry_once' };
}

async function standingLimit(db, a) {
  const l = a.limits || {};
  if (a.override === 'deny') return { check: 'principal_override', reason: 'the principal overrode this action' };
  if (l.harness?.refused) return { check: 'harness', reason: l.harness.reason || 'refused by the harness permission check' };
  if (l.classifier?.refused) return { check: 'classifier', reason: l.classifier.reason || 'refused by a classifier or safety check' };
  if (l.touches_secret_value) return { check: 'secret_lock', reason: 'no agent reads, prints, commits or moves a secret value' };
  if (l.outreach && (l.outreach.suppressed || l.outreach.opted_out || !l.outreach.consent)) {
    return { check: 'outreach_consent', reason: l.outreach.suppressed ? 'recipient is suppressed' : l.outreach.opted_out ? 'recipient opted out' : 'no consent recorded' };
  }
  if (a.item_id) {
    const c = await first(db, `SELECT agent FROM claims WHERE item_id = ?`, a.item_id);
    if (c && c.agent !== a.executor) return { check: 'live_claim', reason: `item ${a.item_id} is claimed by ${c.agent}` };
  }
  return null;
}

/**
 * Decide whether an executor may take an action now. Order, highest first (US-06-R13): standing limits; the interrupt gate
 * (US-06-R08, R14); policy denial; the rung, bounded by the surface ceiling and the executor (US-06-R04, R19).
 *   a = { surface, action_class, target?, executor?, item_id?, required_rung?, override?, limits?, condition?, reversible_forms?, card? }
 * reversible_forms: [{ form, attempt: async () => ({ ok, path?, detail? }) }], tried in order before an action is classed irreversible.
 * Returns { allowed, via?, refused?, reason?, gate_card? }.
 */
export async function authorize(db, a, { policy, now = Date.now(), config = {} } = {}) {
  const s = settings(policy, config);
  // 1. Standing limits outrank everything below, whatever the rung or score.
  const limit = await standingLimit(db, a);
  if (limit) {
    const again = await maySubmit(db, { ...a, check: limit.check });
    const rec = await recordRefusal(db, { ...a, ...limit }, { now });
    return { allowed: false, refused: limit.check, reason: limit.reason, standing_limit: true, resubmission: !again.ok, next: rec.next };
  }
  // A check that refused this action's own text or change is not asked again about the same thing.
  for (const check of ['harness', 'classifier', 'secret_lock']) {
    const prior = await maySubmit(db, { ...a, check });
    if (!prior.ok) return { allowed: false, refused: check, reason: prior.reason, standing_limit: true, resubmission: true, next: 'take_next_path' };
  }
  const def = policy.surfaces?.[a.surface]?.actions?.[a.action_class];
  if (!def) return { allowed: false, refused: 'not_in_policy', reason: `${a.surface}/${a.action_class} is not an action the policy states` };
  // Policy denial (US-06-R27): a denied action is refused whatever its reversibility, so a reversible path never turns a standing denial into an allow.
  if (def.denied) return { allowed: false, refused: 'denied', reason: def.reason || 'denied by policy' };
  // 2. The interrupt gate. Reversibility is engineered before an action is classed irreversible.
  let via = def.reversible ? 'reversible' : null;
  if (!via && def.reversible_path && !def.identity_bound) via = `reversible path: ${def.reversible_path}`;
  if (!via && !def.denied) {
    for (const f of a.reversible_forms || []) {
      let r;
      try { r = await f.attempt(); } catch (e) { r = { ok: false, detail: `attempt failed: ${String(e && e.message).slice(0, 120)}` }; }
      await run(db, `INSERT INTO trust_reversibility_attempts (action_ref, form, ok, detail, at) VALUES (?,?,?,?,?)`, fingerprint(a), f.form, r && r.ok ? 1 : 0, (r && (r.path || r.detail)) ?? null, iso(now));
      if (r && r.ok) { via = `engineered: ${f.form}${r.path ? ` (${r.path})` : ''}`; break; }
    }
  }
  if (!via) {
    if (!def.identity_bound) return { allowed: false, refused: 'irreversible_not_identity_bound', reason: 'no reversible form exists and the step is not bound to the principal: rerouted to the staff, not a gate card' };
    const card = await openCard(db, {
      id: a.card?.id || `GATE-${a.surface}-${a.action_class}${a.target ? `-${a.target}` : ''}`,
      what: a.card?.what || `${a.surface}/${a.action_class}${a.target ? ` on ${a.target}` : ''}`,
      why_gated: a.card?.why_gated || 'irreversible and bound to the principal; no reversible form could be constructed',
      default_in_effect: a.card?.default_in_effect || 'the action is not taken; all other work continues',
      prepared_by_fleet: a.card?.prepared_by_fleet ?? null, closing_probe: a.card?.closing_probe || 'manual',
      identity_bound_line: a.card?.identity_bound_line || def.reason || `${a.action_class} on ${a.surface} is identity-bound in the policy`,
      surface: a.surface, action_class: a.action_class, opened_by: a.executor,
    }, { now });
    return { allowed: false, refused: 'interrupt_gate', reason: 'irreversible and identity-bound: not executable at any rung', gate_card: card.id };
  }
  // 3. The rung.
  if (a.required_rung && a.override !== 'allow') {
    const eff = await effectiveRung(db, { ...a, policy });
    if (idx(s, a.required_rung) < 0) return { allowed: false, refused: 'unknown_rung', reason: `${a.required_rung} is not on the ladder` };
    if (idx(s, eff.rung) < idx(s, a.required_rung)) return { allowed: false, refused: 'rung_too_low', reason: `effective rung ${eff.rung} is below ${a.required_rung}`, rung: eff };
  }
  if (a.override === 'allow') await run(db, `INSERT INTO trust_events (surface, action_class, executor, event, weight, ref, at) VALUES (?,?,?, 'principal_override', 0, ?, ?)`, a.surface, a.action_class, a.executor || '', a.target ?? null, iso(now));
  return { allowed: true, via, override: a.override === 'allow' ? 'honored' : undefined };
}

/**
 * US-06-R25: the port core/deploy asks before it publishes. `authorizer({ surface, action_class, target, executor })` runs
 * authorize() with the rung the action needs (default `autonomous`: a production deploy is the action the ladder defines as an agent
 * executing and merging on green checks; `assisted` means a reviewer merges, so it must be named by the caller) and returns { allowed, reason, gate_card, next }. `limits`
 * and `condition` may be values or functions of the request (the checks that refused this change, and the text they saw);
 * `reversible_forms` is passed through. core/deploy never imports this module: the composition root hands it the function.
 */
export function deployAuthorizer({ db, policy, required_rung = 'autonomous', now = () => Date.now(), config = {}, limits, condition, reversible_forms } = {}) {
  const val = (v, req) => (typeof v === 'function' ? v(req) : v);
  return async (req) => {
    const r = await authorize(db, { surface: req.surface, action_class: req.action_class, target: req.target, executor: req.executor || undefined, required_rung,
      limits: val(limits, req), condition: val(condition, req), reversible_forms: val(reversible_forms, req) }, { policy, now: now(), config });
    return { allowed: Boolean(r.allowed), reason: r.reason || r.refused || (r.via ? `allowed: ${r.via}` : undefined), refused: r.refused, gate_card: r.gate_card, next: r.next, rung: r.rung };
  };
}

// ---- Gate cards (section 3.2) ----

/**
 * Open one gate card. A card has a closing probe and a default in effect (US-06-R09) or it is not opened. A step with no
 * identity-bound line is not a card: it is rerouted to the staff as a work item (US-06-R15).
 */
export async function openCard(db, c, { now = Date.now(), config = {} } = {}) {
  for (const f of ['id', 'what', 'why_gated', 'default_in_effect', 'closing_probe']) {
    if (!c[f] || !String(c[f]).trim()) throw new Error(`gate card requires ${f}`);
  }
  const nowIso = iso(now);
  if (!c.identity_bound_line || !String(c.identity_bound_line).trim()) {
    const item = `REROUTE-${c.id}`;
    await run(db, `INSERT OR IGNORE INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, surface, action_class, created_at, updated_at) VALUES (?,?,'work',?,?,?,?, 'ready', ?,?,?,?)`,
      item, String(c.what).slice(0, 300), config.reroute_role || 'operations', `done by the staff: ${c.what}`.slice(0, 300), c.closing_probe === 'manual' ? null : c.closing_probe,
      c.priority ?? 10, c.surface ?? null, c.action_class ?? null, nowIso, nowIso);
    return { id: null, rerouted: true, item };
  }
  await run(db, `INSERT OR IGNORE INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES (?,?,?,?,?,?)`,
    c.id, c.what, c.why_gated, c.default_in_effect, c.prepared_by_fleet ?? null, c.closing_probe);
  await run(db, `INSERT OR IGNORE INTO trust_gate_meta (card_id, surface, action_class, identity_bound_line, priority, opened_by, opened_at) VALUES (?,?,?,?,?,?,?)`,
    c.id, c.surface ?? null, c.action_class ?? null, c.identity_bound_line, c.priority ?? 50, c.opened_by ?? null, nowIso);
  return { id: c.id, rerouted: false };
}

// A card whose probe waits for a credential is identity-bound by its nature: only the principal can create the credential.
const inferredLine = (card) => (/^env:\w+$/.test(card.closing_probe || '') ? `the credential ${card.closing_probe.slice(4)} can be created only by the principal` : '');

/** The open cards, in the order the principal should see them. Each carries its identity-bound line (possibly empty). */
export async function gateQueue(db) {
  const rows = await all(db, `SELECT g.*, m.identity_bound_line, m.priority, m.surface, m.action_class, m.opened_at FROM gate_cards g
      LEFT JOIN trust_gate_meta m ON m.card_id = g.id WHERE g.status = 'open' ORDER BY COALESCE(m.priority, 50), COALESCE(m.opened_at, ''), g.id`);
  return rows.map(r => ({ ...r, identity_bound_line: r.identity_bound_line || inferredLine(r) }));
}

/** US-06-R15: the number of open cards without an identity-bound line. Target zero. */
export async function cardsWithoutIdentityLine(db) {
  return (await gateQueue(db)).filter(c => !c.identity_bound_line).length;
}

/**
 * US-06-R15: every open card without an identity-bound line is rerouted to the staff: a work item takes its place and the
 * card is closed with the item recorded. Cards that carry the line are untouched.
 */
export async function rerouteUnbound(db, { now = Date.now(), config = {} } = {}) {
  const nowIso = iso(now);
  const moved = [];
  for (const c of (await gateQueue(db)).filter(x => !x.identity_bound_line)) {
    const item = `REROUTE-${c.id}`;
    await run(db, `INSERT OR IGNORE INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, created_at, updated_at) VALUES (?,?,'work',?,?,?,10,'ready',?,?)`,
      item, String(c.what).slice(0, 300), config.reroute_role || 'operations', `done by the staff: ${c.what}`.slice(0, 300), c.closing_probe === 'manual' ? null : c.closing_probe, nowIso, nowIso);
    await run(db, `UPDATE gate_cards SET status='closed', closed_at=? WHERE id=?`, nowIso, c.id);
    await run(db, `INSERT INTO trust_gate_meta (card_id, identity_bound_line, opened_at, rerouted_to, rerouted_at) VALUES (?, '', ?, ?, ?)
        ON CONFLICT(card_id) DO UPDATE SET rerouted_to=excluded.rerouted_to, rerouted_at=excluded.rerouted_at`, c.id, nowIso, item, nowIso);
    moved.push({ card: c.id, item });
  }
  return moved;
}

/**
 * US-06-R16: a reversible, in-scope question is answered by executing the recommended default, with a decision row and its
 * revert path. `execute` is the port that does the work and returns { verified, evidence }. Anything not reversible or not in
 * scope is not adopted here; it goes to authorize(), which gates or refuses it.
 */
export async function adoptDefault(db, q, { now = Date.now(), execute } = {}) {
  for (const f of ['question', 'recommended_default', 'revert_path']) if (!q[f] || !String(q[f]).trim()) throw new Error(`self-adoption requires ${f}`);
  if (!q.reversible || !q.in_scope) return { adopted: false, reason: q.reversible ? 'not in scope' : 'not reversible: classify through the interrupt gate' };
  if (typeof execute !== 'function') throw new Error('self-adoption requires an execute port');
  let res;
  try { res = await execute(q.recommended_default); } catch (e) { res = { verified: false, evidence: `execution failed: ${String(e && e.message).slice(0, 160)}` }; }
  const verified = Boolean(res && res.verified);
  const r = await run(db, `INSERT INTO trust_adoptions (question, default_taken, revert_path, surface, action_class, executor, verified, evidence, at) VALUES (?,?,?,?,?,?,?,?,?)`,
    q.question, q.recommended_default, q.revert_path, q.surface ?? null, q.action_class ?? null, q.executor ?? null, verified ? 1 : 0, (res && res.evidence) ?? null, iso(now));
  if (verified && q.surface && q.action_class) await recordEvent(db, { surface: q.surface, action_class: q.action_class, executor: q.executor, event: 'verified_autonomous_action', ref: `adoption:${r.meta.last_row_id}` }, { now });
  return { adopted: true, verified, decision_id: r.meta.last_row_id, revert_path: q.revert_path,
    report: verified ? `Done: ${q.recommended_default}. Revert: ${q.revert_path}.` : `Open: ${q.recommended_default} was attempted and not verified (${(res && res.evidence) || 'no evidence'}).` };
}

/**
 * US-06-R15: the trigger on the count of open cards without an identity-bound line. A count above zero files one work item per
 * day, closed by a query the tick can run; the card itself is rerouted by rerouteUnbound(). Returns { cards_without_identity_line, filed }.
 */
export async function checkHealth(db, { now = Date.now(), config = {} } = {}) {
  const n = await cardsWithoutIdentityLine(db);
  const filed = [];
  if (n > 0) {
    const nowIso = iso(now), id = `TRUST-cards-without-identity-line-${nowIso.slice(0, 10)}`;
    if (!(await first(db, `SELECT 1 AS x FROM items WHERE id = ?`, id))) {
      await run(db, `INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, created_at, updated_at) VALUES (?,?,'fix',?,?,?,5,'ready',?,?)`,
        id, `${n} open gate card(s) carry no identity-bound line: reroute them to the staff`, config.reroute_role || 'operations', 'cards_without_identity_line = 0',
        `SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END FROM gate_cards g LEFT JOIN trust_gate_meta m ON m.card_id = g.id WHERE g.status = 'open' AND COALESCE(m.identity_bound_line, '') = '' AND g.closing_probe NOT LIKE 'env:%'`, nowIso, nowIso);
      filed.push(id);
    }
  }
  return { cards_without_identity_line: n, filed };
}

/** One guarded pass for a tick: validate the policy, apply the rung changes that merged, recompute scores and proposals, reroute cards that are not identity-bound. */
export async function step({ db, policy, config = {}, now = Date.now(), merged } = {}) {
  assertPolicy(policy);
  const settled = await settleLadder(db, { policy, merged, now }); // before recompute, so a rung a merge applied is the rung recompute reads
  const rows = await recompute(db, { policy, config, now });
  const health = await checkHealth(db, { now, config }); // measured before the reroute, which is what brings the count back to zero
  const rerouted = await rerouteUnbound(db, { now, config });
  return { pairs: rows.filter(r => !r.executor).length, executors: rows.filter(r => r.executor).length, proposed: rows.filter(r => r.item).map(r => r.item),
    ...(typeof merged === 'function' ? { settled: { applied: settled.applied.length, refused: settled.refused.length } } : {}),
    ...(health.filed.length ? { filed: health.filed } : {}),
    rerouted: rerouted.length, cards_without_identity_line: await cardsWithoutIdentityLine(db) };
}
