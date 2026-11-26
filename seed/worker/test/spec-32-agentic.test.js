// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-32 (open standards and agent-consumable surfaces), the seed's agentic surfaces: the surfaces register, the handler, the ports, the transport-neutral
// tools, the MCP server and the discovery documents. Each test is named by the requirement it proves. The network is not used: requests go straight into the
// handler, the store is in memory or node:sqlite, and the one clock-dependent value (a call id) is only checked for shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rig } from './rig.js';
import { makeDb } from './d1shim.js';
import { SURFACES, TOOLS, STANDARDS, CONTRACT_VERSION, createAgenticHandler, DEFAULT_IDENTITY } from '../src/agentic/handler.js';
import { assertPort, STORE_METHODS, REGISTRIES_METHODS, AUTH_METHODS, TELEMETRY_METHODS } from '../src/agentic/core/ports.js';
import { validateArgs } from '../src/agentic/core/tools.js';
import { toolList, MCP_VERSIONS } from '../src/agentic/acl/mcp.js';
import { d1Store } from '../src/agentic/adapters/d1-store.js';
import { memoryStore, staticRegistries } from '../src/agentic/adapters/memory.js';
import { bearerAuth } from '../src/agentic/adapters/bearer-auth.js';
import { consoleTelemetry, nullTelemetry, OTEL_GENAI_PIN } from '../src/agentic/adapters/console-telemetry.js';

const read = rel => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const surfacesDoc = read('../../standards/surfaces.json'), snapshot = read('../contract/mcp-tools.v1.json');
const O = 'https://org.example';
const get = async (path, env, method = 'GET') => { const { h } = rig(env); return h(new Request(O + path, { method }), env || {}); };
const call = (name, args = {}, id = 1) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
const AUTH = { authorization: 'Bearer s3cret' };

// ---- The surfaces register and the handler --------------------------------------------------------------------------------------------

test('US-32-R12: every surface is registered with its kind, audience and standards, and a surface an agent cannot discover says why', () => {
  const ids = new Set();
  for (const s of SURFACES) {
    assert.match(s.id, /^[a-z0-9][a-z0-9-]*$/); assert.ok(!ids.has(s.id), 'duplicate surface id ' + s.id); ids.add(s.id);
    assert.ok(s.path.startsWith('/'), s.path); assert.ok(s.methods.length > 0 && new Set(s.methods).size === s.methods.length, s.id);
    assert.ok(['rest', 'discovery', 'ui', 'analytics', 'mcp'].includes(s.kind), s.id);
    assert.ok(['public', 'owner', 'machine', 'agent'].includes(s.audience), s.id);
    assert.ok(s.description.length > 0, s.id);
    if (s.discoverable) assert.ok(s.standards.length > 0, s.id + ' is discoverable and names no standard');
    else assert.ok(s.reason && s.reason.length > 0, s.id + ' is not discoverable and gives no reason');
    for (const sid of s.standards) { const row = STANDARDS.entries.find(e => e.id === sid); assert.ok(row, `${s.id} names unknown standard ${sid}`); assert.ok(['supported', 'partial'].includes(row.support), `${s.id} names ${sid}, which is ${row.support}`); }
  }
  for (const s of SURFACES.filter(x => x.standards.includes('well-known'))) assert.ok(s.path.startsWith('/.well-known/'), s.path);
});

test('US-32-R13: the handler serves only registered, discoverable surfaces and leaves every other path, and /health, to the host Worker', async () => {
  for (const p of ['/health', '/nope', '/', '/next', '/needs-you', '/a.js']) assert.equal(await get(p), null, p);
  assert.equal(await get('/api/budget'), null, 'a discoverable surface the handler has no document for falls through to the host that serves it');
  const bad = await get('/llms.txt', undefined, 'POST');
  assert.equal(bad.status, 405); assert.equal(bad.headers.get('allow'), 'GET');
  const ok = await get('/llms.txt'); assert.equal(ok.status, 200); assert.match(ok.headers.get('content-type'), /^text\/plain/);
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=300');
  assert.equal((await get('/mcp', undefined, 'GET')).status, 405);
});

// ---- Ports and tools ----------------------------------------------------------------------------------------------------------------

