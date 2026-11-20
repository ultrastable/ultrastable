// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// REPO-ACCESS-1: detect, by code, whether the GitHub App installation covers every repository the system works on, and close the gap through the
// provider's own consent page (an App cannot widen its own installation: that needs the account owner's click, so the Worker serves that click and re-probes).
// Surfaces tried in order: installation repositories with the app's token (what the tick sees), the installation record with the app JWT (selection, settings url).
import { appJwt } from './github-app.js';
import * as store from './store.js';
import { getToken, SCOPE_ALLOWLIST } from './index.js';
const API = 'https://api.github.com';
const H = t => ({ authorization: 'Bearer ' + t, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-access' });

export async function checkRepoAccess(db, env, tenant, repos, { token: tok, fetch: f = fetch, now = Date.now(), origin = '' } = {}) {
  let token = tok;
  const m = await store.material(db, env, tenant, 'github-app');
  const out = { ok: false, covered: [], missing: [...repos], selection: null, settings_url: null, connect: origin + '/connect/repos', at: new Date(now).toISOString() };
  if (!m || !m.meta.installation_id) { out.reason = 'app not installed'; return finish(db, out); }
  const owners = [...new Set(repos.map(x => x.split('/')[0].toLowerCase()))];
  if (m.secret && m.meta.app_id) {  // surface 2: every installation of this app (the one that holds the repos may already exist: adopt it by code), then the app's own account
    const jwt = await appJwt(m.meta.app_id, m.secret.pem, now);
    const li = await f(`${API}/app/installations?per_page=100`, { headers: H(jwt) });
    const list = li.ok ? await li.json() : [];
    const want = list.find(i => i.account && owners.includes(String(i.account.login).toLowerCase()));
    out.installations = list.map(i => i.account && i.account.login);
    if (want && Number(want.id) !== Number(m.meta.installation_id)) {  // self-heal: switch to the installation that covers the repos, then mint from it
      await store.put(db, env, tenant, 'github-app', { meta: { installation_id: Number(want.id) }, access: null, status: 'pending' });
      out.adopted_installation = want.id;
      const t2 = await getToken(db, env, tenant, 'github-app', { fetch: f, now }); token = t2.ok ? t2.token : null;
    }
    const inst = want || list.find(i => Number(i.id) === Number(m.meta.installation_id));
    if (inst) { out.selection = inst.repository_selection; out.settings_url = inst.html_url || null; }
    if (inst && inst.permissions) {  // Q-GATE-403: a permission the allowlist asks for that this installation was never granted (an App changed after it was installed)
      const rank = { read: 1, write: 2, admin: 3 };
      out.permissions_missing = Object.entries(SCOPE_ALLOWLIST['github-app']).filter(([k, v]) => (rank[inst.permissions[k]] || 0) < rank[v]).map(([k, v]) => `${k}:${v}`);
    }
    const ap = await f(`${API}/app`, { headers: H(jwt) });
    const app = ap.ok ? await ap.json() : null;
    out.app_owner = app && app.owner && app.owner.login;
    if (!want) {  // no installation on the repos' account: a user-owned private app cannot be installed on an org, so register the app under that org; an org-owned app is installed from its own page
      const orgOwned = out.app_owner && owners.includes(String(out.app_owner).toLowerCase());
      out.settings_url = orgOwned ? `https://github.com/apps/${m.meta.slug}/installations/new` : `https://github.com/organizations/${owners[0]}/settings/apps/new`;
      out.needs = orgOwned ? 'install the app on the organization' : 'register the app under the organization';
    }
  }
  if (token) {  // surface 1: what this token can actually reach
    const r = await f(`${API}/installation/repositories?per_page=100`, { headers: H(token) });
    if (r.ok) { const j = await r.json(); out.covered = (j.repositories || []).map(x => x.full_name); }
    else out.reason = `installation repositories HTTP ${r.status}`;
  }
  out.missing = repos.filter(x => !out.covered.map(c => c.toLowerCase()).includes(x.toLowerCase()));
  out.ok = out.missing.length === 0 && out.covered.length > 0;
  if (out.permissions_missing && out.permissions_missing.length && !out.reason) out.reason = `the installation lacks ${out.permissions_missing.join(', ')} (accept the updated permissions at ${origin}/connect/github)`;
  return finish(db, out);
}

// Persist the result, keep one machine-readable gate card in step with it (open while missing, closed when covered), and return it.
async function finish(db, out) {
  await db.prepare(`INSERT INTO org (key, value) VALUES ('repo_access', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(out)).run();
  const id = 'GATE-REPO-ACCESS';
  if (out.ok) await db.prepare(`UPDATE gate_cards SET status='closed', closed_at=datetime('now') WHERE id=? AND status='open'`).bind(id).run();
  else await db.prepare(`INSERT INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES (?,?,?,?,?,'repo_access_ok')
    ON CONFLICT(id) DO UPDATE SET what=excluded.what, status='open', closed_at=NULL`).bind(id,
      `Select ${out.missing.join(', ') || 'the repositories'} for the GitHub App installation (one click at ${out.connect}).`,
      'Only the account owner can widen an App installation; the App cannot grant itself access (GitHub API).',
      'Sweeper and lane skip the uncovered repositories and report status errors; the live probe stays red.',
      'The Worker detects the gap every tick, serves the consent page, and re-probes on the setup callback.').run();
  return out;
}
export const readRepoAccess = async db => { const r = await db.prepare(`SELECT value FROM org WHERE key='repo_access'`).first(); return r ? JSON.parse(r.value) : null; };
