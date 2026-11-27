// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// AUTH-1: the credential layer. getToken(provider) returns a live access token for a tenant, minting or refreshing it when the cached one is within the margin of its expiry.
// refreshDue(db) runs on every tick: it re-mints expiring tokens and records a credential_events row for each outcome, so an expiry is a probe result, never a surprise.
import { githubApp } from './github-app.js';
import { oauth } from './oauth.js';
import { cloudflare } from './cloudflare.js';
import * as store from './store.js';
export const ADAPTERS = { 'github-app': githubApp, 'github-admin': githubApp, oauth, cloudflare };  // REPOS-1: the admin app mints installation tokens the same way
export const MARGIN_MS = 10 * 60 * 1000;
export const adapterFor = provider => ADAPTERS[provider.split(':')[0]];

// Q-LESSON-CRED-SCOPE: the one allowlist of what the GitHub App asks for. The earlier fleet ran on a 22-scope token; here the manifest
// (routes.js manifest) requests exactly these permissions and nothing else, and auth.test.js fails when the request and this list differ.
// Widening it is a reviewed change to this constant, never a field added at the call site.
export const SCOPE_ALLOWLIST = Object.freeze({
  'github-app': Object.freeze({ contents: 'write', pull_requests: 'write', issues: 'write', actions: 'write', checks: 'read', statuses: 'write', workflows: 'write', metadata: 'read' }),  // statuses: the Worker gate posts the `worker-gate` commit status (Q-GATE-403)
  'github-admin': Object.freeze({ administration: 'write', metadata: 'read' }),  // REPOS-1: repository settings only (archive a retired repository); no code, no workflows
});

// Q-LESSON-CRED-SCOPE: an auth bypass through path normalization was one of the earlier fleet's credential failures. Every route compares
// url.pathname exactly, so a variant (//x, /x/, /x%2Fy, /a/%2e%2e/x) must never reach a handler as itself: canonicalPath decodes encoded
// slashes, backslashes and dots (twice-encoded too), collapses repeated slashes, resolves dot segments and drops a trailing slash.
export function canonicalPath(pathname) {
  let s = String(pathname || '/');
  for (let i = 0; i < 4; i++) {
    const d = s.replace(/%25/gi, '%').replace(/%2f/gi, '/').replace(/%5c/gi, '/').replace(/%2e/gi, '.').replace(/\\/g, '/');
    if (d === s) break; s = d;
  }
  const out = [];
  for (const seg of s.split('/')) { if (seg === '' || seg === '.') continue; if (seg === '..') out.pop(); else out.push(seg); }
  return '/' + out.join('/');
}
// The router's first check: a non-canonical path is redirected (308 keeps the method and body) to its canonical form, where the route's own
// authentication applies. A variant is never answered by a handler.
export function pathGuard(request) {
  const url = new URL(request.url);
  const canon = canonicalPath(url.pathname);
  if (canon === url.pathname) return null;
  return new Response(null, { status: 308, headers: { location: canon + url.search, 'cache-control': 'no-store' } });
}