test('US-32-R14: the core knows the outside only through ports, a port with a missing method is refused by name, and both stores give one dashboard shape', async () => {
  assert.deepEqual(STORE_METHODS, ['lastTick', 'dashboard']); assert.deepEqual(REGISTRIES_METHODS, ['glossary', 'loops']);
  assert.deepEqual(AUTH_METHODS, ['verify']); assert.deepEqual(TELEMETRY_METHODS, ['span']);
  assert.throws(() => assertPort('store', { lastTick() {} }, STORE_METHODS), /store port: adapter is missing dashboard/);
  assert.throws(() => assertPort('auth', null, AUTH_METHODS), /auth port: adapter is missing verify/);
  assert.throws(() => createAgenticHandler({ store: memoryStore(), registries: staticRegistries(), auth: bearerAuth, telemetry: {} }), /telemetry port: adapter is missing span/);
  const db = makeDb();
  for (let i = 1; i <= 7; i++) db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status,priority) VALUES ('I${i}','t${i}','pm','c','${i === 7 ? 'done' : i % 2 ? 'ready' : 'open'}',${10 - i})`);
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G','w','y','d','manual')`);
  const items = [1, 2, 3, 4, 5, 6, 7].map(i => ({ id: 'I' + i, title: 't' + i, owner_role: 'pm', status: i === 7 ? 'done' : i % 2 ? 'ready' : 'open', priority: 10 - i }));
  for (const store of [d1Store(db), memoryStore({ items, gates: 1 })]) {
    const d = await store.dashboard();
    assert.deepEqual(Object.keys(d).sort(), ['counts', 'last_tick', 'next_items', 'open_gate_cards']);
    assert.equal(d.open_gate_cards, 1); assert.equal(d.counts.done, 1);
    assert.equal(d.next_items.length, 5, 'at most five next items');
    assert.deepEqual(d.next_items.map(n => n.id), ['I6', 'I5', 'I4', 'I3', 'I2'], 'lowest priority number first, only open and ready items');
  }
  assert.deepEqual(await staticRegistries().loops('x'), { source: 'missing', entries: [] });
  const r = staticRegistries({ glossary: [{ term: 'Plus', definition: 'd' }, { term: 'Tick', definition: 'e' }] });
  assert.equal((await r.glossary('PLUS')).entries.length, 1, 'a lookup ignores case'); assert.equal((await r.glossary()).entries.length, 2);
});

test('US-32-R15: a tool is a name, a JSON Schema for its input and a function over ports, and no protocol appears in it', () => {
  assert.deepEqual(TOOLS.map(t => t.name), ['ultrastable_tick_status', 'ultrastable_loop_registry', 'ultrastable_glossary_lookup', 'ultrastable_dashboard_state', 'ultrastable_standards_register']);
  for (const t of TOOLS) {
    assert.match(t.name, /^[a-z][a-z0-9_]{2,63}$/); assert.ok(t.description.length > 20, t.name);
    assert.equal(t.inputSchema.type, 'object', t.name); assert.equal(t.inputSchema.additionalProperties, false, t.name + ' must reject unknown arguments');
    assert.equal(t.scope, 'read', t.name); assert.equal(typeof t.run, 'function', t.name);
  }
  for (const t of toolList(TOOLS)) assert.deepEqual(t.annotations, { readOnlyHint: true, idempotentHint: true }, 'the server exposes no write tool: ' + t.name);
});

test('US-32-R16: arguments are checked against the schema subset the tools use before a tool runs', () => {
  const s = TOOLS.find(t => t.name === 'ultrastable_standards_register').inputSchema;
  assert.equal(validateArgs(s, {}), null); assert.equal(validateArgs(s, undefined), null); assert.equal(validateArgs(s, { id: 'mcp', support: 'planned' }), null);
  assert.equal(validateArgs(s, { bogus: 1 }), 'unknown argument bogus');
  assert.match(validateArgs(s, { support: 'maybe' }), /support must be one of supported, partial, planned, not_applicable/);
  assert.match(validateArgs(s, { id: 'x'.repeat(81) }), /id must be a string up to 80 chars/);
  assert.match(validateArgs(s, { id: 7 }), /id must be a string/);
  assert.equal(validateArgs(s, []), 'arguments must be an object'); assert.equal(validateArgs(s, 'x'), 'arguments must be an object');
  assert.equal(validateArgs({ type: 'object', required: ['q'], properties: { q: { type: 'string' } } }, {}), 'missing q');
  assert.equal(validateArgs({ type: 'object', properties: {} }, { free: 1 }), null, 'an open schema accepts an unlisted argument');
});

