// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SPEND-GOVERNOR-1 (2026-11-16): the owner decides one thing, how much the system may spend a month all-in (budget.usd_per_month). Everything
// else is derived here and enforced in code, every tick, with no person in the loop.
//
// Lesson from an earlier fleet (frozen 2026-11-16 because its bill became unaffordable): its budget rule only steered work to cheaper models
// and never stopped it, so 37 workers on 2-to-30-minute crons spent ~12 million Workers AI neurons a week with no ceiling.
// Here the ceiling is hard: past the day's allowance the tick gets no model at all (frozen). It still measures, files and serves pages; rule-based
// steps keep running. Allowances come from Cloudflare's published prices, so a budget of 0 keeps the account inside the free tier.
//
// Metering needs no analytics token: every model call is counted in the D1 ledger budget_ledger, estimated from the token usage the model reports
// (or from the text length when it reports none), before the next call is allowed.

export const PRICES = {
  source: 'https://developers.cloudflare.com/workers-ai/platform/pricing/ (checked 2026-11-16)',
  paid_plan_usd_month: 5,          // Workers Paid base fee; 0 when the account stays on the free plan
  ai_usd_per_1k_neurons: 0.011,    // Workers AI, beyond the daily free allocation
  ai_free_neurons_day: 10000,      // Workers AI daily free allocation (both plans)
  neurons_per_input_token: 0.03,   // conservative defaults for mid-size text models; a model listed in model_rates overrides them
  neurons_per_output_token: 0.2,
};
export const SAFETY = 0.8;         // paid plan: plan to 80% of every limit, so estimation error never crosses the real one (an overrun there is billed)
// BUDGET-TUNE-1 (2026-11-18): /api/roi showed 87 calls refused with only 52% of the free neurons used. Cause: the free plan was planned to 80% and then split
// 60/20/20 across workers that meter into separate ledgers, so the tick worker froze at 48% of the day while the other shares sat idle, and lean mode began at 70% of that.
// On the free plan an overrun is refused by Cloudflare, never billed, so spend stays 0 with a 95% plan and a larger tick share.
export const SAFETY_FREE = 0.95;
export const LEAN_AT = 0.9;        // above 90% of the day's allowance: one model call per tick
export const DEFAULTS = { usd_per_month: 0, plan: 'free', fixed_usd_month: 0, model_rates: {} };

const DAY_MS = 864e5;
const dayOf = (now) => new Date(now).toISOString().slice(0, 10);
const monthOf = (now) => new Date(now).toISOString().slice(0, 7);
const daysInMonth = (now) => { const d = new Date(now); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); };

// The one knob: config.budget (from the instance manifest) with an env override the owner can change without a deploy (BUDGET_USD_PER_MONTH).
export function budgetConfig(config = {}, env = {}) {
  const b = { ...DEFAULTS, ...(config.budget || {}) };
  const envUsd = env.BUDGET_USD_PER_MONTH;
  if (envUsd !== undefined && envUsd !== null && String(envUsd).trim() !== '' && Number.isFinite(Number(envUsd))) b.usd_per_month = Math.max(0, Number(envUsd));
  if (env.CF_PLAN === 'paid' || env.CF_PLAN === 'free') b.plan = env.CF_PLAN;
  b.usd_per_month = Math.max(0, Number(b.usd_per_month) || 0);
  return b;
}

// What the money buys per day. Variable money = budget minus the fixed costs (plan fee, domains and anything the owner declares as fixed).
export function allowance(b, now = Date.now()) {
  const fixed = (b.plan === 'paid' ? PRICES.paid_plan_usd_month : 0) + (Number(b.fixed_usd_month) || 0);
  const variableMonth = Math.max(0, b.usd_per_month - fixed);
  const variableDay = variableMonth / daysInMonth(now);
  const paidNeurons = (variableDay / PRICES.ai_usd_per_1k_neurons) * 1000;
  const neuronsDay = Math.floor((PRICES.ai_free_neurons_day + paidNeurons) * (b.plan === 'paid' ? SAFETY : SAFETY_FREE));
  const notes = [];
  if (b.usd_per_month < fixed) notes.push(`budget ${b.usd_per_month} USD is below the fixed costs (${fixed} USD a month); only the free AI allocation is used`);
  return { usd_per_month: b.usd_per_month, fixed_usd_month: fixed, variable_usd_month: +variableMonth.toFixed(2), ai_neurons_day: neuronsDay, notes };
}

