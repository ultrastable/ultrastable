// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-32 (open standards and agent-consumable surfaces), the platform's agent surfaces: the live MCP server and its one write tool, the signed A2A agent card
// and task binding, the agent-readiness layer (Link headers, Markdown for agents, robots rules, WebMCP, the connect page), AuthZEN decisions backed by the trust
// ledger and Web Bot Auth signing and verification. The seed does not carry these files (they are the platform's site/), so every test is skipped where the monorepo is
// absent (existsSync guard, as in spec-30-owner-surfaces.test.js). The network is a fake, the databases are node:sqlite in memory and the clocks are injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const have = existsSync(root + 'site/agentic.js') && existsSync(root + 'site/oauth.js') && existsSync(root + 'site/webbotauth.js');
const opts = { skip: have ? false : 'the monorepo surfaces (site/) are not in this checkout' };
const load = p => import(pathToFileURL(root + p).href);

const d1 = db => ({ prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; },
  all: async () => ({ results: db.prepare(sql).all(...a) }), first: async () => db.prepare(sql).get(...a) || null,
  run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) }, changes: Number(r.changes) }; } }; return st; } });
const sha = s => createHash('sha256').update(s).digest('hex');
const ITEMS = "CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'work', project TEXT, owner_role TEXT NOT NULL, trigger_on TEXT, done_check TEXT NOT NULL, closing_probe TEXT, priority INTEGER NOT NULL DEFAULT 50, status TEXT NOT NULL DEFAULT 'open', surface TEXT, disposition TEXT, blocker TEXT, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))";
const orgEnv = (extra = {}) => {
  const raw = new DatabaseSync(':memory:'); raw.exec(ITEMS);
  raw.exec('CREATE TABLE claims (item_id TEXT, agent TEXT, claimed_at TEXT, heartbeat_at TEXT)');
  raw.exec('CREATE TABLE dispatches (id INTEGER PRIMARY KEY, tick_id INTEGER, role_id TEXT, item_id TEXT, model TEXT, status TEXT, at TEXT)');
  raw.exec('CREATE TABLE transparency_parts (generated TEXT, part INTEGER, total INTEGER, body TEXT)');
  const db = d1(raw);
  return { raw, env: { DB: db, ORG: db, ASSETS: { get: async () => null, list: async () => ({ keys: [] }) }, ...extra } };
};
const at = (ag, path, init, env) => ag.agentic(new Request('https://ultrastable.io' + path, init), env);
const rpcBody = (method, params, id = 1) => JSON.stringify({ jsonrpc: '2.0', id, method, params });

// ---- The platform MCP server ---------------------------------------------------------------------------------------------------------------

