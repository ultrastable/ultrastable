// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Status of every piece is kept in core/pace/README.md.
// Pace: speed at near-zero cost, tenant-agnostic. A tenant declares its loops and the free daily limits of the resources they use;
// this module measures progress per run and cost per day, and computes the cadence each loop should run at:
//   - a loop whose last `idle_runs` runs produced nothing backs off (cadence doubles, up to max_s): idle ticks are removed, not tolerated
//   - a loop that produced output and fits in the free headroom speeds up (cadence halves, down to min_s) while every resource stays under `safety` of its limit
//   - a loop with an event trigger (event: true) runs on the event; its polling cadence becomes the fallback (max_s)
//   - rank() orders work by expected reach x impact x probability per unit cost, so the cheapest high-reach work goes first
// Pure functions. Ports: none; the caller supplies counts read from its own ledgers. No tenant names here.
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const DAY = 86400;

export const DEFAULTS = { min_s: 300, max_s: 86400, idle_runs: 6, safety: 0.6, factor: 2 };

// Projected daily use of each resource for a set of loops at their current cadence.
export function usage(loops) {
  const u = {};
  for (const l of loops) {
    const runs = DAY / Math.max(num(l.cadence_s, DAY), 1);
    for (const [res, per] of Object.entries(l.cost || {})) u[res] = (u[res] || 0) + runs * num(per);
  }
  return u;
}

// Metrics shown live: progress per run (useful outputs / runs), cost per day by resource, and the share of each free limit used.
export function metrics(loops, limits = {}) {
  const u = usage(loops), runs = loops.reduce((a, l) => a + num(l.runs), 0), out = loops.reduce((a, l) => a + num(l.outputs), 0);
  const share = {};
  for (const [r, lim] of Object.entries(limits)) share[r] = lim > 0 ? +((u[r] || 0) / lim).toFixed(4) : null;
  return { progress_per_run: runs ? +(out / runs).toFixed(4) : 0, runs, outputs: out, cost_per_day: u, free_share: share,
    over_limit: Object.entries(share).filter(([, s]) => s !== null && s > 1).map(([r]) => r) };
}

// One decision per loop: { id, from_s, to_s, action: 'back_off'|'speed_up'|'event'|'hold', why }.
export function plan(loops, limits = {}, cfg = {}) {
  const c = { ...DEFAULTS, ...cfg }, next = loops.map(l => ({ ...l })), out = [];
  const fits = () => { const u = usage(next); return Object.entries(limits).every(([r, lim]) => (u[r] || 0) <= lim * c.safety); };
  // Least productive loops give way first, most productive claim headroom first.
  const order = [...next.keys()].sort((a, b) => num(next[b].outputs) / Math.max(num(next[b].runs), 1) - num(next[a].outputs) / Math.max(num(next[a].runs), 1));
  const decided = new Map();
  for (const i of order) {
    const l = next[i], from = num(l.cadence_s, DAY), lo = num(l.min_s, c.min_s), hi = num(l.max_s, c.max_s);
    const idle = num(l.runs) >= c.idle_runs && num(l.outputs) === 0;
    let to = from, action = 'hold', why = 'no change';
    if (l.event) { to = hi; action = 'event'; why = 'runs on its event; polling is only the fallback'; }
    else if (idle) { to = Math.min(hi, from * c.factor); action = to > from ? 'back_off' : 'hold'; why = `${num(l.runs)} runs, 0 outputs`; }
    else if (num(l.outputs) > 0 && from > lo) {
      const t = Math.max(lo, Math.floor(from / c.factor)); l.cadence_s = t;
      if (fits()) { to = t; action = 'speed_up'; why = `${l.outputs} outputs in ${l.runs} runs, free headroom`; } else { l.cadence_s = from; why = 'no free headroom'; }
    }
    l.cadence_s = to; decided.set(i, { id: l.id, from_s: from, to_s: to, action, why });
  }
  for (let i = 0; i < next.length; i++) out.push(decided.get(i));
  return out;
}

// Expected reach and impact per unit cost. item = { id, reach, impact, probability (0..1), cost }; higher score first.
export function rank(items) {
  return items.map(i => ({ ...i, score: (num(i.reach) * num(i.impact, 1) * num(i.probability, 1)) / Math.max(num(i.cost, 0), 0.01) }))
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
}

// Metric breaches for the tenant's loop to file as items: a resource above its free limit, or no progress at all.
export function breaches(loops, limits = {}) {
  const m = metrics(loops, limits), b = m.over_limit.map(r => ({ metric: 'free_share:' + r, value: m.free_share[r], limit: 1 }));
  if (m.runs >= DEFAULTS.idle_runs && m.outputs === 0) b.push({ metric: 'progress_per_run', value: 0, limit: '>0' });
  return b;
}
