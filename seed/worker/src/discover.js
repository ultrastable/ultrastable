// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DISCOVER-1 (Rowan, 2026-11-25): every Ultrastable system is public and findable unless its owner says otherwise.
// Each system serves /.well-known/ultrastable.json (name, public URL, repository, license and nothing private), shows a
// "Built on Ultrastable" footer, and once a day tells the ultrastable.io directory its public URL. The directory fetches the
// manifest itself before listing anything, so a heartbeat can never list a page that does not say it is an Ultrastable system.
// Opt out with the variable ULTRASTABLE_DIRECTORY=off or "discoverable": false in ultrastable.json; then the manifest says so
// and no heartbeat is sent. A system with no PUBLIC_URL has no public front end and sends nothing.
import { CONTRACT_VERSION, SURFACES, claims, statementsHtml, jsonLd } from './contract.js';
export const DIRECTORY = 'https://ultrastable.io';
export const LICENSE = 'LicenseRef-Ultrastable-USL-1.0';

const clean = (s, n = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function publicUrl(env = {}, requestUrl = null) {
  try { const u = new URL(env.PUBLIC_URL || ''); if (u.protocol === 'https:') return u.origin; } catch { /* allow-silent: no PUBLIC_URL bound; the address the request came in on is read below */ }
  try { const u = new URL(String(requestUrl || '')); return u.protocol === 'https:' ? u.origin : null; } catch { return null; }  // DISCOVER-2: a system answering on https knows its own address without a binding
}

export function optedOut(env = {}, config = {}) {
  return String(env.ULTRASTABLE_DIRECTORY || '').toLowerCase() === 'off' || config.discoverable === false;
}

export function manifest(env = {}, config = {}, requestUrl = null) {
  // SYSTEM-MANIFEST-1: the identity object of ultrastable.json (written into config by the bootstrap) is the first source of name and repository
  const id = config.identity || {};
  const repos = id.repo ? [id.repo] : config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []);
  return {
    ultrastable: 1,
    name: clean((id.repo && id.name) || config.org_name || config.org_slug || env.TENANT || 'An Ultrastable system', 80),
    url: publicUrl(env, requestUrl),
    repo: repos[0] ? 'https://github.com/' + clean(repos[0], 120) : null,
    license: LICENSE,
    discoverable: !optedOut(env, config),
    directory: DIRECTORY + '/directory',
    contract: CONTRACT_VERSION,
    platform: DIRECTORY,
    surfaces: Object.fromEntries(SURFACES.map(x => [x.id, x.path])),
  };
}

// FLEET-CONTRACT-1: what a system started from the seed states before its owner has added a page of their own, each sentence with the page that
// shows it and the endpoint that backs it. The public page renders these same sentences (visibility.js publicPage), so the two cannot differ.
export function seedSpec(env = {}, config = {}, requestUrl = null) {
  const m = manifest(env, config, requestUrl);
  return {
    name: m.name, url: m.url, repo: m.repo ? m.repo.replace('https://github.com/', '') : null, discoverable: m.discoverable,
    statements: [
      { id: 'clock', text: 'The health report says when the last pass ran, whether every step finished and the stage this system read for itself.', page: '/', api: '/health' },
      { id: 'graph', text: 'This system keeps a graph of its own records; the public view gives counts and never a private record.', page: '/', api: '/api/graph' },
    ],
    internal: [],
  };
}

export function footerHtml(env = {}, config = {}) {
  const m = manifest(env, config);
  return `<footer style="max-width:36rem;margin:2rem auto;padding:0 16px;font-size:.9rem;opacity:.8">Built on <a href="${DIRECTORY}/" rel="noopener">Ultrastable</a>${m.discoverable ? ` · <a href="${DIRECTORY}/directory">More systems built on it</a>` : ''}${m.repo ? ` · <a href="${esc(m.repo)}">Source</a>` : ''} · <a href="/.well-known/ultrastable.json">About this system</a></footer>`;
}

export function discoverRoute(url, env, config) {
  const open = { headers: { 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' } };
  if (url.pathname === '/claims.json') return Response.json(claims(seedSpec(env, config, url)), open);  // FLEET-CONTRACT-1
  // TENANT-PROMO-1: a queue only holds posts about public content. A seed with no public content of its own serves an empty one and says why.
  if (url.pathname === '/social-queue.json' && env.PUBLIC_HEALTH_ONLY === '1') return Response.json({ tenant: config.org_slug || env.TENANT || null, mode: 'tenant-queue', posts: [], why: 'no public content yet: this system serves its health report and its statements only' }, open);
  if (url.pathname !== '/.well-known/ultrastable.json') return null;
  return Response.json(manifest(env, config, url), { headers: { 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
}

export const seedStatements = (env, config, url) => statementsHtml(seedSpec(env, config, url), '/');
export const seedJsonLd = (env, config, url) => jsonLd(seedSpec(env, config, url));  // schema.org JSON-LD from the same spec as the statements

// Once a day (the 03:00 UTC tick window), and never when opted out or without a public URL.
export async function heartbeat(env = {}, config = {}, { fetchFn = fetch, now = new Date() } = {}) {
  const m = manifest(env, config);
  if (!m.discoverable) return { sent: false, why: 'opted out' };
  if (!m.url) return { sent: false, why: 'no public URL' };
  if (now.getUTCHours() !== 3 || now.getUTCMinutes() >= 10) return { sent: false, why: 'not the daily window' };
  try {
    const r = await fetchFn(DIRECTORY + '/api/directory/register', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'ultrastable-heartbeat/1' }, body: JSON.stringify({ url: m.url }) });
    return { sent: true, status: r.status };
  } catch (e) {
    return { sent: false, why: 'directory unreachable: ' + clean(e && e.message, 120) };
  }
}
