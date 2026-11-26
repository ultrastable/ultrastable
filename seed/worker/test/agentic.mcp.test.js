import test from 'node:test';
import assert from 'node:assert/strict';

import { rig } from './rig.js';

const call = (name, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

test('mcp: initialize negotiates version', async () => {
  const { post } = rig();
  let r = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } })).json();
  assert.equal(r.result.protocolVersion, '2025-11-25');
  r = await (await post({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).json();
  assert.equal(r.result.protocolVersion, '2026-07-28');
  assert.ok(r.result.capabilities.tools);
  assert.equal((await post({ jsonrpc: '2.0', id: 3, method: 'ping' }, { 'mcp-protocol-version': '1999-01-01' })).status, 400);
});

test('mcp: server/discover', async () => {
  const { post } = rig();
  const r = await (await post({ jsonrpc: '2.0', id: 1, method: 'server/discover' })).json();
  assert.ok(r.result.supportedVersions.includes('2026-07-28'));
  assert.ok(r.result.serverInfo.name);
});

test('mcp: tools/call fails closed', async () => {
  const noToken = rig({});
  let res = await noToken.post(call('ultrastable_tick_status'));
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /resource_metadata="https:\/\/org\.example\/\.well-known\/oauth-protected-resource"/);
  res = await rig().post(call('ultrastable_tick_status'), { authorization: 'Bearer wrong' });
  assert.equal(res.status, 401);
  // listing tools is public so a client can see what it would be authorising
  assert.equal((await rig({}).post({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).status, 200);
});

test('mcp: tools/call with token', async () => {
  const { post } = rig();
  const auth = { authorization: 'Bearer s3cret' };
  let r = await (await post(call('ultrastable_dashboard_state'), auth)).json();
  assert.equal(r.result.structuredContent.open_gate_cards, 2);
  assert.equal(r.result.structuredContent.counts.ready, 1);
  r = await (await post(call('ultrastable_glossary_lookup', { term: 'PLUS' }), auth)).json();
  assert.equal(r.result.structuredContent.entries[0].definition, 'protected improvement');
  r = await (await post(call('ultrastable_standards_register', { support: 'planned' }), auth)).json();
  assert.ok(r.result.structuredContent.entries.every(e => e.support === 'planned'));
  r = await (await post(call('ultrastable_glossary_lookup', { bogus: 1 }), auth)).json();
  assert.equal(r.error.code, -32602);
  r = await (await post(call('nope'), auth)).json();
  assert.equal(r.error.code, -32602);
  assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
});

test('mcp: rejects foreign origin', async () => {
  const { h } = rig();
  const bad = await h(new Request('https://org.example/mcp', { method: 'POST', headers: { origin: 'https://evil.example' }, body: '{}' }), { MCP_TOKEN: 'x' });
  assert.equal(bad.status, 403);
  assert.equal((await h(new Request('https://org.example/mcp'), {})).status, 405);
});

test('mcp: OTel execute_tool span', async () => {
  const spans = [];
  await rig({ MCP_TOKEN: 's3cret' }, spans).post(call('ultrastable_tick_status'), { authorization: 'Bearer s3cret' });
  assert.equal(spans[0].n, 'execute_tool ultrastable_tick_status');
  assert.equal(spans[0].a['gen_ai.operation.name'], 'execute_tool');
  assert.equal(spans[0].a['gen_ai.tool.name'], 'ultrastable_tick_status');
  assert.ok(spans[0].a['gen_ai.tool.call.id']);
});

test('mcp: unsupported version answers UnsupportedProtocolVersionError', async () => {
  // 2026-07-28 versioning: -32022 with the supported list and the requested value, in the body of a 400, from the header or from _meta
  const { post } = rig();
  let res = await post({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, { 'mcp-protocol-version': '1900-01-01' });
  assert.equal(res.status, 400);
  let r = await res.json();
  assert.equal(r.id, 7);
  assert.equal(r.error.code, -32022);
  assert.deepEqual(r.error.data, { supported: ['2026-07-28', '2025-11-25', '2025-06-18'], requested: '1900-01-01' });
  res = await post({ jsonrpc: '2.0', id: 8, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } } });
  r = await res.json();
  assert.equal(r.error.code, -32022);
  assert.equal(r.error.data.requested, '1900-01-01');
});

test('mcp: a modern request is answered without a handshake and names the server', async () => {
  const { post } = rig();
  const meta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28' };
  let r = await (await post({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta } })).json();
  assert.ok(r.result.tools.length);
  assert.equal(r.result._meta['io.modelcontextprotocol/serverInfo'].name, 'ultrastable-org');
  r = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'ultrastable_tick_status', arguments: {}, _meta: meta } }, { authorization: 'Bearer s3cret' })).json();
  assert.equal(r.result.isError, false);
  assert.ok(r.result._meta['io.modelcontextprotocol/serverInfo'].version);
  // a legacy request keeps its legacy shape: no _meta is added
  r = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { 'mcp-protocol-version': '2025-11-25' })).json();
  assert.equal(r.result._meta, undefined);
});
