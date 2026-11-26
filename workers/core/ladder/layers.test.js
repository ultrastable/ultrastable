// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The ladder layers around the cascade (US-SPEC-09 section 4): L0 handlers, L1 cache, L4 free-only ensemble, L5 exemplar bank,
// L7 budget scheduler with the degradation order and queue, cascade fall-through, scheduled canaries and shadow answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as L from './index.js';
import { createL0, ensembleSample, budgetScheduler, queueNextWindow, reofferQueued } from './layers.js';
import { cacheGet, cachePut, cacheHitRate, stablePrefix, toolCallValidity, cacheKey } from './cache.js';
import { recordExemplar, nearest, serve, fewShot, exemplarCount } from './exemplars.js';
import { canaryRun, shadowRun } from './schedule.js';

const MIG = fileURLToPath(L.MIGRATIONS_DIR);
const NOW = Date.UTC(2026, 10, 26, 10, 0, 0), H = 3600000;
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);
const good = async () => ({ tool_calls: true, schema: true });
async function ladder(db, specs = [['m-free', 0, 0], ['m-cheap', 1, 0.002], ['m-frontier', 2, 0.02]], cls = 'triage') {
  for (const [model, rung, unit_cost] of specs) await L.admit(db, { model, task_class: cls, rung, unit_cost, need: { tool_calls: true }, canary: good }, { now: NOW });
}
// A deterministic embedder: a vector over a fixed vocabulary, so cosine similarity is a function of shared words.
const VOCAB = ['reset', 'password', 'invoice', 'refund', 'login', 'shipping', 'address'];
const embed = async texts => texts.map(t => VOCAB.map(w => (String(t).toLowerCase().includes(w) ? 1 : 0) + 0.001));

// ---- L0 ----

test('US-09 L0: a deterministic handler answers with cost 0 and no model call, and is counted as a verified outcome', async () => {
  const db = makeDb([MIG]), l0 = createL0(db, { now: () => NOW });
  l0.register('status', input => (/^ping/.test(input) ? { output: 'pong' } : undefined));
  const a = await l0.answer({ task_id: 'S1', task_class: 'status', input: 'ping now' });
  assert.deepEqual([a.answered, a.layer, a.output, a.cost], [true, 'L0', 'pong', 0]);
  assert.deepEqual({ ...one(db, `SELECT layer, model, cost, verified FROM ladder_attempts WHERE task_id='S1'`) }, { layer: 'L0', model: null, cost: 0, verified: 1 });
  assert.equal((await l0.answer({ task_id: 'S2', task_class: 'status', input: 'something else' })).answered, false, 'a handler that cannot answer passes the task on');
  assert.equal((await l0.answer({ task_id: 'S3', task_class: 'unknown', input: 'x' })).answered, false);
  l0.register('boom', () => { throw new Error('bad regex'); });
  assert.match((await l0.answer({ task_id: 'S4', task_class: 'boom', input: 'x' })).error, /bad regex/);
  assert.equal(one(db, `SELECT spend FROM ladder_v_cost_per_task WHERE task_class='status'`).spend, 0);
});

// ---- L1 ----

test('US-09 L1: an identical prompt within the TTL is an exact hit and saves its cost; past the TTL it is a miss', async () => {
  const db = makeDb([MIG]), t = { at: NOW }, ctx = { db, now: () => t.at };
  await cachePut(ctx, { task_class: 'faq', input: 'How do I  reset my password?', value: 'Use the reset link.', cost: 0.01 });
  const h = await cacheGet(ctx, { task_class: 'faq', input: 'How do I reset my password?' });
  assert.deepEqual([h.hit, h.value, h.saved_cost], ['exact', 'Use the reset link.', 0.01]);
  assert.equal(await cacheKey('a  b'), await cacheKey('a b'), 'whitespace does not make a new key');
  t.at += 7 * H; // the default TTL is 6 hours
  assert.equal((await cacheGet(ctx, { task_class: 'faq', input: 'How do I  reset my password?' })).hit, null);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM ladder_cache`).n, 0, 'an expired entry is removed');
});

test('US-09 L1: an entry whose source hash changed is a miss and is removed', async () => {
  const db = makeDb([MIG]), ctx = { db, now: () => NOW };
  await cachePut(ctx, { task_class: 'faq', input: 'q', value: 'a', source_hash: 'v1' });
  assert.equal((await cacheGet(ctx, { task_class: 'faq', input: 'q', source_hash: 'v1' })).hit, 'exact');
  assert.equal((await cacheGet(ctx, { task_class: 'faq', input: 'q', source_hash: 'v2' })).hit, null);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM ladder_cache`).n, 0);
  assert.deepEqual(rows(db, `SELECT kind FROM ladder_cache_events ORDER BY id`).map(r => r.kind), ['exact', 'invalidated', 'miss']);
});

