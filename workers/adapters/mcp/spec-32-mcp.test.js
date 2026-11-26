// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-32 (open standards and agent-consumable surfaces), the generic MCP tool server of the extracted reference implementation: one JSON-RPC core behind an HTTP
// transport and a line transport, and the read tools over the org database. The database is the in-memory test database of core/_shared; nothing uses the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../../core/_shared/testdb.js';
import { createMcpServer, readTools } from './server.js';

const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
const seeded = () => { const db = makeDb(); for (let i = 1; i <= 120; i++) db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status,priority) VALUES ('I-${String(i).padStart(3, '0')}','t${i}','staff','d','${i % 3 ? 'open' : 'done'}',${i % 7 + 1})`); return db; };
const http = (s, body) => s.handleHttp(new Request('http://x/mcp', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));

test('US-32-R79: the server answers JSON-RPC 2.0 on one core for both transports: the handshake, the tool list, a tool call whose failure is a result, and a request that is not valid', async () => {
  const seen = []; const s = createMcpServer({ tools: [
    { name: 'echo', description: 'Echo the arguments.', inputSchema: { type: 'object', properties: { a: { type: 'string' } } }, run: async (args, ctx) => { seen.push(ctx); return args; } },
    { name: 'text', description: 'Plain text.', run: async () => 'just text' },
    { name: 'boom', run: async () => { throw new Error('bad ' + 'x'.repeat(400)); } },
  ], info: { name: 'org-tools', version: '9.9.9' }, ctx: { tenant: 't1' } });
  assert.deepEqual(await s.handleRpc(rpc(1, 'initialize')), { jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'org-tools', version: '9.9.9' } } });
  assert.deepEqual(await s.handleRpc(rpc(2, 'ping')), { jsonrpc: '2.0', id: 2, result: {} });
  assert.deepEqual((await s.handleRpc(rpc(3, 'tools/list'))).result.tools, [
    { name: 'echo', description: 'Echo the arguments.', inputSchema: { type: 'object', properties: { a: { type: 'string' } } } },
    { name: 'text', description: 'Plain text.', inputSchema: { type: 'object', properties: {} } },
    { name: 'boom', description: undefined, inputSchema: { type: 'object', properties: {} } }], 'a tool with no schema is listed with an empty object schema, and the function behind it is never listed');
  const echoed = await s.handleRpc(rpc(4, 'tools/call', { name: 'echo', arguments: { a: 'x' } })); assert.equal(echoed.result.content[0].type, 'text'); assert.deepEqual(JSON.parse(echoed.result.content[0].text), { a: 'x' }); assert.deepEqual(seen[0], { tenant: 't1' }, 'the host context reaches the tool');
  assert.equal((await s.handleRpc(rpc(5, 'tools/call', { name: 'text' }))).result.content[0].text, 'just text', 'a string result is sent as it is');
  assert.equal((await s.handleRpc(rpc(6, 'tools/call', { name: 'echo' }))).result.isError, undefined, 'a call with no arguments runs the tool with an empty object');
  const failed = (await s.handleRpc(rpc(7, 'tools/call', { name: 'boom' }))).result; assert.equal(failed.isError, true); assert.equal(failed.content[0].text.length, 300, 'a tool failure is a result, cut to 300 characters, never an exception to the client');
  const unknown = await s.handleRpc(rpc(8, 'tools/call', { name: 'n'.repeat(90) })); assert.equal(unknown.error.code, -32602); assert.equal(unknown.error.message, 'unknown tool: ' + 'n'.repeat(60));
  assert.deepEqual((await s.handleRpc(rpc(9, 'resources/list'))).error, { code: -32601, message: 'method not found' });
  assert.equal(await s.handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'a notification has no reply');
  assert.deepEqual(await s.handleRpc({ id: 10, method: 'ping' }), { jsonrpc: '2.0', id: 10, error: { code: -32600, message: 'invalid request' } }); assert.equal((await s.handleRpc({ jsonrpc: '2.0', id: 11, method: 5 })).error.code, -32600);
  assert.deepEqual(await s.handleRpc(null), { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } });
  assert.equal((await s.handleRpc(rpc(12, 'initialize'))).result.serverInfo.name, 'org-tools'); assert.equal(createMcpServer().handleRpc(rpc(1, 'initialize')) instanceof Promise, true); assert.equal((await createMcpServer().handleRpc(rpc(1, 'initialize'))).result.serverInfo.name, 'ultrastable-tools');
  // HTTP transport
  assert.equal((await s.handleHttp(new Request('http://x/mcp', { method: 'GET' }))).status, 405);
  const bad = await http(s, '{'); assert.equal(bad.status, 400); assert.equal((await bad.json()).error.code, -32700);
  assert.equal((await (await http(s, rpc(1, 'ping'))).json()).result && true, true);
  assert.equal((await http(s, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202, 'a notification over HTTP is accepted with no body');
  const batch = await (await http(s, [rpc(1, 'ping'), { jsonrpc: '2.0', method: 'notifications/x' }, rpc(2, 'tools/list')])).json(); assert.deepEqual(batch.map(r => r.id), [1, 2], 'a batch is answered in order and the notification is left out');
  assert.equal((await http(s, [{ jsonrpc: '2.0', method: 'notifications/x' }])).status, 202);
  // line transport
  assert.equal(await s.handleLine(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })), ''); assert.equal(JSON.parse(await s.handleLine(JSON.stringify(rpc(1, 'ping')))).result && true, true);
  assert.equal(JSON.parse(await s.handleLine('not json')).error.code, -32700);
});

test('US-32-R80: the read tools list and fetch work items from the org database with a bounded page, and offer no way to change anything', async () => {
  const db = seeded(); const tools = readTools(db); const s = createMcpServer({ tools });
  assert.deepEqual(tools.map(t => t.name), ['list_items', 'get_item'], 'writes go through claims and the console, not through this server'); assert.deepEqual(tools[1].inputSchema.required, ['id']);
  const list = async a => JSON.parse((await s.handleRpc(rpc(1, 'tools/call', { name: 'list_items', arguments: a }))).result.content[0].text);
  const all = await list({}); assert.equal(all.length, 20, 'the default page is twenty'); assert.deepEqual(Object.keys(all[0]).sort(), ['id', 'owner_role', 'status', 'title']);
  const prios = all.map(r => db.raw.prepare('SELECT priority FROM items WHERE id = ?').get(r.id).priority); assert.deepEqual(prios, [...prios].sort((a, b) => a - b), 'lowest priority number first');
  assert.equal((await list({ limit: 500 })).length, 100, 'a page is never more than a hundred'); assert.equal((await list({ limit: 3 })).length, 3); assert.equal((await list({ limit: 'junk' })).length, 20);
  const done = await list({ status: 'done', limit: 100 }); assert.ok(done.length > 0 && done.every(r => r.status === 'done'));
  assert.deepEqual(await list({ status: 'no-such-status' }), []);
  const one = JSON.parse((await s.handleRpc(rpc(2, 'tools/call', { name: 'get_item', arguments: { id: 'I-001' } }))).result.content[0].text); assert.equal(one.id, 'I-001'); assert.equal(one.done_check, 'd', 'the whole row is returned');
  const miss = (await s.handleRpc(rpc(3, 'tools/call', { name: 'get_item', arguments: { id: 'I-999' } }))).result; assert.equal(miss.isError, true); assert.equal(miss.content[0].text, 'not found');
  assert.equal((await s.handleRpc(rpc(4, 'tools/call', { name: 'get_item', arguments: { id: "I-001'; DROP TABLE items; --" } }))).result.isError, true, 'an id is a bound value, never part of the statement'); assert.equal(db.raw.prepare('SELECT count(*) AS n FROM items').get().n, 120);
});