test('US-32-R17: the tool contract is versioned: the snapshot lists every tool and its input schema, and the major version agrees with the surfaces register', () => {
  assert.equal(snapshot.contract_version.split('.')[0], CONTRACT_VERSION.split('.')[0]);
  assert.equal(surfacesDoc.contract_version, CONTRACT_VERSION);
  const live = Object.fromEntries(toolList(TOOLS).map(t => [t.name, t]));
  for (const t of snapshot.tools) { assert.ok(live[t.name], 'tool removed: ' + t.name); assert.deepEqual(live[t.name].inputSchema, t.inputSchema, 'input schema changed: ' + t.name); }
  assert.deepEqual(Object.keys(live).sort(), snapshot.tools.map(t => t.name).sort(), 'a tool is recorded in the snapshot in the change that adds it');
});

test('US-32-R18: the standards tool answers from the register, filtered by id and support, one reduced row per standard', async () => {
  const tool = TOOLS.find(t => t.name === 'ultrastable_standards_register');
  const all = await tool.run({ standards: STANDARDS }, {});
  assert.equal(all.version, STANDARDS.version); assert.equal(all.checked, STANDARDS.checked); assert.equal(all.entries.length, STANDARDS.entries.length);
  assert.deepEqual(Object.keys(all.entries[0]).sort(), ['body', 'gap', 'how', 'id', 'name', 'status', 'support', 'tests', 'tracked']);
  const one = await tool.run({ standards: STANDARDS }, { id: 'mcp' }); assert.deepEqual(one.entries.map(e => e.id), ['mcp']);
  const planned = await tool.run({ standards: STANDARDS }, { support: 'planned' });
  assert.ok(planned.entries.length > 0 && planned.entries.every(e => e.support === 'planned'));
  assert.equal((await tool.run({ standards: STANDARDS }, { id: 'mcp', support: 'planned' })).entries.length, 0, 'both filters apply together');
});

// ---- The MCP server -----------------------------------------------------------------------------------------------------------------

test('US-32-R19: /mcp takes POST only, and a request from another origin is refused unless the origin is allowed', async () => {
  const { h, post } = rig();
  const g = await h(new Request(O + '/mcp'), {}); assert.equal(g.status, 405); assert.equal(g.headers.get('allow'), 'POST');
  const evil = await h(new Request(O + '/mcp', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }), { MCP_TOKEN: 'x' });
  assert.equal(evil.status, 403);
  const own = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { origin: O }); assert.equal(own.status, 200);
  const allowed = await h(new Request(O + '/mcp', { method: 'POST', headers: { origin: 'https://client.example', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) }), { MCP_TOKEN: 'x', MCP_ALLOWED_ORIGINS: 'https://other.example,https://client.example' });
  assert.equal(allowed.status, 200, 'an origin on MCP_ALLOWED_ORIGINS is accepted');
});

test('US-32-R20: the server speaks three protocol versions, answers the version asked or its newest, is stateless, and refuses a version it does not speak', async () => {
  assert.deepEqual(MCP_VERSIONS, ['2026-07-28', '2025-11-25', '2025-06-18']);
  const { post } = rig();
  for (const v of MCP_VERSIONS) assert.equal((await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v } })).json()).result.protocolVersion, v);
  const other = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json();
  assert.equal(other.result.protocolVersion, '2026-07-28'); assert.ok(other.result.capabilities.tools); assert.equal(other.result.instructions, DEFAULT_IDENTITY.instructions);
  const d = await post({ jsonrpc: '2.0', id: 2, method: 'server/discover' }); assert.equal(d.headers.get('mcp-session-id'), null, 'no session is issued');
  assert.deepEqual((await d.json()).result.supportedVersions, MCP_VERSIONS);
  assert.deepEqual((await (await post({ jsonrpc: '2.0', id: 3, method: 'ping' })).json()).result, {});
  const refused = await post({ jsonrpc: '2.0', id: 4, method: 'ping' }, { 'mcp-protocol-version': '1999-01-01' });
  assert.equal(refused.status, 400); const body = await refused.json(); assert.equal(body.error.code, -32022); assert.match(body.error.message, /Unsupported protocol version/); assert.deepEqual(body.error.data.supported, ['2026-07-28', '2025-11-25', '2025-06-18']);
  assert.equal((await post({ jsonrpc: '2.0', id: 5, method: 'ping' }, { 'mcp-protocol-version': '2025-11-25' })).status, 200);
});

