// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// REPOS-1 (Q-REPOS-ADMIN-APPLY): archive the retired repositories with the administration-only app from /connect/github-admin. Idempotent: an already archived repository is skipped.
// RETIRED mirrors brand/brand.json (status "retired"); seed/worker/test/auth.test.js fails when the two differ.
import { getToken } from './index.js';
import * as store from './store.js';
export const RETIRED = Object.freeze(['ultrastable/license', 'ultrastable/spec', 'ultrastable/workers']);

export async function archiveRetired(db, env, tenant, { fetch: f = fetch, now = Date.now(), repos = RETIRED, token } = {}) {
  const tk = token ? { ok: true, token } : await getToken(db, env, tenant, 'github-admin', { fetch: f, now });
  if (!tk.ok) { await store.event(db, tenant, 'github-admin', 'failed', 'archive: ' + tk.error); return { ok: false, error: tk.error, results: [] }; }
  const results = [];
  for (const repo of repos) {
    const r = await f(`https://api.github.com/repos/${repo}`, { method: 'PATCH', headers: { authorization: 'Bearer ' + tk.token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-auth', 'content-type': 'application/json' }, body: JSON.stringify({ archived: true }) });
    results.push({ repo, status: r.status, ok: r.status === 200 });
    await store.event(db, tenant, 'github-admin', r.status === 200 ? 'ok' : 'failed', `archive ${repo} HTTP ${r.status}`);
  }
  const ok = results.every(x => x.ok);
  if (ok) await store.event(db, tenant, 'github-admin', 'archived', 'all retired repositories archived');  // the resolver below stops once this row exists
  return { ok, results };
}

// Resolver for Q-REPOS-ADMIN-APPLY: every tick retries for each tenant that has the admin app installed until the 'archived' event exists, so a failed first pass heals itself.
export async function archiveDue(db, env, opts = {}) {
  const rows = (await db.prepare("SELECT tenant FROM credentials WHERE provider = 'github-admin'").all()).results || [];
  const out = [];
  for (const { tenant } of rows) {
    const done = await db.prepare("SELECT 1 AS x FROM credential_events WHERE tenant = ? AND provider = 'github-admin' AND event = 'archived' LIMIT 1").bind(tenant).first();
    if (done) { out.push({ tenant, action: 'done' }); continue; }
    const r = await archiveRetired(db, env, tenant, opts).catch(e => ({ ok: false, error: String(e && e.message || e) }));
    out.push({ tenant, action: r.ok ? 'archived' : 'retry', error: r.error });
  }
  return out;
}
