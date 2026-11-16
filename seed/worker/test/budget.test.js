// SPEND-GOVERNOR-1: the owner's one number (budget.usd_per_month) bounds every model call, with a hard stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { budgetConfig, allowance, estimateNeurons, governedAI, budgetView, decide, BudgetExhausted, PRICES, _resetForTests } from '../src/budget.js';

function mkdb() {
  const raw = new DatabaseSync(':memory:');
  const db = { prepare(sql) { const st = raw.prepare(sql); let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: st.all(...a).map(r => ({ ...r })) }; }, async first() { const r = st.get(...a); return r ? { ...r } : null; },
    async run() { const r = st.run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; } };
  _resetForTests();
  return { raw, db };
}
const NOW = Date.parse('2026-11-16T12:00:00Z');
const fakeAI = (outTok = 500) => { const calls = []; return { calls, async run(model, input) { calls.push(model); return { response: 'ok', usage: { prompt_tokens: 1000, completion_tokens: outTok } }; } }; };

test('a budget of 0 stays inside the free AI allocation, with a safety margin', () => {
  const a = allowance(budgetConfig({}, {}), NOW);
  assert.equal(a.variable_usd_month, 0);
  assert.equal(a.ai_neurons_day, Math.floor(PRICES.ai_free_neurons_day * 0.8));
});

test('the monthly number buys a daily allowance after fixed costs', () => {
  const a = allowance(budgetConfig({ budget: { usd_per_month: 30, plan: 'paid' } }, {}), NOW);
  assert.equal(a.fixed_usd_month, 5);
  assert.equal(a.variable_usd_month, 25);
  const perDay = 25 / 30, expected = Math.floor((10000 + (perDay / 0.011) * 1000) * 0.8);
  assert.equal(a.ai_neurons_day, expected);
  const low = allowance(budgetConfig({ budget: { usd_per_month: 3, plan: 'paid' } }, {}), NOW);
  assert.equal(low.variable_usd_month, 0); assert.match(low.notes[0], /below the fixed costs/);
});

test('the owner can change the number without a deploy (env override), and nonsense is ignored', () => {
  assert.equal(budgetConfig({ budget: { usd_per_month: 10 } }, { BUDGET_USD_PER_MONTH: '50' }).usd_per_month, 50);
  assert.equal(budgetConfig({ budget: { usd_per_month: 10 } }, { BUDGET_USD_PER_MONTH: 'lots' }).usd_per_month, 10);
  assert.equal(budgetConfig({ budget: { usd_per_month: 10 } }, { BUDGET_USD_PER_MONTH: '-4' }).usd_per_month, 0);
});

test('neurons are estimated from reported usage, or from the text when none is reported', () => {
  assert.equal(estimateNeurons('m', { prompt_tokens: 1000, completion_tokens: 500 }, ''), Math.ceil(1000 * 0.03 + 500 * 0.2));
  assert.equal(estimateNeurons('m', { prompt_tokens: 1000, completion_tokens: 500 }, '', { m: { input: 0.01, output: 0.1 } }), Math.ceil(10 + 50));
  assert.ok(estimateNeurons('m', null, 'x'.repeat(4000)) > 0);
});

test('modes: normal, lean above 70% of the day, frozen at the cap and when the month is spent', () => {
  const a = { ai_neurons_day: 1000, variable_usd_month: 10 };
  assert.equal(decide(a, { ai_neurons_today: 100, ai_usd_month_to_date: 0 }).mode, 'normal');
  assert.equal(decide(a, { ai_neurons_today: 750, ai_usd_month_to_date: 0 }).mode, 'lean');
  assert.equal(decide(a, { ai_neurons_today: 1000, ai_usd_month_to_date: 0 }).mode, 'frozen');
  assert.equal(decide(a, { ai_neurons_today: 0, ai_usd_month_to_date: 10 }).mode, 'frozen');
});

