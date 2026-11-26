// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgenticHandler, DEFAULT_IDENTITY, TOOLS } from '../src/agentic/handler.js';
import { rig } from './rig.js';
import { A2A_ERRORS, requested } from '../src/agentic/acl/a2a.js';
import { memoryStore, staticRegistries } from '../src/agentic/adapters/memory.js';
import { bearerAuth } from '../src/agentic/adapters/bearer-auth.js';

// A2A 1.0 JSON-RPC binding (a2a-protocol.org/latest/specification, sections 3.6, 4.1.4, 5.4, 9.4).
const ENV = { MCP_TOKEN: 's3cret' };
const send = (body, headers = { 'a2a-version': '1.0', authorization: 'Bearer s3cret' }, env = ENV, path = '/a2a') =>
  rig(env).h(new Request('https://org.example' + path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }), env);
const msg = (parts, extra = {}) => ({ jsonrpc: '2.0', id: 1, method: 'SendMessage', params: { message: { messageId: 'm-1', role: 'ROLE_USER', parts, ...extra } } });

test('a2a: SendMessage runs the named skill and answers with an agent Message', async () => {
  const r = await (await send(msg([{ data: { skill: 'ultrastable_dashboard_state', arguments: {} } }], { contextId: 'ctx-9' }))).json();
  const m = r.result.message;
  assert.equal(r.id, 1);
  assert.equal(m.role, 'ROLE_AGENT');
  assert.equal(m.contextId, 'ctx-9');
  assert.ok(m.messageId && m.messageId !== 'm-1');
  assert.equal(m.parts[0].data.open_gate_cards, 2);
  assert.equal(r.result.task, undefined);
});

test('a2a: every skill on the agent card can be called by its id', async () => {
  const card = await (await rig().h(new Request('https://org.example/.well-known/agent-card.json'), ENV)).json();
  assert.deepEqual(card.skills.map(s => s.id), TOOLS.map(t => t.name));
  const r = await (await send(msg([{ text: 'ultrastable_tick_status' }]))).json();
  assert.ok(r.result.message.parts[0].data);
  assert.deepEqual(requested({ parts: [{ text: 'x' }], metadata: { skill: 'ultrastable_tick_status' } }, null, TOOLS), { skill: 'ultrastable_tick_status', args: {} });
});

test('a2a: a message that names no skill is answered with the skills as data', async () => {
  const r = await (await send(msg([{ text: 'what can you do?' }]))).json();
  const parts = r.result.message.parts;
  assert.match(parts[0].text, /skill/);
  assert.deepEqual(parts[1].data.skills.map(s => s.id), TOOLS.map(t => t.name));
});

test('a2a: version is required and a version not served answers VersionNotSupportedError', async () => {
  for (const h of [{}, { 'a2a-version': '0.3' }, { 'a2a-version': '2.0' }]) {
    const r = await (await send(msg([{ text: 'x' }]), { authorization: 'Bearer s3cret', ...h })).json();
    assert.equal(r.error.code, A2A_ERRORS.VersionNotSupportedError);
    assert.equal(r.error.code, -32009);
    assert.deepEqual(r.error.data.supported, ['1.0']);
  }
  const r = await (await send(msg([{ text: 'ultrastable_tick_status' }]), { authorization: 'Bearer s3cret' }, ENV, '/a2a?A2A-Version=1.0')).json();
  assert.ok(r.result.message); // the version may be a request parameter instead of a header
});

test('a2a: fails closed without the bearer the card declares', async () => {
  for (const [headers, env] of [[{ 'a2a-version': '1.0' }, ENV], [{ 'a2a-version': '1.0', authorization: 'Bearer wrong' }, ENV], [{ 'a2a-version': '1.0', authorization: 'Bearer s3cret' }, {}]]) {
    const res = await send(msg([{ text: 'ultrastable_tick_status' }]), headers, env);
    assert.equal(res.status, 401);
    assert.match(res.headers.get('www-authenticate'), /^Bearer /);
    assert.equal((await res.json()).result, undefined);
  }
});

test('a2a: no task is created, so task methods and streaming answer the specification errors', async () => {
  const code = async (method, params = {}) => (await (await send({ jsonrpc: '2.0', id: 2, method, params })).json()).error.code;
  assert.equal(await code('GetTask', { id: 't-1' }), -32001);
  assert.equal(await code('CancelTask', { id: 't-1' }), -32001);
  assert.equal(await code('SendStreamingMessage'), -32004);
  assert.equal(await code('SubscribeToTask'), -32004);
  assert.equal(await code('ListTasks'), -32004);
  assert.equal(await code('CreateTaskPushNotificationConfig'), -32003);
  assert.equal(await code('GetExtendedAgentCard'), -32007);
  assert.equal(await code('NoSuchMethod'), -32601);
});

test('a2a: bad requests are refused with JSON-RPC errors', async () => {
  assert.equal((await send(msg([]))).status, 200);
  assert.equal((await (await send(msg([]))).json()).error.code, -32602);
  assert.equal((await (await send(msg([{ data: { skill: 'nope' } }]))).json()).error.code, -32602);
  assert.equal((await (await send(msg([{ data: { skill: 'ultrastable_glossary_lookup', arguments: { term: 7 } } }]))).json()).error.code, -32602);
  const raw = await rig().h(new Request('https://org.example/a2a', { method: 'POST', body: '{', headers: { 'a2a-version': '1.0' } }), ENV);
  assert.equal(raw.status, 400);
  assert.equal((await rig().h(new Request('https://org.example/a2a'), ENV)).status, 405);
});

test('a2a: a failing skill is an InvalidAgentResponseError and is traced', async () => {
  const spans = [];
  const h = createAgenticHandler({ store: { ...memoryStore({}), lastTick: async () => { throw new TypeError('boom'); } }, registries: staticRegistries({}), auth: bearerAuth, telemetry: { span: (n, a) => spans.push({ n, a }) }, identity: DEFAULT_IDENTITY });
  const res = await h(new Request('https://org.example/a2a', { method: 'POST', headers: { 'a2a-version': '1.0', authorization: 'Bearer s3cret' }, body: JSON.stringify(msg([{ text: 'ultrastable_tick_status' }])) }), ENV);
  const r = await res.json();
  assert.equal(r.error.code, -32006);
  assert.equal(spans.length, 1);
  assert.equal(spans[0].a['error.type'], 'TypeError');
});
