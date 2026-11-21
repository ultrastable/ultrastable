// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SPEND-SOFT-1 (Rowan, 2026-11-21): "No more than $5 a day ... Caps need to be soft ... Think about cell phone plans. You get throttled as you approach
// your limit ... Never a hard stop ... the parameters can be tweaked to never fail the system. So the system never stops."
// So $5 a day is a soft target, not a cap. Every tick the system estimates what the account would be billed today from Cloudflare's own usage
// analytics (Workers requests and CPU, D1 rows, KV, R2, Durable Objects, Workers AI neurons) at list prices, and turns the share of the target
// into a throttle level. Each level only turns knobs (loop cadence, model choice, how much AI beyond the free allocation, how often non-essential
// steps run); no level stops the clock, the queue, the merge lane or the deploys. Every knob springs back by itself when the estimate falls.
// DECISION-METRIC: free-tier-governor (the spend level is set on the same usage sample, which recordGovernor logs and scores)
//
// Lesson from an earlier fleet (hundreds of dollars a month): a budget rule that only steers never limits, and a hard stop at the limit grinds the system
// to a halt. Graduated throttling sits between the two: the spend curve bends long before the target and never reaches zero work.

// Cloudflare list prices for the Workers Paid plan. Sources: developers.cloudflare.com/workers/platform/pricing/, /kv/platform/pricing/,
// /d1/platform/pricing/, /r2/pricing/, /durable-objects/platform/pricing/, /workers-ai/platform/pricing/ (checked 2026-11-21).
// Allowances are monthly; the estimate takes a 1/30 slice per day, so it can only over-state a day (unused allowance carries over in reality).
export const RATES = {
  checked: '2026-11-21',
  base_usd_month: 5,
  requests: { included_month: 10e6, usd_per_million: 0.30 },
  cpu_ms: { included_month: 30e6, usd_per_million: 0.02 },
  d1_rows_read: { included_month: 25e9, usd_per_million: 0.001 },
  d1_rows_written: { included_month: 50e6, usd_per_million: 1.0 },
  kv_reads: { included_month: 10e6, usd_per_million: 0.50 },
  kv_writes: { included_month: 1e6, usd_per_million: 5.0 },     // writes, deletes and lists are billed at the same rate
  r2_class_a: { included_month: 1e6, usd_per_million: 4.50 },
  r2_class_b: { included_month: 10e6, usd_per_million: 0.36 },
  do_requests: { included_month: 1e6, usd_per_million: 0.15 },
  do_gb_s: { included_month: 400e3, usd_per_million: 12.50 },
  ai_neurons: { included_day: 10_000, usd_per_thousand: 0.011 },
};
const R2_CLASS_A = new Set(['PutObject', 'CopyObject', 'CompleteMultipartUpload', 'CreateMultipartUpload', 'UploadPart', 'UploadPartCopy', 'ListMultipartUploads', 'ListObjects', 'ListObjectsV2', 'ListBuckets', 'PutBucket', 'PutBucketCors', 'PutBucketLifecycleConfiguration', 'DeleteObject', 'DeleteObjects', 'LifecycleStorageTierTransition']);

// The one knob: the soft daily target in USD (config.spend.target_usd_day, env SPEND_TARGET_USD_DAY without a deploy).
export const DEFAULTS = { target_usd_day: 5 };
// Graduated bands on max(share of target spent today, share projected for the whole day). Phone-plan style: full speed, then slower and slower.
// pace: factor applied to idle loop intervals; ai: what model calls may use; wide_every_h / extra_every_h: how often deferred steps still run.
export const BANDS = [
  { level: 'full', below: 0.5, pace: 1, ai: 'any', wide_every_h: 0, extra_every_h: 0, text: 'Under half of the daily target: everything runs at full speed.' },
  { level: 'ease', below: 0.7, pace: 1.5, ai: 'cheap-first', wide_every_h: 0, extra_every_h: 0, text: 'Past half of the daily target: idle loops slow down and the cheapest model that passes is tried first.' },
  { level: 'throttle', below: 0.9, pace: 3, ai: 'free-allocation', wide_every_h: 1, extra_every_h: 0, text: 'Past 70% of the daily target: model calls stay inside the free daily allocation, wide reads run once an hour, idle loops run a third as often.' },
  { level: 'crawl', below: Infinity, pace: 6, ai: 'free-allocation-lean', wide_every_h: 6, extra_every_h: 3, text: 'Near or past the daily target: essential loops keep running every tick (measure, reconcile, dispatch, merge, deploy); everything else runs every few hours and model calls trickle from the free allocation. Nothing stops.' },
];

