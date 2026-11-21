// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// CONTROL-1 (Rowan, 2026-11-21: "What else would genuinely strengthen Ultrastable? Research and implement. Give credit where due.")
// Two pieces of established practice the goal loop lacked, as pure functions (no I/O) the tick calls:
//
// 1. Oscillation damping for knobs. A bang-bang controller that steps a knob and reverts it when the goal does not move can chatter:
//    up, revert, down, revert... Classical control answers this with damping and hysteresis (cf. K. J. Astrom and R. M. Murray,
//    "Feedback Systems: An Introduction for Scientists and Engineers", Princeton, 2008/2021, ch. 10-11 on PID and integrator windup;
//    and W. R. Ashby, "Design for a Brain", 1952/1960, on the step-function second loop this code already runs). We count direction
//    reversals among a knob's recent moves; each reversal doubles the knob's effective cooldown (exponential backoff, capped), so a
//    chattering knob slows down instead of thrashing the system it regulates.
//
// 2. Error budgets and multi-window burn-rate alerts. From Google SRE practice: B. Beyer, C. Jones, J. Petoff, N. R. Murphy (eds.),
//    "Site Reliability Engineering", O'Reilly 2016, ch. 3-4 (SLOs, error budgets); and B. Beyer et al. (eds.), "The Site Reliability
//    Workbook", O'Reilly 2018, ch. 5 "Alerting on SLOs" (burn rate, multiwindow multi-burn-rate alerts: 14.4x over 1 h with a 5 min
//    confirm window pages; 6x over 6 h pages; 1x over 3 d tickets). Here a goal's SLO is "the goal is met in >= objective of its
//    readings"; the budget is 1 - objective; burn rate = observed miss fraction / budget.
//
// Sources and their use are also listed in CREDITS.md at the repository root. Tests: seed/worker/test/control.test.js.

// ---- 1. oscillation damping ----
// moves: [{at, old, new}] for one knob, any order. Returns the count of sign reversals among the last `window` moves.
export function reversals(moves, window = 6) {
  const d = [...(moves || [])].sort((a, b) => a.at - b.at).slice(-window).map(m => Math.sign(m.new - m.old)).filter(s => s !== 0);
  let r = 0; for (let i = 1; i < d.length; i++) if (d[i] !== d[i - 1]) r++;
  return r;
}
// Effective cooldown in hours: base * 2^max(0, reversals - allowed), capped at cap_factor * base.
export function dampedCooldown(base_h, moves, { window = 6, allowed = 1, cap_factor = 16 } = {}) {
  const r = reversals(moves, window), k = Math.max(0, r - allowed);
  return { reversals: r, cooldown_h: Math.min(base_h * cap_factor, base_h * 2 ** k), damped: k > 0 };
}

// ---- 2. error budgets and burn rate ----
// samples: [{at, ok:boolean}]. objective in (0,1), e.g. 0.9 means 90% of readings must meet the goal.
export function burnRate(samples, objective, { now = Date.now(), window_h }) {
  const since = now - window_h * 3600e3, w = (samples || []).filter(s => s.at >= since && s.at <= now);
  if (!w.length) return { n: 0, miss: null, burn: null };
  const miss = w.filter(s => !s.ok).length / w.length, budget = Math.max(1 - objective, 1e-9);
  return { n: w.length, miss, burn: miss / budget };
}
// The workbook's multiwindow rules, scaled by `period_d` (the SLO period; workbook uses 30 d). A rule fires when both its long and
// short window burn at or above the threshold, which keeps alerts fast without firing on a single blip.
export const BURN_RULES = [
  { severity: 'page', long_h: 1, short_h: 5 / 60, burn: 14.4 },
  { severity: 'page', long_h: 6, short_h: 0.5, burn: 6 },
  { severity: 'ticket', long_h: 72, short_h: 6, burn: 1 },
];
export function errorBudget(samples, objective, { now = Date.now(), period_d = 30, rules = BURN_RULES } = {}) {
  const scale = period_d / 30, total = burnRate(samples, objective, { now, window_h: period_d * 24 });
  const fired = [];
  for (const r of rules) {
    const L = burnRate(samples, objective, { now, window_h: r.long_h * scale }), S = burnRate(samples, objective, { now, window_h: Math.max(r.short_h * scale, 1 / 60) });
    if (L.burn != null && S.burn != null && L.burn >= r.burn && S.burn >= r.burn) fired.push({ severity: r.severity, long_h: r.long_h * scale, burn: +L.burn.toFixed(2), threshold: r.burn });
  }
  const remaining = total.burn == null ? null : +Math.max(0, 1 - total.burn).toFixed(3);
  return { objective, period_d, readings: total.n, budget_remaining: remaining, burn: total.burn == null ? null : +total.burn.toFixed(2), alerts: fired, state: fired.some(f => f.severity === 'page') ? 'burning fast' : fired.length ? 'burning' : remaining === 0 ? 'exhausted' : remaining == null ? 'no readings' : 'within budget' };
}
