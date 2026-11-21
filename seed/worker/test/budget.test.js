// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SPEND-GOVERNOR-1: the owner's one number (budget.usd_per_month) bounds every model call, with a hard stop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
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
  assert.equal(a.ai_neurons_day, Math.floor(PRICES.ai_free_neurons_day * 0.95));  // BUDGET-TUNE-1: the free plan refuses an overrun, it never bills one
});

test('the monthly number buys a daily allowance after fixed costs', () => {
  const a = allowance(budgetConfig({ budget: { usd_per_month: 30, plan: 'paid' } }, {}), NOW);
  assert.equal(a.fixed_usd_month, 5);
  assert.equal(a.variable_usd_month, 25);
  const perDay = 25 / 30, expected = Math.floor((10000 + (perDay / 0.011) * 1000) * 0.8);  // paid plan keeps the 80% margin
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

test('modes: normal, lean above 90% of the day, crawl (never frozen) at the cap and when the month is spent', () => {
  const a = { ai_neurons_day: 1000, variable_usd_month: 10 };
  assert.equal(decide(a, { ai_neurons_today: 100, ai_usd_month_to_date: 0 }).mode, 'normal');
  assert.equal(decide(a, { ai_neurons_today: 950, ai_usd_month_to_date: 0 }).mode, 'lean');
  assert.equal(decide(a, { ai_neurons_today: 1000, ai_usd_month_to_date: 0 }).mode, 'crawl');
  assert.equal(decide(a, { ai_neurons_today: 0, ai_usd_month_to_date: 10 }).mode, 'crawl');
  assert.equal(decide(a, { ai_neurons_today: 1000, ai_usd_month_to_date: 0 }).hourly, true);
});

test('every call is metered in the ledger; past the day cap calls are refused within the tick and then trickle one an hour (SPEND-SOFT-1)', async () => {
  const { raw, db } = mkdb(); const ai = fakeAI();
  const g = await governedAI(db, ai, { config: { budget: { usd_per_month: 0 } }, now: NOW });
  assert.equal(g.state.mode, 'normal');
  const perCall = estimateNeurons('m', { prompt_tokens: 1000, completion_tokens: 500 }, '');
  const fit = Math.ceil(g.state.allowance.ai_neurons_day / perCall);
  let refused = null;
  for (let i = 0; i < fit + 5; i++) { try { await g.ai.run('m', {}); } catch (e) { refused = e; break; } }
  assert.ok(refused instanceof BudgetExhausted, 'refused once the allowance is used');
  assert.ok(ai.calls.length <= fit, 'never more calls than the allowance holds');
  const row = raw.prepare("SELECT units, calls, refused FROM budget_ledger WHERE day='2026-11-16' AND kind='ai_neurons'").get();
  assert.equal(row.calls, ai.calls.length); assert.ok(row.units >= g.state.allowance.ai_neurons_day); assert.equal(row.refused, 1);
  const next = await governedAI(db, ai, { config: { budget: { usd_per_month: 0 } }, now: NOW });
  assert.equal(next.state.mode, 'crawl', 'never frozen: the system keeps one model call an hour');
  await next.ai.run('m', {}); await assert.rejects(() => next.ai.run('m', {}), BudgetExhausted);
  const sameHour = await governedAI(db, ai, { config: { budget: { usd_per_month: 0 } }, now: NOW + 1000 });
  await assert.rejects(() => sameHour.ai.run('m', {}), BudgetExhausted, 'CRAWL-SHARED-1: the hour\'s one call is shared by every surface');
  const nextHour = await governedAI(db, ai, { config: { budget: { usd_per_month: 0 } }, now: (Math.floor(NOW / 36e5) + 1) * 36e5 + 6e5 * 3 });
  if (nextHour.state.mode === 'crawl') { await nextHour.ai.run('m', {}); await assert.rejects(() => nextHour.ai.run('m', {}), BudgetExhausted); }
  const tomorrow = await governedAI(db, ai, { config: { budget: { usd_per_month: 0 } }, now: NOW + 864e5 });
  assert.equal(tomorrow.state.mode, 'normal', 'a new day starts a new allowance');
});

test('lean mode allows one model call per tick', async () => {
  const { raw, db } = mkdb(); const ai = fakeAI();
  await governedAI(db, ai, { config: {}, now: NOW });
  raw.prepare("INSERT INTO budget_ledger (day, kind, units, calls, refused) VALUES ('2026-11-16','ai_neurons',?,1,0) ON CONFLICT(day,kind) DO UPDATE SET units=excluded.units").run(Math.floor(9500 * 0.95));
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
  const raw = src.split('\n').filter(l => /env\.AI\b/.test(l) && !/^const aiFor = \(env\) =>.*governedAI\(env\.DB, env\.AI/.test(l));
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

test('REPLY-GATE-1: empty, truncated and repeated replies are rejected before use', async () => {
  const { replyProblem } = await import('../src/doer.js');
  assert.equal(replyProblem({}, '  '), 'empty reply');
  assert.equal(replyProblem({ choices: [{ finish_reason: 'length', message: { content: 'abc' } }] }, 'abc'), 'cut off at max_tokens');
  assert.equal(replyProblem({}, Array(12).fill('same line').join('\n')), 'repeated lines');
  assert.equal(replyProblem({}, 'the same twenty chars! '.repeat(5)), 'repeated text');
  assert.equal(replyProblem({}, '{"action":"done","evidence":"tests pass"}'), null);
});

test('ORIGINATE-CAP-1: the system files at most ORIGINATE_MAX_PER_DAY items of its own a day', async () => {
  const { raw, db } = mkdb();
  raw.exec("CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT, kind TEXT, owner_role TEXT, done_check TEXT, closing_probe TEXT, priority INTEGER, status TEXT, surface TEXT, action_class TEXT)");
  const { ensureItem } = await import('../src/tick.js');
  const mk = (i) => ({ id: 'X-' + i, title: 't', owner_role: 'operations', done_check: 'grep:a::b' });
  let filed = 0;
  for (let i = 0; i < 5; i++) if (await ensureItem(db, mk(i), { cap: 3, now: NOW })) filed++;
  assert.equal(filed, 3);
  assert.equal(raw.prepare("SELECT refused FROM budget_ledger WHERE kind='originated'").get().refused, 2);
  assert.equal(await ensureItem(db, mk(9), { cap: 3, now: NOW + 864e5 }), true, 'a new day has a new allowance');
});

test('lazy governed env: a request with no model call reads nothing; a spent budget crawls (at most one call an hour)', async () => {
  const { budgetEnv } = await import('../src/budget.js');
  const { raw, db } = mkdb(); const ai = fakeAI();
  const env = budgetEnv({ DB: db, AI: ai }, 0.2);
  assert.notEqual(env.AI, ai); assert.equal(raw.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE name='budget_ledger'").get().c, 0, 'nothing read until a model call');
  await env.AI.run('m', {});
  assert.equal(ai.calls.length, 1);
  raw.prepare("UPDATE budget_ledger SET units = 1e9 WHERE kind='ai_neurons'").run();
  const env2 = budgetEnv({ DB: db, AI: ai }, 0.2);
  await assert.rejects(async () => { await env2.AI.run('m', {}).catch(e => { throw e; }); await env2.AI.run('m', {}); }, BudgetExhausted, 'crawl: at most the hour\'s one call, then refused');
});

test('every Workers AI call site in the workers goes through the governor', { skip: !existsSync(new URL('../../../site/worker.js', import.meta.url)) && 'platform-only: a generated system has no site or dashboard worker (SEED-ADMIT-1)' }, () => {
  const read = (p) => readFileSync(new URL('../../../' + p, import.meta.url), 'utf8');
  assert.match(read('site/worker.js'), /env = budgetEnv\(env, SHARES\.site\)/);
  assert.match(read('dashboard/worker.js'), /async fetch\(req, env\) \{ env = budgetEnv\(env, SHARES\.dashboard\)/);
  assert.match(read('dashboard/worker.js'), /async scheduled\(ev, env, ctx\) \{ if \(halted\(null, env\)\) return;  \/\* HALT-1 \*\/ env = budgetEnv\(env, SHARES\.dashboard\)/);
  assert.match(read('seed/worker/src/index.js'), /probeAgents\(\{ \.\.\.env, AI: \(await aiFor\(env\)\)\.ai \|\| undefined \}\)/);
});

test('D1-LIMIT-503: /health and /api/budget answer 503 with a code when D1 refuses every query', async () => {
  const { writeFileSync, existsSync, rmSync } = await import('node:fs');
  const cfg = new URL('../src/config.js', import.meta.url);
  const made = !existsSync(cfg);
  if (made) writeFileSync(cfg, 'export default ' + JSON.stringify({ org_slug: 'test', budget: { usd_per_month: 0 } }) + ';\n');
  try {
    const mod = await import('../src/index.js');
    const refuse = () => { throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit"); };
    const DB = { prepare() { const o = { bind() { return o; }, first: async () => refuse(), all: async () => refuse(), run: async () => refuse() }; return o; } };
    for (const p of ['/health', '/api/budget']) {
      const r = await mod.default.fetch(new Request('https://x' + p), { DB, AI: fakeAI() }, { waitUntil() {} });
      assert.equal(r.status, 503, p);
      assert.equal((await r.json()).code, 'd1_read_limit', p);
    }
  } finally { if (made) rmSync(cfg); }
});

test('HALT-1: the worker variable wins over the committed file, and a halted tick runs nothing but its beat', async () => {
  const { halted } = await import('../src/budget.js');
  assert.equal(halted({ halt: { halted: true } }, {}), true);
  assert.equal(halted({ halt: { halted: true } }, { HALT: '0' }), false, 'HALT=0 resumes without a deploy');
  assert.equal(halted({}, { HALT: '1' }), true);
  assert.equal(halted(null, {}), false);
  const { writeFileSync, existsSync, rmSync } = await import('node:fs');
  const cfg = new URL('../src/config.js', import.meta.url);
  const made = !existsSync(cfg);
  if (made) writeFileSync(cfg, 'export default ' + JSON.stringify({ org_slug: 'test' }) + ';\n');
  try {
    const mod = await import('../src/index.js');
    const sqls = [];
    const DB = { prepare(sql) { sqls.push(sql); const o = { bind() { return o; }, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }; return o; } };
    const ai = fakeAI(); const waits = [];
    await mod.default.scheduled({}, { DB, AI: ai, HALT: '1' }, { waitUntil(p) { waits.push(p); } });
    await Promise.allSettled(waits);
    assert.equal(ai.calls.length, 0, 'no model call');
    assert.ok(sqls.every(s => /loop_beats|loop_clock|ignition_log|CREATE (TABLE|INDEX)/i.test(s)), 'only the halted beat touches the database: ' + sqls.filter(s => !/loop_beats|loop_clock|ignition_log|CREATE/i.test(s)).join(' | ').slice(0, 300));
    const h = await mod.default.fetch(new Request('https://x/health'), { DB, AI: ai, HALT: '1' }, { waitUntil() {} });
    assert.equal((await h.json()).halted, true);
    const w = await mod.default.fetch(new Request('https://x/pulse/watch', { method: 'POST' }), { DB, AI: ai, HALT: '1' }, { waitUntil() {} });
    assert.equal(w.status, 202);
  } finally { if (made) rmSync(cfg); }
});

test('BUDGET-TUNE-1: a day that used 52% of the free neurons refuses nothing, and the tick share leaves room', () => {
  const a = allowance(budgetConfig({}, {}), NOW);
  const tick = Math.floor(a.ai_neurons_day * 0.7);
  assert.ok(tick > PRICES.ai_free_neurons_day * 0.6, 'the tick share covers 60% of the free neurons');
  assert.equal(decide(a, { ai_neurons_today: PRICES.ai_free_neurons_day * 0.52, ai_usd_month_to_date: 0 }).mode, 'normal');
  assert.equal(allowance(budgetConfig({ budget: { plan: 'paid' } }, {}), NOW).ai_neurons_day, Math.floor(PRICES.ai_free_neurons_day * 0.8));
});

import { accountAllowance, applySpend } from '../src/budget.js';
test('AI-GOV-ACCOUNT-1: with an account-wide reading the tick may use what the rest of the account left, not a fixed 70% share', () => {
  const full = { ai_neurons_day: 9500, variable_usd_month: 0 }, shared = { ...full, share: 0.7, ai_neurons_day: 6650 };
  assert.equal(accountAllowance(full, shared, 5000, NaN).ai_neurons_day, 6650, 'no reading: the fixed share');
  assert.equal(accountAllowance(full, shared, 5000, 5200).ai_neurons_day, 9300, 'others used 200: the tick gets 9300, past the old 6650 freeze at 52%');
  assert.equal(accountAllowance(full, shared, 0, 9600).ai_neurons_day, 0);
});
test('SPEND-SOFT-1: throttle and crawl hold model calls to the free allocation; crawl is lean', async () => {
  const a = { ai_neurons_day: 50000, variable_usd_month: 20 };
  assert.equal(applySpend(a, { level: 'ease', knobs: { ai: 'cheap-first' } }).a.ai_neurons_day, 50000);
  assert.equal(applySpend(a, { level: 'throttle', knobs: { ai: 'free-allocation' } }).a.ai_neurons_day, 9500);
  assert.equal(applySpend(a, { level: 'crawl', knobs: { ai: 'free-allocation-lean' } }).lean, true);
  const { db } = mkdb(); const ai = fakeAI();
  const g = await governedAI(db, ai, { config: { budget: { usd_per_month: 30, plan: 'paid' } }, now: NOW, spend: { level: 'crawl', measured: true, used: {}, knobs: { ai: 'free-allocation-lean' } } });
  assert.equal(g.state.mode, 'lean'); await g.ai.run('m', {}); await assert.rejects(() => g.ai.run('m', {}), BudgetExhausted);
});
