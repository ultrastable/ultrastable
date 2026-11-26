import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { rig } from './rig.js';
import { SURFACES, TOOLS, STANDARDS } from '../src/agentic/handler.js';
import { A2A_CARD_REQUIRED, skillProblems, skillMd } from '../src/agentic/acl/discovery.js';

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
  // A2A 1.0 AgentCard, specification section 4.4.1: the required fields, the 1.0 security shape and an honest interface list
  const c = await (await get('/.well-known/agent-card.json')).json();
  for (const k of A2A_CARD_REQUIRED) assert.ok(c[k] !== undefined, `agent card misses required field ${k}`);
  assert.equal(c.skills.length, TOOLS.length);
  for (const s of c.skills) for (const k of ['id', 'name', 'description', 'tags']) assert.ok(s[k] && s[k].length, `skill misses ${k}`);
  assert.ok(c.supportedInterfaces.every(i => i.url.startsWith('https://org.example/') && i.protocolBinding && i.protocolVersion));
  assert.deepEqual(c.supportedInterfaces[0], { url: 'https://org.example/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' });
  assert.ok(SURFACES.some(s => s.path === '/a2a' && s.discoverable), 'the card names an interface no surface serves');
  assert.equal(c.securitySchemes.bearer.httpAuthSecurityScheme.scheme, 'Bearer');
  assert.deepEqual(c.securityRequirements, [{ schemes: { bearer: { list: [] } } }]);
  for (const gone of ['url', 'protocolVersion', 'security', 'preferredTransport', 'additionalInterfaces']) assert.equal(c[gone], undefined, `${gone} is not an A2A 1.0 card field`);
  assert.deepEqual(c.capabilities, { streaming: false, pushNotifications: false, extendedAgentCard: false });
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

test('discovery: skill conforms to the Agent Skills specification', async () => {
  // agentskills.io/specification: name and description rules, name equals the parent directory, frontmatter is valid YAML
  const idx = await (await get('/.well-known/agent-skills/index.json')).json();
  for (const e of idx.skills) {
    const dir = e.url.split('/').at(-2);
    assert.equal(e.name, dir);
    assert.deepEqual(skillProblems(await (await get(e.url)).text(), dir), []);
  }
  // an organisation whose name would break the YAML still yields a valid skill
  assert.deepEqual(skillProblems(skillMd({ identity: { name: 'Acme: the #1 org' }, origin: 'https://org.example' }), 'ultrastable-operate'), []);
  // and the validator refuses what the specification refuses
  const bad = (fm, dir) => skillProblems(`---\n${fm}\n---\n\nbody\n`, dir);
  assert.match(bad('name: PDF-Processing\ndescription: x')[0], /lowercase/);
  assert.match(bad('name: pdf--processing\ndescription: x')[0], /single hyphens/);
  assert.match(bad('name: pdf\ndescription: x', 'other')[0], /does not match its directory/);
  assert.match(bad('name: pdf\ndescription: tools: read')[0], /plain YAML scalar/);
  assert.match(bad('name: pdf\ndescription: ' + 'x'.repeat(1025))[0], /1-1024/);
  assert.match(skillProblems('# no frontmatter')[0], /frontmatter/);
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