export function estimateNeurons(model, usage, text, rates = {}) {
  const r = rates[model] || {};
  const inRate = r.input ?? PRICES.neurons_per_input_token, outRate = r.output ?? PRICES.neurons_per_output_token;
  const u = usage || {};
  const inTok = Number(u.prompt_tokens ?? u.input_tokens ?? 0), outTok = Number(u.completion_tokens ?? u.output_tokens ?? 0);
  if (inTok || outTok) return Math.ceil(inTok * inRate + outTok * outRate);
  return Math.ceil((String(text || '').length / 4) * outRate + 200 * inRate);  // no usage reported: charge the output length plus a small prompt
}

// Several workers meter into their own ledgers; each gets a share of the account's daily allowance so together they never exceed it.
export const SHARES = { tick: 0.7, dashboard: 0.15, site: 0.15 };  // the tick worker makes nearly every model call; the console and the site call rarely
function withShare(a, share) {
  const s = Math.min(1, Math.max(0, Number(share) || 0));
  return s === 1 ? a : { ...a, share: s, ai_neurons_day: Math.floor(a.ai_neurons_day * s), variable_usd_month: +(a.variable_usd_month * s).toFixed(2) };
}

// For workers that call Workers AI only on some requests: returns env with AI replaced by a lazy governed handle. The governor reads the
// ledger on the first model call of the request only, so requests that never call a model cost no D1 read.
export function budgetEnv(env, share) {
  if (!env || !env.AI || !env.DB || env.__budgeted) return env;
  let gov = null;
  const raw = env.AI;
  const AI = {
    async run(model, input, opts) {
      if (!gov) gov = await governedAI(env.DB, raw, { env, share }).catch(e => { console.error('budget governor', e && e.message); return { ai: null, state: { why: 'governor unavailable' } }; });
      if (!gov.ai) throw new BudgetExhausted('AI budget: ' + ((gov.state && gov.state.why) || 'frozen'));
      return gov.ai.run(model, input, opts);
    },
  };
  return { ...env, AI, __budgeted: true };
}

// Per database handle, not per isolate: a worker or test may hold more than one database.
// HALT-1: one stop for every recurring and self-triggering path. The worker variable HALT ('1' or '0') wins over the committed ops/halt.json
// (config.halt), so the owner can stop or resume without a deploy.
export function halted(config, env) {
  const e = env && env.HALT !== undefined && env.HALT !== null ? String(env.HALT).trim().toLowerCase() : '';
  if (e === '1' || e === 'true' || e === 'on') return true;
  if (e === '0' || e === 'false' || e === 'off') return false;
  return Boolean(config && config.halt && config.halt.halted);
}

let ensured = new WeakSet();
export async function ensureLedger(db) {
  if (ensured.has(db)) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS budget_ledger (day TEXT NOT NULL, kind TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, refused INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind))").run();
  ensured.add(db);
}
export const _resetForTests = () => { ensured = new WeakSet(); };

export async function usage(db, now = Date.now()) {
  await ensureLedger(db);
  const day = dayOf(now), month = monthOf(now);
  const today = (await db.prepare("SELECT COALESCE(SUM(units),0) units, COALESCE(SUM(calls),0) calls, COALESCE(SUM(refused),0) refused FROM budget_ledger WHERE day=?1 AND kind='ai_neurons'").bind(day).first()) || {};
  const mtd = (await db.prepare("SELECT COALESCE(SUM(MAX(units - ?2, 0)),0) paid FROM (SELECT day, SUM(units) units FROM budget_ledger WHERE substr(day,1,7)=?1 AND kind='ai_neurons' GROUP BY day)").bind(month, PRICES.ai_free_neurons_day).first()) || {};
  return { day, ai_neurons_today: Number(today.units) || 0, ai_calls_today: Number(today.calls) || 0, ai_refused_today: Number(today.refused) || 0,
    ai_usd_month_to_date: +(((Number(mtd.paid) || 0) / 1000) * PRICES.ai_usd_per_1k_neurons).toFixed(4) };
}

