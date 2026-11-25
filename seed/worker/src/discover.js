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
  const repos = config.github_repos || (env.GITHUB_REPOS ? String(env.GITHUB_REPOS).split(',') : (env.PUBLIC_REPO ? [env.PUBLIC_REPO] : []));  // PUBLIC_REPO: the repository a deploy names for the manifest only (deploy/deploy-seed.mjs); it grants nothing
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

// Once a day (the 03:00 UTC tick window), and never when opted out or without a public URL. BOOT-4: a newborn system also
// registers on its first ticks, without waiting for 03:00, until the directory has answered "listed" once; those attempts are
// spaced an hour apart and every answer (status and the directory's reason) is kept in directory_registration, so a refusal is read.
const REG_TABLE = 'CREATE TABLE IF NOT EXISTS directory_registration (id INTEGER PRIMARY KEY CHECK (id = 1), at TEXT NOT NULL, status INTEGER, listed INTEGER NOT NULL DEFAULT 0, why TEXT)';
export async function heartbeat(env = {}, config = {}, { fetchFn = fetch, now = new Date(), db = env.DB } = {}) {
  const m = manifest(env, config);
  if (!m.discoverable) return { sent: false, why: 'opted out' };
  if (!m.url) return { sent: false, why: 'no public URL' };
  let last = null;
  if (db) { try { await db.prepare(REG_TABLE).run(); last = await db.prepare('SELECT at, listed FROM directory_registration WHERE id = 1').first(); } catch (e) { console.error('directory registration read', e && e.message); } }
  const daily = now.getUTCHours() === 3 && now.getUTCMinutes() < 10;
  const birth = Boolean(db) && !(last && last.listed) && (!last || now - Date.parse(last.at) >= 3600e3);
  if (!daily && !birth) return { sent: false, why: 'not the daily window' };
  let status = 0, why = null;
  try {
    const r = await fetchFn(DIRECTORY + '/api/directory/register', { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'ultrastable-heartbeat/1' }, body: JSON.stringify({ url: m.url }) });
    status = r.status;
    try { const j = r.json ? await r.json() : null; why = j && (j.why || j.error) ? clean(j.why || j.error, 160) : null; } catch { why = null; }
  } catch (e) {
    why = 'directory unreachable: ' + clean(e && e.message, 120);
  }
  const listed = status >= 200 && status < 300;
  if (db) { try { await db.prepare('INSERT INTO directory_registration (id, at, status, listed, why) VALUES (1, ?1, ?2, ?3, ?4) ON CONFLICT(id) DO UPDATE SET at = ?1, status = ?2, listed = MAX(listed, ?3), why = ?4').bind(now.toISOString(), status, listed ? 1 : 0, why).run(); } catch (e) { console.error('directory registration write', e && e.message); } }
  return status ? { sent: true, status, listed, why, birth: !daily } : { sent: false, why };
}
