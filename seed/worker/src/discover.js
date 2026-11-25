// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DISCOVER-1 (Rowan, 2026-11-25): every Ultrastable system is public and findable unless its owner says otherwise.
// Each system serves /.well-known/ultrastable.json (name, public URL, repository, license and nothing private), shows a
// "Built on Ultrastable" footer, and once a day tells the ultrastable.io directory its public URL. The directory fetches the
// manifest itself before listing anything, so a heartbeat can never list a page that does not say it is an Ultrastable system.
// Opt out with the variable ULTRASTABLE_DIRECTORY=off or "discoverable": false in ultrastable.json; then the manifest says so
// and no heartbeat is sent. A system with no PUBLIC_URL has no public front end and sends nothing.
export const DIRECTORY = 'https://ultrastable.io';
export const LICENSE = 'LicenseRef-Ultrastable-USL-1.0';

const clean = (s, n = 200) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function publicUrl(env = {}) {
  try { const u = new URL(env.PUBLIC_URL || ''); return u.protocol === 'https:' ? u.origin : null; } catch { return null; }
}

export function optedOut(env = {}, config = {}) {
  return String(env.ULTRASTABLE_DIRECTORY || '').toLowerCase() === 'off' || config.discoverable === false;
}

export function manifest(env = {}, config = {}) {
  const repos = config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : []);
  return {
    ultrastable: 1,
    name: clean(config.org_name || config.org_slug || env.TENANT || 'An Ultrastable system', 80),
    url: publicUrl(env),
    repo: repos[0] ? 'https://github.com/' + clean(repos[0], 120) : null,
    license: LICENSE,
    discoverable: !optedOut(env, config),
    directory: DIRECTORY + '/directory',
  };
}

export function footerHtml(env = {}, config = {}) {
  const m = manifest(env, config);
  return `<footer style="max-width:36rem;margin:2rem auto;padding:0 16px;font-size:.9rem;opacity:.8">Built on <a href="${DIRECTORY}/" rel="noopener">Ultrastable</a>${m.discoverable ? ` · <a href="${DIRECTORY}/directory">More systems built on it</a>` : ''}${m.repo ? ` · <a href="${esc(m.repo)}">Source</a>` : ''} · <a href="/.well-known/ultrastable.json">About this system</a></footer>`;
}

export function discoverRoute(url, env, config) {
  if (url.pathname !== '/.well-known/ultrastable.json') return null;
  return Response.json(manifest(env, config), { headers: { 'cache-control': 'public, max-age=3600', 'access-control-allow-origin': '*' } });
}

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
