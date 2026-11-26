// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-32 (open standards and agent-consumable surfaces), the platform's own discovery documents and the places where the platform server answers differently from the
// seed's: the connect page that is really served, the answer to a message without an id, the challenge a missing, bad or narrow bearer token gets, the Agent Skills
// index, the RFC 9727 API catalog, the MCP server card and its aliases, the OpenAPI document, the generated llms.txt and the limits of submit_work. Every assertion reads
// the response the platform's handler or Worker serves, not a helper next to it. Every test is skipped where the platform's site/ is absent (existsSync guard, as in
// spec-32-platform-agent.test.js). The network is absent, the databases are node:sqlite in memory, the clocks are injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const have = ['site/agentic.js', 'site/oauth.js', 'site/connectagent.js', 'site/controlplane.js', 'site/worker.js', 'site/sop.js'].every(f => existsSync(root + f));
const opts = { skip: have ? false : 'the monorepo surfaces (site/) are not in this checkout' };
const load = p => import(pathToFileURL(root + p).href);

const d1 = db => ({ prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; },
  all: async () => ({ results: db.prepare(sql).all(...a) }), first: async () => db.prepare(sql).get(...a) || null,
  run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) }, changes: Number(r.changes) }; } }; return st; } });
const sha = s => createHash('sha256').update(s).digest('hex');
const ITEMS = "CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'work', project TEXT, owner_role TEXT NOT NULL, trigger_on TEXT, done_check TEXT NOT NULL, closing_probe TEXT, priority INTEGER NOT NULL DEFAULT 50, status TEXT NOT NULL DEFAULT 'open', surface TEXT, disposition TEXT, blocker TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))";
const orgEnv = (extra = {}) => {
  const raw = new DatabaseSync(':memory:'); raw.exec(ITEMS);
  const db = d1(raw);
  return { raw, env: { DB: db, ORG: db, ASSETS: { get: async () => null, list: async () => ({ keys: [] }) }, ...extra } };
};
const at = (ag, path, init, env) => ag.agentic(new Request('https://ultrastable.io' + path, init), env);
const site = async (host, path) => (await load('site/worker.js')).default.fetch(new Request('https://' + host + path), {}, { waitUntil() {} });
const rpcBody = (method, params, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params });
const ALL_TOOLS = ag => [...ag.LIVE_TOOLS, ...ag.TOOLS, ...ag.WRITE_TOOLS];

// ---- The connect page that is really served ---------------------------------------------------------------------------------------------

