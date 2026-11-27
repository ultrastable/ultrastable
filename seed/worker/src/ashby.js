// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ASHBY-KERNEL-1 (Rowan, 2026-11-27: "Implement Ashby's journal and concept index into working parts of an autonomous AI system, Ultrastable.")
// W. Ross Ashby kept a research journal from 1928 to 1972 (7,189 pages, 25 volumes) and indexed it on cards. The W. Ross Ashby Digital Archive
// (https://ashby.info, The Estate of W. Ross Ashby) publishes the pages, the keyword index and a subject index. This module turns the parts of
// that index that say how a self-regulating machine must be built into pure functions (no I/O) that the goal loop and the tick call.
//
// The archive's text is not copied here. Each function states the idea in our own words and cites the journal pages it comes from as J.<page>
// (the page is at https://ashby.info/journal/page/<page>.html). The register that binds every concept to its code is the platform's
// doctrine/ashby-concepts.json (python3 -m foundation ashbymap --check). Tests: seed/worker/test/ashby.test.js.

const log2 = x => Math.log(x) / Math.LN2;
const r3 = x => Math.round(1000 * x) / 1000;

// ---- 1. variety and transmission -------------------------------------------------------------------------------------------------------------
// Variety is the number of distinguishable elements in a set, counted or in bits (J.4312, J.4625). Entropy is its form when the elements come
// with frequencies (J.4922).
export function variety(values) {
  const n = new Set(values || []).size;
  return { n, bits: n ? r3(log2(n)) : 0 };
}
export function entropy(counts) {
  const c = (counts || []).filter(x => x > 0), t = c.reduce((a, b) => a + b, 0);
  return t ? Math.max(0, -c.reduce((a, x) => a + (x / t) * log2(x / t), 0)) : 0;
}
// Transmission T(A:B) = H(A) + H(B) - H(A,B) in bits, from a list of [a, b] observations. Two parts are independent exactly when no variety
// passes between them (J.4883), so T near 0 over enough observations is the kernel's reading of independence (uncertainty analysis, J.5741).
export function transmission(pairs) {
  const A = new Map(), B = new Map(), AB = new Map();
  for (const [a, b] of pairs || []) { A.set(a, (A.get(a) || 0) + 1); B.set(b, (B.get(b) || 0) + 1); const k = JSON.stringify([a, b]); AB.set(k, (AB.get(k) || 0) + 1); }
  if (!AB.size) return { n: 0, bits: null };
  return { n: (pairs || []).length, bits: r3(Math.max(0, entropy([...A.values()]) + entropy([...B.values()]) - entropy([...AB.values()]))) };
}

// ---- 2. the law of requisite variety ---------------------------------------------------------------------------------------------------------
// Only variety in the regulator can force down the variety that disturbances would otherwise pass on to the outcomes (stated J.4658, restated
// J.4846, in set theory J.4850; read as noise correction J.5242). A disturbance class with no response that worked is variety the regulator
// lets through. rows: [{ d: disturbance class, r: response that was used or null, ok: the outcome was held }].
// No rows is unmeasured (null), never a healthy 0.
export function requisiteVariety(rows) {
  const by = new Map();
  for (const x of rows || []) { const e = by.get(x.d) || { ok: 0, n: 0, r: new Set() }; e.n++; if (x.ok) { e.ok++; if (x.r != null) e.r.add(x.r); } by.set(x.d, e); }
  if (!by.size) return { disturbances: 0, covered: 0, uncovered: [], responses: 0, regulated_share: null, deficit_bits: null, outcome_bits: null };
  const uncovered = [...by].filter(([, e]) => !e.ok).map(([d]) => d).sort(), covered = by.size - uncovered.length;
  const responses = new Set([...by.values()].flatMap(e => [...e.r])).size;
  return { disturbances: by.size, covered, uncovered, responses, regulated_share: r3(covered / by.size),
    deficit_bits: r3(log2(by.size) - log2(Math.max(covered, 1))),  // the variety left for the outcomes: 0 only when every class met a response that held
    outcome_bits: r3(entropy([covered, uncovered.length])) };
}

