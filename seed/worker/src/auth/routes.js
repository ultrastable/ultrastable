// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// AUTH-1 + POINT-AND-CLICK-1: the auth-callback routes. The GitHub App is created and installed through GitHub's own manifest flow: one consent click to register the app (GitHub returns the app id and
// private key to /auth/github/callback), one to install it (GitHub returns the installation id to /auth/github/installed). The Worker stores everything sealed and mints every later token itself.
//   GET  /connect/github            consent screen
//   GET  /auth/github/callback      ?code&state  manifest conversion -> store app -> send the person to the install page
//   GET  /auth/github/installed     ?installation_id&state -> store installation -> done
//   GET  /connect/github-admin      REPOS-1: consent for the administration-only app (+ /auth/github-admin/callback and /installed)
//   GET  /auth/health               credential probe (no secrets)
import * as store from './store.js';
import { consentScreen, doneScreen, failScreen } from './consent.js';
import { probe, getToken, SCOPE_ALLOWLIST } from './index.js';
import { checkRepoAccess, readRepoAccess } from './access.js';

import { hmac } from './state.js';
import { handleConnector } from './connectors.js';
import { handleSocial } from './social.js';
import { archiveRetired } from './archive.js';
export const makeState = async (env, tenant, now = Date.now()) => `${tenant}.${now}.${await hmac(env, `${tenant}.${now}`)}`;
export async function checkState(env, state, now = Date.now()) {
  const [tenant, ts, sig] = String(state || '').split('.');
  if (!tenant || !ts || !sig || now - Number(ts) > 3600e3 || sig !== await hmac(env, `${tenant}.${ts}`)) return null;
  return tenant;
}

// APP-REUSE-1 (owner, 2026-11-20: "I'm sick of creating new GitHub apps ... keep track of what you've already done"): a connect link never registers a second app.
// Before 2026-11-20 every visit to /connect/github or /connect/github-admin posted a fresh manifest, so six apps were registered for two roles. Now the stored
// app is the registry: connected -> a done screen and nothing else; registered but not installed -> the stored app's own install page; a new app only when no
// app is stored or the stored one can no longer mint (status failed).
export async function reuseApp(env, tenant, provider, title, now) {
  const row = await store.get(env.DB, tenant, provider);
  if (!row) return null;
  const meta = JSON.parse(row.meta || '{}');
  if (!meta.app_id || !meta.slug || row.status === 'failed') return null;
  if (meta.installation_id) {  // installed: the admin app rests at 'pending' between uses, which is still connected
    await store.event(env.DB, tenant, provider, 'reused', 'already connected as ' + meta.slug + '; no new app');
    return doneScreen(title, 'Already connected. Nothing more is needed.');
  }
  await store.event(env.DB, tenant, provider, 'reused', 'install page of ' + meta.slug + '; no new app');
  return Response.redirect(`https://github.com/apps/${meta.slug}/installations/new?state=${encodeURIComponent(await makeState(env, tenant, now))}`, 302);
}

// GitHub App names are global, so every visit gets its own prefilled name (never a form field for the person): <name>-<6 random hex>, capped at GitHub's 34 characters.
export const uniqueName = (name, rnd = () => crypto.randomUUID().replace(/-/g, '').slice(0, 6)) => `${String(name || 'ultrastable').slice(0, 27)}-${rnd()}`;

export function manifest(origin, name, kind = 'github-app') {
  const admin = kind === 'github-admin', seg = admin ? 'github-admin' : 'github';  // REPOS-1: the admin app has its own callbacks, no webhook and no events
  return {
    name, url: origin, redirect_url: `${origin}/auth/${seg}/callback`, setup_url: `${origin}/auth/${seg}/installed`, public: false, setup_on_update: true,
    ...(admin ? {} : { hook_attributes: { url: origin + '/hook/github', active: true }, default_events: ['pull_request', 'push', 'check_suite', 'workflow_run', 'issues'] }),
    default_permissions: { ...SCOPE_ALLOWLIST[kind] },  // Q-LESSON-CRED-SCOPE: exactly the allowlist
  };
}