test('every call is metered in the ledger, and the day cap is a hard stop (BudgetExhausted), not a downgrade', async () => {
  const { raw, db } = mkdb(); const ai = fakeAI();
  const g = await governedAI(db, ai, { config: { budget: { usd_per_month: 0 } }, now: NOW });
  assert.equal(g.state.mode, 'normal');
  const perCall = estimateNeurons('m', { prompt_tokens: 1000, completion_tokens: 500 }, '');
  const fit = Math.ceil(g.state.allowance.ai_neurons_day / perCall);
  let refused = null;
  for (let i = 0; i < fit + 5; i++) { try { await g.ai.run('m', {}); } catch (e) { refused = e; break; } }
  assert.ok(refused instanceof BudgetExhausted, 'refused once the allowance is used');
  assert.ok(ai.calls.length <= fit, 'never more calls than the allowance holds');
  const row = raw.prepare("SELECT units, calls, refused FROM budget_ledger WHERE day='2026-11-16'").get();
  assert.equal(row.calls, ai.calls.length); assert.ok(row.units >= g.state.allowance.ai_neurons_day); assert.equal(row.refused, 1);
  const next = await governedAI(db, ai, { config: { budget: { usd_per_month: 0 } }, now: NOW });
  assert.equal(next.ai, null, 'the next tick gets no model at all'); assert.equal(next.state.mode, 'frozen');
  const tomorrow = await governedAI(db, ai, { config: { budget: { usd_per_month: 0 } }, now: NOW + 864e5 });
  assert.equal(tomorrow.state.mode, 'normal', 'a new day starts a new allowance');
});

test('lean mode allows one model call per tick', async () => {
  const { raw, db } = mkdb(); const ai = fakeAI();
  await governedAI(db, ai, { config: {}, now: NOW });
  raw.prepare("INSERT INTO budget_ledger (day, kind, units, calls, refused) VALUES ('2026-11-16','ai_neurons',?,1,0) ON CONFLICT(day,kind) DO UPDATE SET units=excluded.units").run(Math.floor(8000 * 0.75));
  const g = await governedAI(db, ai, { config: {}, now: NOW });
  assert.equal(g.state.mode, 'lean');
  await g.ai.run('m', {});
  await assert.rejects(() => g.ai.run('m', {}), BudgetExhausted);
});

test('no AI binding means no AI handle, and the view reports the knob, the allowance and the mode', async () => {
  const { db } = mkdb();
  assert.equal((await governedAI(db, null, { now: NOW })).ai, null);
  const v = await budgetView(db, { config: { budget: { usd_per_month: 30, plan: 'paid' } }, env: { BUDGET_USD_PER_MONTH: '20' }, now: NOW });
  assert.equal(v.knob.usd_per_month, 20); assert.equal(v.knob.set_by, 'BUDGET_USD_PER_MONTH');
  assert.equal(v.mode, 'normal'); assert.equal(v.allowance.variable_usd_month, 15);
});

test('the tick worker never hands a loop the raw AI binding', () => {
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  const raw = src.split('\n').filter(l => /env\.AI\b/.test(l) && !/aiFor = \(env\) => governedAI\(env\.DB, env\.AI/.test(l));
  assert.deepEqual(raw, [], 'only the governor reads env.AI');
});

test('a frozen budget lets the criticality step originate only a cost cut and file no idle item', async () => {
  const src = readFileSync(new URL('../src/criticality.js', import.meta.url), 'utf8');
  assert.match(src, /if \(frozen\) m\.cap_breached = 1;/);
  assert.match(src, /if \(idle && !frozen\)/);
  assert.match(src, /const order = m\.cap_breached \? \['cost_cut'\]/);
  const tick = readFileSync(new URL('../src/tick.js', import.meta.url), 'utf8');
  assert.match(tick, /ai = null, budget = null \} = \{\}\) \{/);
  const idx = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.equal((idx.match(/budget: (gov|g)\.state/g) || []).length, 3, 'every runTick call carries the budget state');
});