// normal: model calls allowed; lean: one per tick; frozen: none until tomorrow (day cap) or next month (month's variable money spent).
export function decide(a, u) {
  if (u.ai_usd_month_to_date >= a.variable_usd_month && a.variable_usd_month > 0) return { mode: 'frozen', why: 'month variable budget spent', calls_per_tick: 0 };
  if (u.ai_neurons_today >= a.ai_neurons_day) return { mode: 'frozen', why: `today's AI allowance used (${Math.round(u.ai_neurons_today)} of ${a.ai_neurons_day} neurons)`, calls_per_tick: 0 };
  if (u.ai_neurons_today >= a.ai_neurons_day * LEAN_AT) return { mode: 'lean', why: `over ${LEAN_AT * 100}% of today's AI allowance`, calls_per_tick: 1 };
  return { mode: 'normal', why: 'within budget', calls_per_tick: null };
}

export class BudgetExhausted extends Error { constructor(msg) { super(msg); this.name = 'BudgetExhausted'; this.code = 'budget_exhausted'; } }

// The AI handle every loop receives. Returns null when frozen, so callers take their existing "no model" path; otherwise a metered wrapper that
// refuses a call (BudgetExhausted) once the per-tick or per-day allowance is reached and records every call in the ledger.
export async function governedAI(db, ai, { config = {}, env = {}, now = Date.now(), share = 1 } = {}) {
  if (!ai) return { ai: null, state: null };
  const b = budgetConfig(config, env), a = withShare(allowance(b, now), share), u = await usage(db, now), d = decide(a, u);
  const state = { budget: b.usd_per_month, plan: b.plan, allowance: a, usage: u, ...d };
  if (d.mode === 'frozen') { await bump(db, dayOf(now), 0, 0, 1).catch(e => console.error('budget ledger', e && e.message)); return { ai: null, state }; }
  let used = u.ai_neurons_today, callsThisTick = 0;
  const wrapped = {
    async run(model, input, opts) {
      if ((d.calls_per_tick !== null && callsThisTick >= d.calls_per_tick) || used >= a.ai_neurons_day) {
        await bump(db, dayOf(now), 0, 0, 1).catch(e => console.error('budget ledger', e && e.message));
        throw new BudgetExhausted(`AI budget: ${d.mode === 'lean' ? 'lean mode allows one model call per tick' : "today's allowance is used"}`);
      }
      callsThisTick++;
      const res = await ai.run(model, input, opts);
      const text = typeof res === 'string' ? res : (res && (res.response ?? res.result?.response ?? (res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content))) || '';
      const n = estimateNeurons(model, res && res.usage, text, b.model_rates);
      used += n;
      await bump(db, dayOf(now), n, 1, 0).catch(e => console.error('budget ledger', e && e.message));
      return res;
    },
  };
  return { ai: wrapped, state };
}

async function bump(db, day, units, calls, refused) {
  await ensureLedger(db);
  await db.prepare("INSERT INTO budget_ledger (day, kind, units, calls, refused) VALUES (?1,'ai_neurons',?2,?3,?4) ON CONFLICT(day, kind) DO UPDATE SET units=units+excluded.units, calls=calls+excluded.calls, refused=refused+excluded.refused")
    .bind(day, units, calls, refused).run();
}

// Read-only view for the dashboard and agents: the knob, what it buys, what was used, the mode, and the plain-words reason.
export async function budgetView(db, { config = {}, env = {}, now = Date.now() } = {}) {
  const b = budgetConfig(config, env), a = allowance(b, now), u = await usage(db, now), d = decide(a, u);
  return { knob: { usd_per_month: b.usd_per_month, set_by: env.BUDGET_USD_PER_MONTH !== undefined && String(env.BUDGET_USD_PER_MONTH).trim() !== '' ? 'BUDGET_USD_PER_MONTH' : 'instance manifest', plan: b.plan },
    allowance: a, usage: u, mode: d.mode, why: d.why, prices: PRICES, as_of: new Date(now).toISOString() };
}