// ---- 3. reducibility and the time adaptation takes -------------------------------------------------------------------------------------------
// The chance that n variables are all at equilibrium at the same moment falls like (1/2)^n, so a whole that must come right at once takes a time
// that grows exponentially with its size; when each part can come right and stay right by itself the time grows far more slowly (J.1334,
// J.1373, J.1596, J.2330; speed of adaptation J.4246 to J.4257). Design for a Brain (2nd ed., 1960, S.11/5) gives the three cases for n parts
// that each succeed with probability p per trial: all at once p^-n trials, one after another n/p, all independently and together 1/p.
export function expectedTrials(n, p = 0.5, mode = 'whole') {
  if (!(n >= 1) || !(p > 0 && p <= 1)) return null;
  return mode === 'whole' ? Math.pow(1 / p, n) : mode === 'serial' ? n / p : 1 / p;
}
// A reaction that must activate m variables together is stable only by chance in all m, so m can hardly exceed 6 to 10 (J.2011, J.2014, J.2326).
export const MAX_JOINT = 8;
// links: [{ knob, goal }] (declared, or measured as a confirmed interference). Each connected component is one irreducible whole: its
// step-functions can only be judged together. The rule for accumulating adaptations is one ultrastable system for each irreducible good
// (J.5436; reducibility implied by accumulation J.5430).
export function components(links) {
  const p = new Map(), find = x => { while (p.get(x) !== x) { p.set(x, p.get(p.get(x))); x = p.get(x); } return x; };
  const add = x => { if (!p.has(x)) p.set(x, x); };
  for (const l of links || []) { const k = 'k:' + l.knob, g = 'g:' + l.goal; add(k); add(g); p.set(find(k), find(g)); }
  const out = new Map();
  for (const x of p.keys()) { const r = find(x), c = out.get(r) || { goals: [], knobs: [] }; (x[0] === 'g' ? c.goals : c.knobs).push(x.slice(2)); out.set(r, c); }
  return [...out.values()].map(c => ({ goals: c.goals.sort(), knobs: c.knobs.sort() })).sort((a, b) => b.knobs.length - a.knobs.length || String(a.goals[0]).localeCompare(String(b.goals[0])));
}
export function reducibility(links, { p = 0.5, max_joint = MAX_JOINT } = {}) {
  const cs = components(links).map(c => ({ ...c, joint: c.knobs.length, trials_at_once: expectedTrials(c.knobs.length, p, 'whole'), trials_by_parts: expectedTrials(c.knobs.length, p, 'serial') }));
  const largest = cs.reduce((a, c) => Math.max(a, c.joint), 0);
  return { components: cs, parts: cs.length, largest_joint: largest, max_joint, irreducible: cs.filter(c => c.joint > max_joint).map(c => c.knobs) };
}
// A search has a finite budget of trials (Bremermann's limit is the physical form of this, J.6546; a trial lasts as long as the loop from the
// step-mechanism through the environment and back, J.5635, J.5641). grid sizes multiply inside one irreducible component.
export function searchBudget(grids, { horizon_h = 365 * 24, trial_h = 24 } = {}) {
  const g = (grids || []).filter(x => x >= 1), bits = g.reduce((a, x) => a + log2(x), 0), trials = Math.floor(horizon_h / Math.max(trial_h, 1e-9));
  return { settings_bits: r3(bits), trials, feasible: Math.pow(2, bits) <= trials };
}

// ---- 4. the step-function search (the homeostat's uniselector) --------------------------------------------------------------------------------
// When an essential variable is outside its limits a step-function takes a new value, and this repeats until some value holds it inside
// (J.995, J.1098; the homeostat J.2427 to J.2435). Which value is tried does not matter; the test afterwards is what selects (J.1106). A known
// constraint shortens the search (J.4548), so the declared direction is tried first; after it fails the nearest untried value is taken, on
// either side, and a value that failed in this episode is never taken again (systematic or random, J.3745). null: every value is spent.
// k: { value, min, max, step }; dir: the preferred direction (+1 or -1); rejected: values that failed in this episode; heldDir: a direction resting.
// The grid is min, min + step ... and never passes max, whatever the step. A current value off the grid is read as its nearest grid point.
// The search looks at most `reach` grid points to either side, so a very fine grid still moves, one neighbourhood at a time.
export function nextTrial(k, { dir = 1, rejected = [], heldDir = 0, reach = 400 } = {}) {
  if (!(k.step > 0) || !(k.max > k.min)) return null;
  const n = Math.floor((k.max - k.min) / k.step + 1e-9); if (n < 1) return null;
  const idx = v => Math.min(n, Math.max(0, Math.round((v - k.min) / k.step))), cur = idx(k.value), bad = new Set(rejected.map(idx));
  const at = i => Math.round(1e9 * (k.min + i * k.step)) / 1e9, d0 = dir < 0 ? -1 : 1;
  for (let d = 1; d <= Math.min(n, reach); d++) for (const s of [d0, -d0]) {
    const i = cur + s * d; if (i < 0 || i > n || bad.has(i) || (heldDir && s === heldDir) || at(i) === k.value) continue;
    return { value: at(i), exploratory: s !== d0 || d > 1, distance: d, tried: bad.size, grid: n + 1 };
  }
  return null;
}