test('US-09 L1: a prompt above the cosine threshold is a semantic hit, below it a miss', async () => {
  const db = makeDb([MIG]), ctx = { db, now: () => NOW, embed };
  await cachePut(ctx, { task_class: 'faq', input: 'reset password login', value: 'reset link' });
  const near = await cacheGet(ctx, { task_class: 'faq', input: 'login password reset' });
  assert.deepEqual([near.hit, near.value], ['semantic', 'reset link']);
  assert.ok(near.similarity >= 0.95);
  assert.equal((await cacheGet(ctx, { task_class: 'faq', input: 'invoice refund shipping address' })).hit, null);
  assert.equal((await cacheGet({ db, now: () => NOW }, { task_class: 'faq', input: 'login password reset' })).hit, null, 'without an embedder only the exact lookup runs');
  assert.equal((await cacheGet(ctx, { task_class: 'other', input: 'login password reset' })).hit, null, 'classes do not share entries');
});

test('US-09 L1: stablePrefix returns the same hash for calls that differ only in the tail', () => {
  const sys = { role: 'system', content: 'You answer support questions.' }, ctxm = { role: 'user', content: 'Policy: refunds within 30 days.' };
  const a = stablePrefix([sys, ctxm, { role: 'user', content: 'q1' }]), b = stablePrefix([sys, ctxm, { role: 'user', content: 'a different q' }]);
  assert.equal(a.prefix_hash, b.prefix_hash);
  assert.ok(a.prefix_chars > 40);
  assert.notEqual(a.prefix_hash, stablePrefix([{ ...sys, content: 'changed' }, ctxm, { role: 'user', content: 'q1' }]).prefix_hash);
});

test('US-09-R10: cache hit rate and tool-call validity rate are computed per task class', async () => {
  const db = makeDb([MIG]), ctx = { db, now: () => NOW };
  await cachePut(ctx, { task_class: 'faq', input: 'q', value: 'a', cost: 0.5 });
  for (const i of [1, 2, 3]) await cacheGet(ctx, { task_class: 'faq', input: i === 3 ? 'new' : 'q' });
  const r = await cacheHitRate(db, 'faq');
  assert.deepEqual([r.lookups, r.exact, r.miss, r.saved_cost], [3, 2, 1, 1]);
  assert.ok(Math.abs(r.hit_rate - 2 / 3) < 1e-9);
  assert.equal((await cacheHitRate(db, 'none')).hit_rate, null, 'no lookups is unmeasured, not zero');
  await ladder(db);
  for (const [id, sig] of [['T1', null], ['T2', 'tool_call_parse'], ['T3', null], ['T4', 'schema']]) {
    db.raw.prepare(`INSERT INTO ladder_attempts (task_id, task_class, layer, verified, signal, at) VALUES (?, 'triage', 'cascade', ?, ?, '2026-11-26 10:00:00')`).run(id, sig ? 0 : 1, sig);
  }
  const v = await toolCallValidity(db, 'triage');
  assert.deepEqual([v.attempts, v.parse_failures, v.tool_call_validity_rate], [4, 1, 0.75]);
});

// ---- L4 ----

test('US-09 L4: the ensemble samples only free or cached components and refuses otherwise', async () => {
  const db = makeDb([MIG]);
  const comps = [{ model: 'free-a', unit_cost: 0 }, { model: 'free-b', unit_cost: 0 }, { model: 'cached-c', unit_cost: 0.01, cached: true }];
  const answers = { 'free-a': 'yes', 'free-b': 'no', 'cached-c': 'yes' };
  const r = await ensembleSample(db, { task_id: 'E1', task_class: 'vote', components: comps, n: 3, run: async c => ({ output: answers[c.model] }), validate: o => ({ ok: o === 'yes' || o === 'no' }) }, { now: NOW });
  assert.deepEqual([r.ok, r.output, r.valid], [true, 'yes', 3]);
  assert.ok(Math.abs(r.agreement - 2 / 3) < 1e-9);
  assert.equal(rows(db, `SELECT * FROM ladder_attempts WHERE layer='L4'`).length, 3);
  assert.ok(rows(db, `SELECT cost FROM ladder_attempts WHERE layer='L4'`).every(x => x.cost === 0));
  let ran = 0;
  const paid = await ensembleSample(db, { task_id: 'E2', task_class: 'vote', components: [...comps, { model: 'paid', unit_cost: 0.02 }], n: 4, run: async () => { ran++; return { output: 'yes' }; }, validate: () => ({ ok: true }) }, { now: NOW });
  assert.deepEqual([paid.ok, paid.refusal, ran], [false, 'ensemble_not_free', 0]);
  const none = await ensembleSample(db, { task_id: 'E3', task_class: 'vote', components: comps, n: 2, run: async () => { throw new Error('x'); }, validate: () => ({ ok: true }) }, { now: NOW });
  assert.equal(none.refusal, 'no_valid_answer');
});