test('US-32-R38: the connect page served at /connect-agent on ultrastable.io offers VS Code, VS Code Insiders and Cursor deep links, the Claude connector address, the Claude Code and Codex commands and an .mcp.json, and no secret; the page of connectagent.js, served on a host the handler declines, offers the same clients', opts, async () => {
  const ag = await load('site/agentic.js'), ca = await load('site/connectagent.js');
  const served = await (await site('ultrastable.io', '/connect-agent')).text();
  assert.equal(served, ag.CONNECT_HTML(), 'agentic() runs before the page of connectagent.js, so on ultrastable.io the served page is CONNECT_HTML');
  const cfg = JSON.stringify({ name: 'ultrastable', type: 'http', url: 'https://ultrastable.io/mcp' });
  assert.ok(served.includes('href="vscode:mcp/install?' + encodeURIComponent(cfg).replace(/"/g, '&quot;') + '"') || served.includes('vscode:mcp/install?' + encodeURIComponent(cfg)), 'VS Code');
  assert.ok(served.includes('vscode-insiders:mcp/install?'), 'VS Code Insiders'); assert.ok(served.includes('cursor://anysphere.cursor-deeplink/mcp/install?name=ultrastable&config='), 'Cursor');
  // the Claude Code section is new in this change (the served page lacked it): the heading list and the command assertion follow the new page
  assert.deepEqual([...served.matchAll(/<h2>([^<]*)<\/h2>/g)].map(m => m[1]), ['Claude', 'Claude Code', 'Codex', 'Any MCP client'], 'the sections of the served page');
  assert.ok(served.includes('codex mcp add ultrastable --url https://ultrastable.io/mcp')); assert.ok(served.includes('{ "mcpServers": { "ultrastable": { "url": "https://ultrastable.io/mcp" } } }'));
  assert.ok(served.includes('<pre>claude mcp add --transport http ultrastable https://ultrastable.io/mcp</pre>'), 'the served page has the Claude Code command');
  assert.ok(!/\bsecret\b|bearer|api[_ -]?key|paste a token/i.test(served.replace(/nothing to copy or paste/i, '')), 'the page never asks for a credential');
  // the page of connectagent.js is reached on a host agentic() declines, and it offers the same clients
  assert.equal(await ag.agentic(new Request('https://example.com/connect-agent'), {}), null, 'agentic() declines a host that is not the platform');
  const other = await (await site('example.com', '/connect-agent')).text();
  assert.equal(other.includes(ca.connectLinks().claude_code.replace(/&/g, '&amp;')), true, 'the other page offers the Claude Code command');
  assert.equal(other.includes(ca.connectLinks().codex), true, 'and the Codex command');
  assert.notEqual(other, served, 'the two pages differ');
  for (const page of [served, other]) assert.ok(page.includes('https://ultrastable.io/mcp') || page.includes('https:&#x2F;&#x2F;ultrastable.io/mcp') || page.includes('ultrastable.io/mcp'), 'both open the same MCP address');
});

test('US-32-R81: the connect page served on ultrastable.io and www.ultrastable.io offers the one command for Claude Code, the same command the page of connectagent.js offers', opts, async () => {
  const ag = await load('site/agentic.js'), ca = await load('site/connectagent.js');
  const cmd = 'claude mcp add --transport http ultrastable https://ultrastable.io/mcp';
  assert.equal(ca.connectLinks().claude_code, cmd, 'one command on both pages');
  for (const host of ['ultrastable.io', 'www.ultrastable.io']) {
    const r = await site(host, '/connect-agent'); assert.equal(r.status, 200, host); assert.match(r.headers.get('content-type'), /^text\/html/, host);
    const served = await r.text(); assert.equal(served, ag.CONNECT_HTML(), host + ' serves CONNECT_HTML'); assert.ok(served.includes(cmd), host);
  }
});

// ---- Notifications and the challenge a bad token gets ------------------------------------------------------------------------------------

test('US-32-R82: the platform MCP server acknowledges every message without an id with 202 and no body, whatever its method, and runs nothing; a message with an id is answered', opts, async () => {
  const ag = await load('site/agentic.js'); const { raw, env: base } = orgEnv(); const env = { ...base, INTEGRATION_TOKENS: 'bot:' + sha('legacy') };
  const idless = [['notifications/initialized'], ['notifications/cancelled', { requestId: 1 }], ['notifications/progress', { progressToken: 't', progress: 1 }],
    ['ping'], ['tools/list'], ['initialize', { protocolVersion: '2025-06-18' }], ['server/discover'], ['resources/list'],
    ['tools/call', { name: 'submit_work', arguments: { title: 'never filed', agent: 'a', harness: 'h' } }], ['tools/call', { name: 'get_status' }]];
  for (const [method, params] of idless) {
    const r = await at(ag, '/mcp', { method: 'POST', headers: { authorization: 'Bearer legacy' }, body: JSON.stringify({ jsonrpc: '2.0', method, params }) }, env);
    assert.equal(r.status, 202, method); assert.equal(await r.text(), '', method);
  }
  assert.equal(raw.prepare('SELECT count(*) AS n FROM items').get().n, 0, 'an id-less tools/call is not run: nothing is filed');
  const r = await at(ag, '/mcp', { method: 'POST', body: rpcBody('ping', undefined, 7) }, env); assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { jsonrpc: '2.0', id: 7, result: {} }, 'the same method with an id is a request and is answered');
});

test('US-32-R39: a missing token gets the bare challenge, and a presented token that is not valid (unknown, or one of Ultrastable\'s own OAuth tokens that is revoked, expired or for another resource) gets 401 with error="invalid_token"', opts, async () => {
  const ag = await load('site/agentic.js'), oa = await load('site/oauth.js');
  assert.equal(oa.CHALLENGE(), 'Bearer resource_metadata="https://ultrastable.io/.well-known/oauth-protected-resource", scope="mcp:submit"');
  assert.equal(oa.CHALLENGE('invalid_token'), oa.CHALLENGE() + ', error="invalid_token"');
  const { raw, env: base } = orgEnv(); const env = { ...base, INTEGRATION_TOKENS: 'bot:' + sha('legacy') };
  const call = headers => at(ag, '/mcp', { method: 'POST', headers, body: rpcBody('tools/call', { name: 'submit_work', arguments: { title: 'x', agent: 'a', harness: 'h' } }) }, env);
  let r = await call({}); assert.equal(r.status, 401); assert.equal(r.headers.get('www-authenticate'), oa.CHALLENGE(), 'no token: the bare challenge');
  // the unknown token is the behaviour changed with R83: it was 403 (or 401) with the bare challenge, and is now 401 with invalid_token, like a revoked token of ours
  r = await call({ authorization: 'Bearer garbage' }); assert.equal(r.status, 401, 'an unknown token is invalid_token, not a refusal of the integration check');
  assert.equal(r.headers.get('www-authenticate'), oa.CHALLENGE('invalid_token'), 'and it is challenged with the error parameter');
  assert.equal((await r.json()).error.code, -32001);
  r = await at(ag, '/mcp', { method: 'POST', headers: { authorization: 'Bearer garbage' }, body: rpcBody('tools/call', { name: 'submit_work', arguments: { title: 'x' } }) }, base);
  assert.equal(r.status, 401, 'with no integration tokens configured the unknown token is 401 too'); assert.equal(r.headers.get('www-authenticate'), oa.CHALLENGE('invalid_token'));
  // an access token we issued that has expired is invalid_token, with the same challenge plus the error
  assert.equal(await oa.verifyAccess(new Request('https://ultrastable.io/mcp', { headers: { authorization: 'Bearer ours' } }), base), null, 'the first call creates the schema; nothing is stored yet');
  const RES = 'https://ultrastable.io/mcp', put = (tok, exp, resource = RES, revoked = 0) => raw.prepare("INSERT INTO oauth_tokens (hash, kind, family, client_id, scope, resource, expires_at, revoked, used) VALUES (?, 'access', 'f', 'c', 'mcp:submit', ?, ?, ?, 0)").run(sha(tok), resource, exp, revoked);
  put('expired', 1); put('foreign', Date.now() + 36e5, 'https://other.example/mcp'); put('revoked', Date.now() + 36e5, RES, 1);
  for (const tok of ['expired', 'foreign', 'revoked']) {
    r = await call({ authorization: 'Bearer ' + tok }); assert.equal(r.status, 401, tok);
    assert.equal(r.headers.get('www-authenticate'), oa.CHALLENGE('invalid_token'), tok);
  }
});

test('US-32-R83: a bearer token that is neither one of Ultrastable\'s own OAuth tokens nor an integration token is answered 401 with error="invalid_token", whether or not integration tokens are configured, and files nothing; a valid integration token still passes', opts, async () => {
  const ag = await load('site/agentic.js'), oa = await load('site/oauth.js'); const { raw, env: base } = orgEnv(); const env = { ...base, INTEGRATION_TOKENS: 'bot:' + sha('legacy') };
  const submit = (headers, e) => at(ag, '/mcp', { method: 'POST', headers, body: rpcBody('tools/call', { name: 'submit_work', arguments: { title: 'x', agent: 'a', harness: 'h' } }) }, e);
  for (const [name, e] of [['integration tokens configured', env], ['no integration tokens', base]]) {
    for (const tok of ['garbage', 'legacy-but-wrong', sha('legacy')]) {
      const r = await submit({ authorization: 'Bearer ' + tok }, e); assert.equal(r.status, 401, name + ': ' + tok);
      assert.equal(r.headers.get('www-authenticate'), oa.CHALLENGE('invalid_token'), name + ': ' + tok);
      assert.deepEqual((await r.json()).error, { code: -32001, message: 'invalid_token' }, name + ': ' + tok);
    }
  }
  // a header that carries no bearer token is a missing token: the bare challenge
  const basic = await submit({ authorization: 'Basic YTpi' }, env); assert.equal(basic.status, 401); assert.equal(basic.headers.get('www-authenticate'), oa.CHALLENGE());
  assert.equal(raw.prepare('SELECT count(*) AS n FROM items').get().n, 0, 'nothing is filed for a refused call');
  const ok = await submit({ authorization: 'Bearer legacy' }, env); assert.equal(ok.status, 200); assert.equal((await ok.json()).result.isError, false, 'the integration token is still the legacy path');
});

test('US-32-R90: a valid OAuth access token of Ultrastable\'s own whose scope lacks mcp:submit is answered 403 with error="insufficient_scope" and the scope it needs, and files nothing', opts, async () => {
  const ag = await load('site/agentic.js'), oa = await load('site/oauth.js'); const { raw, env: base } = orgEnv();
  assert.equal(await oa.verifyAccess(new Request('https://ultrastable.io/mcp', { headers: { authorization: 'Bearer none' } }), base), null, 'the first call creates the schema');
  raw.prepare("INSERT INTO oauth_tokens (hash, kind, family, client_id, scope, resource, expires_at, revoked, used) VALUES (?, 'access', 'f', 'c', 'read', 'https://ultrastable.io/mcp', ?, 0, 0)").run(sha('narrow'), Date.now() + 36e5);
  for (const [name, e] of [['no integration tokens', base], ['integration tokens configured', { ...base, INTEGRATION_TOKENS: 'bot:' + sha('legacy') }]]) {
    const r = await at(ag, '/mcp', { method: 'POST', headers: { authorization: 'Bearer narrow' }, body: rpcBody('tools/call', { name: 'submit_work', arguments: { title: 'x', agent: 'a', harness: 'h' } }) }, e);
    assert.equal(r.status, 403, name); assert.equal(r.headers.get('www-authenticate'), oa.CHALLENGE('insufficient_scope'), name);
    assert.match(r.headers.get('www-authenticate'), /scope="mcp:submit"/, 'the challenge names the scope the call needs');
    assert.deepEqual((await r.json()).error, { code: -32001, message: 'insufficient_scope' }, name);
  }
  assert.equal(raw.prepare('SELECT count(*) AS n FROM items').get().n, 0);
});

// ---- The platform's discovery documents ----------------------------------------------------------------------------------------------------

test('US-32-R84: the platform Agent Skills index lists two skills with the SHA-256 of the exact bytes each URL serves, under both well-known paths', opts, async () => {
  const ag = await load('site/agentic.js'), sop = await load('site/sop.js'); const { env } = orgEnv();
  const a = await at(ag, '/.well-known/agent-skills/index.json', {}, env), b = await at(ag, '/.well-known/skills/index.json', {}, env);
  const body = await a.json(); assert.deepEqual(await b.json(), body, 'the alias serves the same body'); assert.match(a.headers.get('content-type'), /^application\/json/);
  assert.equal(body.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  assert.deepEqual(body.skills.map(s => s.name), ['ultrastable-live', 'ultrastable-code-agent']);
  const files = { 'ultrastable-live': ag.SKILL_MD, 'ultrastable-code-agent': sop.SOP_MD };
  for (const s of body.skills) {
    assert.equal(s.type, 'skill-md', s.name); assert.ok(s.description.length > 20, s.name); assert.match(s.sha256, /^[0-9a-f]{64}$/, s.name);
    assert.equal(s.url, 'https://ultrastable.io/.well-known/agent-skills/' + s.name + '/SKILL.md', s.name);
    const served = await at(ag, new URL(s.url).pathname, {}, env); assert.equal(served.status, 200); assert.match(served.headers.get('content-type'), /^text\/markdown; charset=utf-8/);
    const text = await served.text(); assert.equal(text, files[s.name], s.name); assert.equal(s.sha256, sha(text), 'the digest is of the bytes the URL serves: ' + s.name);
    assert.ok(text.startsWith('---\nname: ' + s.name + '\ndescription: '), 'the file opens with front matter naming the skill: ' + s.name);
  }
  assert.equal(body.skills.some(s => 'digest' in s), false, 'the platform names the member sha256; the seed carries digest as sha256:<hex> (section 3.8, ruling 7)');
});

test('US-32-R85: the platform API catalog is an RFC 9727 linkset with four anchors and service-desc links that resolve to served documents', opts, async () => {
  const ag = await load('site/agentic.js'); const { env } = orgEnv();
  const r = await at(ag, '/.well-known/api-catalog', {}, env); assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'); assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
  const set = (await r.json()).linkset; const O = 'https://ultrastable.io';
  assert.deepEqual(set.map(e => e.anchor), [O + '/api/v1', O + '/api/live', O + '/changelog.json', O + '/mcp']);
  const rel = (e, k) => (e[k] || []).map(x => x.href);
  assert.deepEqual(rel(set[0], 'service-desc'), [O + '/openapi.json']); assert.deepEqual(rel(set[0], 'service-doc'), [O + '/llms.txt']); assert.deepEqual(rel(set[0], 'status'), [O + '/api/v1/status']);
  assert.deepEqual(rel(set[1], 'service-desc'), [O + '/openapi.json']); assert.deepEqual(rel(set[1], 'service-doc'), [O + '/llms.txt']);
  assert.deepEqual(rel(set[2], 'alternate'), [O + '/changelog.xml']); assert.equal(set[2].alternate[0].type, 'application/rss+xml'); assert.deepEqual(rel(set[2], 'service-doc'), [O + '/llms.txt']);
  assert.deepEqual(rel(set[3], 'service-desc'), [O + '/.well-known/mcp/server-card.json']);
  for (const href of [O + '/openapi.json', O + '/.well-known/mcp/server-card.json']) assert.equal((await at(ag, new URL(href).pathname, {}, env)).status, 200, href);
  assert.equal((await (await site('ultrastable.io', '/llms.txt')).text()).includes('[API catalog](https://ultrastable.io/.well-known/api-catalog)'), true, 'llms.txt points to the catalog');
});

test('US-32-R86: the platform MCP server card says the read tools are open and submit_work needs OAuth 2.1, and is served under four paths, also as a list of servers', opts, async () => {
  const ag = await load('site/agentic.js'); const { env } = orgEnv(); const O = 'https://ultrastable.io';
  const card = await (await at(ag, '/.well-known/mcp/server-card.json', {}, env)).json();
  assert.equal(card.serverInfo.name, 'ultrastable-live'); assert.deepEqual(card.transport, { type: 'streamable-http', endpoint: O + '/mcp' }); assert.deepEqual(card.capabilities, { tools: { listChanged: false } });
  assert.equal(card.authentication.required, false); assert.deepEqual(card.authentication.requiredFor, ['submit_work']); assert.equal(card.authentication.scheme, 'oauth2.1');
  assert.equal(card.authentication.protected_resource_metadata, O + '/.well-known/oauth-protected-resource'); assert.equal(card.authentication.authorization_server, O + '/.well-known/oauth-authorization-server');
  assert.equal(card.authentication.legacy, 'bearer integration token'); assert.equal(card.documentation, O + '/llms.txt');
  for (const p of ['/.well-known/mcp', '/.well-known/mcp.json']) { const r = await at(ag, p, {}, env); assert.equal(r.status, 200, p); assert.deepEqual(await r.json(), card, p); }
  const list = await (await at(ag, '/.well-known/mcp/server-cards.json', {}, env)).json(); assert.deepEqual(list, { servers: [card] });
  assert.equal(card.authentication.required, false, 'the card is consistent with the server: tools/list needs no credential');
  const tools = (await (await at(ag, '/mcp', { method: 'POST', body: rpcBody('tools/list') }, env)).json()).result.tools; assert.equal(tools.length, ALL_TOOLS(ag).length);
});

test('US-32-R87: the platform OpenAPI document is 3.1.0 with the control-plane paths, the live record, the ignition reading and /mcp, and the agent card is served at both well-known names', opts, async () => {
  const ag = await load('site/agentic.js'), cp = await load('site/controlplane.js'); const { env } = orgEnv();
  const r = await at(ag, '/openapi.json', {}, env); assert.equal(r.headers.get('content-type'), 'application/vnd.oai.openapi+json; charset=utf-8');
  const doc = await r.json(); assert.equal(doc.openapi, '3.1.0'); assert.equal(doc.info.version, cp.API_VERSION); assert.deepEqual(doc.servers, [{ url: 'https://ultrastable.io' }]);
  for (const p of [...Object.keys(cp.OPENAPI_PATHS), '/api/live', '/api/v1/ignition', '/mcp']) assert.ok(doc.paths[p], p);
  assert.deepEqual(doc.components.securitySchemes.bearer, { type: 'http', scheme: 'bearer', description: 'Integration token; only POST /api/v1/intake needs one' });
  const ids = []; for (const p of Object.values(doc.paths)) for (const op of Object.values(p)) if (op.operationId) ids.push(op.operationId);
  assert.equal(new Set(ids).size, ids.length, 'operationIds are unique'); assert.ok(ids.includes('mcp') && ids.includes('submitIntake') && ids.includes('getIgnitionStage'));
  const strip = ({ signatures, ...rest }) => rest;
  const a = await (await at(ag, '/.well-known/agent-card.json', {}, env)).json(), b = await (await at(ag, '/.well-known/agent.json', {}, env)).json();
  assert.deepEqual(strip(a), strip(b), 'the alias serves the same card'); assert.equal(a.signatures.length, 1); assert.equal(b.signatures.length, 1);
  assert.equal(a.securitySchemes.oauth2.flows.authorizationCode.tokenUrl, 'https://ultrastable.io/oauth/token'); assert.deepEqual(Object.keys(a.securitySchemes).sort(), ['bearer', 'oauth2']);
});

test('US-32-R88: the platform llms.txt names the connect page and the MCP endpoint with the number of tools and every tool name generated from the code that serves them', opts, async () => {
  const ag = await load('site/agentic.js'); const tools = ALL_TOOLS(ag).map(t => t.name);
  const r = await site('ultrastable.io', '/llms.txt'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /^text\/plain/);
  const txt = await r.text(); assert.ok(txt.startsWith('# Ultrastable\n\n> ')); assert.ok(txt.includes('/mcp (' + tools.length + ' tools, generated from the code that serves them: ' + tools.join(', ') + ')'));
  for (const t of tools) assert.ok(txt.includes(t), t); assert.ok(txt.includes('[Connect your agent](https://ultrastable.io/connect-agent)'));
  assert.ok(txt.includes('[A2A agent card](https://ultrastable.io/.well-known/agent-card.json)')); assert.ok(txt.includes('POST /api/v1/intake submits a backlog item with an integration bearer token'));
  assert.equal(tools.filter(n => n === 'submit_work').length, 1); assert.equal(new Set(tools).size, tools.length, 'no tool name is listed twice');
});

// ---- What submit_work and the REST intake accept -------------------------------------------------------------------------------------------

test('US-32-R89: intake clips a title to 200 and a detail to 4000 characters, reads an unknown kind as request, clamps the priority to 1..90 with 50 as the default, cleans the attribution to 60 characters, and refuses an empty title; the submit_work schema declares those limits', opts, async () => {
  const cp = await load('site/controlplane.js'), ag = await load('site/agentic.js'); const { raw, env } = orgEnv();
  let tick = 0; const file = async b => { const r = await cp.submitIntake(env, 'bot', b, Date.UTC(2026, 10, 26) + (tick++)); return { r, row: r.body.id ? raw.prepare('SELECT * FROM items WHERE id = ?').get(r.body.id) : null }; };
  let x = await file({ title: '  ' }); assert.equal(x.r.status, 422); assert.deepEqual(x.r.body, { error: 'title is required' }); assert.equal(raw.prepare('SELECT count(*) AS n FROM items').get().n, 0, 'nothing is filed');
  x = await file({ title: 'T'.repeat(300), detail: 'D'.repeat(5000), kind: 'invention', priority: 'urgent', agent: 'claude code!', harness: 'vscode/claude <x>' });
  assert.equal(x.r.status, 201); assert.match(x.r.body.id, /^IN-20261126-[0-9a-f]{6}$/); assert.equal(x.row.title, x.r.body.id + ': ' + 'T'.repeat(200)); assert.equal(x.row.disposition.length, 4000);
  assert.equal(x.row.kind, 'intake-request'); assert.equal(x.row.priority, 50); assert.equal(x.row.status, 'open'); assert.equal(x.row.owner_role, 'product-manager');
  assert.equal(x.row.surface, 'integration:bot agent:claudecode harness:vscode/claudex', 'characters outside letters, digits and . _ : / - are removed');
  assert.deepEqual(x.r.body.attributed_to, { agent: 'claudecode', harness: 'vscode/claudex' }); assert.equal(x.r.body.url, 'https://ultrastable.io/api/v1/work/' + x.r.body.id);
  for (const [given, want] of [[500, 90], [-4, 1], [0, 50], [7, 7], [90, 90], [91, 90]]) assert.equal((await file({ title: 't', priority: given })).row.priority, want, 'priority ' + given);
  for (const k of ['idea', 'request', 'bug', 'question']) assert.equal((await file({ title: 't', kind: k })).row.kind, 'intake-' + k, k);
  x = await file({ title: 'long attribution', agent: 'a'.repeat(100), harness: 'h'.repeat(100) }); assert.equal(x.r.body.attributed_to.agent.length, 60); assert.equal(x.r.body.attributed_to.harness.length, 60);
  // the MCP tool declares the same limits in its input schema
  const t = ag.WRITE_TOOLS[0]; assert.equal(t.name, 'submit_work'); assert.deepEqual(t.inputSchema.required, ['title']); assert.equal(t.inputSchema.additionalProperties, false);
  assert.equal(t.inputSchema.properties.title.maxLength, 200); assert.equal(t.inputSchema.properties.detail.maxLength, 4000); assert.deepEqual(t.inputSchema.properties.kind.enum, ['idea', 'request', 'bug', 'question']);
  assert.deepEqual([t.inputSchema.properties.priority.minimum, t.inputSchema.properties.priority.maximum], [1, 90]); assert.deepEqual(Object.keys(t.inputSchema.properties).sort(), ['agent', 'detail', 'harness', 'kind', 'priority', 'title']);
  assert.equal(t.inputSchema.properties.agent.maxLength, 60); assert.equal(t.inputSchema.properties.harness.maxLength, 60);
  assert.equal('pattern' in t.inputSchema.properties.agent || 'pattern' in t.inputSchema.properties.harness, false, 'no pattern: characters outside the set are removed by intake, not refused');
  const listed = (await (await at(ag, '/mcp', { method: 'POST', body: rpcBody('tools/list') }, env)).json()).result.tools.find(x => x.name === 'submit_work');
  assert.deepEqual(listed.inputSchema, t.inputSchema, 'tools/list serves the same schema');
  assert.deepEqual(t.annotations, { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
});