test('US-32-R32: the platform MCP server is stateless, speaks three versions, serves read tools with no credential and says plainly when its data is missing', opts, async () => {
  const ag = await load('site/agentic.js');
  assert.deepEqual(ag.MCP_VERSIONS, ['2026-07-28', '2025-11-25', '2025-06-18']);
  const { raw, env } = orgEnv();
  const rpc = async (method, params, headers = {}) => { const r = await at(ag, '/mcp', { method: 'POST', headers, body: rpcBody(method, params) }, env); return r; };
  for (const v of ag.MCP_VERSIONS) assert.equal((await (await rpc('initialize', { protocolVersion: v })).json()).result.protocolVersion, v);
  assert.equal((await (await rpc('initialize', {})).json()).result.protocolVersion, '2025-06-18', 'a client that names no known version gets 2025-06-18');
  const disc = await rpc('server/discover'); assert.equal(disc.headers.get('mcp-session-id'), null);
  const dj = (await disc.json()).result; assert.deepEqual(dj.supportedVersions, ag.MCP_VERSIONS); assert.equal(dj.serverInfo.name, 'ultrastable-live');
  assert.deepEqual((await (await rpc('ping')).json()).result, {});
  const refused = await rpc('ping', undefined, { 'mcp-protocol-version': '1999-01-01' }); assert.equal(refused.status, 400); assert.equal((await refused.json()).error.code, -32600);
  assert.equal((await at(ag, '/mcp', { method: 'GET' }, env)).status, 405);
  const badJson = await at(ag, '/mcp', { method: 'POST', body: '{' }, env); assert.equal(badJson.status, 400); assert.equal((await badJson.json()).error.code, -32700);
  assert.equal((await at(ag, '/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) }, env)).status, 202);
  assert.equal((await (await rpc('resources/list')).json()).error.code, -32601);
  const list = (await (await rpc('tools/list')).json()).result.tools;
  assert.deepEqual(list.map(t => t.name), [...ag.LIVE_TOOLS, ...ag.TOOLS, ...ag.WRITE_TOOLS].map(t => t.name));
  for (const t of list.filter(x => x.name !== 'submit_work')) { assert.equal(t.annotations.readOnlyHint, true, t.name); assert.equal(t.annotations.openWorldHint, false, t.name); assert.equal(t.inputSchema.additionalProperties, false, t.name); }
  assert.equal(list.filter(t => t.annotations.readOnlyHint === false).length, 1, 'exactly one tool is not read-only');
  assert.equal((await (await rpc('tools/call', { name: 'nope' })).json()).error.code, -32602);
  const noSnap = (await (await rpc('tools/call', { name: 'get_scoreboard' })).json()).result; assert.equal(noSnap.isError, true); assert.equal(noSnap.content[0].text, 'No snapshot published yet.');
  raw.exec("INSERT INTO transparency_parts VALUES ('g', 0, 1, '" + JSON.stringify({ generated: 'g', scoreboard: { a: 1 }, gaps: [] }) + "')");
  assert.deepEqual(JSON.parse((await (await rpc('tools/call', { name: 'get_scoreboard' })).json()).result.content[0].text), { a: 1 }, 'a snapshot tool answers from the published snapshot');
  const std = JSON.parse((await (await rpc('tools/call', { name: 'get_standards' })).json()).result.content[0].text);
  assert.ok(std.checked && std.entries.length > 0 && Object.keys(std.entries[0]).sort().join() === 'body,id,name,status,support,tracked_by', 'the standards tool serves the generated register view');
  const noOrg = (await (await at(ag, '/mcp', { method: 'POST', body: rpcBody('tools/call', { name: 'get_status' }) }, { DB: env.DB })).json()).result;
  assert.equal(noOrg.isError, true); assert.equal(noOrg.content[0].text, 'Org database not bound.', 'a live tool with no database says so');
});

test('US-32-R33: submit_work is the one MCP write: it asks for a credential with the OAuth challenge, requires the agent and harness, files an attributed item, and records a verified signature', opts, async () => {
  const ag = await load('site/agentic.js'), wba = await load('site/webbotauth.js');
  const { raw, env: base } = orgEnv();
  const env = { ...base, INTEGRATION_TOKENS: 'bot:' + sha('legacy') };
  const submit = (args, headers = {}, e = env) => at(ag, '/mcp', { method: 'POST', headers, body: rpcBody('tools/call', { name: 'submit_work', arguments: { title: 'From a test', kind: 'idea', ...args } }) }, e);
  let r = await submit({}); assert.equal(r.status, 401);
  assert.equal(r.headers.get('www-authenticate'), 'Bearer resource_metadata="https://ultrastable.io/.well-known/oauth-protected-resource", scope="mcp:submit"');
  assert.equal((await r.json()).error.code, -32001);
  r = await submit({}, { authorization: 'Bearer wrong' }); assert.ok([401, 403].includes(r.status)); assert.ok(r.headers.get('www-authenticate'));
  r = await submit({}, { authorization: 'Bearer legacy' }); const need = (await r.json()).result; assert.equal(need.isError, true); assert.equal(need.content[0].text, 'agent and harness are required');
  r = await submit({ agent: 'ci', harness: 'cli' }, { authorization: 'Bearer legacy' }); assert.equal(r.status, 200);
  const filed = JSON.parse((await r.json()).result.content[0].text); assert.match(filed.id, /^IN-\d{8}-[0-9a-f]{6}$/); assert.equal(filed.status, 'open');
  const row = raw.prepare('SELECT surface, kind, status, owner_role FROM items WHERE id = ?').get(filed.id);
  assert.deepEqual({ ...row }, { surface: 'integration:bot agent:ci harness:cli', kind: 'intake-idea', status: 'open', owner_role: 'product-manager' });
  // WEB-BOT-AUTH-1: a signature that verifies against the agent's own key directory is added to the record. The peer directory is fetched through a fake network.
  const realFetch = globalThis.fetch; const dir = await wba.directory(env);
  globalThis.fetch = async url => { assert.equal(String(url), 'https://ultrastable.io' + wba.DIRECTORY_PATH); return new Response(JSON.stringify(dir), { headers: { 'content-type': wba.DIRECTORY_TYPE } }); };
  try {
    const sig = await wba.signRequest(env, 'https://ultrastable.io/mcp');
    r = await submit({ agent: 'ci', harness: 'cli', title: 'Signed' }, { authorization: 'Bearer legacy', ...sig });
    const signed = JSON.parse((await r.json()).result.content[0].text);
    assert.ok(raw.prepare('SELECT surface FROM items WHERE id = ?').get(signed.id).surface.includes('wba-ultrastable.io'), 'the verified origin is named in the harness record');
  } finally { globalThis.fetch = realFetch; }
});

test('US-32-R34: the agent card is served with a detached ES256 signature over its canonical JSON, the Worker keeps and rotates the key itself, and a card cached before a rotation still verifies', opts, async () => {
  const ag = await load('site/agentic.js');
  assert.equal(ag.jcs({ b: 1, a: [2, { d: 1, c: 'x' }], z: null }), '{"a":[2,{"c":"x","d":1}],"b":1,"z":null}', 'keys are sorted at every depth');
  assert.equal(ag.CARD_KEY_TTL_MS, 90 * 864e5); assert.equal(ag.JWKS_PATH, '/.well-known/jwks.json');
  const store = new Map(); const env = { ASSETS: { get: async k => store.get(k) || null, put: async (k, v) => { store.set(k, v); } } };
  const dec = x => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const verify = async (card, jwks) => {
    const { signatures, ...body } = card, sg = signatures[0], head = JSON.parse(new TextDecoder().decode(dec(sg.protected))), jwk = jwks.keys.find(k => k.kid === head.kid);
    if (!jwk) return false; assert.deepEqual([head.alg, head.typ, head.jku], ['ES256', 'JOSE', 'https://ultrastable.io/.well-known/jwks.json']);
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const payload = btoa(String.fromCharCode(...new TextEncoder().encode(ag.jcs(body)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, dec(sg.signature), new TextEncoder().encode(sg.protected + '.' + payload));
  };
  const t0 = Date.UTC(2026, 10, 1); ag._resetCardKey();
  const card = await ag.signedCard(env, t0), jwks = await ag.cardJwks(env, t0);
  assert.equal(card.protocolVersion, '1.0'); assert.equal(card.signatures.length, 1); assert.equal(await verify(card, jwks), true);
  assert.deepEqual(Object.keys(jwks.keys[0]).sort(), ['alg', 'crv', 'kid', 'kty', 'use', 'x', 'y'], 'the key set never carries the private half'); assert.equal(jwks.keys[0].alg, 'ES256');
  assert.equal(await verify({ ...card, name: 'Someone else' }, jwks), false, 'a changed card fails');
  ag._resetCardKey(); assert.equal((await ag.cardJwks(env, t0 + 864e5)).keys[0].kid, jwks.keys[0].kid, 'a new isolate reads the stored key, it does not make another');
  assert.equal(JSON.parse(store.get('agent-card-key:v1')).created, t0);
  ag._resetCardKey(); const later = t0 + ag.CARD_KEY_TTL_MS; const jw2 = await ag.cardJwks(env, later);
  assert.notEqual(jw2.keys[0].kid, jwks.keys[0].kid, 'a key aged 90 days is replaced on the first request that sees it'); assert.equal(jw2.keys[1].kid, jwks.keys[0].kid, 'the previous public key stays for one more period');
  assert.equal(await verify(card, jw2), true, 'a card cached before the rotation still verifies');
  const served = await (await at(ag, '/.well-known/agent-card.json', {}, env)).json(); assert.ok(served.signatures);
  const set = await at(ag, ag.JWKS_PATH, {}, env); assert.match(set.headers.get('content-type'), /^application\/jwk-set\+json/);
  ag._resetCardKey();
  const c = ag.AGENT_CARD; assert.equal(c.supportedInterfaces[0].url, 'https://ultrastable.io/a2a'); assert.equal(c.supportedInterfaces[0].protocolBinding, 'JSONRPC');
  assert.deepEqual(c.additionalInterfaces.map(i => i.transport).sort(), ['HTTP+JSON', 'JSONRPC', 'MCP']);
  assert.deepEqual(c.skills.map(s => s.id), ['status', 'agents', 'backlog', 'products', 'brief', 'handoff', 'intake']);
});

test('US-32-R35: the A2A binding takes a message as an intake item for a caller with the integration credential and reads the task back, under either generation of method names', opts, async () => {
  const ag = await load('site/agentic.js');
  const { raw, env: base } = orgEnv(); const env = { ...base, INTEGRATION_TOKENS: 'bot:' + sha('tok') };
  const a2a = (method, params, headers = { authorization: 'Bearer tok' }, id = 7) => at(ag, '/a2a', { method: 'POST', headers, body: rpcBody(method, params, id) }, env);
  assert.equal((await at(ag, '/a2a', { method: 'GET' }, env)).status, 405);
  let r = await a2a('SendMessage', { message: { parts: [{ text: 'x' }] } }, {}); assert.equal(r.status, 401); assert.equal(r.headers.get('www-authenticate'), 'Bearer');
  assert.equal((await a2a('SendMessage', { message: { parts: [] } })).status, 200);
  assert.equal((await (await a2a('SendMessage', { message: { parts: [] } })).json()).error.code, -32602, 'a message with no text part is refused');
  r = await (await a2a('SendMessage', { message: { parts: [{ text: 'Fix the page\nand the footer' }] }, metadata: { kind: 'bug', agent: 'copilot', harness: 'vscode' } })).json();
  const t = r.result.task; assert.match(t.id, /^IN-/); assert.equal(t.contextId, t.id); assert.equal(t.status.state, 'TASK_STATE_SUBMITTED'); assert.deepEqual(t.artifacts, []);
  const row = raw.prepare('SELECT title, kind, surface FROM items WHERE id = ?').get(t.id); assert.ok(row.title.endsWith(': Fix the page')); assert.equal(row.kind, 'intake-bug'); assert.equal(row.surface, 'integration:bot agent:copilot harness:vscode');
  r = await (await a2a('message/send', { message: { parts: [{ text: 'Old name' }] } })).json(); assert.match(r.result.task.id, /^IN-/, 'the 0.3 name is an alias of SendMessage');
  const get = async (id, m = 'GetTask') => (await (await a2a(m, id === undefined ? {} : { id })).json());
  for (const [status, state] of [['open', 'TASK_STATE_SUBMITTED'], ['ready', 'TASK_STATE_SUBMITTED'], ['claimed', 'TASK_STATE_WORKING'], ['in_progress', 'TASK_STATE_WORKING'], ['blocked', 'TASK_STATE_INPUT_REQUIRED'], ['done', 'TASK_STATE_COMPLETED']]) {
    raw.prepare('UPDATE items SET status = ? WHERE id = ?').run(status, t.id);
    const g = await get(t.id); assert.equal(g.result.task.status.state, state, status); assert.equal(g.result.task.artifacts[0].parts[0].text, row.title);
  }
  assert.equal((await get(t.id, 'tasks/get')).result.task.id, t.id); assert.equal((await get('IN-nope')).error.message, 'TaskNotFoundError'); assert.equal((await get()).error.code, -32602);
  assert.equal((await (await a2a('tasks/cancel', {})).json()).error.code, -32601);
});

// ---- Agent-readiness -----------------------------------------------------------------------------------------------------------------------

test('US-32-R36: an agent that asks for Markdown gets the page as Markdown, every HTML page says it varies on Accept, and the home page points to the discovery documents in a Link header', opts, async () => {
  const rd = await load('site/readiness.js'), ag = await load('site/agentic.js');
  const req = (accept, method = 'GET') => new Request('https://ultrastable.io/how', { method, headers: accept ? { accept } : {} });
  assert.equal(rd.wantsMarkdown(req('text/markdown')), true); assert.equal(rd.wantsMarkdown(req('text/markdown, text/html')), true, 'equal preference goes to Markdown');
  assert.equal(rd.wantsMarkdown(req('text/html,text/markdown;q=0.5')), false); assert.equal(rd.wantsMarkdown(req('text/html')), false); assert.equal(rd.wantsMarkdown(req()), false);
  assert.equal(rd.wantsMarkdown(req('text/markdown', 'POST')), false); assert.equal(rd.wantsMarkdown(req('text/markdown', 'HEAD')), true);
  const html = '<!doctype html><title>How it works &amp; why</title><meta name="description" content="One loop."><nav><a href="/x">skip</a></nav><main><h1>How</h1><p>It <strong>runs</strong> a <a href="/live">loop</a>.</p><ul><li>one</li></ul><pre>a &lt; b</pre><table><tr><th>k</th><td>v|w</td></tr></table><script>evil()</script><form><p>no</p></form></main>';
  const md = rd.htmlToMarkdown(html, 'https://ultrastable.io/how');
  assert.ok(md.startsWith('# How it works & why\n\n> One loop.\n\nSource: https://ultrastable.io/how\n\n## How\n\nIt **runs** a [loop](/live).'), md);
  for (const needle of ['- one', '```\na < b\n```', '| k | v\\|w |']) assert.ok(md.includes(needle), needle);
  for (const gone of ['evil()', 'skip', 'no\n']) assert.ok(!md.includes(gone), gone);
  const res = () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '9' } });
  const m = await rd.negotiate(res(), req('text/markdown')); assert.match(m.headers.get('content-type'), /^text\/markdown/); assert.match(m.headers.get('vary'), /Accept/);
  assert.equal(m.headers.get('x-markdown-tokens'), String(Math.ceil((await m.text()).length / 4))); assert.equal(m.headers.get('content-length'), null);
  assert.equal(await (await rd.negotiate(res(), req('text/markdown', 'HEAD'))).text(), '', 'a HEAD request gets headers and no body');
  const h = await rd.negotiate(res(), req('text/html')); assert.match(h.headers.get('vary'), /Accept/); assert.match(h.headers.get('content-type'), /text\/html/);
  const js = new Response('{}', { headers: { 'content-type': 'application/json' } }); assert.equal(await rd.negotiate(js, req('text/markdown')), js, 'only HTML is negotiated');
  const home = ag.withLinks(new Response('x', { headers: { 'content-type': 'text/html' } }), new Request('https://ultrastable.io/'));
  for (const rel of ['api-catalog', 'agent-card', 'service-desc', 'mcp-server-card', 'describedby']) assert.ok(home.headers.get('link').includes(`rel="${rel}"`), rel);
  assert.ok(!ag.withLinks(new Response('x', { headers: { 'content-type': 'text/html' } }), new Request('https://ultrastable.io/how')).headers.get('link'), 'the Link header is on the home page only');
  assert.ok(!ag.withLinks(new Response('{}', { headers: { 'content-type': 'application/json' } }), new Request('https://ultrastable.io/')).headers.get('link'));
});

test('US-32-R37: robots.txt carries the content signal, allows search crawlers and agents acting for a person by name, and disallows crawlers that only gather training data', opts, async () => {
  const rd = await load('site/readiness.js'), ag = await load('site/agentic.js');
  assert.equal(ag.CONTENT_SIGNAL, 'Content-Signal: search=yes, ai-input=yes, ai-train=no\n');
  const txt = rd.robots(ag.CONTENT_SIGNAL, 'https://ultrastable.io/sitemap.xml');
  const groups = txt.trim().split('\n\n');
  assert.match(groups[0], /^User-agent: \*\nContent-Signal: search=yes, ai-input=yes, ai-train=no\nAllow: \/$/);
  const agentGroup = groups.find(g => g.includes('User-agent: ' + rd.AGENT_BOTS[0])); for (const b of rd.AGENT_BOTS) assert.ok(agentGroup.includes('User-agent: ' + b), b); assert.ok(agentGroup.includes('Allow: /') && agentGroup.includes('ai-input=yes'));
  const trainGroup = groups.find(g => g.includes('User-agent: ' + rd.TRAINING_BOTS[0])); for (const b of rd.TRAINING_BOTS) assert.ok(trainGroup.includes('User-agent: ' + b), b); assert.ok(trainGroup.endsWith('Disallow: /') && !trainGroup.includes('Allow'));
  assert.deepEqual(rd.TRAINING_BOTS.filter(b => rd.AGENT_BOTS.includes(b)), [], 'no crawler is both allowed and disallowed');
  for (const b of ['GPTBot', 'ClaudeBot', 'Google-Extended']) assert.ok(rd.TRAINING_BOTS.includes(b), b); for (const b of ['ChatGPT-User', 'Claude-User', 'PerplexityBot']) assert.ok(rd.AGENT_BOTS.includes(b), b);
  assert.ok(txt.endsWith('Sitemap: https://ultrastable.io/sitemap.xml\n'));
});

test('US-32-R38: WebMCP gives a browser agent four read-only tools over the public API, and the connect page opens the MCP address in each client with nothing to copy or paste as a secret', opts, async () => {
  const rd = await load('site/readiness.js'), ag = await load('site/agentic.js'), ca = await load('site/connectagent.js');
  const registered = [], calls = [];
  const fake = { modelContext: { provideContext: ({ tools }) => registered.push(...tools) } };
  new Function('navigator', 'fetch', 'console', rd.WEBMCP_JS)(fake, async url => { calls.push(String(url)); return { json: async () => ({ ok: 1 }) }; }, console);
  assert.deepEqual(registered.map(t => t.name), ['ultrastable_status', 'ultrastable_agents', 'ultrastable_work', 'ultrastable_brief']); assert.ok(registered.every(t => t.annotations.readOnlyHint === true));
  const out = await registered[2].execute({ view: 'blocked', limit: 5 }); assert.equal(JSON.parse(out.content[0].text).ok, 1);
  await registered[0].execute(); await registered[3].execute(); assert.deepEqual(calls, ['/api/v1/work?view=blocked&limit=5', '/api/v1/status', '/api/v1/companion/brief'], 'GET only, on the same origin');
  assert.doesNotMatch(rd.WEBMCP_JS, /method:\s*['"]POST/); const legacy = []; new Function('navigator', 'fetch', 'console', rd.WEBMCP_JS)({ modelContext: { registerTool: t => legacy.push(t) } }, async () => ({ json: async () => ({}) }), console); assert.equal(legacy.length, 4, 'registerTool is the fallback');
  new Function('navigator', 'fetch', 'console', rd.WEBMCP_JS)({}, null, console);  // a browser with no WebMCP runs nothing
  const l = ca.connectLinks(); const cfg = JSON.stringify({ name: 'ultrastable', type: 'http', url: 'https://ultrastable.io/mcp' });
  assert.equal(l.vscode, 'vscode:mcp/install?' + encodeURIComponent(cfg)); assert.ok(l.vscode_insiders.startsWith('vscode-insiders:mcp/install?'));
  assert.match(l.cursor, /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=ultrastable&config=/); assert.equal(l.claude_code, 'claude mcp add --transport http ultrastable https://ultrastable.io/mcp');
  assert.equal(l.codex, 'codex mcp add ultrastable --url https://ultrastable.io/mcp'); assert.deepEqual(JSON.parse(l.mcp_json), { mcpServers: { ultrastable: { type: 'http', url: 'https://ultrastable.io/mcp' } } });
  const page = ag.CONNECT_HTML(); assert.ok(page.includes('vscode:mcp/install') && page.includes('cursor://anysphere') && page.includes('https://ultrastable.io/mcp'));
  assert.ok(!/\bsecret\b|bearer|api[_ -]?key|paste a token/i.test(page.replace(/Nothing to copy or paste/, '')), 'the page never asks for a credential');
  const served = await (await at(ag, '/connect-agent', {}, {})).text(); assert.equal(served, page);
});

// ---- AuthZEN ---------------------------------------------------------------------------------------------------------------------------------

const ledger = rows => { const raw = new DatabaseSync(':memory:'); raw.exec('CREATE TABLE trust_ledger (surface TEXT, action_class TEXT, ok INT, fail INT, trust_score REAL, ladder_position TEXT, PRIMARY KEY(surface, action_class))');
  for (const [s, a, rung, score] of rows) raw.prepare('INSERT INTO trust_ledger VALUES (?,?,1,0,?,?)').run(s, a, score ?? 0.5, rung); return { ORG: d1(raw) }; };
const q = (surface, action, type = 'surface') => ({ subject: { type: 'agent', id: 'claude-code' }, resource: { type, id: surface }, action: { name: action } });
const ask = async (az, path, body, env, method = 'POST', headers = {}) => { const r = await az.authzen(new Request('https://ultrastable.io' + path, { method, headers, body: body && method === 'POST' ? JSON.stringify(body) : undefined }), env); return { status: r.status, headers: r.headers, body: await r.json() }; };

test('US-32-R45: the AuthZEN endpoints publish their metadata, take one evaluation or up to fifty, echo the request id, and refuse what is malformed', opts, async () => {
  const az = await load('site/authzen.js'); const env = ledger([['site', 'deploy', 'autonomous']]);
  const meta = await ask(az, '/.well-known/authzen-configuration', null, env, 'GET');
  assert.deepEqual(meta.body, { policy_decision_point: 'https://ultrastable.io', access_evaluation_endpoint: 'https://ultrastable.io/access/v1/evaluation', access_evaluations_endpoint: 'https://ultrastable.io/access/v1/evaluations' });
  assert.equal(meta.headers.get('cache-control'), 'public, max-age=300');
  let r = await ask(az, '/access/v1/evaluation', q('site', 'deploy'), env, 'POST', { 'x-request-id': 'req-9' }); assert.equal(r.status, 200); assert.equal(r.body.decision, true); assert.equal(r.headers.get('x-request-id'), 'req-9'); assert.equal(r.headers.get('cache-control'), 'no-store');
  r = await ask(az, '/access/v1/evaluation', { subject: {} }, env); assert.equal(r.status, 400);
  for (const miss of ['subject', 'resource', 'action']) { const b = q('site', 'deploy'); delete b[miss]; assert.equal((await ask(az, '/access/v1/evaluation', b, env)).status, 400, miss); }
  r = await ask(az, '/access/v1/evaluation', null, env, 'GET'); assert.equal(r.status, 405); assert.equal(r.headers.get('allow'), 'POST');
  assert.equal((await az.authzen(new Request('https://ultrastable.io/access/v1/evaluation', { method: 'POST', body: 'not json' }), env)).status, 400);
  assert.equal((await ask(az, '/access/v1/evaluation', q('site', 'deploy'), {})).status, 503, 'with no ledger bound the endpoint says so');
  r = await ask(az, '/access/v1/evaluations', { subject: q('a', 'b').subject, evaluations: [{ resource: q('site', 'x').resource, action: { name: 'deploy' } }, { resource: q('zzz', 'x').resource, action: { name: 'deploy' } }] }, env);
  assert.deepEqual(r.body.evaluations.map(e => e.decision), [true, false], 'each evaluation inherits what it does not name from the request');
  assert.equal((await ask(az, '/access/v1/evaluations', { evaluations: [] }, env)).status, 400);
  const many = { subject: q('a', 'b').subject, resource: q('site', 'x').resource, action: { name: 'deploy' }, evaluations: Array.from({ length: 80 }, () => ({})) };
  assert.equal((await ask(az, '/access/v1/evaluations', many, env)).body.evaluations.length, 50, 'a batch is cut to fifty');
  const bad = await ask(az, '/access/v1/evaluations', { evaluations: [{}] }, env); assert.equal(bad.body.evaluations[0].decision, false);
  assert.equal(await az.authzen(new Request('https://example.com/access/v1/evaluation', { method: 'POST' }), env), null, 'another host is not this decision point');
  assert.equal((await az.authzen(new Request('https://x.workers.dev/access/v1/evaluation', { method: 'POST', body: JSON.stringify(q('site', 'deploy')) }), env)).status, 200);
});

test('US-32-R46: a decision is read from the trust ledger, ordered by the ladder, and fails closed on a missing row, an unreadable ledger or an unknown rung', opts, async () => {
  const az = await load('site/authzen.js');
  const env = ledger([['site', 'deploy', 'autonomous', 0.8], ['site', 'modify', 'autonomous'], ['docs', 'execute', 'assisted'], ['repo', 'merge_pr_green', 'delegated'], ['site', 'read', 'observed'], ['site', 'weird_action', 'autonomous'], ['site', 'extend', 'self-extending'], ['site', 'propose', 'mystery']]);
  const d = async (s, a, e = env) => (await az.decide(e, q(s, a)));
  let r = await d('site', 'deploy'); assert.equal(r.decision, true); assert.deepEqual(r.context, { reason: 'ledger rung autonomous covers deploy', rung: 'autonomous', rung_needed: 'autonomous', trust_score: 0.8 });
  r = await d('site', 'modify'); assert.equal(r.decision, false); assert.equal(r.context.rung_needed, 'self-modifying'); assert.match(r.context.reason, /below self-modifying/);
  assert.equal((await d('docs', 'execute')).decision, false, 'assisted is below delegated'); assert.equal((await d('repo', 'merge_pr_green')).decision, true, 'a class the ledger seeds is covered at delegated');
  assert.equal((await d('site', 'read')).decision, true); assert.equal((await d('site', 'weird_action')).decision, true, 'a class with no listed rung needs autonomous');
  assert.equal((await d('site', 'extend')).decision, true);
  r = await d('nowhere', 'deploy'); assert.equal(r.decision, false); assert.match(r.context.reason, /no ledger row .* failing closed/); assert.equal(r.context.rung_needed, 'autonomous');
  r = await d('site', 'propose'); assert.equal(r.decision, false); assert.equal(r.context.reason, 'unknown rung mystery');
  r = await d('site', 'deploy', { ORG: { prepare() { throw new Error('boom'); } } }); assert.equal(r.decision, false); assert.match(r.context.reason, /ledger unreadable; failing closed/);
  assert.equal((await az.decide(env, { subject: { type: 'a' } })).status, 400);
});

test('US-32-R47: an irreversible or identity-bound action class, and a secret, credential, permission or the interrupt gate itself, is refused whatever rung the ledger holds', opts, async () => {
  const az = await load('site/authzen.js');
  const gated = ['spend', 'send_as_owner', 'publish_public', 'sign_or_file', 'mint_or_rotate_owner_credential', 'delete_repo', 'force_push_default_branch', 'migrate_destructive', 'delete_database_or_bucket', 'transfer_or_delete_domain'];
  const env = ledger([...gated.map(a => ['repo', a, 'self-extending', 0.99]), ['kv', 'read', 'self-extending'], ['gate', 'read', 'self-extending']]);
  for (const a of gated) { const r = await az.decide(env, q('repo', a)); assert.equal(r.decision, false, a); assert.match(r.context.reason, /^interrupt gate: irreversible or identity-bound; no trust rung grants it/); assert.equal(r.context.rung_needed, null); }
  for (const type of ['secret', 'credential', 'interrupt-gate', 'alignment-floor', 'permission', 'secret:prod']) { const r = await az.decide(env, q('kv', 'read', type)); assert.equal(r.decision, false, type); assert.equal(r.context.reason, 'resource is outside every trust rung'); }
  assert.equal((await az.decide(env, q('credential:github', 'read'))).decision, false, 'the id counts as well as the type'); assert.equal((await az.decide(env, q('permission', 'read'))).decision, false);
  assert.equal((await az.decide(env, q('gate', 'read'))).decision, true, 'a name that only starts like a protected one is not protected');
});

// ---- Web Bot Auth ---------------------------------------------------------------------------------------------------------------------------

const wbaEnv = () => { const raw = new DatabaseSync(':memory:'); return { raw, ORG: d1(raw) }; };
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0), TARGET = 'https://peer.example/api';

test('US-32-R48: the signing key is made on first use and kept in the org database, its id is the RFC 7638 thumbprint, and only the public half is published', opts, async () => {
  const wba = await load('site/webbotauth.js'), ag = await load('site/agentic.js'); const env = wbaEnv();
  assert.equal(wba.DIRECTORY_PATH, '/.well-known/http-message-signatures-directory'); assert.equal(wba.DIRECTORY_TYPE, 'application/http-message-signatures-directory+json');
  assert.equal(env.raw.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'agent_keys'").get().n, 0);
  const res = await ag.agentic(new Request('https://ultrastable.io' + wba.DIRECTORY_PATH), env);
  assert.equal(res.headers.get('content-type'), wba.DIRECTORY_TYPE); assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
  const dir = await res.json(); assert.equal(dir.keys.length, 1); const k = dir.keys[0]; assert.deepEqual(Object.keys(k).sort(), ['crv', 'kid', 'kty', 'x']); assert.equal(k.kty, 'OKP'); assert.equal(k.crv, 'Ed25519');
  assert.equal(k.kid, await wba.thumbprint(k)); assert.equal(k.d, undefined);
  assert.equal(env.raw.prepare("SELECT purpose FROM agent_keys").get().purpose, 'web-bot-auth'); assert.deepEqual((await wba.directory(env)).keys[0], k, 'the key is stable across calls');
  assert.equal((await ag.agentic(new Request('https://ultrastable.io' + wba.DIRECTORY_PATH), {})).status, 503, 'with no database the directory says so');
});

test('US-32-R49: a signed request covers the authority and the agent origin, names its key, carries a short validity and the web-bot-auth tag', opts, async () => {
  const wba = await load('site/webbotauth.js'); const env = wbaEnv();
  const h = await wba.signRequest(env, TARGET, NOW); const dir = await wba.directory(env);
  assert.equal(h['signature-agent'], '"https://ultrastable.io"');
  const created = NOW / 1000; assert.equal(h['signature-input'], `sig1=("@authority" "signature-agent");created=${created};expires=${created + 300};keyid="${dir.keys[0].kid}";alg="ed25519";tag="web-bot-auth"`);
  assert.match(h.signature, /^sig1=:[A-Za-z0-9+/]+=*:$/);
  assert.equal((await wba.signRequest(env, TARGET, NOW, 60))['signature-input'].includes(`expires=${created + 60}`), true, 'the validity is a parameter');
  assert.equal(wba.sigParams(['a'], 1, 2, 'k'), '("a");created=1;expires=2;keyid="k";alg="ed25519";tag="web-bot-auth"');
  const key = await crypto.subtle.importKey('jwk', dir.keys[0], 'Ed25519', false, ['verify']);
  const base = `"@authority": peer.example\n"signature-agent": "https://ultrastable.io"\n"@signature-params": ${h['signature-input'].slice(5)}`;
  assert.equal(await crypto.subtle.verify('Ed25519', key, Uint8Array.from(atob(h.signature.slice(6, -1)), c => c.charCodeAt(0)), new TextEncoder().encode(base)), true, 'the signature base is the RFC 9421 form');
});

test('US-32-R50: verification names why it refused: unsigned, malformed, wrong tag, uncovered, outside its window, a key not in the directory, an origin that is not https, a covered header missing, a changed authority', opts, async () => {
  const wba = await load('site/webbotauth.js'); const env = wbaEnv();
  const h = await wba.signRequest(env, TARGET, NOW), dir = await wba.directory(env), get = async () => dir;
  const req = (hh, url = TARGET) => new Request(url, { headers: hh });
  const v = (hh, now = NOW + 1000, getDir = get, url) => wba.verifyRequest(req(hh, url), getDir, now);
  let r = await v(h); assert.deepEqual(r, { ok: true, agent: 'https://ultrastable.io', keyid: dir.keys[0].kid });
  assert.equal((await v({})).reason, 'unsigned'); assert.equal((await v({ ...h, 'signature-input': 'nonsense' })).reason, 'bad signature-input');
  assert.equal((await v({ ...h, 'signature-input': h['signature-input'].replace('web-bot-auth', 'other') })).reason, 'not a web-bot-auth ed25519 signature');
  assert.equal((await v({ ...h, 'signature-input': h['signature-input'].replace('"signature-agent"', '') })).reason, 'components must cover @authority and signature-agent');
  assert.equal((await v(h, NOW + 400e3)).reason, 'signature outside its validity window'); assert.equal((await v(h, NOW - 60e3)).reason, 'signature outside its validity window', 'a signature dated in the future is refused beyond 30 seconds');
  assert.equal((await v(h, NOW - 20e3)).ok, true, 'thirty seconds of clock skew are allowed');
  assert.equal((await v({ ...h, signature: 'x' })).reason, 'bad signature'); assert.equal((await v({ ...h, signature: 'sig1=:' + btoa('x'.repeat(64)) + ':' })).reason, 'signature does not verify');
  assert.equal((await v({ ...h, 'signature-agent': '"http://plain.example"' })).reason, 'signature-agent must be an https origin');
  assert.equal((await v({ ...h, 'signature-agent': '"https://evil.example"' })).ok, false, 'a changed agent origin does not verify');
  assert.equal((await v(h, NOW + 1000, async () => ({ keys: [] }))).reason, "key not in the agent's directory"); assert.equal((await v(h, NOW + 1000, async () => null)).reason, "key not in the agent's directory");
  assert.equal((await v(h, NOW + 1000, async () => ({ keys: [{ ...dir.keys[0], kid: 'other' }] }))).ok, false, 'a key id that is not the thumbprint of the key is refused');
  assert.equal((await v(h, NOW + 1000, get, 'https://other.example/api')).ok, false, 'the signature is bound to the authority it was made for');
  const withAlg = h['signature-input'].replace('("@authority" "signature-agent")', '("@authority" "signature-agent" "x-extra")'); assert.equal((await v({ ...h, 'signature-input': withAlg })).reason, 'covered header missing');
});

test('US-32-R51: an outbound fetch is signed when the key store is reachable and goes out unsigned when it is not, and a peer directory is fetched once per origin per period', opts, async () => {
  const wba = await load('site/webbotauth.js'); const env = wbaEnv();
  let seen = null; const capture = async (url, init) => { seen = { url: String(url), headers: new Headers(init.headers) }; return new Response(JSON.stringify(await wba.directory(env)), { headers: { 'content-type': wba.DIRECTORY_TYPE } }); };
  await wba.signedFetch(env, TARGET, { headers: { accept: 'application/json' } }, capture, NOW);
  assert.equal(seen.headers.get('accept'), 'application/json'); assert.match(seen.headers.get('signature-input'), /tag="web-bot-auth"/);
  await wba.signedFetch({}, TARGET, {}, capture, NOW); assert.equal(seen.headers.get('signature'), null, 'no key store: the request still goes out');
  await wba.signedFetch({ ORG: { prepare() { throw new Error('db down'); } } }, TARGET, {}, capture, NOW); assert.equal(seen.headers.get('signature'), null, 'a failing key store never blocks a fetch');
  const fetched = await wba.fetchDirectory('https://peer.example', capture, env); assert.equal(seen.url, 'https://peer.example' + wba.DIRECTORY_PATH); assert.ok(seen.headers.get('signature'), 'the directory fetch is signed too'); assert.ok(fetched.keys[0].kid);
  assert.equal(await wba.fetchDirectory('https://peer.example', async () => new Response('{}'), null), null, 'a body with no keys is not a directory');
  assert.equal(await wba.fetchDirectory('https://peer.example', async () => new Response('x', { status: 500 }), null), null);
  let t = 0, calls = 0; const cache = wba.directoryCache({ ttlMs: 1000, missTtlMs: 100, max: 2, clock: () => t });
  const fetcher = async o => { calls++; await new Promise(res => setTimeout(res, 2)); return o.includes('dead') ? null : { keys: [{ kid: o }] }; };
  const [a1, a2] = await Promise.all([cache('https://a.example', fetcher), cache('https://a.example', fetcher)]); assert.equal(calls, 1, 'concurrent lookups share one fetch'); assert.deepEqual(a1, a2);
  t = 999; await cache('https://a.example', fetcher); assert.equal(calls, 1); t = 1000; await cache('https://a.example', fetcher); assert.equal(calls, 2, 'past the period it fetches again');
  assert.equal(await cache('https://dead.example', fetcher), null); t = 1050; await cache('https://dead.example', fetcher); assert.equal(calls, 3, 'a miss is kept'); t = 1200; await cache('https://dead.example', fetcher); assert.equal(calls, 4, 'a miss is kept for the shorter period');
  assert.equal(await cache('https://b.example', async () => { throw new Error('boom'); }), null, 'a fetcher that throws is a miss, not an error'); await cache('https://c.example', fetcher); assert.ok(cache.size() <= 2, 'at most max origins are kept');
  cache.clear(); assert.equal(cache.size(), 0);
});