// ---- L7 ----

test('US-09 L7: the scheduler steps cache, free, cheaper, queue in the spec order as a class cap and then the organization ceiling are breached', async () => {
  const db = makeDb([MIG]);
  const spend = (cls, usd) => db.raw.prepare(`INSERT INTO ladder_attempts (task_id, task_class, layer, cost, verified, at) VALUES (?,?,?,?,1,'2026-11-26 09:00:00')`).run('x' + Math.random(), cls, 'cascade', usd);
  const cfg = { classes: { triage: { daily_usd: 1 } }, org_daily_usd: 5 };
  const ask = available => budgetScheduler({ db, now: () => NOW, config: cfg, task_class: 'triage', available });
  assert.deepEqual([(await ask({})).capBreached, (await ask({})).degrade], [false, null]);
  spend('triage', 1.5);
  const all3 = await ask({ cache: true, free: true, cheaper: true });
  assert.deepEqual([all3.capBreached, all3.scope, all3.degrade], [true, 'class', 'cache']);
  assert.equal((await ask({ free: true, cheaper: true })).degrade, 'free');
  assert.equal((await ask({ cheaper: true })).degrade, 'cheaper');
  const q = await ask({});
  assert.deepEqual([q.degrade, q.queue_until], ['queue', '2026-11-27 00:00:00']);
  assert.equal((await budgetScheduler({ db, now: () => NOW, config: cfg, task_class: 'other', available: {} })).capBreached, false, 'another class is not breached by this class spend');
  spend('other', 4);
  const org = await budgetScheduler({ db, now: () => NOW, config: cfg, task_class: 'other', available: {} });
  assert.deepEqual([org.capBreached, org.scope], [true, 'org']);
  assert.equal((await budgetScheduler({ db, now: () => NOW + 24 * H, config: cfg, task_class: 'triage', available: {} })).capBreached, false, 'the next day starts clean');
});

test('US-09 L7: a queued task is re-offered when its window opens, once', async () => {
  const db = makeDb([MIG]);
  await ladder(db, [['m-paid', 1, 0.02]]);
  let spent = false;
  const scheduler = async () => ({ capBreached: true, queue_until: '2026-11-27 00:00:00' });
  const r = await L.cascade(db, { task_id: 'Q1', task_class: 'triage', run: async () => { spent = true; return { output: 'x' }; }, validate: () => ({ ok: true }), scheduler, payload: { text: 'hello' },
    onQueue: p => queueNextWindow(db, p, { now: NOW }) }, { now: NOW });
  assert.deepEqual([r.ok, r.refusal, r.queued, r.queue_until, spent], [false, 'cap_breached_no_free_rung', true, '2026-11-27 00:00:00', false]);
  assert.deepEqual(await reofferQueued(db, { now: NOW + 5 * H }), []);
  const back = await reofferQueued(db, { now: NOW + 15 * H });
  assert.deepEqual(back.map(b => [b.task_id, b.payload]), [['Q1', { text: 'hello' }]]);
  assert.deepEqual(await reofferQueued(db, { now: NOW + 16 * H }), []);
});

test('US-09-R07 with a scheduler that reports a breach the cascade serves the free rung and never ends the task', async () => {
  const db = makeDb([MIG]); await ladder(db);
  const r = await L.cascade(db, { task_id: 'Q2', task_class: 'triage', run: async row => ({ output: row.model }), validate: () => ({ ok: true }), scheduler: async () => ({ capBreached: true }) }, { now: NOW });
  assert.deepEqual([r.ok, r.model, r.steered], [true, 'm-free', true]);
});

// ---- cascade fall-through ----

