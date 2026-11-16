// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// AUTH-1 + POINT-AND-CLICK-1: the auth-callback routes. The GitHub App is created and installed through GitHub's own manifest flow: one consent click to register the app (GitHub returns the app id and
// private key to /auth/github/callback), one to install it (GitHub returns the installation id to /auth/github/installed). The Worker stores everything sealed and mints every later token itself.
//   GET  /connect/github            consent screen
//   GET  /auth/github/callback      ?code&state  manifest conversion -> store app -> send the person to the install page
//   GET  /auth/github/installed     ?installation_id&state -> store installation -> done
//   GET  /auth/health               credential probe (no secrets)
import * as store from './store.js';
import { consentScreen, doneScreen, failScreen } from './consent.js';
import { probe, getToken, SCOPE_ALLOWLIST } from './index.js';
import { checkRepoAccess, readRepoAccess } from './access.js';

import { hmac } from './state.js';
import { handleConnector } from './connectors.js';
export const makeState = async (env, tenant, now = Date.now()) => `${tenant}.${now}.${await hmac(env, `${tenant}.${now}`)}`;
export async function checkState(env, state, now = Date.now()) {
  const [tenant, ts, sig] = String(state || '').split('.');
  if (!tenant || !ts || !sig || now - Number(ts) > 3600e3 || sig !== await hmac(env, `${tenant}.${ts}`)) return null;
  return tenant;
}

// GitHub App names are global, so every visit gets its own prefilled name (never a form field for the person): <name>-<6 random hex>, capped at GitHub's 34 characters.
export const uniqueName = (name, rnd = () => crypto.randomUUID().replace(/-/g, '').slice(0, 6)) => `${String(name || 'ultrastable').slice(0, 27)}-${rnd()}`;

export function manifest(origin, name) {
  return {
    name, url: origin, redirect_url: origin + '/auth/github/callback', setup_url: origin + '/auth/github/installed', public: false, setup_on_update: true,
    hook_attributes: { url: origin + '/hook/github', active: true }, default_events: ['pull_request', 'push', 'check_suite', 'workflow_run', 'issues'],
    default_permissions: { ...SCOPE_ALLOWLIST['github-app'] },  // Q-LESSON-CRED-SCOPE: exactly the allowlist
  };
}

async function route(request, env, opts = {}) {
  const { tenant = 'default', name = 'ultrastable', fetch: f = fetch, now = Date.now() } = opts;
  const url = new URL(request.url), origin = url.origin;
  if (/^\/(connect|auth|\.well-known\/oauth-client)\//.test(url.pathname) || url.pathname === '/connect') await store.ensureSchema(env.DB);  // the Worker brings up its own credential tables before any route touches them
  if (url.pathname === '/connect') { const r = await probe(env.DB, now); return Response.redirect(new URL(r.github_connected ? '/' : '/connect/github', url), 302); }
  if (url.pathname === '/auth/health') { const r = await probe(env.DB, now); return Response.json(r, { status: r.ok ? 200 : 503 }); }
  if (url.pathname === '/connect/repos') {  // REPO-ACCESS-1: the one click that widens the installation; GitHub sends the owner back to /auth/github/installed, which re-probes
    const a = await readRepoAccess(env.DB);
    if (!a || a.ok) return doneScreen('GitHub access', a ? 'Every repository is covered.' : 'Nothing to select yet.');
    return Response.redirect(a.settings_url || new URL('/connect/github', url).toString(), 302);
  }
  if (url.pathname === '/connect/github') {
    const state = await makeState(env, tenant, now);
    return consentScreen({
      provider: 'GitHub', title: 'Connect GitHub', button: 'Authorize on GitHub',
      will: ['Create a private GitHub App for this system (GitHub shows you exactly what it can do).', 'Install it on your repositories so changes can be opened, checked, merged and deployed automatically.', 'Keep its access renewed by itself, with nothing for you to copy or paste.'],
      why: 'This is a one-time approval. After it, the system does all of the work on its own.',
      action: { method: 'POST', url: (opts.repos && opts.repos[0] ? `https://github.com/organizations/${opts.repos[0].split('/')[0]}/settings/apps/new` : 'https://github.com/settings/apps/new') + '?state=' + encodeURIComponent(state), fields: { manifest: JSON.stringify(manifest(origin, uniqueName(name))) } },
    });
  }
  if (url.pathname === '/auth/github/callback') {
    const t = await checkState(env, url.searchParams.get('state'), now);
    if (!t) return failScreen('Connect GitHub', 'That approval link expired.', '/connect/github');
    const r = await f(`https://api.github.com/app-manifests/${encodeURIComponent(url.searchParams.get('code') || '')}/conversions`, { method: 'POST', headers: { accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-auth' } });
    if (r.status !== 201) { await store.event(env.DB, t, 'github-app', 'failed', 'manifest conversion HTTP ' + r.status); return failScreen('Connect GitHub', 'GitHub did not finish creating the app.', '/connect/github'); }
    const j = await r.json();
    await store.put(env.DB, env, t, 'github-app', { secret: { pem: j.pem, webhook_secret: j.webhook_secret, client_secret: j.client_secret }, meta: { app_id: j.id, slug: j.slug, client_id: j.client_id }, status: 'pending' });
    await store.event(env.DB, t, 'github-app', 'consent', 'app registered ' + j.slug);
    const state = await makeState(env, t, now);
    return Response.redirect(`https://github.com/apps/${j.slug}/installations/new?state=${encodeURIComponent(state)}`, 302);
  }
  if (url.pathname === '/auth/github/installed') {
    const t = await checkState(env, url.searchParams.get('state'), now);
    const inst = url.searchParams.get('installation_id');
    if (!t || !inst) return failScreen('Connect GitHub', 'The installation did not complete.', '/connect/github');
    await store.put(env.DB, env, t, 'github-app', { meta: { installation_id: Number(inst) }, access: null, status: 'pending' });
    await store.event(env.DB, t, 'github-app', 'consent', 'installed ' + inst);
    const repos = opts.repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []);  // re-probe now: the new token is scoped to the selection just made
    try {  // the re-probe never fails the install page; the next tick probes again
      const tk = await getToken(env.DB, env, t, 'github-app', { fetch: f, now });
      if (tk.ok && repos.length) await checkRepoAccess(env.DB, env, t, repos, { token: tk.token, fetch: f, now, origin });
    } catch (e) { await store.event(env.DB, t, 'github-app', 'failed', 're-probe: ' + String(e && e.message || e)); }
    return doneScreen('GitHub connected', 'Done. From here the system opens, checks, merges and deploys changes by itself.');
  }
  return handleConnector(request, env, { tenant, fetch: f, now, allowInsecure: !!opts.allowInsecure });  // CONNECT-1: every other /connect/<provider> path
}

// Any failure inside an auth route is recorded as a credential event and answered with a retry screen, never a raw Worker exception.
export async function handleAuth(request, env, opts = {}) {
  try { return await route(request, env, opts); }
  catch (e) {
    const t = opts.tenant || 'default';
    try { await store.event(env.DB, t, 'github-app', 'failed', String(e && e.message || e).slice(0, 300)); } catch (_) { console.error('auth event', e && e.message); }
    console.error('auth', e && e.message);
    return failScreen('Connect GitHub', 'Something went wrong finishing the connection. The system recorded it and you can try again.', '/connect/github');
  }
}
