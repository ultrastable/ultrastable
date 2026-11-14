// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// CONTROL-PLANE-1: the org's control plane as a versioned HTTP API plus an operations dashboard, served by the tick Worker from its own database.
// Every system on Ultrastable inherits it (seed), so services read each other through one contract:
//   GET  /api/v1                      index (links to every resource)
//   GET  /api/v1/openapi.json         OpenAPI 3.1 description (stable operationIds)
//   GET  /api/v1/status               heartbeat, counts, findings (what is broken, measured, not declared)
//   GET  /api/v1/agents               every role: model, cadence, last tick, what it holds now, what it has done
//   GET  /api/v1/backlog              items by status (?status=ready|claimed|waiting|blocked|open|done&limit=), totals always included
//   GET  /api/v1/activity             recent tick reports, outcomes and dispatches
//   GET  /api/v1/integrations         services that read or write this org, with their contract
//   POST /api/v1/events               a registered integration sends a signal (bearer INTEGRATION_TOKEN); it lands as a backlog item for the owning role
//   GET  /ops                         the operations dashboard (server-rendered, refreshes itself)
// Reads are public and read-only, like /api/live. Errors are JSON {error:{code,message}}. Lists are never cut silently: total, returned and filter are reported.

export const API_VERSION = '1.0.0';
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'x-content-type-options': 'nosniff' };
const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o, null, 1), { status, headers: { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });
const fail = (status, code, message) => json({ error: { code, message } }, status);
const all = async (db, sql, ...a) => ((await db.prepare(sql).bind(...a).all()).results) || [];
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const iso = d => d.toISOString().replace('T', ' ').slice(0, 19);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUSES = ['ready', 'claimed', 'waiting', 'blocked', 'open', 'done', 'superseded', 'cancelled'];

// Integrations: who reads this org and who may write signals into it. Data, so a new service is one row.
export const INTEGRATIONS = [
  { id: 'personal-companion', direction: 'both', reads: ['/api/v1/status', '/api/v1/agents', '/api/v1/backlog'], writes: ['/api/v1/events'],
    purpose: 'The owner\'s personal companion reads what the org is doing and sends requests, ideas and reminders as signals.', default_role: 'product-manager' },
  { id: 'qnfo-fleet', direction: 'read', reads: ['/api/v1/status', '/api/v1/agents'], writes: [], purpose: 'The QNFO fleet dashboard shows this org beside its own workers.' },
  { id: 'agents', direction: 'read', reads: ['/api/v1/openapi.json', '/mcp'], writes: [], purpose: 'Any agent discovers the org through the API catalog, OpenAPI and MCP.' },
];