test('US-09-R09: a dead transport rung falls through to the next rung without spending an escalation attempt, and the loop still terminates', async () => {
  const db = makeDb([MIG]); await ladder(db, [['m-free', 0, 0], ['m-free2', 0, 0], ['m-cheap', 1, 0.002], ['m-frontier', 2, 0.02]]);
  const calls = [];
  const dead = new Set(['m-free', 'm-free2', 'm-cheap']);
  const r = await L.cascade(db, { task_id: 'F1', task_class: 'triage', maxRetries: 0, run: async row => { calls.push(row.model); if (dead.has(row.model)) throw new Error('503'); return { output: 'fine' }; }, validate: () => ({ ok: true }) }, { now: NOW });
  assert.deepEqual([r.ok, r.model, r.attempts], [true, 'm-frontier', 1], 'three dead transports, still within maxRetries 0');
  assert.deepEqual(calls, ['m-free', 'm-free2', 'm-cheap', 'm-frontier'], 'each row is tried at most once');
  assert.deepEqual(rows(db, `SELECT model, signal, cost FROM ladder_attempts WHERE task_id='F1' ORDER BY id`).map(a => [a.model, a.signal, a.cost]), [['m-free', 'provider_error', 0], ['m-free2', 'provider_error', 0], ['m-cheap', 'provider_error', 0], ['m-frontier', null, 0.02]]);
  const all = await L.cascade(db, { task_id: 'F2', task_class: 'triage', run: async () => { throw new Error('down'); }, validate: () => ({ ok: true }) }, { now: NOW });
  assert.deepEqual([all.ok, all.refusal, all.attempts], [false, 'failed', 0]);
  assert.equal(one(db, `SELECT status FROM items WHERE id='TASKFAIL-F2'`).status, 'ready');
  const measured = await L.cascade(db, { task_id: 'F3', task_class: 'triage', maxRetries: 1, run: async row => ({ output: row.model }), validate: () => ({ ok: false, signal: 'schema' }) }, { now: NOW });
  assert.equal(measured.attempts, 2, 'a measured failure still spends the attempt');
});

// ---- scheduled canaries and shadow answers ----

test('canaryRun probes only matrix rows older than the interval and records the result; two failed scheduled canaries demote the row', async () => {
  const db = makeDb([MIG]); await ladder(db, [['m-a', 1, 0.002]]);
  const seen = [];
  const t0 = NOW + 25 * H;
  const r1 = await canaryRun({ db, now: () => t0, every_h: 24, canary: async (m, c) => { seen.push([m, c]); return { tool_calls: false, schema: true }; } });
  assert.deepEqual([r1.ran, seen], [1, [['m-a', 'triage']]]);
  assert.equal((await canaryRun({ db, now: () => t0 + H, every_h: 24, canary: async () => ({ tool_calls: false }) })).ran, 0, 'probed an hour ago: not due');
  await canaryRun({ db, now: () => t0 + 26 * H, every_h: 24, canary: async () => ({ tool_calls: false, schema: true }) });
  assert.deepEqual(rows(db, `SELECT passed FROM ladder_canary_runs WHERE passed=0`).length >= 2, true);
  const s = await L.step({ db, now: t0 + 27 * H });
  assert.equal(s.demoted, 1);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM ladder_model_task_matrix`).n, 0);
});

test('a missing canary port is reported in the notes and a throwing port is recorded, not counted as a failed canary', async () => {
  const db = makeDb([MIG]); await ladder(db, [['m-a', 1, 0.002]]);
  assert.match((await canaryRun({ db, now: () => NOW + 30 * H })).notes[0], /no canary port/);
  const e = await canaryRun({ db, now: () => NOW + 30 * H, canary: async () => { throw new Error('provider down'); } });
  assert.deepEqual([e.ran, e.errors.length], [0, 1]);
  assert.equal(one(db, `SELECT status FROM items WHERE id='LADDER-CANARY-PORT'`).status, 'ready');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM ladder_canary_runs WHERE passed=0`).n, 0, 'an unreachable provider is not a failing model');
  const s = await L.step({ db, now: NOW + 31 * H, config: { canary_every_h: 24 } });
  assert.ok(s.notes.some(n => /no canary port/.test(n)));
});

