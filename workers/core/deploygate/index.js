// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Deploy gateway: lets a CI run deploy a Worker with no stored secret. The run presents its OIDC identity token (audience = the
// gateway origin); the gateway verifies the signature against the issuer's keys and deploys only what a configured rule allows.
// createGate({ fetch, now, config: { rules, token, accountId, issuer? } }) -> { handle(req) }.
// rules: [{ repo, refs: [..], script, compat?, compat_flags?, ai? }]. A rule with ai: true gives a new script the Workers AI binding `AI` (the only binding a rule can add; keep_bindings only keeps what a script already has). token is the account-scoped deploy credential, held only by the gateway's host.
const ISSUER = 'https://token.actions.githubusercontent.com';
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const KEEP = ['kv_namespace', 'plain_text', 'secret_text', 'service', 'd1', 'durable_object_namespace', 'send_email', 'ai'];

export async function verifyToken(jwt, { audience, fetch, now, issuer = ISSUER }) {
  const [h, p, s] = String(jwt).split('.');
  if (!s) throw new Error('malformed token');
  const dec = x => JSON.parse(new TextDecoder().decode(b64u(x)));
  const head = dec(h), claims = dec(p);
  if (head.alg !== 'RS256') throw new Error('bad alg');
  const jwks = await (await fetch(issuer + '/.well-known/jwks')).json();
  const jwk = jwks.keys.find(k => k.kid === head.kid);
  if (!jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(s), new TextEncoder().encode(h + '.' + p)))) throw new Error('bad signature');
  const t = now() / 1000;
  if (claims.iss !== issuer || claims.aud !== audience || !(claims.exp > t) || claims.nbf > t + 60) throw new Error('bad claims');
  return claims;
}

const hex = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
// The stored script comes back as multipart: take the first part's body.
export function modulePart(body) { const i = body.indexOf('\r\n\r\n'), j = body.lastIndexOf('\r\n--'); return i < 0 ? body : body.slice(i + 4, j > i ? j : undefined); }

// Names only: a binding's value, a secret's value and a variable's text never leave the host through this read.
export async function readState(fetch, config, script, rule = {}) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/scripts/${script}`;
  const auth = { authorization: `Bearer ${config.token}` };
  const errors = [], get = async (path, as = 'json') => {
    try { const r = await fetch(base + path, { headers: auth }); if (!r.ok) { errors.push(`${path} ${r.status}`); return null; } return as === 'json' ? (await r.json()).result : await r.text(); }
    catch (e) { errors.push(`${path} ${String(e.message || e)}`); return null; }
  };
  const [settings, sched, sub, dep, body] = await Promise.all([get('/settings'), get('/schedules'), get('/subdomain'), get('/deployments'), get('/content/v2', 'text')]);
  // Account-level custom domains and, where the rule names zones, zone routes; D1 migration names where the rule names databases (HOSTSYNC-1).
  const acct = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}`;
  const call = async (u, init = {}) => { try { const r = await fetch(u, { ...init, headers: { ...auth, ...(init.headers || {}) } }); if (!r.ok) { errors.push(`${u.replace(/^.*\/client\/v4/, '')} ${r.status}`); return null; } return (await r.json()).result; } catch (e) { errors.push(String(e.message || e)); return null; } };
  const doms = await call(`${acct}/workers/domains?service=${encodeURIComponent(script)}`);
  const routes = [];
  for (const z of rule.zones || []) for (const r of (await call(`https://api.cloudflare.com/client/v4/zones/${z}/workers/routes`)) || []) if (r.script === script) routes.push(r.pattern);
  const migrations = {};
  for (const db of rule.d1 || []) { const q = await call(`${acct}/d1/database/${db}/query`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sql: 'SELECT file FROM _migrations ORDER BY file' }) }); if (q) migrations[db] = ((q[0] && q[0].results) || []).map(x => x.file); }
  const d0 = ((dep && dep.deployments) || [])[0];
  return {
    script, found: !!(settings || body),
    sha256: body == null ? null : await hex(modulePart(body)),
    bindings: ((settings && settings.bindings) || []).map(b => ({ type: b.type, name: b.name })).sort((a, b) => (a.name + a.type).localeCompare(b.name + b.type)),
    crons: ((sched && sched.schedules) || []).map(x => x.cron).sort(),
    workers_dev: sub ? !!sub.enabled : null,
    domains: (doms || []).map(d => d.hostname).sort(), routes: routes.sort(), migrations,
    compat_date: (settings && settings.compatibility_date) || null,
    compat_flags: ((settings && settings.compatibility_flags) || []).slice().sort(),
    deployment: d0 ? { id: d0.id, created_on: d0.created_on } : null,
    read_errors: errors,
  };
}