// READ-BUDGET-7: a live token is also kept in isolate memory. When the daily D1 allowance is spent the credential row cannot be read, and every
// App-backed route (the main-writer, the lane, the executor) then answered 401 for the rest of the day (watchdog run 44373626830, 'read main 401').
// A warm isolate keeps serving its token until the margin before expiry; D1 is read only when the memo is empty or about to lapse.
const memos = new WeakMap();  // per database handle: one per isolate in production, one per test
const memoOf = db => { let m = memos.get(db); if (!m) memos.set(db, m = new Map()); return m; };
export async function getToken(db, env, tenant, provider, opts = {}) {
  const now = opts.now || Date.now();
  const memo = memoOf(db), key = tenant + '|' + provider, hit = memo.get(key);
  if (hit && hit.expiresAt - now > MARGIN_MS) return { ok: true, token: hit.token, cached: true, memo: true };
  // HOSTED-1: a hosted app holds no App key. Its host mints a one-hour token for the app's one repository (apprepos.js on the host); the app
  // proves itself with the key its host bound at deploy. A refusal is returned as it is, never hidden behind an older token.
  if (provider === 'github-app' && env.HOST_TOKEN_URL && env.HOST_APP_KEY && env.HOST_REPO) {
    const r = await (opts.fetch || fetch)(env.HOST_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'ultrastable-hosted-app' }, body: JSON.stringify({ repo: env.HOST_REPO, key: env.HOST_APP_KEY }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.token) return { ok: false, error: 'host token HTTP ' + r.status + (j.error ? ' ' + j.error : '') };
    memo.set(key, { token: j.token, expiresAt: Date.parse(j.expires_at) });
    return { ok: true, token: j.token, cached: false, host: true };
  }
  let m;
  try { m = await store.material(db, env, tenant, provider); }
  catch (e) {
    if (hit && hit.expiresAt > now) return { ok: true, token: hit.token, cached: true, memo: true, degraded: 'credential store unreadable: ' + String(e && e.message).slice(0, 100) };
    throw e;
  }
  if (m && m.access && m.expiresAt && Date.parse(m.expiresAt) - now > MARGIN_MS) { memo.set(key, { token: m.access, expiresAt: Date.parse(m.expiresAt) }); return { ok: true, token: m.access, cached: true }; }
  const a = adapterFor(provider);
  if (!a) return { ok: false, error: 'unknown provider ' + provider };
  const r = await a.mint(m, { ...opts, env, now });
  if (!r.ok) {
    await store.put(db, env, tenant, provider, { status: 'failed', error: r.error });
    await store.event(db, tenant, provider, 'failed', r.error);
    return r;
  }
  if (r.token && r.expiresAt) memo.set(key, { token: r.token, expiresAt: typeof r.expiresAt === 'number' ? r.expiresAt : Date.parse(r.expiresAt) });
  await store.put(db, env, tenant, provider, { access: r.token || null, expiresAt: r.expiresAt || null, status: 'ok', error: null, ...(r.rotatedRefresh || r.secretPatch ? { secret: { ...m.secret, ...(r.secretPatch || {}), ...(r.rotatedRefresh ? { refresh_token: r.rotatedRefresh } : {}) } } : {}) });
  await store.event(db, tenant, provider, m && m.access ? 'refreshed' : 'minted', r.expiresAt ? 'expires ' + new Date(r.expiresAt).toISOString() : 'no expiry');
  return { ok: true, token: r.token, cached: false };
}

export const DEAD_RETRY_MS = 6 * 3600 * 1000;
export const isDead = r => r.status === 'failed' && /refresh HTTP 40[01]|consent has not completed/.test(r.last_error || '');

// OWNER-ACTS-1: the acts that need a person's sign-in, read from live credential rows instead of a typed list. No secret leaves: provider, reason, link.
export async function ownerActs(db) {
  await store.ensureSchema(db);
  const rows = (await db.prepare('SELECT tenant, provider, status, last_error, updated_at, meta FROM credentials').all()).results || [];
  const metaOf = r => { try { return typeof r.meta === 'string' ? JSON.parse(r.meta) : (r.meta || {}); } catch { return {}; } };
  const link = (p, r) => { const m = r ? metaOf(r) : {}; if (m.kind === 'mcp' && m.server) return '/connect/mcp?server=' + encodeURIComponent(m.server); if (p === 'oauth:mastodon' && m.instance && /^[a-z0-9.-]+$/i.test(m.instance)) return '/connect/mastodon/start?instance=' + encodeURIComponent(m.instance); return link0(p); };  // a remote MCP server is reconnected by its own address, a Mastodon account on the instance its row names (US-30-R06)
  const link0 = p => p === 'oauth:mastodon' ? '/connect/mastodon/start?instance=mstdn.science' : '/connect/' + p.replace(/^oauth:/, '').replace(/^github-.*/, 'github');  // SOCIAL-MODULE-1: one link for Mastodon, the instance is part of it
  const acts = rows.filter(isDead).map(r => ({ id: 'signin:' + r.provider, tenant: r.tenant, provider: r.provider, reason: r.last_error, since: r.updated_at, connect: link(r.provider, r) }));
  return acts;
}

