// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-09 requirements the seed meets in code, named by requirement and test id so the specification can cite them:
// R19/T12 (the graduated throttle), R16/T08 (one halt), R25/T13 (reply gate), R26/T10 (exact cache and shared calls),
// R21/T11 (retired model), R18 (metering bounds the next call), R05/T09 (a spent allowance trickles one call an hour),
// R23 (knob damping and burn-rate alerts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { level, BANDS } from '../src/spend.js';
import { decide, governedAI, allowance, budgetConfig, BudgetExhausted, halted, _resetForTests } from '../src/budget.js';
import { createRouter, ensure, replyProblem, RETIRE_MS } from '../src/airouter.js';
import { dampedCooldown, reversals, errorBudget } from '../src/control.js';

const d1 = () => { const db = new DatabaseSync(':memory:'); const w = s => ({ bind: (...a) => ({ run: async () => { const r = db.prepare(s).run(...a); return { meta: { changes: Number(r.changes) } }; }, first: async () => db.prepare(s).get(...a) || null, all: async () => ({ results: db.prepare(s).all(...a) }) }), run: async () => { db.exec(s); return {}; }, first: async () => db.prepare(s).get() || null, all: async () => ({ results: db.prepare(s).all() }) }); return { prepare: w, raw: db }; };
const DAY_START = new Date('2026-11-21T00:00:00.500Z'); // under two hours into the UTC day: the level reads today's spend as it stands
const at = share => level({ plan: 'paid', usd_today: share * 5, fixed_usd: 0.17 }, 5, DAY_START);

test('US-09-R19 US-09-T12: shares 0.3, 0.6, 0.8 and 1.2 of the soft target give full, ease, throttle and crawl with the knobs of section 3.1', () => {
  const got = [0.3, 0.6, 0.8, 1.2].map(s => { const l = at(s); return [l.level, l.knobs.pace, l.knobs.ai, l.knobs.wide_every_h, l.knobs.extra_every_h]; });
  assert.deepEqual(got, [['full', 1, 'any', 0, 0], ['ease', 1.5, 'cheap-first', 0, 0], ['throttle', 3, 'free-allocation', 1, 0], ['crawl', 6, 'free-allocation-lean', 6, 3]]);
  assert.deepEqual([0.499, 0.5, 0.699, 0.7, 0.899, 0.9].map(s => at(s).level), ['full', 'ease', 'ease', 'throttle', 'throttle', 'crawl'], 'the band edges are 0.5, 0.7 and 0.9');
});

test('US-09-R19: no level stops the clock, the queue, the merge lane or deploys, and the level springs back when use falls', async () => {
  assert.ok(BANDS.every(b => b.pace > 0 && Number.isFinite(b.pace) && b.level !== 'stop'), 'every band only slows');
  assert.equal(at(1.2).level, 'crawl');
  assert.equal(at(0.1).level, 'full', 'the same reading one tick later with less use is full speed again: no latch');
  const crawl = decide({ ai_neurons_day: 1000, variable_usd_month: 0 }, { ai_neurons_today: 5000, ai_usd_month_to_date: 0 });
  assert.deepEqual([crawl.mode, crawl.calls_per_tick, crawl.hourly], ['crawl', 1, true], 'crawl still advances: one model call, never zero');
});

test('US-09-R16 US-09-T08: HALT=1 stops the cron but its beat, answers /pulse/watch with 202 and reports halted; HALT=0 resumes with no deploy', async () => {
  assert.deepEqual([halted({ halt: { halted: true } }, {}), halted({ halt: { halted: true } }, { HALT: '0' }), halted({}, { HALT: '1' }), halted({}, { HALT: 'on' }), halted(null, {})], [true, false, true, true, false], 'the worker variable beats the committed file and 0 resumes');
  const cfg = new URL('../src/config.js', import.meta.url), made = !existsSync(cfg);
  if (made) writeFileSync(cfg, 'export default ' + JSON.stringify({ org_slug: 'test' }) + ';\n');
  try {
    const mod = await import('../src/index.js');
    const sqls = [], calls = [];
    const DB = { prepare(sql) { sqls.push(sql); const o = { bind() { return o; }, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }; return o; } };
    const AI = { run: async () => { calls.push(1); return { response: 'x' }; } }, waits = [];
    await mod.default.scheduled({}, { DB, AI, HALT: '1' }, { waitUntil(p) { waits.push(p); } });
    await Promise.allSettled(waits);
    assert.equal(calls.length, 0, 'no model call');
    assert.ok(sqls.every(s => /loop_beats|loop_clock|ignition_log|CREATE (TABLE|INDEX)/i.test(s)), 'only the beat of the halted tick touches the database');
    const health = await mod.default.fetch(new Request('https://x/health'), { DB, AI, HALT: '1' }, { waitUntil() {} });
    assert.equal((await health.json()).halted, true, 'pages keep serving and say halted');
    const watch = await mod.default.fetch(new Request('https://x/pulse/watch', { method: 'POST' }), { DB, AI, HALT: '1' }, { waitUntil() {} });
    assert.equal(watch.status, 202);
    for (const p of ['/hook/github', '/hook/host', '/hook/cloudflare']) assert.equal((await mod.default.fetch(new Request('https://x' + p, { method: 'POST' }), { DB, AI, HALT: '1' }, { waitUntil() {} })).status, 202, p + ' is held by the same halt');
  } finally { if (made) rmSync(cfg); }
});

