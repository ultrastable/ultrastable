// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// APP-INVENTORY-1: the live truth about the org's GitHub Apps, read by the Worker with each app's own key. For every stored app (one per role) it asks GitHub
// who the app is and where it is installed, removes any installation of that app other than the stored one, and records one credential_events row (event
// 'app-audit', detail JSON). An app whose key is gone cannot be asked and is reported as unreachable. Runs at most once a day. No person clicks anything.
import { appJwt } from './auth/github-app.js';
import * as store from './auth/store.js';
const API = 'https://api.github.com', ROLES = ['github-app', 'github-admin'], DAY = 20 * 3600 * 1000;
const H = jwt => ({ authorization: 'Bearer ' + jwt, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-app-audit' });

export async function auditApps(db, env, tenant, { fetch: f = fetch, now = Date.now(), force = false } = {}) {
  await store.ensureSchema(db);
  const last = await db.prepare("SELECT at FROM credential_events WHERE tenant = ? AND event = 'app-audit' ORDER BY id DESC LIMIT 1").bind(tenant).first();
  if (!force && last && now - Date.parse(last.at) < DAY) return { skipped: 'ran within a day', at: last.at };
  const apps = [];
  for (const role of ROLES) {
    const m = await store.material(db, env, tenant, role).catch(() => null);
    if (!m || !m.secret || !m.meta.app_id) { apps.push({ role, reachable: false, reason: 'no stored key' }); continue; }
    const jwt = await appJwt(m.meta.app_id, m.secret.pem, now);
    const me = await f(`${API}/app`, { headers: H(jwt) });
    if (me.status !== 200) { apps.push({ role, app_id: m.meta.app_id, reachable: false, reason: 'GET /app HTTP ' + me.status }); continue; }
    const app = await me.json();
    const ir = await f(`${API}/app/installations?per_page=100`, { headers: H(jwt) });
    const installs = ir.status === 200 ? await ir.json() : [];
    const removed = [];
    for (const i of installs) {
      if (String(i.id) === String(m.meta.installation_id)) continue;
      const d = await f(`${API}/app/installations/${i.id}`, { method: 'DELETE', headers: H(jwt) });
      removed.push({ id: i.id, account: i.account && i.account.login, status: d.status });
    }
    apps.push({ role, app_id: app.id, slug: app.slug, reachable: true, installations: installs.map(i => ({ id: i.id, account: i.account && i.account.login, kept: String(i.id) === String(m.meta.installation_id) })), removed });
  }
  const report = { at: new Date(now).toISOString(), apps, active: apps.filter(a => a.reachable).length, expected: ROLES.length };
  await store.event(db, tenant, 'github-app', 'app-audit', JSON.stringify(report));
  return report;
}
