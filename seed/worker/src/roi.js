// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ROI-1 (Rowan, 2026-11-18): "I need to be convinced that I'm actually going to get a return" before any paid Cloudflare service. This turns the free-tier
// governor's real samples (free_tier_samples), the AI ledger (budget_ledger) and the decision log into a recommendation: pay for X, or stay free.
// It never buys or enables anything. Free-only mode is the default and stays the default for the demo and for self-hosters; paid AI stays capped at $0.
// Advisory only: it recommends and the owner decides, so it is not an autonomous decision point (no marker needed).
import { FREE_LIMITS, DEGRADE_AT, SHED_AT } from './freetier.js';

// Cloudflare list prices, read from the pricing pages on PRICES.checked (workers/platform/pricing, d1/platform/pricing, workers-ai/platform/pricing,
// queues/platform/pricing, r2/pricing). Update the date with any change; the panel shows it.
export const PRICES = {
  checked: '2026-11-18',
  sources: ['developers.cloudflare.com/workers/platform/pricing/', 'developers.cloudflare.com/d1/platform/pricing/', 'developers.cloudflare.com/workers-ai/platform/pricing/', 'developers.cloudflare.com/queues/platform/pricing/', 'developers.cloudflare.com/r2/pricing/'],
  workers_paid_base_usd: 5,
  requests: { included_month: 10e6, per_million_usd: 0.30 },
  d1: { reads_included_month: 25e9, reads_per_million_usd: 0.001, writes_included_month: 50e6, writes_per_million_usd: 1.0, storage_gb_included: 5, storage_gb_usd: 0.75 },
  ai: { per_1000_neurons_usd: 0.011, free_neurons_day: 10_000 },
  queues: { free_ops_day: 10_000, included_month: 1e6, per_million_usd: 0.40 },
  r2: { free_gb: 10, class_a_free_month: 1e6, class_b_free_month: 10e6, gb_usd: 0.015, class_a_per_million_usd: 4.5, class_b_per_million_usd: 0.36, egress_usd: 0 },
};
// BOUNDARIES-1 (Rowan, 2026-11-18): every tenant (an NGO with only an idea) runs this same seed worker against its own D1, so the optimizer below is shared code,
// not an Ultrastable-only report. It detects the tenant's plan (CF_PLAN=paid once the owner has bought Workers Paid; free otherwise), uses free headroom up to
// TARGET_USE of each limit, tells the tick to slow down when the pace would pass it, and recommends an upgrade only with measured ROI.
export const TARGET_USE = 0.8;
export function detectPlan(env = {}) { return env.CF_PLAN === 'paid' ? 'paid' : 'free'; }
// Per-day equivalents of the paid monthly allowances (30-day month), so one pace formula serves both plans.
export function limitsForPlan(plan) {
  if (plan !== 'paid') return FREE_LIMITS;
  const P = PRICES;
  return { d1_rows_read: { per_day: P.d1.reads_included_month / 30, label: 'D1 rows read (paid allowance)' }, d1_rows_written: { per_day: P.d1.writes_included_month / 30, label: 'D1 rows written (paid allowance)' },
    workers_requests: { per_day: P.requests.included_month / 30, label: 'Workers requests (paid allowance)' }, ai_neurons: FREE_LIMITS.ai_neurons };
}
// Pure. peaks = { resource: peak share of a day's limit }. pace_factor > 1: stretch loop intervals by that factor to fit; < 1: that much headroom can be used.
export function tune(shareByResource) {
  const worst = Math.max(0, ...Object.values(shareByResource).filter(Number.isFinite));
  const pace_factor = worst ? +(worst / TARGET_USE).toFixed(2) : 1;
  return { pace_factor, action: pace_factor > 1.05 ? 'slow' : pace_factor < 0.7 ? 'use-headroom' : 'hold',
    headroom_share: +Math.max(0, TARGET_USE - worst).toFixed(3), text: pace_factor > 1.05 ? `Stretch idle loop intervals by ${pace_factor}x to stay under ${TARGET_USE * 100}% of the tightest limit.` : pace_factor < 0.7 ? `${Math.round((TARGET_USE - worst) * 100)}% of the day's tightest limit is unused: more of the improvement backlog can run now.` : 'Pace fits the limits.' };
}
export const AI_PAID_CAP_USD = 0;          // paid AI stays $0 unless the data below proves otherwise and the owner raises it
export const NEED_DAYS = 3, PAY_IF_SHED_DAYS = 2;

