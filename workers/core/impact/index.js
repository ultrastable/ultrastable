// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// IMPACT-LOOP-1 (core, tenant-agnostic): a closed loop that raises a system's own impact and reach numbers. A tenant declares metrics (value, target, direction)
// and levers (what to file when a metric is short); this module records the series, finds plateaus, picks levers by their kept rate, plans bounded work items
// that each carry a checkable prediction, and settles those predictions against later readings. Pure functions: the tenant supplies the readings and files the items.
const DAY = 86400e3;
const ok = (op, v, t) => (op === '<=' ? v <= t : v >= t);

// Append today's readings (one point per metric per day, 120 days kept). A reading that is not a finite number is left out, never stored as zero.
export function record(hist = {}, readings = {}, now = Date.now()) {
  const out = {};
  for (const id of new Set([...Object.keys(hist), ...Object.keys(readings)])) {
    let s = (hist[id] || []).filter(p => now - p.at <= 120 * DAY);
    const v = readings[id], last = s[s.length - 1];
    if (Number.isFinite(v)) s = last && now - last.at < 0.9 * DAY ? [...s.slice(0, -1), { at: last.at, v }] : [...s, { at: now, v }];
    out[id] = s;
  }
  return out;
}

// Status of one metric: met, rising, plateau (no movement toward the target over plateau_days), falling or unknown (too little history is never a plateau).
export function assess(m, series = [], { now = Date.now(), plateau_days = 7, eps = 0.005 } = {}) {
  const op = m.op || '>=', v = Number.isFinite(m.value) ? m.value : null;
  if (v == null) return { id: m.id, status: 'unknown', gap: null };
  const gap = ok(op, v, m.target) ? 0 : Math.abs(m.target - v), sign = op === '<=' ? -1 : 1;
  if (!gap) return { id: m.id, status: 'met', gap: 0, value: v };
  const past = series.filter(p => now - p.at >= plateau_days * DAY).pop();
  if (!past) return { id: m.id, status: 'unknown', gap, value: v, note: 'history shorter than the plateau window' };
  const d = sign * (v - past.v) / Math.max(Math.abs(m.target), 1e-9);
  return { id: m.id, status: d > eps ? 'rising' : d < -eps ? 'falling' : 'plateau', gap, value: v, change: Math.round(d * 1e4) / 1e4 };
}

// Kept rate per lever from settled items, with a 0.5 prior so a new lever is tried and a lever that keeps failing sinks (but is never removed).
export function weights(ledger = []) {
  const w = {};
  for (const e of ledger) if (e.lever && (e.outcome === 'kept' || e.outcome === 'missed')) { const x = w[e.lever] || (w[e.lever] = { kept: 0, n: 0 }); x.n++; if (e.outcome === 'kept') x.kept++; }
  return Object.fromEntries(Object.entries(w).map(([k, x]) => [k, (x.kept + 0.5) / (x.n + 1)]));
}

// Plan work: for every short metric that is not already rising, ask its levers for items, drop any whose key is already open or was filed inside cooldown_days,
// order by lever weight and gap, cap the day's filing. Each item carries a prediction `<metric> <op> <target-step> within <hours> h`.
// An item that failed `split_after` times is decomposed, never retried whole: the lever's `split(item, ctx)` returns smaller items (children keyed `<key>/<n>`, each carrying `parent`).
// `failures` maps item key to its failed attempts, read by the tenant from its own record; a lever with no `split` simply stops offering a twice-failed item.
export function plan({ metrics, series = {}, levers = {}, ledger = [], open = [], now = Date.now(), cap = 3, cooldown_days = 14, plateau_days = 7, horizon_h = 168, failures = {}, split_after = 2 }) {
  const w = weights(ledger), seen = new Set([...open, ...ledger.filter(e => now - e.at < cooldown_days * DAY).map(e => e.key)]);
  const assessed = metrics.map(m => ({ m, a: assess(m, series[m.id] || [], { now, plateau_days }) }));
  const cand = [];
  for (const { m, a } of assessed) {
    if (a.status === 'met' || a.status === 'rising' || !a.gap) continue;   // unknown history still acts: a short metric with no trend is worked, not waited on
    for (const lv of (levers[m.id] || [])) {
      const ctx = { metric: m, assessment: a };
      const offered = [];
      for (const it of lv.propose(ctx) || []) {
        if ((failures[it.key] || 0) < split_after) { offered.push(it); continue; }
        if (typeof lv.split === 'function') (lv.split(it, ctx) || []).forEach((c, i) => offered.push({ ...c, key: c.key || `${it.key}/${i + 1}`, parent: it.key }));
      }
      for (const it of offered) {
        if (seen.has(it.key)) continue;
        const step = (m.op || '>=') === '<=' ? m.value - Math.min(a.gap, it.expected_step ?? a.gap / 4) : m.value + Math.min(a.gap, it.expected_step ?? a.gap / 4);
        cand.push({ ...it, lever: lv.id, metric: m.id, op: m.op || '>=', score: (w[lv.id] ?? 0.5) * (1 + a.gap / Math.max(Math.abs(m.target), 1e-9)), predicted: Math.round(step * 1e3) / 1e3, prediction: `${m.id} ${m.op || '>='} ${Math.round(step * 1e3) / 1e3} within ${horizon_h} h`, due: now + horizon_h * 3600e3, base: m.value });
      }
    }
  }
  cand.sort((x, y) => y.score - x.score);
  const out = []; for (const c of cand) { if (out.length >= cap) break; if (!out.some(o => o.key === c.key)) out.push(c); }
  return { assessments: assessed.map(x => x.a), items: out };
}

// Settle due predictions: kept when the metric moved toward the target by at least half of the predicted step, otherwise missed. Unreadable metrics stay pending.
export function settle(ledger = [], readings = {}, now = Date.now()) {
  return ledger.map(e => {
    if (e.outcome || !e.due || now < e.due || !Number.isFinite(readings[e.metric])) return e;
    const dir = e.op === '<=' ? -1 : 1, moved = dir * (readings[e.metric] - e.base), asked = dir * (e.predicted - e.base);
    return { ...e, outcome: moved > 0 && moved >= asked / 2 ? 'kept' : 'missed', settled_at: now, reading: readings[e.metric] };
  });
}