test('US-32-R21: JSON-RPC framing: a bad body is a 400 with the code that names the fault, a notification gets no answer, an unknown method is an error object', async () => {
  const { h, post } = rig();
  const raw = body => h(new Request(O + '/mcp', { method: 'POST', body }), { MCP_TOKEN: 's3cret' });
  let r = await raw('{'); assert.equal(r.status, 400); assert.equal((await r.json()).error.code, -32700);
  for (const bad of ['[]', '[{"jsonrpc":"2.0","id":1,"method":"ping"}]', '"x"', '{"jsonrpc":"1.0","id":1,"method":"ping"}', '{"jsonrpc":"2.0","id":1,"method":7}']) {
    r = await raw(bad); assert.equal(r.status, 400, bad); assert.equal((await r.json()).error.code, -32600, bad);
  }
  r = await post({ jsonrpc: '2.0', method: 'notifications/initialized' }); assert.equal(r.status, 202); assert.equal(await r.text(), '');
  r = await post({ jsonrpc: '2.0', id: 9, method: 'resources/list' }); assert.equal(r.status, 200);
  const e = await r.json(); assert.equal(e.id, 9); assert.equal(e.error.code, -32601); assert.match(e.error.message, /method not found: resources\/list/);
});

test('US-32-R22: tools/list is public, so a client can see what it would be authorising', async () => {
  const r = await (await rig({}).post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).json();
  assert.deepEqual(r.result.tools.map(t => t.name), TOOLS.map(t => t.name));
  for (const t of r.result.tools) { assert.ok(t.description && t.inputSchema && t.annotations.readOnlyHint === true, t.name); }
});

test('US-32-R23: tools/call checks the credential before anything else and answers 401 with the protected-resource challenge', async () => {
  const challenge = /^Bearer resource_metadata="https:\/\/org\.example\/\.well-known\/oauth-protected-resource"$/;
  let r = await rig({}).post(call('ultrastable_tick_status')); assert.equal(r.status, 401);
  assert.match(r.headers.get('www-authenticate'), challenge); assert.deepEqual(await r.json(), { jsonrpc: '2.0', id: 1, error: { code: -32001, message: 'unauthorized' } });
  r = await rig().post(call('ultrastable_tick_status'), { authorization: 'Bearer wrong' }); assert.equal(r.status, 401);
  r = await rig().post(call('no_such_tool', { x: 1 })); assert.equal(r.status, 401, 'an unknown tool is not revealed to a caller with no credential');
  r = await rig().post(call('ultrastable_glossary_lookup', { bogus: 1 })); assert.equal(r.status, 401, 'arguments are not read before the credential');
});