test('shadowRun samples about 5% of decisions, once each, and feeds the rolling agreement', async () => {
  const db = makeDb([MIG]); await ladder(db, [['m-a', 1, 0.002]]);
  const decisions = Array.from({ length: 2000 }, (_, i) => ({ ref: `d${i}`, task_class: 'triage', model: 'm-a' }));
  const asked = [];
  const ports = { decisions: async () => decisions, label: async d => { asked.push(d.ref); return 'A'; }, answer: async (m, d) => (Number(d.ref.slice(1)) % 4 === 0 ? 'B' : 'A') };
  const r = await shadowRun({ db, now: () => NOW, rate: 0.05, max: 1000, ...ports });
  assert.ok(r.sampled > 40 && r.sampled < 180, `sampled ${r.sampled}`);
  assert.equal((await shadowRun({ db, now: () => NOW, rate: 0.05, max: 1000, ...ports })).sampled, 0, 'a decision is sampled once');
  const roll = await L.rollingAgreement(db, { model: 'm-a', task_class: 'triage' });
  assert.equal(roll.n, Math.min(200, r.sampled));
  assert.ok(roll.agreement > 0.6 && roll.agreement < 0.9);
  assert.match((await shadowRun({ db, now: () => NOW })).notes[0], /no answer, label or decisions port/);
  const err = await shadowRun({ db, now: () => NOW, rate: 1, decisions: async () => [{ ref: 'zz', task_class: 'triage', model: 'm-a' }], label: async () => { throw new Error('label store down'); }, answer: async () => 'A' });
  assert.equal(err.errors.length, 1);
});

// ---- L5 exemplar bank ----

test('US-09 L5: only a verified outcome becomes an exemplar and a secret-looking input is refused', async () => {
  const db = makeDb([MIG]), ctx = { db, now: () => NOW, embed };
  assert.equal((await recordExemplar(ctx, { task_class: 'faq', input: 'reset password', output: 'link', verified: false })).stored, false);
  assert.equal((await recordExemplar(ctx, { task_class: 'faq', input: 'my token: sk-abcdefghijkl1234', output: 'ok', verified: true })).stored, false);
  assert.equal((await recordExemplar(ctx, { task_class: 'faq', input: 'reset password login', output: 'Use the reset link.', verified: true })).stored, true);
  assert.equal(await exemplarCount(db, 'faq'), 1);
});

test('US-09 L5: serve returns an exemplar above the similarity threshold only when validation passes and records an L5 attempt with cost 0', async () => {
  const db = makeDb([MIG]), ctx = { db, now: () => NOW, embed };
  await recordExemplar(ctx, { task_class: 'faq', input: 'reset password login', output: 'Use the reset link.', verified: true });
  const s = await serve(ctx, { task_id: 'X1', task_class: 'faq', input: 'login password reset' });
  assert.deepEqual([s.served, s.output, s.cost], [true, 'Use the reset link.', 0]);
  assert.deepEqual({ ...one(db, `SELECT layer, cost, verified FROM ladder_attempts WHERE task_id='X1'`) }, { layer: 'L5', cost: 0, verified: 1 });
  assert.deepEqual([(await serve(ctx, { task_id: 'X2', task_class: 'faq', input: 'invoice refund' })).reason], ['below_threshold']);
  assert.equal((await serve(ctx, { task_id: 'X3', task_class: 'faq', input: 'login password reset', validate: () => false })).reason, 'validation_failed');
  assert.equal((await serve(ctx, { task_id: 'X4', task_class: 'empty', input: 'x' })).reason, 'empty_bank');
  assert.equal(rows(db, `SELECT * FROM ladder_attempts WHERE task_id IN ('X2','X3','X4')`).length, 0, 'a miss records no attempt');
});

test('US-09 L5: few-shot retrieval returns the nearest exemplars per class, lexically without an embedder, and retention keeps the newest', async () => {
  const db = makeDb([MIG]), t = { at: NOW }, ctx = { db, now: () => t.at, per_class: 3 };
  for (const [i, text] of ['reset password', 'refund invoice', 'shipping address', 'login problem', 'password reset login'].entries()) { t.at = NOW + i * 1000; await recordExemplar(ctx, { task_class: 'faq', input: text, output: 'out ' + i, verified: true }); }
  assert.equal(await exemplarCount(db, 'faq'), 3, 'retention keeps the newest 3');
  const shots = await fewShot(ctx, { task_class: 'faq', input: 'password reset login' , k: 2 });
  assert.equal(shots[0].input, 'password reset login');
  assert.equal(shots.length, 2);
  assert.deepEqual((await nearest(ctx, { task_class: 'faq', input: 'x', k: 1 })).length, 1);
});