const r2 = (n) => Math.round(n * 100) / 100;
// Pure. days = [{day, resources:{key:{peak, over80, over95, n}}}] (newest first), refused = AI calls refused in the window, storage_gb = D1 bytes/1e9.
export function analyze({ days, refused = 0, storage_gb = 0, mode = 'free-only', plan = 'free', prices = PRICES, now = new Date() }) {
  const LIM = limitsForPlan(plan);
  const keys = Object.keys(LIM);
  const res = {};
  for (const k of keys) {
    const rows = days.map(d => d.resources[k]).filter(Boolean);
    const peak = rows.length ? Math.max(...rows.map(x => x.peak)) : null;
    const lim = LIM[k].per_day;
    res[k] = { label: LIM[k].label, limit_day: lim, peak_day: peak, peak_share: peak == null ? null : +(peak / lim).toFixed(3),
      days_over_80: rows.filter(x => x.peak / lim >= DEGRADE_AT).length, days_over_95: rows.filter(x => x.peak / lim >= SHED_AT).length,
      throttled_samples: rows.reduce((s, x) => s + x.over80, 0), samples: rows.reduce((s, x) => s + x.n, 0) };
  }
  const measured = Object.values(res).filter(r => r.peak_share != null);
  const binding = measured.slice().sort((a, b) => b.peak_share - a.peak_share)[0] || null;
  const shedDays = days.filter(d => Object.entries(d.resources).some(([k, x]) => x.peak / LIM[k].per_day >= SHED_AT)).length;
  const avg = (k) => days.length ? days.reduce((s, d) => s + ((d.resources[k] || {}).peak || 0), 0) / days.length : 0;
  const m = { reads: avg('d1_rows_read') * 30, writes: avg('d1_rows_written') * 30, reqs: avg('workers_requests') * 30 };
  const P = prices, over = (v, inc) => Math.max(0, v - inc);
  const variable = (over(m.reqs, P.requests.included_month) / 1e6) * P.requests.per_million_usd + (over(m.reads, P.d1.reads_included_month) / 1e6) * P.d1.reads_per_million_usd
    + (over(m.writes, P.d1.writes_included_month) / 1e6) * P.d1.writes_per_million_usd + over(storage_gb, P.d1.storage_gb_included) * P.d1.storage_gb_usd;
  const paidProjected = r2(P.workers_paid_base_usd + variable);
  const enough = days.length >= NEED_DAYS;
  const pay = plan === 'free' && enough && shedDays >= PAY_IF_SHED_DAYS;
  const tuning = tune(Object.fromEntries(Object.entries(res).map(([k, r]) => [k, r.peak_share])));
  const headroom = (k, inc) => m[k] ? +(inc / m[k]).toFixed(1) : null;
  const options = [
    { id: 'cf-workers-paid', title: 'Workers Paid (includes D1, Queues, higher request and CPU limits)', projected_usd_month: paidProjected, fixed_usd_month: P.workers_paid_base_usd,
      unlocks: `D1 reads go from 5M/day to ${P.d1.reads_included_month / 1e9}B/month and writes from 100k/day to ${P.d1.writes_included_month / 1e6}M/month; requests from 100k/day to ${P.requests.included_month / 1e6}M/month. At today's pace that is ${headroom('reads', P.d1.reads_included_month)}x read, ${headroom('writes', P.d1.writes_included_month)}x write and ${headroom('reqs', P.requests.included_month)}x request headroom.`,
      gain: `${shedDays} of the last ${days.length} days reached the shed level; ${binding ? binding.label + ' peaked at ' + Math.round(binding.peak_share * 100) + '% of its free day' : 'no usage measured yet'}.`,
      verdict: pay ? 'pay' : 'stay-free' },
    { id: 'workers-ai-overage', title: 'Workers AI beyond 10,000 neurons a day', projected_usd_month: 0, cap_usd_month: AI_PAID_CAP_USD,
      unlocks: `More model calls a day at $${P.ai.per_1000_neurons_usd} per 1,000 neurons (needs the paid plan).`,
      gain: `Peak ${res.ai_neurons.peak_day == null ? 'unmeasured' : res.ai_neurons.peak_day + ' neurons (' + Math.round(res.ai_neurons.peak_share * 100) + '% of free)'}; ${refused} calls refused in the window.`, verdict: 'stay-free' },
    { id: 'cf-queues', title: 'Queues (free plan has 10,000 operations a day)', projected_usd_month: 0, unlocks: 'Decoupled retries without extra tick reads.', gain: 'No queue demand is measured; the tick already retries by itself.', verdict: 'stay-free' },
    { id: 'cf-r2', title: 'R2 (free: 10 GB, 1M writes and 10M reads a month, no egress fee)', projected_usd_month: 0, unlocks: 'Audit archive segments beyond the free allowance.', gain: `D1 holds ${storage_gb.toFixed(3)} GB of 5 GB; no R2 demand beyond the free allowance is measured.`, verdict: 'stay-free' },
  ];
  const recommendation = plan === 'paid' ? { action: 'stay-free', for: null, text: `Already on the paid plan: ${tuning.text} Paid AI stays at ${AI_PAID_CAP_USD} USD.` } : pay
    ? { action: 'pay', for: 'cf-workers-paid', text: `Pay for Workers Paid: ${shedDays} of ${days.length} days hit the shed level, so paid work was refused. Projected ${paidProjected} USD a month. Paid AI stays at ${AI_PAID_CAP_USD} USD.` }
    : { action: 'stay-free', for: null, text: enough ? `Stay free: only ${shedDays} of ${days.length} days reached the shed level (pay needs ${PAY_IF_SHED_DAYS}). ${binding ? binding.label + ' is the tightest limit at ' + Math.round(binding.peak_share * 100) + '% of its free day.' : ''} Paid AI stays at ${AI_PAID_CAP_USD} USD.` : `Stay free: only ${days.length} day(s) of usage are recorded and ${NEED_DAYS} are needed before any paid option can be justified.` };
  return { as_of: now.toISOString(), mode, plan, tuning, days_measured: days.length, need_days: NEED_DAYS, binding: binding && { resource: binding.label, peak_share: binding.peak_share }, shed_days: shedDays, resources: res,
    projection: { reads_month: Math.round(m.reads), writes_month: Math.round(m.writes), requests_month: Math.round(m.reqs) }, options, recommendation,
    hard_cap: { paid_ai_usd_month: AI_PAID_CAP_USD, note: 'Cloudflare has no account-level spend cap, so the cap is enforced here: the governor sheds at 95% of any free limit and no paid mode is switched on by code. Paid mode needs the owner to buy the plan and set FREE_ONLY=0.' },
    prices: { checked: P.checked, sources: P.sources } };
}