test('US-32-R24: a tool result carries its data as text and as structured content, a failing tool says only its error name, an unknown tool or bad argument is -32602', async () => {
  const { post } = rig();
  let r = await (await post(call('ultrastable_dashboard_state'), AUTH)).json();
  assert.equal(r.result.isError, false); assert.deepEqual(JSON.parse(r.result.content[0].text), r.result.structuredContent); assert.equal(r.result.structuredContent.open_gate_cards, 2);
  r = await (await post(call('ultrastable_tick_status'), AUTH)).json(); assert.equal(r.result.structuredContent.steps_total, 11);
  r = await (await post(call('no_such_tool'), AUTH)).json(); assert.equal(r.error.code, -32602); assert.match(r.error.message, /unknown tool no_such_tool/);
  r = await (await post(call('ultrastable_glossary_lookup', { bogus: 1 }), AUTH)).json(); assert.equal(r.error.code, -32602); assert.equal(r.error.message, 'unknown argument bogus');
  const failing = createAgenticHandler({ store: { lastTick: async () => { throw new TypeError('secret detail at /srv/db'); }, dashboard: async () => ({}) }, registries: staticRegistries(), auth: bearerAuth, telemetry: nullTelemetry });
  const res = await (await failing(new Request(O + '/mcp', { method: 'POST', headers: AUTH, body: JSON.stringify(call('ultrastable_tick_status')) }), { MCP_TOKEN: 's3cret' })).json();
  assert.equal(res.result.isError, true); assert.equal(res.result.content[0].text, 'tool failed: TypeError'); assert.ok(!JSON.stringify(res).includes('/srv/db'), 'the backend detail never reaches the caller');
});

test('US-32-R25: every executed tool call leaves one OpenTelemetry GenAI span, failures carry error.type, refused calls leave none, and the console adapter pins the convention', async () => {
  const spans = [];
  const { post } = rig({ MCP_TOKEN: 's3cret' }, spans);
  await post(call('ultrastable_tick_status'), AUTH); await post(call('ultrastable_tick_status')); await post(call('no_such_tool'), AUTH);
  assert.equal(spans.length, 1, 'a refused or invalid call is not an executed tool call');
  assert.equal(spans[0].n, 'execute_tool ultrastable_tick_status');
  assert.deepEqual(Object.keys(spans[0].a).sort(), ['gen_ai.operation.name', 'gen_ai.tool.call.id', 'gen_ai.tool.name', 'gen_ai.tool.type']);
  assert.equal(spans[0].a['gen_ai.operation.name'], 'execute_tool'); assert.equal(spans[0].a['gen_ai.tool.type'], 'function');
  assert.match(spans[0].a['gen_ai.tool.call.id'], /^[0-9a-f-]{36}$/);
  await post(call('ultrastable_tick_status'), AUTH); assert.notEqual(spans[1].a['gen_ai.tool.call.id'], spans[0].a['gen_ai.tool.call.id'], 'a fresh id per call');
  const failSpans = [];
  const h = createAgenticHandler({ store: { lastTick: async () => { throw new RangeError('x'); }, dashboard: async () => ({}) }, registries: staticRegistries(), auth: bearerAuth, telemetry: { span: (n, a) => failSpans.push({ n, a }) } });
  await h(new Request(O + '/mcp', { method: 'POST', headers: AUTH, body: JSON.stringify(call('ultrastable_tick_status')) }), { MCP_TOKEN: 's3cret' });
  assert.equal(failSpans[0].a['error.type'], 'RangeError');
  const lines = []; const orig = console.log; console.log = s => lines.push(s);
  try { consoleTelemetry.span('execute_tool x', { 'gen_ai.tool.name': 'x' }); } finally { console.log = orig; }
  assert.deepEqual(JSON.parse(lines[0]), { span: 'execute_tool x', 'gen_ai.tool.name': 'x', 'otel.semconv': OTEL_GENAI_PIN }); assert.match(OTEL_GENAI_PIN, /^gen_ai semconv v\d+\.\d+\.\d+ \(Development\)$/);
});

test('US-32-R26: the bearer adapter compares the whole token and fails closed with no token configured', async () => {
  const req = t => new Request(O + '/mcp', { headers: t ? { authorization: 'Bearer ' + t } : {} });
  assert.deepEqual(await bearerAuth.verify(req('s3cret'), { MCP_TOKEN: 's3cret' }), { ok: true, subject: 'mcp-token', scopes: ['read'] });
  assert.deepEqual(await bearerAuth.verify(req('s3cret'), {}), { ok: false, reason: 'no_token_configured' });
  assert.deepEqual(await bearerAuth.verify(req('s3cret'), undefined), { ok: false, reason: 'no_token_configured' });
  assert.deepEqual(await bearerAuth.verify(req('s3cre'), { MCP_TOKEN: 's3cret' }), { ok: false, reason: 'bad_token' }, 'a shorter token');
  assert.deepEqual(await bearerAuth.verify(req('s3crex'), { MCP_TOKEN: 's3cret' }), { ok: false, reason: 'bad_token' }, 'a token that differs in the last character');
  assert.deepEqual(await bearerAuth.verify(req(null), { MCP_TOKEN: 's3cret' }), { ok: false, reason: 'bad_token' });
  assert.deepEqual(await bearerAuth.verify(new Request(O + '/mcp', { headers: { authorization: 'bearer s3cret' } }), { MCP_TOKEN: 's3cret' }), { ok: true, subject: 'mcp-token', scopes: ['read'] }, 'the scheme name is case-insensitive');
});