export function spendConfig(config = {}, env = {}) {
  const s = { ...DEFAULTS, ...((config && config.spend) || {}) };
  const e = env && env.SPEND_TARGET_USD_DAY;
  if (e !== undefined && e !== null && String(e).trim() !== '' && Number.isFinite(Number(e)) && Number(e) > 0) s.target_usd_day = Number(e);
  s.target_usd_day = Number(s.target_usd_day) > 0 ? Number(s.target_usd_day) : DEFAULTS.target_usd_day;
  s.tenants = Array.isArray(s.tenants) ? s.tenants : [];
  return s;
}

const daysInMonth = (now) => { const d = new Date(now); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); };
const r4 = (n) => Math.round(n * 1e4) / 1e4;

// Pure. used = today's usage per meter (any subset of RATES keys). Free plan: 0 (Cloudflare refuses an overrun there, it never bills it),
// but `paid_equivalent_usd` still says what the same usage would cost on Workers Paid, which /api/roi reads.
export function estimateDay(used = {}, { plan = 'free', now = Date.now() } = {}) {
  const by = {};
  let variable = 0;
  for (const [k, r] of Object.entries(RATES)) {
    if (typeof r !== 'object' || used[k] == null) continue;
    const u = Number(used[k]) || 0;
    const usd = k === 'ai_neurons' ? Math.max(0, u - r.included_day) / 1000 * r.usd_per_thousand : Math.max(0, u - r.included_month / 30) / 1e6 * r.usd_per_million;
    by[k] = r4(usd); variable += usd;
  }
  const fixed = RATES.base_usd_month / daysInMonth(now);
  const paid = r4(fixed + variable);
  return { plan, usd_today: plan === 'paid' ? paid : 0, paid_equivalent_usd: paid, fixed_usd: r4(fixed), variable_usd: r4(variable), by_meter: by };
}

// Pure. Projection extrapolates today's variable spend to 24 h once 2 h of the UTC day have passed (fixed share counted once).
export function level(est, target, now = new Date()) {
  const d = new Date(now), hours = Math.max(0.001, (d - Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())) / 3600e3);
  const projected = hours >= 2 ? est.usd_today - (est.plan === 'paid' ? est.fixed_usd : 0) : est.usd_today;
  const projectedDay = hours >= 2 ? r4(projected / hours * 24 + (est.plan === 'paid' ? est.fixed_usd : 0)) : est.usd_today;
  const share = Math.max(est.usd_today, projectedDay) / target;
  const band = BANDS.find(b => share < b.below) || BANDS[BANDS.length - 1];
  return { level: band.level, share: r4(share), usd_today: est.usd_today, projected_usd_day: projectedDay, target_usd_day: target, knobs: { pace: band.pace, ai: band.ai, wide_every_h: band.wide_every_h, extra_every_h: band.extra_every_h }, text: band.text };
}

// Pure. Spread the target across tenants by share and attribute usage by worker-script and database prefix. A tenant over its share sees its own
// level rise (read by the tenant at GET /api/spend?tenant=ID, the same pattern as goal knobs); the account level still governs the whole account.
export function tenantSpend(spend, byScript = {}, byDb = {}, { plan = 'free', now = Date.now() } = {}) {
  const out = [];
  for (const t of spend.tenants || []) {
    const match = (name, pats) => (pats || []).some(p => p.endsWith('*') ? name.startsWith(p.slice(0, -1)) : name === p);
    const used = { requests: 0, cpu_ms: 0, d1_rows_read: 0, d1_rows_written: 0 };
    for (const [s, v] of Object.entries(byScript)) if (match(s, t.scripts)) { used.requests += v.requests || 0; used.cpu_ms += v.cpu_ms || 0; }
    for (const [id, v] of Object.entries(byDb)) if (match(id, t.databases)) { used.d1_rows_read += v.rows_read || 0; used.d1_rows_written += v.rows_written || 0; }
    const share = Math.min(1, Math.max(0, Number(t.share) || 0));
    // A tenant's included allowance is its share of the account's: scale usage up by 1/share so the account-level formula applies unchanged.
    const scaled = share ? Object.fromEntries(Object.entries(used).map(([k, v]) => [k, v / share])) : used;
    const e = estimateDay(scaled, { plan, now });
    const tenantUsd = r4(e.variable_usd * share + (plan === 'paid' ? e.fixed_usd * share : 0));
    const lv = level({ ...e, usd_today: plan === 'paid' ? tenantUsd : 0, fixed_usd: e.fixed_usd * share }, spend.target_usd_day * (share || 1), new Date(now));
    out.push({ id: t.id, share, used, usd_today: tenantUsd, paid_equivalent_usd: r4(e.paid_equivalent_usd * share), level: lv.level, knobs: lv.knobs });
  }
  return out;
}

