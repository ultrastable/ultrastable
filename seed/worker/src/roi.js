// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ROI-1 (Rowan, 2026-11-18): "I need to be convinced that I'm actually going to get a return" before any paid Cloudflare service. This turns the free-tier
// governor's real samples (free_tier_samples), the AI ledger (budget_ledger) and the decision log into a recommendation: pay for X, or stay free.
// It never buys or enables anything. Free-only mode is the default and stays the default for the demo and for self-hosters; paid AI stays capped at $0.
// The verdict is the system's own (system_decision); only the purchase is the owner's, as one gate with a default in effect (index.js roiGate).
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
export function detectPlan(env = {}, config = {}) { return env.CF_PLAN === 'paid' || (env.CF_PLAN !== 'free' && config && config.budget && config.budget.plan === 'paid') ? 'paid' : 'free'; }
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
export const NEED_DAYS = 3, PAY_IF_SHED_DAYS = 2, THROTTLED_HOURS_PAY = 12;

const r2 = (n) => Math.round(n * 100) / 100;
// Pure. days = [{day, resources:{key:{peak, over80, over95, n}}}] (newest first), refused = AI calls refused in the window, storage_gb = D1 bytes/1e9.
export function analyze({ days, refused = 0, storage_gb = 0, mode = 'free-only', plan = 'free', prices = PRICES, now = new Date(), target_usd_day = 5 }) {
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
  // SPEND-SOFT-1 / ROI-SELF-1 (Rowan, 2026-11-21: time and cost trade off, quality never does): time lost is the hours the free plan throttled
  // the system (samples at or over the degrade level, six a hour); cost is the projected paid bill. Paid is worth it when the free plan throttles
  // for real (two shed days, or half a day of throttling in the window) and the projected bill fits well inside the soft daily target.
  const throttledHours = +(days.reduce((s, d) => s + Math.max(0, ...Object.values(d.resources).map(x => x.over80 || 0)), 0) / 6).toFixed(1);
  const fitsTarget = paidProjected / 30 <= target_usd_day * 0.5;
  const pay = plan === 'free' && enough && (shedDays >= PAY_IF_SHED_DAYS || throttledHours >= THROTTLED_HOURS_PAY) && fitsTarget;
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
  const time_vs_cost = { throttled_hours: throttledHours, window_days: days.length, paid_usd_month: paidProjected, paid_usd_day: r2(paidProjected / 30), soft_target_usd_day: target_usd_day,
    usd_per_throttled_hour_recovered: throttledHours ? r2(paidProjected / Math.max(1, throttledHours * 30 / Math.max(1, days.length))) : null, quality: 'unchanged: every check, probe and review runs on either plan; only speed changes' };
  // The system's own decision, read by the tick (index.js roiGate): buying a plan is money, an identity-bound act, so the verdict becomes one owner
  // gate with the default in effect (stay free; the soft throttle keeps every loop running), never a stop.
  const system_decision = { verdict: pay ? 'pay' : 'stay-free', gate: pay ? 'owner-billing' : null, default_in_effect: 'free plan with soft throttling: every loop keeps running, slower when the free limits bind',
    reason: pay ? `free limits throttled the system for ${throttledHours} h in ${days.length} days (${shedDays} shed days) and Workers Paid projects to ${paidProjected} USD a month, ${r2(paidProjected / 30)} USD a day against a ${target_usd_day} USD soft target` : (fitsTarget ? 'the free plan is not throttling enough to buy time' : 'the projected paid bill would not fit inside half the soft daily target') };
  return { as_of: now.toISOString(), mode, plan, tuning, time_vs_cost, system_decision, days_measured: days.length, need_days: NEED_DAYS, binding: binding && { resource: binding.label, peak_share: binding.peak_share }, shed_days: shedDays, resources: res,
    projection: { reads_month: Math.round(m.reads), writes_month: Math.round(m.writes), requests_month: Math.round(m.reqs) }, options, recommendation,
    hard_cap: { paid_ai_usd_month: AI_PAID_CAP_USD, note: 'No hard stop anywhere (SPEND-SOFT-1): spend.js throttles in steps as the estimated bill nears the soft daily target (GET /api/spend), the free-tier governor slows wide reads near 80% of a free limit, and no paid mode is switched on by code.' },
    prices: { checked: P.checked, sources: P.sources } };
}

// READ-BUDGET-10: this reads seven days of every free-tier resource's samples (about 2,100 rows a resource, 102,000 rows an hour measured on 2026-11-26)
// and /api/roi is public. The verdict moves by the day, so a read without an explicit clock is served from one org row for ROI_CACHE_MS; a caller that
// passes `now` (a test, a replay) or `cache: false` always reads the samples.
export const ROI_CACHE_MS = 900e3;
export async function readRoi(db, { env = {}, config = {}, now = null, cache = true } = {}) {
  const useCache = cache && !now;
  if (useCache) {
    try {
      const c = JSON.parse(((await db.prepare(`SELECT value FROM org WHERE key = 'roi_cache'`).first()) || {}).value || 'null');
      if (c && c.at && Date.now() - c.at < ROI_CACHE_MS && c.result) return c.result;
    } catch (e) { /* allow-silent: an unreadable cache row is a fresh read below */ }
  }
  const result = await computeRoi(db, { env, config, now: now || new Date() });
  if (useCache) {
    try { await db.prepare(`INSERT INTO org (key, value) VALUES ('roi_cache', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify({ at: Date.now(), result })).run(); }
    catch (e) { /* allow-silent: a cache write miss only costs the next call one more read */ console.error('roi: not cached:', e && e.message); }
  }
  return result;
}

async function computeRoi(db, { env, config, now }) {
  const since = new Date(now - 7 * 864e5).toISOString().replace('T', ' ').slice(0, 10);
  const byDay = {};
  for (const [k, l] of Object.entries(FREE_LIMITS)) {
    const rows = (await db.prepare(`SELECT substr(at,1,10) day, MAX(used_today) peak, COUNT(*) n, SUM(CASE WHEN used_today>=?2 THEN 1 ELSE 0 END) o FROM free_tier_samples WHERE resource=?1 AND used_today IS NOT NULL AND at>=?3 GROUP BY day`).bind(k, l.per_day * DEGRADE_AT, since).all()).results || [];
    for (const r of rows) (byDay[r.day] ??= { day: r.day, resources: {} }).resources[k] = { peak: r.peak, n: r.n, over80: r.o || 0 };
  }
  const days = Object.values(byDay).sort((a, b) => b.day.localeCompare(a.day));
  let refused = 0, ledger_error = null; try { refused = Number(((await db.prepare("SELECT COALESCE(SUM(refused),0) r FROM budget_ledger WHERE day>=?1 AND kind='ai_neurons'").bind(since).first()) || {}).r || 0); } catch (e) { ledger_error = String(e && e.message).slice(0, 120); }  // ledger absent until the first model call: shown, never silent
  const target = Number(env.SPEND_TARGET_USD_DAY) > 0 ? Number(env.SPEND_TARGET_USD_DAY) : (Number(config && config.spend && config.spend.target_usd_day) || 5);
  return { ...analyze({ days, refused, plan: detectPlan(env, config), mode: env.FREE_ONLY === '0' ? 'paid-allowed' : 'free-only', now, target_usd_day: target }), ledger_error };
}