export async function status(db, now = Date.now()) {
  const day = iso(new Date(now - 86400e3));
  const last = await first(db, `SELECT id, started_at, finished_at, steps_completed, steps_total, report, errors FROM tick_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1`);
  const items = Object.fromEntries((await all(db, `SELECT status, COUNT(*) AS n FROM items GROUP BY status`)).map(r => [r.status, r.n]));
  const dispatches = Object.fromEntries((await all(db, `SELECT status, COUNT(*) AS n FROM dispatches GROUP BY status`)).map(r => [r.status, r.n]));
  const outcomes24 = Object.fromEntries((await all(db, `SELECT result, COUNT(*) AS n FROM outcomes WHERE at >= ? GROUP BY result`, day)).map(r => [r.result, r.n]));
  const ticks24 = (await first(db, `SELECT COUNT(*) AS n, SUM(CASE WHEN steps_completed = steps_total THEN 1 ELSE 0 END) AS full FROM tick_runs WHERE started_at >= ?`, day)) || {};
  const roles = (await first(db, `SELECT COUNT(*) AS n FROM roles`)).n;
  const done24 = (await first(db, `SELECT COUNT(*) AS n FROM items WHERE status='done' AND updated_at >= ?`, day)).n;
  const breaches = await all(db, `SELECT id, name, last_value, op, threshold FROM metrics WHERE breached = 1 ORDER BY id LIMIT 50`).catch(() => []);
  const ageMin = last ? Math.round((now - Date.parse(last.started_at.replace(' ', 'T') + 'Z')) / 60e3) : null;
  // Findings are computed from the rows, never declared. Each names its signal so a probe can re-read it.
  const findings = [];
  if (ageMin === null || ageMin > 30) findings.push({ id: 'heartbeat-late', severity: 'high', signal: 'minutes since last finished tick', value: ageMin });
  if ((dispatches.queued || 0) > 20) findings.push({ id: 'dispatch-unconsumed', severity: 'high', signal: 'dispatches still queued', value: dispatches.queued });
  if ((dispatches.waiting || 0) > 0) findings.push({ id: 'needs-executor', severity: 'medium', signal: 'dispatched items whose probe only the executor can satisfy', value: dispatches.waiting });
  if (done24 === 0) findings.push({ id: 'nothing-closed-24h', severity: 'high', signal: 'items closed in the last 24 hours', value: 0 });
  if (last && last.steps_completed !== last.steps_total) findings.push({ id: 'tick-step-failing', severity: 'high', signal: 'last tick errors', value: last.errors });
  if (breaches.length) findings.push({ id: 'metrics-in-breach', severity: 'medium', signal: 'metrics breached', value: breaches.length });
  return {
    api_version: API_VERSION, generated: iso(new Date(now)),
    heartbeat: { last_tick: last ? { id: last.id, started_at: last.started_at, steps: `${last.steps_completed}/${last.steps_total}`, report: last.report } : null, minutes_since: ageMin, ticks_24h: ticks24.n || 0, full_ticks_24h: ticks24.full || 0 },
    roles, items, dispatches, outcomes_24h: outcomes24, items_closed_24h: done24, metrics_in_breach: breaches, findings,
  };
}

export async function agents(db) {
  const roles = await all(db, `SELECT id, role, project, tick_every, model, last_tick_at FROM roles ORDER BY role, id`);
  const holds = await all(db, `SELECT c.agent, c.item_id, c.claimed_at, c.heartbeat_at, i.title, i.closing_probe FROM claims c JOIN items i ON i.id = c.item_id ORDER BY c.claimed_at`);
  const counts = await all(db, `SELECT role_id, status, COUNT(*) AS n FROM dispatches GROUP BY role_id, status`);
  const doneBy = await all(db, `SELECT agent, COUNT(*) AS n, MAX(at) AS last FROM outcomes WHERE result='verified' GROUP BY agent`);
  const queue = await all(db, `SELECT owner_role, COUNT(*) AS n FROM items WHERE status='ready' AND id NOT IN (SELECT item_id FROM claims) GROUP BY owner_role`);
  return roles.map(r => ({
    ...r,
    working_on: holds.filter(h => h.agent === r.id).map(h => ({ item: h.item_id, title: h.title, since: h.claimed_at, heartbeat: h.heartbeat_at, closes_when: h.closing_probe })),
    dispatches: Object.fromEntries(counts.filter(c => c.role_id === r.id).map(c => [c.status, c.n])),
    verified_closes: (doneBy.find(d => d.agent === r.id) || {}).n || 0,
    last_verified: (doneBy.find(d => d.agent === r.id) || {}).last || null,
    on_deck_for_role: (queue.find(q => q.owner_role === r.role) || {}).n || 0,
  }));
}

export async function backlog(db, { status: st = 'ready', limit = 50 } = {}) {
  const lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const filter = st === 'all' ? null : String(st).split(',').filter(s => STATUSES.includes(s));
  if (st !== 'all' && !filter.length) return { error: { code: 'bad_status', message: `status must be one of ${STATUSES.join(', ')} or all` } };
  // 'waiting' is a dispatch state, not an item state: claimed items whose newest dispatch is waiting on the executor.
  const LAST_D = `(SELECT status FROM dispatches d WHERE d.item_id = i.id ORDER BY d.id DESC LIMIT 1)`;
  const conds = [], args = [];
  if (filter) {
    const plain = filter.filter(s => s !== 'waiting');
    const parts = [];
    if (plain.length) { parts.push(`i.status IN (${plain.map(() => '?').join(',')})`); args.push(...plain); }
    if (filter.includes('waiting')) parts.push(`(i.status = 'claimed' AND ${LAST_D} = 'waiting')`);
    conds.push('(' + parts.join(' OR ') + ')');
  }
  const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';
  const total = (await first(db, `SELECT COUNT(*) AS n FROM items i ${where}`, ...args)).n;
  const items = await all(db, `SELECT i.id, i.title, i.kind, i.owner_role, i.priority, i.status, i.done_check, i.closing_probe, i.blocker, i.disposition, i.created_at, i.updated_at, c.agent,
      ${LAST_D} AS dispatch
      FROM items i LEFT JOIN claims c ON c.item_id = i.id ${where} ORDER BY CASE i.status WHEN 'claimed' THEN 0 WHEN 'ready' THEN 1 ELSE 2 END, i.priority, i.created_at LIMIT ?`, ...args, lim);
  return { filter: filter || 'all', total, returned: items.length, omitted: Math.max(0, total - items.length), items };
}