// One GraphQL call for every meter the estimate needs (a Free-plan invocation has 50 subrequests). Missing datasets are left unmeasured.
export function usageQuery(account_id, from, to) {
  const f = `limit:1000,filter:{datetime_geq:"${from}",datetime_leq:"${to}"}`;
  return `{viewer{accounts(filter:{accountTag:"${account_id}"}){d1:d1AnalyticsAdaptiveGroups(${f}){sum{rowsRead rowsWritten} dimensions{databaseId}} w:workersInvocationsAdaptive(${f}){sum{requests cpuTimeUs} dimensions{scriptName}} ai:aiInferenceAdaptiveGroups(${f}){sum{totalNeurons}} kv:kvOperationsAdaptiveGroups(${f}){sum{requests} dimensions{actionType}} r2:r2OperationsAdaptiveGroups(${f}){sum{requests} dimensions{actionType}} dor:durableObjectsInvocationsAdaptiveGroups(${f}){sum{requests}} dod:durableObjectsPeriodicGroups(${f}){sum{activeTime}}}}}`;
}

// Pure. Turns the GraphQL account node into meters, plus per-script and per-database breakdowns for tenant attribution.
export function metersFrom(a = {}) {
  const sum = (arr, f) => (arr || []).reduce((s, g) => s + (Number(f(g.sum || {})) || 0), 0);
  const used = {}, byScript = {}, byDb = {};
  if (a.d1) { used.d1_rows_read = sum(a.d1, s => s.rowsRead); used.d1_rows_written = sum(a.d1, s => s.rowsWritten); for (const g of a.d1) { const id = g.dimensions && g.dimensions.databaseId; if (id) byDb[id] = { rows_read: Number(g.sum.rowsRead) || 0, rows_written: Number(g.sum.rowsWritten) || 0 }; } }
  if (a.w) { used.requests = sum(a.w, s => s.requests); used.cpu_ms = sum(a.w, s => s.cpuTimeUs) / 1000; for (const g of a.w) { const n = g.dimensions && g.dimensions.scriptName; if (n) byScript[n] = { requests: Number(g.sum.requests) || 0, cpu_ms: (Number(g.sum.cpuTimeUs) || 0) / 1000 }; } }
  if (a.ai) used.ai_neurons = sum(a.ai, s => s.totalNeurons);
  if (a.kv) { used.kv_reads = sum(a.kv.filter(g => (g.dimensions || {}).actionType === 'read'), s => s.requests); used.kv_writes = sum(a.kv.filter(g => (g.dimensions || {}).actionType !== 'read'), s => s.requests); }
  if (a.r2) { used.r2_class_a = sum(a.r2.filter(g => R2_CLASS_A.has((g.dimensions || {}).actionType)), s => s.requests); used.r2_class_b = sum(a.r2.filter(g => !R2_CLASS_A.has((g.dimensions || {}).actionType)), s => s.requests); }
  if (a.dor) used.do_requests = sum(a.dor, s => s.requests);
  if (a.dod) used.do_gb_s = sum(a.dod, s => s.activeTime) / 1e6 * 0.128;   // activeTime is microseconds; billed at 128 MB per object
  return { used, byScript, byDb };
}