// ---- 5. the veto of every essential variable --------------------------------------------------------------------------------------------------
// A resting state must be acceptable to every part: each holds a veto (J.5307, J.5677). A new adaptation can upset an earlier one, and a system
// that corrects many reactions at once settles at a fixed share correct instead of accumulating them (J.1994, J.2007, J.5360), so memories are
// kept only where the interaction between the event and the memories is small (J.5304). After a step, a variable that was holding inside its
// limits and has left them vetoes the step. series: { id: [{ at, ok }] }. A variable counts as holding when its last `hold` readings before the
// step were all ok, and as upset when its last `confirm` readings after it are all not ok.
export function upsets(step, series, { hold = 3, confirm = 2 } = {}) {
  const out = [];
  for (const [id, rows] of Object.entries(series || {})) {
    if (id === step.own) continue;
    const s = [...rows].sort((a, b) => a.at - b.at), before = s.filter(x => x.at < step.at).slice(-hold), after = s.filter(x => x.at > step.at).slice(-confirm);
    if (before.length >= hold && before.every(x => x.ok) && after.length >= confirm && after.every(x => !x.ok)) out.push(id);
  }
  return out.sort();
}
// A multistable system comes to avoid the variables whose effects ramify widely (J.3479); some step-functions should be hard to reach (J.3531).
// A step-function with n confirmed upsets is offered 1/(1+n) as readily as one with none.
export const accessibility = n => 1 / (1 + Math.max(0, n || 0));

// ---- 6. the whole is not the sum of its parts --------------------------------------------------------------------------------------------------
// If the parts were formed independently the chance that the whole is at rest is the product of the parts' chances (J.5485); coupling can raise
// it or destroy it (J.5450 to J.5455), and two stable parts can make an unstable whole (J.1396, J.1602). rows: [{ id: ok }] one per reading.
// observed below product: the parts disturb each other. null with fewer than `least` complete readings.
export function jointRest(rows, { least = 12 } = {}) {
  const ids = [...new Set((rows || []).flatMap(r => Object.keys(r)))].sort(), full = (rows || []).filter(r => ids.every(i => i in r));
  if (!ids.length || full.length < least) return { n: full.length, parts: {}, product: null, observed: null, gap: null };
  const parts = Object.fromEntries(ids.map(i => [i, r3(full.filter(r => r[i]).length / full.length)]));
  const product = ids.reduce((a, i) => a * parts[i], 1), observed = full.filter(r => ids.every(i => r[i])).length / full.length;
  return { n: full.length, parts, product: r3(product), observed: r3(observed), gap: r3(observed - product) };
}
// Cylindrance (introduced J.6465, J.6473; algorithm J.6499; and reducibility J.6528): the smallest k such that a relation over n variables is
// fully given by its projections onto k variables at a time. A relation of low cylindrance can be adapted to a few variables at a time.
// tuples: equal-length arrays of observed joint values. The values each variable was seen to take span the space tested.
export function cylindrance(tuples, { max_n = 10 } = {}) {
  const R = new Set((tuples || []).map(t => JSON.stringify(t))), rows = [...R].map(s => JSON.parse(s)), n = rows.length ? rows[0].length : 0;
  if (!n || n > max_n || rows.some(t => t.length !== n)) return null;
  const vals = Array.from({ length: n }, (_, i) => [...new Set(rows.map(t => JSON.stringify(t[i])))].map(s => JSON.parse(s)));
  const space = vals.reduce((a, v) => a * v.length, 1); if (space > 4096) return null;
  const all = []; (function walk(i, acc) { if (i === n) { all.push(acc); return; } for (const v of vals[i]) walk(i + 1, [...acc, v]); })(0, []);
  const subsets = k => { const o = []; (function pick(s, acc) { if (acc.length === k) { o.push(acc); return; } for (let i = s; i < n; i++) pick(i + 1, [...acc, i]); })(0, []); return o; };
  for (let k = 1; k <= n; k++) {
    const proj = subsets(k).map(S => ({ S, seen: new Set(rows.map(t => JSON.stringify(S.map(i => t[i])))) }));
    if (all.every(t => R.has(JSON.stringify(t)) || proj.some(p => !p.seen.has(JSON.stringify(p.S.map(i => t[i])))))) return k;
  }
  return n;
}

// ---- 7. the black box --------------------------------------------------------------------------------------------------------------------------
// A machine is known only through its protocol: what state it was in, what input it received, what state came next (J.4455, J.4953). It is
// state-determined when the same state and input always give the same next state (J.1316, J.1431). When they do not, a variable that matters is
// not being observed (J.4829), and the remedy is to add variables or history until the protocol is single-valued again (J.5870, J.5876).
// rows: [{ state, input, next }].
export function protocol(rows) {
  const by = new Map();
  for (const x of rows || []) { const k = JSON.stringify([x.state, x.input]); const e = by.get(k) || { state: x.state, input: x.input, nexts: new Map(), n: 0 }; e.n++; e.nexts.set(JSON.stringify(x.next), x.next); by.set(k, e); }
  const repeated = [...by.values()].filter(e => e.n >= 2), hidden = repeated.filter(e => e.nexts.size > 1).map(e => ({ state: e.state, input: e.input, nexts: [...e.nexts.values()] }));
  return { observations: (rows || []).length, repeated: repeated.length, determinate_share: repeated.length ? r3(1 - hidden.length / repeated.length) : null, hidden };
}