async function route(request, env, opts = {}) {
  const { tenant = 'default', name = 'ultrastable', fetch: f = fetch, now = Date.now() } = opts;
  const url = new URL(request.url), origin = url.origin;
  if (/^\/(connect|auth|\.well-known\/oauth-client)\//.test(url.pathname) || url.pathname === '/connect') await store.ensureSchema(env.DB);  // the Worker brings up its own credential tables before any route touches them
  if (url.pathname === '/connect') { const r = await probe(env.DB, now); if (!r.github_connected) return Response.redirect(new URL('/connect/github', url), 302); }  // REACH-1: once GitHub is linked /connect is the index of every channel (social.js)
  if (url.pathname === '/auth/health') { const r = await probe(env.DB, now); return Response.json(r, { status: r.ok ? 200 : 503 }); }
  if (url.pathname === '/connect/repos') {  // REPO-ACCESS-1: the one click that widens the installation; GitHub sends the owner back to /auth/github/installed, which re-probes
    const a = await readRepoAccess(env.DB);
    if (!a || a.ok) return doneScreen('GitHub access', a ? 'Every repository is covered.' : 'Nothing to select yet.');
    return Response.redirect(a.settings_url || new URL('/connect/github', url).toString(), 302);
  }
  if (url.pathname === '/connect/github') {
    const reused = await reuseApp(env, tenant, 'github-app', 'GitHub is connected', now);
    if (reused) return reused;
    const state = await makeState(env, tenant, now);
    return consentScreen({
      provider: 'GitHub', title: 'Connect GitHub', button: 'Authorize on GitHub',
      will: ['Create a private GitHub App for this system (GitHub shows you exactly what it can do).', 'Install it on your repositories so changes can be opened, checked, merged and deployed automatically.', 'Keep its access renewed by itself, with nothing for you to copy or paste.'],
      why: 'This is a one-time approval. After it, the system does all of the work on its own.',
      action: { method: 'POST', url: (opts.repos && opts.repos[0] ? `https://github.com/organizations/${opts.repos[0].split('/')[0]}/settings/apps/new` : 'https://github.com/settings/apps/new') + '?state=' + encodeURIComponent(state), fields: { manifest: JSON.stringify(manifest(origin, uniqueName(name))) } },
    });
  }
  if (url.pathname === '/connect/github-admin') {  // REPOS-1 + CONNECT-LINK-1: one click registers a second, administration-only app so retired repositories can be archived server-side
    const reusedAdmin = await reuseApp(env, tenant, 'github-admin', 'Repository settings are allowed', now);
    if (reusedAdmin) return reusedAdmin;
    const state = await makeState(env, tenant, now), org = opts.repos && opts.repos[0] ? opts.repos[0].split('/')[0] : '';
    return consentScreen({
      provider: 'GitHub', title: 'Allow repository archiving', button: 'Authorize on GitHub',
      will: ['Create a second private GitHub App that can change repository settings only (it cannot read or write code).', 'Use it to archive the retired repositories, once, from the server.', 'Keep its access renewed by itself, with nothing for you to copy or paste.'],
      why: 'Archiving a repository is a settings change the code-writing app is not allowed to make.',
      action: { method: 'POST', url: (org ? `https://github.com/organizations/${org}/settings/apps/new` : 'https://github.com/settings/apps/new') + '?state=' + encodeURIComponent(state), fields: { manifest: JSON.stringify(manifest(origin, uniqueName((name || 'ultrastable') + '-admin'), 'github-admin')) } },
    });
  }
  if (url.pathname === '/auth/github-admin/callback') {
    const t = await checkState(env, url.searchParams.get('state'), now);
    if (!t) return failScreen('Allow repository archiving', 'That approval link expired.', '/connect/github-admin');
    const r = await f(`https://api.github.com/app-manifests/${encodeURIComponent(url.searchParams.get('code') || '')}/conversions`, { method: 'POST', headers: { accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-auth' } });
    if (r.status !== 201) { await store.event(env.DB, t, 'github-admin', 'failed', 'manifest conversion HTTP ' + r.status); return failScreen('Allow repository archiving', 'GitHub did not finish creating the app.', '/connect/github-admin'); }
    const j = await r.json();
    await store.put(env.DB, env, t, 'github-admin', { secret: { pem: j.pem, webhook_secret: j.webhook_secret, client_secret: j.client_secret }, meta: { app_id: j.id, slug: j.slug, client_id: j.client_id }, status: 'pending' });
    await store.event(env.DB, t, 'github-admin', 'consent', 'app registered ' + j.slug);
    return Response.redirect(`https://github.com/apps/${j.slug}/installations/new?state=${encodeURIComponent(await makeState(env, t, now))}`, 302);
  }
  if (url.pathname === '/auth/github-admin/installed') {
    const t = await checkState(env, url.searchParams.get('state'), now), inst = url.searchParams.get('installation_id');
    if (!t || !inst) return failScreen('Allow repository archiving', 'The installation did not complete.', '/connect/github-admin');
    await store.put(env.DB, env, t, 'github-admin', { meta: { installation_id: Number(inst) }, status: 'pending' });
    await store.event(env.DB, t, 'github-admin', 'consent', 'installed ' + inst);
    let msg = 'Done. The server archives the retired repositories by itself.';
    try { const a = await archiveRetired(env.DB, env, t, { fetch: f, now }); msg = a.ok ? 'Done. The retired repositories are archived.' : 'Connected. Archiving will be retried automatically.'; } catch (e) { await store.event(env.DB, t, 'github-admin', 'failed', 'archive: ' + String(e && e.message || e)); }  // never fails the page; the tick retries
    return doneScreen('Repository archiving allowed', msg);
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
  { const sr = await handleSocial(request, env, { tenant, fetch: f, now, allowInsecure: !!opts.allowInsecure }); if (sr) return sr; }  // REACH-1: /connect, /connect/bluesky, /connect/mastodon
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