export async function refreshDue(db, env, opts = {}) {
  await store.ensureSchema(db);
  const now = opts.now || Date.now();
  const rows = (await db.prepare('SELECT tenant, provider, expires_at, status, last_error, updated_at FROM credentials').all()).results || [];
  const out = [];
  for (const r of rows) {
    if (r.provider === 'oauth:bluesky' || r.provider === 'oauth:mastodon') { out.push({ ...r, action: 'at-use' }); continue; }  // SOCIAL-TENANTS-1: the publisher refreshes these when it posts (Bluesky needs DPoP, which the generic grant lacks; Mastodon tokens do not expire). The generic grant failed every hour and overwrote the row's status.
    // NO-EXPIRY-1 (2026-11-20): a connected token with no expiry (Mastodon) is not due. It was treated as due on every tick, the refresh found no refresh
    // token, and the row was marked failed minutes after a good sign-in. A sign-in still under way (pending, oauth) is waiting on its callback, not on a refresh.
    if (r.status === 'ok' && !r.expires_at && r.provider.startsWith('oauth:')) { out.push({ tenant: r.tenant, provider: r.provider, status: r.status, action: 'fresh' }); continue; }
    if (r.status === 'pending' && r.provider.startsWith('oauth:')) { out.push({ tenant: r.tenant, provider: r.provider, status: r.status, action: 'awaiting-consent' }); continue; }
    const due = r.status !== 'ok' || !r.expires_at || Date.parse(r.expires_at) - now <= MARGIN_MS;
    if (!due) { out.push({ tenant: r.tenant, provider: r.provider, expires_at: r.expires_at, status: r.status, action: 'fresh' }); continue; }
    // DEAD-CONSENT-1 (2026-11-20): a refresh the provider refused (401/400) or a consent that never finished cannot heal by retrying; only a new sign-in does.
    // Live rows showed 337 Bluesky and 374 Mastodon retries, one every tick. Such a row is retried every DEAD_RETRY_MS, and a new consent rewrites it at once.
    if (isDead(r) && r.updated_at && now - Date.parse(r.updated_at) < DEAD_RETRY_MS) { out.push({ tenant: r.tenant, provider: r.provider, action: 'backoff', error: r.last_error }); continue; }
    const res = await getToken(db, env, r.tenant, r.provider, { ...opts, now });
    out.push({ tenant: r.tenant, provider: r.provider, action: res.ok ? 'renewed' : 'failed', error: res.error });
  }
  if (rows.some(r => r.provider === 'github-admin')) { const { archiveDue } = await import('./archive.js'); out.push(...(await archiveDue(db, env, opts)).map(a => ({ ...a, provider: 'github-admin' }))); }  // REPOS-1 resolver
  if (rows.some(r => r.provider === 'github-admin')) { const { rulesetsDue } = await import('./rulesets.js'); out.push(...(await rulesetsDue(db, env, opts)).map(a => ({ ...a, provider: 'github-admin' }))); }  // DIRECT-MERGE-GATE-1 resolver
  return out;
}

// Probe for the failure registry: every credential row is ok and no cached token lapses within the margin.
export async function probe(db, now = Date.now()) {
  await store.ensureSchema(db);
  const rows = (await db.prepare('SELECT tenant, provider, expires_at, status FROM credentials').all()).results || [];
  const bad = rows.filter(r => r.status === 'failed' || (r.expires_at && Date.parse(r.expires_at) <= now));
  const gh = rows.some(r => r.provider === 'github-app' && r.status === 'ok');  // no GitHub credential: the Worker points at its own consent screen, never at a person's to-do list
  return { ok: bad.length === 0 && gh, credentials: rows.length, bad: bad.map(r => `${r.tenant}/${r.provider}`), github_connected: gh, ...(gh ? {} : { connect: '/connect/github' }) };
}