// ---- The discovery documents ---------------------------------------------------------------------------------------------------------

test('US-32-R27: llms.txt lists every discoverable surface and AGENTS.md tells an agent how to work with the organisation', async () => {
  const r = await get('/llms.txt'); const t = await r.text();
  assert.match(t, /^# /); assert.match(t, /\n> .*Ultra-stable: infrastructure that works so nobody notices\./); assert.match(t, /\n## Agent interfaces\n/); assert.match(t, /\n## Optional\n/);
  for (const s of SURFACES.filter(x => x.discoverable)) assert.ok(t.includes(`- [${s.path}](${O}${s.path}): ${s.description}`), s.path);
  for (const s of SURFACES.filter(x => !x.discoverable && !['ui'].includes(x.kind))) assert.ok(!t.includes(`(${O}${s.path})`), s.path + ' is not advertised');
  const a = await get('/AGENTS.md'); assert.match(a.headers.get('content-type'), /^text\/markdown/);
  const m = await a.text();
  for (const needle of [`${O}/mcp`, 'ultrastable_dashboard_state', 'If it is not in code, it does not exist', 'Never handle secret values', `${O}/llms.txt`, `${O}/standards.json`]) assert.ok(m.includes(needle), needle);
});

test('US-32-R28: the agent card and the MCP server card describe only what the Worker serves', async () => {
  const card = await (await get('/.well-known/agent-card.json')).json();
  assert.equal(card.version, '1.0.0'); assert.equal(card.name, DEFAULT_IDENTITY.name);
  // the card advertises the A2A task interface and MCP, and nothing else; each advertised url is a route the Worker answers on
  assert.deepEqual(card.supportedInterfaces, [{ url: O + '/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }, { url: O + '/mcp', protocolBinding: 'MCP', protocolVersion: '2026-07-28' }]);
  for (const i of card.supportedInterfaces) assert.notEqual((await get(i.url.slice(O.length))).status, 404, i.url + ' is served');
  assert.deepEqual(card.capabilities, { streaming: false, pushNotifications: false, extendedAgentCard: false });
  assert.deepEqual(Object.keys(card.securitySchemes), ['bearer']);
  assert.deepEqual(card.skills.map(s => s.id), TOOLS.map(t => t.name));
  const mc = await (await get('/.well-known/mcp/server-card.json')).json();
  assert.deepEqual(mc.transport, { type: 'streamable-http', endpoint: O + '/mcp' }); assert.deepEqual(mc.protocolVersions, MCP_VERSIONS);
  assert.deepEqual(mc.authentication, { required: true, schemes: ['bearer'], resource_metadata: O + '/.well-known/oauth-protected-resource' });
  assert.deepEqual(mc.tools.map(t => t.name), TOOLS.map(t => t.name)); assert.deepEqual(Object.keys(mc.tools[0]).sort(), ['description', 'name']);
  assert.equal(mc.serverInfo.name, DEFAULT_IDENTITY.slug);
});

test('US-32-R29: the Agent Skills index carries the digest of the skill file it points at, and the skill file opens with its own name and description', async () => {
  const idx = await (await get('/.well-known/agent-skills/index.json')).json();
  assert.equal(idx.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json'); assert.equal(idx.skills.length, 1);
  const s = idx.skills[0]; assert.equal(s.name, 'ultrastable-operate'); assert.equal(s.type, 'skill-md'); assert.equal(s.url, '/.well-known/agent-skills/ultrastable-operate/SKILL.md');
  const md = await get(s.url); assert.match(md.headers.get('content-type'), /^text\/markdown/);
  const body = await md.text();
  assert.equal(s.digest, 'sha256:' + createHash('sha256').update(body).digest('hex'));
  assert.match(body, /^---\nname: ultrastable-operate\ndescription: .+\n(compatibility: .+\n)?---\n/); assert.ok(body.includes(`${O}/mcp`));
  assert.ok(SURFACES.some(x => x.path === s.url && x.discoverable), 'the skill file is a registered surface');
});

test('US-32-R30: the API catalog is an RFC 9727 linkset and the protected-resource metadata is RFC 9728, naming an authorisation server only when one is configured', async () => {
  const c = await get('/.well-known/api-catalog'); assert.match(c.headers.get('content-type'), /^application\/linkset\+json/);
  const ls = (await c.json()).linkset;
  assert.deepEqual(ls.map(e => e.anchor), [O + '/mcp', O + '/health']);
  assert.deepEqual(ls[0]['service-desc'], [{ href: O + '/.well-known/mcp/server-card.json', type: 'application/json' }]);
  assert.equal(ls[1]['service-desc'][0].href, O + '/openapi.json');
  const none = await (await get('/.well-known/oauth-protected-resource')).json();
  assert.deepEqual(none, { resource: O + '/mcp', bearer_methods_supported: ['header'], scopes_supported: ['read'], resource_name: 'Ultrastable MCP server' });
  const withIss = await (await get('/.well-known/oauth-protected-resource', { OAUTH_ISSUER: 'https://auth.example' })).json();
  assert.deepEqual(withIss.authorization_servers, ['https://auth.example']);
});

test('US-32-R31: the OpenAPI 3.1 document covers every discoverable rest, discovery and mcp surface with an operationId per method, and the register itself is served', async () => {
  const r = await get('/openapi.json'); assert.match(r.headers.get('content-type'), /^application\/vnd\.oai\.openapi\+json/);
  const o = await r.json(); assert.equal(o.openapi, '3.1.0'); assert.deepEqual(o.servers, [{ url: O }]); assert.deepEqual(o.components.securitySchemes, { bearer: { type: 'http', scheme: 'bearer' } });
  const wanted = SURFACES.filter(s => s.discoverable && ['rest', 'mcp', 'discovery'].includes(s.kind));
  assert.deepEqual(Object.keys(o.paths).sort(), wanted.map(s => s.path).sort());
  const ops = [];
  for (const s of wanted) for (const m of s.methods) { const op = o.paths[s.path][m.toLowerCase()]; assert.equal(op.operationId, s.id.replace(/-/g, '_')); assert.equal(op.summary, s.description); ops.push(op.operationId); }
  assert.equal(new Set(ops).size, ops.length, 'operationIds are unique');
  assert.ok(o.paths['/mcp'].post.responses['401']); assert.ok(o.paths['/health'].get.responses['503']);
  const served = await (await get('/standards.json')).json(); assert.deepEqual(served, STANDARDS);
  for (const p of ['/llms.txt', '/AGENTS.md', '/.well-known/agent-card.json', '/.well-known/api-catalog', '/openapi.json', '/standards.json']) assert.equal((await get(p)).headers.get('cache-control'), 'public, max-age=300', p);
});

test('US-32-T01: an agent that knows only the origin reaches the register through the documents the Worker publishes', async () => {
  const llms = await (await get('/llms.txt')).text();
  const link = /\[(\/[^\]]+)\]\(https:\/\/org\.example\/[^)]*\)/g; const paths = [...llms.matchAll(link)].map(m => m[1]);
  assert.ok(paths.includes('/mcp') && paths.includes('/standards.json') && paths.includes('/openapi.json'));
  const card = await (await get('/.well-known/mcp/server-card.json')).json();
  const init = await (await rig().post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: card.protocolVersions[0] } })).json();
  assert.equal(init.result.protocolVersion, card.protocolVersions[0]);
  const res = await (await rig().post(call('ultrastable_standards_register', { id: 'mcp' }), AUTH)).json();
  assert.equal(res.result.structuredContent.entries[0].id, 'mcp');
});