export async function activity(db, { limit = 25 } = {}) {
  const lim = Math.max(1, Math.min(100, Number(limit) || 25));
  return {
    ticks: await all(db, `SELECT id, started_at, steps_completed, steps_total, report, errors FROM tick_runs ORDER BY id DESC LIMIT ?`, Math.min(lim, 12)),
    outcomes: await all(db, `SELECT o.at, o.agent, o.item_id, o.result, o.evidence, i.title FROM outcomes o LEFT JOIN items i ON i.id = o.item_id ORDER BY o.id DESC LIMIT ?`, lim),
    dispatches: await all(db, `SELECT d.at, d.role_id, d.item_id, d.status, d.model, i.title FROM dispatches d LEFT JOIN items i ON i.id = d.item_id ORDER BY d.id DESC LIMIT ?`, lim),
  };
}

async function safeEqual(a, b) {
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(String(a))), crypto.subtle.digest('SHA-256', enc.encode(String(b)))]);
  const u = new Uint8Array(x), v = new Uint8Array(y); let d = 0; for (let i = 0; i < u.length; i++) d |= u[i] ^ v[i]; return d === 0;
}

// POST /api/v1/events {source, type, title, detail?, id?, role?}. Idempotent on (source, id). Lands as a ready item the owning role is dispatched.
export async function ingestEvent(db, env, request, now = Date.now()) {
  if (!env.INTEGRATION_TOKEN) return fail(503, 'not_configured', 'INTEGRATION_TOKEN is not bound on this worker');
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ') || !(await safeEqual(auth.slice(7), env.INTEGRATION_TOKEN))) return fail(401, 'unauthorized', 'bearer token missing or wrong');
  let b; try { b = await request.json(); } catch { return fail(400, 'bad_json', 'body must be JSON'); }
  const integ = INTEGRATIONS.find(x => x.id === b.source && x.writes.includes('/api/v1/events'));
  if (!integ) return fail(422, 'unknown_source', `source must be one of ${INTEGRATIONS.filter(x => x.writes.length).map(x => x.id).join(', ')}`);
  const title = String(b.title || '').replace(/\s+/g, ' ').trim();
  if (title.length < 4 || title.length > 300) return fail(422, 'bad_title', 'title must be 4 to 300 characters');
  const type = ['request', 'idea', 'bug', 'reminder', 'signal'].includes(b.type) ? b.type : 'signal';
  const ext = String(b.id || '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 64) || [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(title)))].slice(0, 6).map(x => x.toString(16).padStart(2, '0')).join('');
  const id = `EV-${integ.id}-${ext}`;
  const roles = (await all(db, `SELECT DISTINCT role FROM roles`)).map(r => r.role);
  const role = roles.includes(b.role) ? b.role : (roles.includes(integ.default_role) ? integ.default_role : (roles[0] || 'staff'));
  const existing = await first(db, `SELECT id, status FROM items WHERE id=?`, id);
  if (existing) return json({ ok: true, id, status: existing.status, duplicate: true }, 200);
  const nowIso = iso(new Date(now));
  await db.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, blocker, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, 'ready', NULL, ?, ?)`)
    .bind(id, `${type}: ${title}`, type === 'bug' ? 'fix' : 'signal', role, `the ${type} from ${integ.id} is answered by a merged change or a recorded decision` + (b.detail ? ` (detail: ${String(b.detail).slice(0, 500)})` : ''),
      type === 'bug' ? 10 : 30, nowIso, nowIso).run();
  await db.prepare(`INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?, ?, 'integration', 'ingest', 'verified', ?, ?)`).bind(id, integ.id, `event ${type} accepted for ${role}`, nowIso).run();
  return json({ ok: true, id, status: 'ready', owner_role: role }, 202);
}

export function openapi(origin) {
  const ok = d => ({ '200': { description: d, content: { 'application/json': { schema: { type: 'object' } } } } });
  return {
    openapi: '3.1.0', info: { title: 'Ultrastable control plane', version: API_VERSION, description: 'Read what the org\'s agents are doing, what is on deck and what is broken; send signals from registered integrations.' },
    servers: [{ url: origin }],
    components: { securitySchemes: { integration: { type: 'http', scheme: 'bearer' } }, schemas: { Error: { type: 'object', properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } } } } },
    paths: {
      '/api/v1/status': { get: { operationId: 'getStatus', summary: 'Heartbeat, counts and computed findings', responses: ok('Status') } },
      '/api/v1/agents': { get: { operationId: 'listAgents', summary: 'Every role with what it holds now and what it has closed', responses: ok('Agents') } },
      '/api/v1/backlog': { get: { operationId: 'listBacklog', summary: 'Items by status, totals included', parameters: [{ name: 'status', in: 'query', schema: { type: 'string', default: 'ready' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 } }], responses: { ...ok('Backlog'), '400': { description: 'Bad status', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } } } },
      '/api/v1/activity': { get: { operationId: 'listActivity', summary: 'Recent ticks, outcomes and dispatches', responses: ok('Activity') } },
      '/api/v1/integrations': { get: { operationId: 'listIntegrations', summary: 'Registered integrations and their contracts', responses: ok('Integrations') } },
      '/api/v1/events': { post: { operationId: 'postEvent', summary: 'Send a signal from a registered integration', security: [{ integration: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['source', 'title'], properties: { source: { type: 'string', enum: INTEGRATIONS.filter(x => x.writes.length).map(x => x.id) }, type: { type: 'string', enum: ['request', 'idea', 'bug', 'reminder', 'signal'] }, title: { type: 'string' }, detail: { type: 'string' }, id: { type: 'string', description: 'idempotency key' }, role: { type: 'string' } } } } } },
        responses: { '202': { description: 'Accepted as a backlog item' }, '200': { description: 'Duplicate, already accepted' }, '401': { description: 'Unauthorized' }, '422': { description: 'Invalid' }, '503': { description: 'Not configured' } } } },
    },
  };
}

// ---------- the operations dashboard ----------
const CSS = `:root{color-scheme:light dark;--ds-bg:#f6f1e7;--ds-sf:#fffdf8;--ds-ink:#14120f;--ds-ink2:#5b574f;--ds-line:#ddd5c5;--ds-ac:#c93d00;--ds-good:#0a7a3d;--ds-bad:#b3261e;--ds-warn:#8a5a00}
@media(prefers-color-scheme:dark){:root{--ds-bg:#0b1a15;--ds-sf:#12342a;--ds-ink:#f6f1e7;--ds-ink2:#c9d4cc;--ds-line:#1f4a3c;--ds-ac:#ff5b1f;--ds-good:#4cc38a;--ds-bad:#ff8a80;--ds-warn:#f2c14e}}
*{box-sizing:border-box}body{margin:0;background:var(--ds-bg);color:var(--ds-ink);font:16px/1.5 'IBM Plex Sans',system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:16px 16px 64px}
h1{font:600 26px/1.2 Fraunces,Georgia,serif;margin:8px 0}h2{font-size:19px;margin:28px 0 8px}a{color:var(--ds-ac)}small,.mut{color:var(--ds-ink2);font-size:14px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}.tile{background:var(--ds-sf);border:1px solid var(--ds-line);border-radius:8px;padding:12px}.tile b{display:block;font-size:26px}
.card{background:var(--ds-sf);border:1px solid var(--ds-line);border-radius:8px;padding:12px 14px;margin:0 0 10px}table{width:100%;border-collapse:collapse;font-size:15px}td,th{text-align:left;padding:8px 6px;border-bottom:1px solid var(--ds-line);vertical-align:top}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;border:1px solid var(--ds-line);font-size:14px}.high{color:var(--ds-bad);border-color:var(--ds-bad)}.medium{color:var(--ds-warn);border-color:var(--ds-warn)}.ok{color:var(--ds-good);border-color:var(--ds-good)}
nav{display:flex;gap:16px;flex-wrap:wrap;margin:4px 0 12px}:focus-visible{outline:3px solid var(--ds-ac);outline-offset:2px}pre{white-space:pre-wrap;margin:0;font:14px/1.45 ui-monospace,monospace}`;

export function dashboardHtml({ s, ags, deck, doing, waiting, act, org }) {
  const tile = (label, v, cls = '') => `<div class="tile"><small>${esc(label)}</small><b class="${cls}">${esc(v)}</b></div>`;
  const f = s.findings.length ? s.findings.map(x => `<div class="card"><span class="pill ${esc(x.severity)}">${esc(x.severity)}</span> <b>${esc(x.id)}</b> <span class="mut">${esc(x.signal)}: ${esc(typeof x.value === 'object' ? JSON.stringify(x.value) : x.value)}</span></div>`).join('') : '<div class="card"><span class="pill ok">ok</span> No findings.</div>';
  const agentRows = ags.map(a => `<tr><td><b>${esc(a.id)}</b><br><small>${esc(a.role)}${a.project ? ' · ' + esc(a.project) : ''} · ${esc(a.model)} · every ${esc(a.tick_every)} tick(s)</small></td>
    <td>${a.working_on.length ? a.working_on.map(w => `${esc(w.item)}<br><small>${esc(w.title)}</small>`).join('<br>') : '<small>idle</small>'}</td>
    <td>${esc(a.on_deck_for_role)}</td><td>${esc(a.verified_closes)}</td><td><small>${esc(Object.entries(a.dispatches).map(([k, v]) => k + ' ' + v).join(', ') || 'none')}</small></td><td><small>${esc(a.last_tick_at || 'never')}</small></td></tr>`).join('');
  const list = (b, empty) => b.items.length ? `<table><tr><th>Item</th><th>Role</th><th>P</th><th>Closes when</th></tr>${b.items.map(i => `<tr><td><b>${esc(i.id)}</b><br><small>${esc(i.title)}</small></td><td>${esc(i.agent || i.owner_role)}</td><td>${esc(i.priority)}</td><td><small>${esc(i.closing_probe || i.done_check)}</small></td></tr>`).join('')}</table><small>${b.returned} shown of ${b.total}${b.omitted ? `; ${b.omitted} more via the API` : ''}</small>` : `<div class="card">${empty}</div>`;
  const outs = act.outcomes.map(o => `<tr><td><small>${esc(o.at)}</small></td><td>${esc(o.agent || '')}</td><td><span class="pill ${o.result === 'verified' ? 'ok' : o.result === 'failed' ? 'high' : 'medium'}">${esc(o.result)}</span></td><td>${esc(o.item_id || '')}<br><small>${esc(o.evidence || '')}</small></td></tr>`).join('');
  const hb = s.heartbeat;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="60"><meta name="robots" content="noindex">
<title>${esc(org)} operations</title><link rel="service-desc" href="/api/v1/openapi.json" type="application/vnd.oai.openapi+json"><style>${CSS}</style></head><body><main>
<h1>${esc(org)} operations</h1><p class="mut">Live from the tick Worker's database at ${esc(s.generated)} UTC. Refreshes every minute. Read-only.</p>
<nav><a href="#agents">Agents</a><a href="#doing">In progress</a><a href="#deck">On deck</a><a href="#activity">Activity</a><a href="/api/v1">API</a><a href="/api/v1/openapi.json">OpenAPI</a><a href="/dashboard">Roadmap view</a></nav>
<div class="grid">${tile('Last tick', hb.minutes_since == null ? 'none' : hb.minutes_since + ' min ago', hb.minutes_since > 30 ? 'high' : 'ok')}${tile('Ticks 24h', `${hb.full_ticks_24h}/${hb.ticks_24h} full`)}${tile('Agents', s.roles)}
${tile('On deck', s.items.ready || 0)}${tile('In progress', s.items.claimed || 0)}${tile('Blocked', s.items.blocked || 0)}${tile('Closed 24h', s.items_closed_24h, s.items_closed_24h ? 'ok' : 'high')}${tile('Done total', s.items.done || 0)}</div>
<h2>Findings</h2>${f}
<h2 id="agents">Agents</h2><div class="card" style="overflow-x:auto"><table><tr><th>Agent</th><th>Working on</th><th>On deck</th><th>Verified closes</th><th>Dispatches</th><th>Last tick</th></tr>${agentRows}</table></div>
<h2 id="doing">In progress</h2>${list(doing, 'Nothing claimed.')}
<h2>Waiting on the executor</h2><p class="mut">Dispatched work whose closing probe needs code changes; the Worker-native executor or a session closes these.</p>${list(waiting, 'Nothing waiting.')}
<h2 id="deck">On deck</h2>${list(deck, 'Nothing ready.')}
<h2 id="activity">Recent outcomes</h2><div class="card" style="overflow-x:auto"><table><tr><th>When</th><th>Agent</th><th>Result</th><th>Item</th></tr>${outs || '<tr><td colspan=4>None yet.</td></tr>'}</table></div>
<h2>Last tick report</h2><div class="card"><pre>${esc(hb.last_tick ? hb.last_tick.report : 'none')}</pre></div>
</main></body></html>`;
}

export async function controlPlane(request, env, { org = 'ultrastable', now = Date.now() } = {}) {
  const u = new URL(request.url);
  const p = u.pathname.replace(/\/$/, '') || '/';
  if (p !== '/ops' && !p.startsWith('/api/v1')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, OPTIONS' } });
  const db = env.DB;
  if (!db) return fail(503, 'no_database', 'DB binding missing');
  const origin = u.origin;
  try {
    if (p === '/api/v1/events') return request.method === 'POST' ? ingestEvent(db, env, request, now) : fail(405, 'method_not_allowed', 'use POST');
    if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'method_not_allowed', 'read-only resource');
    switch (p) {
      case '/api/v1': return json({ api_version: API_VERSION, org, resources: ['status', 'agents', 'backlog', 'activity', 'integrations', 'events'].map(r => ({ name: r, href: `${origin}/api/v1/${r}` })), openapi: `${origin}/api/v1/openapi.json`, dashboard: `${origin}/ops` });
      case '/api/v1/openapi.json': return json(openapi(origin), 200, { 'content-type': 'application/vnd.oai.openapi+json; charset=utf-8', 'cache-control': 'public, max-age=300' });
      case '/api/v1/status': return json(await status(db, now));
      case '/api/v1/agents': return json({ agents: await agents(db) });
      case '/api/v1/backlog': { const b = await backlog(db, { status: u.searchParams.get('status') || 'ready', limit: u.searchParams.get('limit') }); return b.error ? json(b, 400) : json(b); }
      case '/api/v1/activity': return json(await activity(db, { limit: u.searchParams.get('limit') }));
      case '/api/v1/integrations': return json({ integrations: INTEGRATIONS, events: { href: `${origin}/api/v1/events`, auth: 'bearer INTEGRATION_TOKEN', configured: Boolean(env.INTEGRATION_TOKEN) } });
      case '/ops': {
        const [s, ags, deck, doing, waiting, act] = await Promise.all([status(db, now), agents(db), backlog(db, { status: 'ready', limit: 25 }), backlog(db, { status: 'claimed', limit: 50 }), backlog(db, { status: 'waiting', limit: 50 }), activity(db, { limit: 20 })]);
        return new Response(dashboardHtml({ s, ags, deck, doing, waiting, act, org }), { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', link: '</api/v1/openapi.json>; rel="service-desc"' } });
      }
      default: return fail(404, 'not_found', `no resource ${p}; see ${origin}/api/v1`);
    }
  } catch (e) {
    console.error('controlplane', p, e && e.message);
    return fail(500, 'internal', String(e && e.message).slice(0, 200));
  }
}