// Records the reading: one free_tier_samples row per extra meter (resource spend_usd carries the estimate) and the current state in org.spend_state,
// which every tick and the AI governor read with one primary-key lookup. Never throws; a failed write is returned as .error.
export async function recordSpend(db, { meters, error = null, config = {}, env = {}, now = new Date() }) {
  const spend = spendConfig(config, env), plan = (env && (env.CF_PLAN === 'paid' || env.CF_PLAN === 'free')) ? env.CF_PLAN : (config && config.budget && config.budget.plan === 'paid' ? 'paid' : 'free');
  const used = (meters && meters.used) || {};
  const est = estimateDay(used, { plan, now: now.getTime() });
  // PLAN-SAFE-1: the throttle reads the paid-plan price of today's usage whatever CF_PLAN says, so buying Workers Paid without telling the worker can
  // never leave the throttle blind. On the free plan the paid price of capped usage is the base-fee share (every free cap sits under the paid daily
  // slice), so this never throttles a free account.
  const lv = level({ ...est, plan: 'paid', usd_today: est.paid_equivalent_usd }, spend.target_usd_day, now);
  const tenants = tenantSpend(spend, (meters && meters.byScript) || {}, (meters && meters.byDb) || {}, { plan: 'paid', now: now.getTime() });
  const measured = Object.keys(used).length > 0;
  const state = { at: now.toISOString(), measured, error, plan, ...lv, usd_today: est.usd_today, paid_equivalent_usd: est.paid_equivalent_usd, by_meter: est.by_meter, used, tenants };
  if (!measured) { state.level = 'full'; state.knobs = { pace: 1, ai: 'any', wide_every_h: 0, extra_every_h: 0 }; state.text = 'No usage reading: the free-tier governor and the AI ledger still limit the day.'; }
  try {
    const at = now.toISOString().replace('T', ' ').slice(0, 19);
    for (const [k, v] of [['spend_usd', measured ? est.usd_today : null], ['spend_paid_equivalent_usd', measured ? est.paid_equivalent_usd : null], ['cpu_ms', used.cpu_ms], ['kv_reads', used.kv_reads], ['kv_writes', used.kv_writes], ['ai_neurons_account', used.ai_neurons]])
      await db.prepare('INSERT INTO free_tier_samples (at, resource, used_today, error) VALUES (?,?,?,?)').bind(at, k, v ?? null, v == null ? (error || 'unmeasured') : null).run();
    await db.prepare("INSERT INTO org (key, value) VALUES ('spend_state', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(state)).run();
  } catch (e) { state.write_error = String(e && e.message).slice(0, 150); console.error('spend record:', state.write_error); }
  return state;
}

// The state as last recorded; older than 2 h counts as unmeasured (level full: the other governors still apply). One indexed read.
export async function readSpend(db, now = Date.now()) {
  let readError = '';
  try {
    const r = await db.prepare("SELECT value FROM org WHERE key='spend_state'").first();
    const s = r && r.value ? JSON.parse(r.value) : null;
    if (s && now - Date.parse(s.at) <= 7200e3) return s;
  } catch (e) { readError = String(e && e.message).slice(0, 120); console.error('spend read:', readError); }
  return { level: 'full', measured: false, ...(readError ? { read_error: readError } : {}), knobs: { pace: 1, ai: 'any', wide_every_h: 0, extra_every_h: 0 } };
}

// Pure. Whether a deferred step runs on this tick: every `everyH` hours, on the first tick of the hour. 0 = deferred steps run normally.
export function dueEvery(everyH, now) { if (!everyH) return true; const d = new Date(now); return d.getUTCMinutes() < 10 && d.getUTCHours() % everyH === 0; }

// For tenant workers and the owner view.
export function spendView(state, tenantId = null) {
  if (tenantId) { const t = (state.tenants || []).find(x => x.id === tenantId); return t ? { tenant: tenantId, ...t, account_level: state.level, at: state.at } : { tenant: tenantId, level: 'full', knobs: { pace: 1, ai: 'any', wide_every_h: 0, extra_every_h: 0 }, note: 'tenant not registered in config.spend.tenants', at: state.at }; }
  return { ...state, bands: BANDS.map(b => ({ level: b.level, from_share: b === BANDS[0] ? 0 : BANDS[BANDS.indexOf(b) - 1].below, text: b.text })), rates: { checked: RATES.checked } };
}