export function createGate({ fetch = globalThis.fetch, now = Date.now, config }) {
  const issuer = config.issuer || ISSUER;
  async function handle(req) {
    const url = new URL(req.url);
    if (url.pathname === '/health') return json({ ok: true });
    const isState = req.method === 'GET' && url.pathname === '/state';
    if (!isState && (req.method !== 'POST' || url.pathname !== '/deploy')) return json({ error: 'not found' }, 404);
    const m = /^Bearer (.+)$/.exec(req.headers.get('authorization') || '');
    if (!m) return json({ error: 'missing token' }, 401);
    let claims;
    try { claims = await verifyToken(m[1], { audience: url.origin, fetch, now, issuer }); } catch (e) { return json({ error: String(e.message) }, 401); }
    // HOSTSYNC-1: read-only runtime state of a script the caller's repo may deploy (same rule match, same OIDC proof, no stored secret).
    if (isState) {
      const script = url.searchParams.get('script') || '';
      if (!(config.rules || []).find(r => r.repo === claims.repository && r.script === script && (r.refs || []).includes(claims.ref))) return json({ error: 'not allowed', repository: claims.repository, ref: claims.ref, script }, 403);
      const rule = (config.rules || []).find(r => r.repo === claims.repository && r.script === script && (r.refs || []).includes(claims.ref));
      return json(await readState(fetch, config, script, rule));
    }
    const form = await req.formData();
    const script = String(form.get('script') || '');
    const rule = (config.rules || []).find(r => r.repo === claims.repository && r.script === script && (r.refs || []).includes(claims.ref));
    if (!rule) return json({ error: 'not allowed', repository: claims.repository, ref: claims.ref, script }, 403);
    const text = await form.get('worker.js').text();
    const meta = { main_module: 'worker.js', compatibility_date: rule.compat || '2026-10-01', compatibility_flags: rule.compat_flags || [], keep_bindings: KEEP, observability: { enabled: true, head_sampling_rate: 1 }, ...(rule.ai === true ? { bindings: [{ type: 'ai', name: 'AI' }] } : {}) };
    const out = new FormData();
    out.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    out.append('worker.js', new Blob([text], { type: 'application/javascript+module' }), 'worker.js');
    const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}/workers/scripts/${script}`;
    const auth = { authorization: `Bearer ${config.token}` };
    const put = await fetch(base, { method: 'PUT', headers: auth, body: out });
    const j = await put.json();
    if (!put.ok || !j.success) return json({ error: 'deploy failed', status: put.status, errors: j.errors }, 502);
    // DEPLOYGATE-WORKERSDEV-1: a new script answers on workers.dev unless its rule sets workers_dev: false, so a first deploy needs no manual step.
    if (rule.workers_dev !== false) {
      const sd = await fetch(base + '/subdomain', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ enabled: true, previews_enabled: false }) });
      if (!sd.ok) return json({ deployed: true, verified: false, error: 'workers.dev not enabled', status: sd.status, script }, 502);
    }
    const sha256 = await hex(text);
    // Read-back (DEPLOYGATE-READBACK-1): compare the stored module by hash. A read the token cannot make is reported, not called a mismatch:
    // the upload already succeeded, and the caller's own live check is the independent verification.
    // DEPLOYGATE-READBACK-RETRY-1: the stored module can lag the upload for a moment, so a mismatch is read again after a short wait before it is called one.
    const waits = config.readback_waits_ms || [0, 1500, 3000, 6000];
    for (let i = 0; i < waits.length; i++) {
      if (waits[i]) await new Promise(r => setTimeout(r, waits[i]));
      const rb = await fetch(base + '/content/v2', { headers: auth });
      if (!rb.ok) return json({ deployed: true, verified: false, readback_status: rb.status, script, sha256, sha: claims.sha, run: claims.run_id });
      const back = await rb.text();
      if (back.includes(text) || await hex(modulePart(back)) === sha256) break;
      if (i === waits.length - 1) return json({ error: 'read-back mismatch', sha256 }, 502);
    }
    return json({ deployed: true, verified: true, script, sha256, sha: claims.sha, run: claims.run_id });
  }
  return { handle };
}