test('US-09-R25 US-09-T13: an empty, a truncated and a repeated answer are each rejected before use and counted against that model for that kind', async () => {
  const db = d1(); await ensure(db);
  const replies = { empty: { response: '' }, cut: { choices: [{ message: { content: 'half an ans' }, finish_reason: 'length' }] }, rep: { response: 'Same sentence again and again. '.repeat(8) } };
  const ai = { run: async model => replies[model] };
  const r = createRouter({ db, ai, models: [{ id: 'e', model: 'empty', tier: 'free' }, { id: 'c', model: 'cut', tier: 'free' }, { id: 'r', model: 'rep', tier: 'free' }] });
  await assert.rejects(() => r.call({ kind: 'summary', prompt: 'p', cache: false }), /no model passed \(e: empty reply \(keys: response\); c: cut off at max_tokens; r: repeated text\)/);
  const stats = db.raw.prepare(`SELECT kind, model, calls, passes FROM airouter_stats ORDER BY model`).all().map(x => ({ ...x }));
  assert.deepEqual(stats, [{ kind: 'summary', model: 'cut', calls: 1, passes: 0 }, { kind: 'summary', model: 'empty', calls: 1, passes: 0 }, { kind: 'summary', model: 'rep', calls: 1, passes: 0 }]);
  assert.equal(replyProblem({}, 'fine'), null);
  assert.equal(replyProblem({}, Array(12).fill('same line').join('\n')), 'repeated lines');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM airouter_cache`).get().n, 0, 'a rejected answer is never cached');
});

test('US-09-R26 US-09-T10: an identical call inside the time to live is one model call with no spend, and concurrent identical calls share one call', async () => {
  const db = d1(); await ensure(db);
  let t = Date.parse('2026-11-26T12:00:00Z'), n = 0, release;
  const gate = new Promise(res => { release = res; });
  const ai = { run: async () => { n++; await gate; return { response: 'the answer', usage: { prompt_tokens: 10, completion_tokens: 5 } }; } };
  const r = createRouter({ db, ai, now: () => t, models: [{ id: 'm', model: 'm', tier: 'free' }] });
  const both = Promise.all([r.call({ kind: 'k', prompt: 'same' }), r.call({ kind: 'k', prompt: 'same' })]);
  release();
  const [a, b] = await both;
  assert.deepEqual([n, a.text, b.text], [1, 'the answer', 'the answer'], 'two at once, one call');
  const again = await r.call({ kind: 'k', prompt: 'same' });
  assert.deepEqual([n, again.cached, again.usd, again.neurons], [1, true, 0, 0], 'twice in a row, one call and nothing spent');
  t += 7 * 3600e3;
  assert.equal((await r.call({ kind: 'k', prompt: 'same' })).cached, false, 'past the 6 hour time to live it is a miss');
  assert.equal(n, 2);
  assert.equal((await r.call({ kind: 'other-kind', prompt: 'same' })).cached, false, 'the key covers the kind');
});

test('US-09-R21 US-09-T11: HTTP 410 or a deprecation error retires the model for seven days, the next rung serves and the failed call is charged nothing', async () => {
  const db = d1(); await ensure(db);
  let t = Date.parse('2026-11-20T12:00:00Z'); const seen = [];
  const ai = { run: async model => { seen.push(model); if (model === 'gone') throw new Error('410: gone was deprecated on 2026-11-20'); return { response: 'answer' }; } };
  const r = createRouter({ db, ai, now: () => t, models: [{ id: 'a', model: 'gone', tier: 'free' }, { id: 'b', model: 'live', tier: 'free' }] });
  assert.equal((await r.call({ kind: 'k', prompt: 'one ' + 'x'.repeat(2000), cache: false })).model, 'live');
  assert.equal(db.raw.prepare(`SELECT neurons FROM airouter_calls WHERE model='gone'`).get().neurons, 0, 'a call that never ran costs nothing');
  seen.length = 0; await r.call({ kind: 'k', prompt: 'two', cache: false });
  assert.deepEqual(seen, ['live'], 'skipped inside the window');
  t += RETIRE_MS - 1000; seen.length = 0; await r.call({ kind: 'k', prompt: 'three', cache: false });
  assert.deepEqual(seen, ['live'], 'still skipped just before seven days');
  t += 2000; seen.length = 0; await r.call({ kind: 'k', prompt: 'four', cache: false });
  assert.equal(seen[0], 'gone', 'probed again after the window');
  assert.equal(RETIRE_MS, 7 * 864e5);
});

test('US-09-R18: every model call is metered into the ledger before the next call is decided, and the metering bounds the next call', async () => {
  _resetForTests();
  const db = d1(), now = Date.parse('2026-11-26T12:00:00Z');
  const ai = { run: async () => ({ response: 'ok', usage: { prompt_tokens: 20000, completion_tokens: 40000 } }) };
  const { ai: gov, state } = await governedAI(db, ai, { config: {}, env: {}, now, share: 0.7 });
  assert.equal(state.mode, 'normal');
  await gov.run('@cf/test/model', {});
  const used = db.raw.prepare(`SELECT units, calls FROM budget_ledger WHERE kind='ai_neurons'`).get();
  assert.equal(used.calls, 1);
  assert.ok(used.units >= allowance(budgetConfig({}, {}), now).ai_neurons_day * 0.7, 'one large call spent the whole tick share, recorded before anything else ran');
  await assert.rejects(() => gov.run('@cf/test/model', {}), e => e instanceof BudgetExhausted && /allowance is used/.test(e.message), 'the next call is refused on that metering');
  assert.equal(db.raw.prepare(`SELECT refused FROM budget_ledger WHERE kind='ai_neurons'`).get().refused, 1, 'the refusal is in the ledger too');
});

test('US-09-R05 US-09-T09: a spent day allowance leaves one model call per hour; the second call in that hour is refused and the refusal lands in the ledger', async () => {
  _resetForTests();
  const db = d1(), now = Date.parse('2026-11-26T12:20:00Z'), calls = [];
  const ai = { run: async () => { calls.push(1); return { response: 'ok', usage: { prompt_tokens: 20000, completion_tokens: 40000 } }; } };
  const cfg = { config: { budget: { usd_per_month: 0 } }, env: {} };
  const day = await governedAI(db, ai, { ...cfg, now });
  for (let i = 0; i < 50; i++) { try { await day.ai.run('@cf/test/model', {}); } catch (e) { if (e instanceof BudgetExhausted) break; throw e; } }
  const spent = (await governedAI(db, ai, { ...cfg, now: now + 60e3 }));
  assert.equal(spent.state.mode, 'crawl', 'the allowance is used: crawl, never a freeze');
  const before = calls.length, refusedBefore = db.raw.prepare(`SELECT refused FROM budget_ledger WHERE kind='ai_neurons'`).get().refused;
  await spent.ai.run('@cf/test/model', {});
  const other = await governedAI(db, ai, { ...cfg, now: now + 120e3 }); // a second call in the same hour, from another surface
  await assert.rejects(() => other.ai.run('@cf/test/model', {}), BudgetExhausted, 'the hour has one call, shared by every caller');
  assert.equal(calls.length - before, 1, 'one model call in the hour');
  assert.equal(db.raw.prepare(`SELECT refused FROM budget_ledger WHERE kind='ai_neurons'`).get().refused, refusedBefore + 1, 'the refusal is counted in the ledger');
});

test('US-09-R23: a knob that reverses waits longer, each further reversal doubles its cooldown up to 16 times the base, and a burn-rate alert fires before the budget is spent', () => {
  const mv = (...d) => d.map((s, i) => ({ at: i + 1, old: 5, new: 5 + s }));
  assert.equal(reversals(mv(1, 1, 1)), 0);
  assert.deepEqual(dampedCooldown(6, mv(1, -1)), { reversals: 1, cooldown_h: 6, damped: false }, 'one reversal is tolerated: the base cooldown stands');
  assert.deepEqual(dampedCooldown(6, mv(1, -1, 1)), { reversals: 2, cooldown_h: 12, damped: true }, 'the second reversal doubles it');
  assert.equal(dampedCooldown(6, mv(1, -1, 1, -1)).cooldown_h, 24);
  assert.equal(dampedCooldown(6, mv(1, -1, 1, -1, 1, -1, 1, -1, 1, -1), { window: 10 }).cooldown_h, 96, 'capped at 16 times the base');
  const now = Date.parse('2026-11-26T12:00:00Z'), five = 5 * 60e3, samples = [];
  for (let i = 8640; i > 12; i--) samples.push({ at: now - i * five, ok: true });
  for (let i = 12; i >= 0; i--) samples.push({ at: now - i * five, ok: false });
  const eb = errorBudget(samples, 0.99, { now });
  assert.ok(eb.alerts.some(a => a.severity === 'page') && eb.budget_remaining > 0, 'the page fires while budget remains');
  assert.equal(errorBudget(samples.filter(s => s.ok), 0.99, { now }).alerts.length, 0);
});
