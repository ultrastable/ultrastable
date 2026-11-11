import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rig } from './rig.js';
import { SURFACES, TOOLS, STANDARDS } from '../src/agentic/handler.js';

const get = async (path, env) => { const { h } = rig(env); const r = await h(new Request('https://org.example' + path), env || {}); return r; };

test('discovery: llms.txt lists every discoverable surface', async () => {
  const body = await (await get('/llms.txt')).text();
  assert.match(body, /^# /);
  assert.match(body, /nobody notices/);
  for (const s of SURFACES.filter(x => x.discoverable)) assert.ok(body.includes(s.path), `llms.txt misses ${s.path}`);
  for (const s of SURFACES.filter(x => !x.discoverable)) assert.ok(s.reason, `${s.path} undiscoverable without a reason`);
});

test('discovery: AGENTS.md', async () => {
  const r = await get('/AGENTS.md');
  assert.match(r.headers.get('content-type'), /markdown/);
  const t = await r.text();
  assert.match(t, /\/mcp/); assert.match(t, /If it is not in code, it does not exist/);
});

test('discovery: agent card', async () => {
  const c = await (await get('/.well-known/agent-card.json')).json();
  assert.equal(c.protocolVersion, '1.0');
  assert.equal(c.skills.length, TOOLS.length);
  assert.ok(c.supportedInterfaces.every(i => i.url.startsWith('https://org.example/')));
});

test('discovery: server card', async () => {
  const c = await (await get('/.well-known/mcp/server-card.json')).json();
  assert.equal(c.transport.endpoint, 'https://org.example/mcp');
  assert.deepEqual(c.tools.map(t => t.name), TOOLS.map(t => t.name));
  assert.equal(c.authentication.required, true);
});

test('discovery: agent skills digest', async () => {
  const idx = await (await get('/.well-known/agent-skills/index.json')).json();
  assert.match(idx.$schema, /agentskills\.io\/discovery\/0\.2\.0/);
  const e = idx.skills[0];
  const md = await (await get(e.url)).text();
  assert.equal(e.digest, 'sha256:' + createHash('sha256').update(md).digest('hex'));
  assert.match(md, /^---\nname: ultrastable-operate\ndescription: /);
});

test('discovery: api catalog and protected resource', async () => {
  const r = await get('/.well-known/api-catalog');
  assert.match(r.headers.get('content-type'), /linkset\+json/);
  assert.ok((await r.json()).linkset.length >= 1);
  const p = await (await get('/.well-known/oauth-protected-resource', { OAUTH_ISSUER: 'https://auth.example' })).json();
  assert.equal(p.resource, 'https://org.example/mcp');
  assert.deepEqual(p.authorization_servers, ['https://auth.example']);
});

test('discovery: openapi', async () => {
  const o = await (await get('/openapi.json')).json();
  assert.equal(o.openapi, '3.1.0');
  for (const s of SURFACES.filter(x => x.discoverable && ['rest', 'mcp', 'discovery'].includes(x.kind))) assert.ok(o.paths[s.path], `openapi misses ${s.path}`);
});

test('discovery: well-known paths and json schema register', async () => {
  for (const s of SURFACES.filter(x => x.standards.includes('well-known'))) assert.ok(s.path.startsWith('/.well-known/'), s.path);
  const served = await (await get('/standards.json')).json();
  assert.deepEqual(served, STANDARDS);
  assert.ok(served.entries.length >= 15);
});
