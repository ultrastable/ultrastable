// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-09 steps 2318 and 2320: the router-backed canary and shadow-answer ports run through canaryRun and shadowRun. The provider
// is a fake fetch; no network, no key of any kind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createRouter } from '../router/router.js';
import * as L from './index.js';
import { canaryRun, shadowRun } from './schedule.js';
import { createRouterCanary, createRouterAnswer } from './router-ports.js';

const MIGS = [L.MIGRATIONS_DIR, new URL('../router/migrations/', import.meta.url)].map(u => fileURLToPath(u));
const CONFIG = JSON.parse(readFileSync(new URL('../router/example-config.json', import.meta.url), 'utf8'));
const NOW = Date.UTC(2026, 10, 26, 10, 0, 0), H = 3600000;
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

function mk({ reply = () => ({ text: '{"ok":true}', tool_calls: [] }) } = {}) {
  const db = makeDb(MIGS), seen = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body), r = reply(body); seen.push({ url, model: body.model, tools: body.tools });
    if (r instanceof Response) return r;
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content: r.text, tool_calls: r.tool_calls } }], usage: { prompt_tokens: 5, completion_tokens: 3 } }), { status: 200 });
  };
  const router = createRouter({ db, fetch, now: () => NOW, config: CONFIG, env: { PROVIDER_A_API_KEY: 'k-a', PROVIDER_B_API_KEY: 'k-b' } });
  return { db, router, seen };
}
const tools = [{ type: 'function', function: { name: 'ping', parameters: { type: 'object', properties: {} } } }];

test('US-09-R08 a scheduled canary through the router pins the model asked for, records tool-call and schema results and files no item', async () => {
  const { db, router, seen } = mk({ reply: () => ({ text: '{"ok":true}', tool_calls: [{ id: '1', function: { name: 'ping', arguments: '{}' } }] }) });
  await L.admit(db, { model: 'a-medium', task_class: 'triage', rung: 1, unit_cost: 0.01, need: { tool_calls: true }, canary: async () => ({ tool_calls: true, schema: true }) }, { now: NOW });
  const canary = createRouterCanary({ router, config: CONFIG, canaries: { triage: { messages: [{ role: 'user', content: 'call ping' }], tools, json: true } } });
  const r = await canaryRun({ db, now: () => NOW + 30 * H, every_h: 24, canary });
  assert.deepEqual([r.ran, r.errors.length], [1, 0]);
  assert.deepEqual(seen.map(s => s.model), ['a-medium'], 'the model asked for served it, no other candidate was tried');
  assert.deepEqual({ ...one(db, `SELECT tool_calls, schema_ok, passed FROM ladder_canary_runs ORDER BY id DESC LIMIT 1`) }, { tool_calls: 1, schema_ok: 1, passed: 1 });
  assert.equal(one(db, `SELECT kind FROM router_calls ORDER BY id DESC LIMIT 1`).kind, 'canary', 'probe traffic is marked as such');
});

test('US-09-R08 a model that answers without a tool call fails its tool canary; twice in a row demotes it', async () => {
  const { db, router } = mk({ reply: () => ({ text: 'no tools here', tool_calls: [] }) });
  await L.admit(db, { model: 'a-medium', task_class: 'triage', rung: 1, unit_cost: 0.01, need: { tool_calls: true }, canary: async () => ({ tool_calls: true, schema: true }) }, { now: NOW });
  const canary = createRouterCanary({ router, config: CONFIG, canaries: { '*': { messages: [{ role: 'user', content: 'x' }], tools } } });
  await canaryRun({ db, now: () => NOW + 30 * H, every_h: 24, canary });
  await canaryRun({ db, now: () => NOW + 60 * H, every_h: 24, canary });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM ladder_canary_runs WHERE passed = 0`).n, 2);
  assert.equal((await L.monitor(db, { now: NOW + 61 * H })).length, 1, 'the demotion step removes the row');
});

test('US-09-R09 an unreachable provider, a refused call and a successor answering are errors on the port, never a failed canary', async () => {
  const { db, router } = mk({ reply: () => new Response('down', { status: 503 }) });
  await L.admit(db, { model: 'a-medium', task_class: 'triage', rung: 1, unit_cost: 0.01, canary: async () => ({ tool_calls: true, schema: true }) }, { now: NOW });
  const canary = createRouterCanary({ router, config: CONFIG, canaries: { '*': { messages: [{ role: 'user', content: 'x' }], json: true } } });
  const r = await canaryRun({ db, now: () => NOW + 30 * H, every_h: 24, canary });
  assert.deepEqual([r.ran, r.errors.length], [0, 1]);
  assert.match(r.errors[0].error, /refused the call \(all_providers_failed: http 503/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM ladder_canary_runs WHERE at > ?`, '2026-11-26 11:00:00').n, 0, 'nothing counted against the model');
  assert.equal(one(db, `SELECT status FROM items WHERE id='LADDER-CANARY-PORT'`).status, 'ready');
  await assert.rejects(() => createRouterCanary({ router, config: CONFIG })('a-medium', 'triage'), /no canary spec for task class triage/);
  await assert.rejects(() => createRouterCanary({ router, config: CONFIG, canaries: { '*': { messages: [] } } })('not-configured', 'x'), /not in the router configuration/);
});

test('US-09-R20 when the model asked for is retired the successor serves and that is no canary of the original', async () => {
  const { db, router } = mk({ reply: (b) => (b.model === 'a-medium' ? new Response('model a-medium is deprecated', { status: 410 }) : { text: '{"ok":1}', tool_calls: [] }) });
  const canary = createRouterCanary({ router, config: CONFIG, canaries: { '*': { messages: [{ role: 'user', content: 'x' }], json: true } } });
  await assert.rejects(() => canary('a-medium', 'triage'), /refused the call \(all_providers_failed: http 410/, 'the first call meets the 410 and retires the model');
  await assert.rejects(() => canary('a-medium', 'triage'), /a-medium was answered by a-large/, 'the next call is served by the successor, which is no canary of a-medium');
  assert.equal(one(db, `SELECT is_on FROM router_switches WHERE name='model:a-medium'`).is_on, 1);
});

test('US-09 a shadow answer through the router is compared with the label and feeds rolling agreement', async () => {
  const { db, router } = mk({ reply: () => ({ text: ' approve \n', tool_calls: [] }) });
  await L.admit(db, { model: 'a-medium', task_class: 'triage', rung: 1, unit_cost: 0.01, canary: async () => ({ tool_calls: true, schema: true }) }, { now: NOW });
  const answer = createRouterAnswer({ router, config: CONFIG, prompt: d => [{ role: 'user', content: d.text }] });
  const decisions = async () => Array.from({ length: 40 }, (_, i) => ({ ref: 'D' + i, task_class: 'triage', model: 'a-medium', text: 'q' + i }));
  const r = await shadowRun({ db, now: () => NOW, rate: 1, max: 100, answer, label: async d => (Number(d.ref.slice(1)) % 4 === 0 ? 'reject' : 'approve'), decisions });
  assert.equal(r.sampled, 40);
  const roll = await L.rollingAgreement(db, { model: 'a-medium', task_class: 'triage' });
  assert.deepEqual([roll.n, roll.agreement], [40, 0.75]);
  assert.equal(one(db, `SELECT kind FROM router_calls ORDER BY id DESC LIMIT 1`).kind, 'shadow');
  assert.throws(() => createRouterAnswer({ router, config: CONFIG }), /needs a prompt/);
});
