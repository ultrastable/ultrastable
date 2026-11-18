// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DIRECT-MERGE-GATE-1: apply the main-branch ruleset with the administration-only app from /connect/github-admin. #619 was merged by a direct
// merge call 30 s before its `checks` run failed; only GitHub itself can refuse that route. Upsert by name, so a repeat pass changes nothing.
// RULESETS mirrors github/org-settings.json (repos[repo].rulesets); seed/worker/test/auth.test.js fails when the two differ.
import { getToken } from './index.js';
import * as store from './store.js';
export const RULESETS = Object.freeze({ 'ultrastable/ultrastable': [{
  name: 'main-requires-checks', target: 'branch', enforcement: 'active',
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  rules: [
    { type: 'pull_request', parameters: { required_approving_review_count: 0, dismiss_stale_reviews_on_push: false, require_code_owner_review: false, require_last_push_approval: false, required_review_thread_resolution: false } },
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'checks' }] } },
  ],
  bypass_actors: [{ actor_id: 15368, actor_type: 'Integration', bypass_mode: 'always' }],
}] });

export async function applyRulesets(db, env, tenant, { fetch: f = fetch, now = Date.now(), rulesets = RULESETS, token } = {}) {
  const tk = token ? { ok: true, token } : await getToken(db, env, tenant, 'github-admin', { fetch: f, now });
  if (!tk.ok) { await store.event(db, tenant, 'github-admin', 'failed', 'rulesets: ' + tk.error); return { ok: false, error: tk.error, results: [] }; }
  const h = { authorization: 'Bearer ' + tk.token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-auth', 'content-type': 'application/json' };
  const results = [];
  for (const [repo, list] of Object.entries(rulesets)) {
    const cur = await f(`https://api.github.com/repos/${repo}/rulesets`, { headers: h });
    const have = cur.status === 200 ? await cur.json() : null;
    for (const rs of list) {
      let status = cur.status;
      if (Array.isArray(have)) {
        const old = have.find(x => x.name === rs.name);
        const r = await f(`https://api.github.com/repos/${repo}/rulesets${old ? '/' + old.id : ''}`, { method: old ? 'PUT' : 'POST', headers: h, body: JSON.stringify(rs) });
        status = r.status;
      }
      const ok = status === 200 || status === 201;
      results.push({ repo, name: rs.name, status, ok });
      await store.event(db, tenant, 'github-admin', ok ? 'ok' : 'failed', `ruleset ${repo} ${rs.name} HTTP ${status}`);
    }
  }
  const ok = results.length > 0 && results.every(x => x.ok);
  if (ok) await store.event(db, tenant, 'github-admin', 'rulesets', 'all rulesets applied');  // the resolver below stops once this row exists
  return { ok, results };
}

// Resolver: every tick retries for each tenant with the admin app until the 'rulesets' event exists, so a failed first pass heals itself.
export async function rulesetsDue(db, env, opts = {}) {
  const rows = (await db.prepare("SELECT tenant FROM credentials WHERE provider = 'github-admin'").all()).results || [];
  const out = [];
  for (const { tenant } of rows) {
    const done = await db.prepare("SELECT 1 AS x FROM credential_events WHERE tenant = ? AND provider = 'github-admin' AND event = 'rulesets' LIMIT 1").bind(tenant).first();
    if (done) { out.push({ tenant, action: 'done' }); continue; }
    const r = await applyRulesets(db, env, tenant, opts).catch(e => ({ ok: false, error: String(e && e.message || e) }));
    out.push({ tenant, action: r.ok ? 'rulesets-applied' : 'retry', error: r.error });
  }
  return out;
}