export async function readRoi(db, { env = {}, now = new Date() } = {}) {
  const since = new Date(now - 7 * 864e5).toISOString().replace('T', ' ').slice(0, 10);
  const byDay = {};
  for (const [k, l] of Object.entries(FREE_LIMITS)) {
    const rows = (await db.prepare(`SELECT substr(at,1,10) day, MAX(used_today) peak, COUNT(*) n, SUM(CASE WHEN used_today>=?2 THEN 1 ELSE 0 END) o FROM free_tier_samples WHERE resource=?1 AND used_today IS NOT NULL AND at>=?3 GROUP BY day`).bind(k, l.per_day * DEGRADE_AT, since).all()).results || [];
    for (const r of rows) (byDay[r.day] ??= { day: r.day, resources: {} }).resources[k] = { peak: r.peak, n: r.n, over80: r.o || 0 };
  }
  const days = Object.values(byDay).sort((a, b) => b.day.localeCompare(a.day));
  let refused = 0, ledger_error = null; try { refused = Number(((await db.prepare("SELECT COALESCE(SUM(refused),0) r FROM budget_ledger WHERE day>=?1 AND kind='ai_neurons'").bind(since).first()) || {}).r || 0); } catch (e) { ledger_error = String(e && e.message).slice(0, 120); }  // ledger absent until the first model call: shown, never silent
  return { ...analyze({ days, refused, plan: detectPlan(env), mode: env.FREE_ONLY === '0' ? 'paid-allowed' : 'free-only', now }), ledger_error };
}
