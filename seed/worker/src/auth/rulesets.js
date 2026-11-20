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
  bypass_actors: [],  // the Actions app (15368) cannot be a bypass actor (HTTP 422); applyRulesets adds the org's own app, and workflows commit to main through it (MAIN-WRITER-1)
}] });

export async function applyRulesets(db, env, tenant, { fetch: f = fetch, now = Date.now(), rulesets = RULESETS, token } = {}) {
  const tk = token ? { ok: true, token } : await getToken(db, env, tenant, 'github-admin', { fetch: f, now });
  if (!tk.ok) { await store.event(db, tenant, 'github-admin', 'failed', 'rulesets: ' + tk.error); return { ok: false, error: tk.error, results: [] }; }
  const h = { authorization: 'Bearer ' + tk.token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-auth', 'content-type': 'application/json' };
  const results = [];
  // The tick Worker's own app writes to main through the contents API, so it is exempt as well; its id comes from the stored install, never from a literal.
  const own = await db.prepare("SELECT meta FROM credentials WHERE tenant = ? AND provider = 'github-app'").bind(tenant).first();
  let ownId = 0;
  try { ownId = Number(JSON.parse((own && own.meta) || '{}').app_id) || 0; } catch (e) { ownId = 0; /* unreadable meta: apply without the extra exemption and let the event row show the result */ }
  for (const [repo, list] of Object.entries(rulesets)) {
    const cur = await f(`https://api.github.com/repos/${repo}/rulesets`, { headers: h });
    const have = cur.status === 200 ? await cur.json() : null;
    for (const rs of list) {
      let status = cur.status, why = '';
      if (Array.isArray(have)) {
        const old = have.find(x => x.name === rs.name);
        const bypass = [...(rs.bypass_actors || [])];
        if (ownId && !bypass.some(x => x.actor_id === ownId)) bypass.push({ actor_id: ownId, actor_type: 'Integration', bypass_mode: 'always' });
        const r = await f(`https://api.github.com/repos/${repo}/rulesets${old ? '/' + old.id : ''}`, { method: old ? 'PUT' : 'POST', headers: h, body: JSON.stringify({ ...rs, bypass_actors: bypass }) });
        status = r.status;
        if (status !== 200 && status !== 201) why = await reason(r);
      }
      const ok = status === 200 || status === 201;
      results.push({ repo, name: rs.name, status, ok });
      await store.event(db, tenant, 'github-admin', ok ? 'ok' : 'failed', `ruleset ${repo} ${rs.name} HTTP ${status}${why ? ' ' + why : ''}`);
    }
  }
  const ok = results.length > 0 && results.every(x => x.ok);
  if (ok) await store.event(db, tenant, 'github-admin', 'rulesets', 'all rulesets applied; own app ' + ownId);  // the resolver below stops once this row names the app that writes to main
  return { ok, results };
}

// GitHub's own refusal text (a validation message, never a credential), cut short so the event row says why a rule was refused.
async function reason(r) {
  try { const j = await r.json(); return [j.message, ...(j.errors || []).map(e => typeof e === 'string' ? e : e.message || e.code)].filter(Boolean).join('; ').slice(0, 300); }
  catch (e) { return 'no readable body'; /* the status code is already recorded */ }
}

// Resolver: every tick retries for each tenant with the admin app until the 'rulesets' event exists, so a failed first pass heals itself.
export async function rulesetsDue(db, env, opts = {}) {
  const rows = (await db.prepare("SELECT tenant FROM credentials WHERE provider = 'github-admin'").all()).results || [];
  const out = [];
  for (const { tenant } of rows) {
    // APP-DRIFT-1 (seen live 2026-11-20): the rule on main exempted the app that existed when it was applied; the tick later ran under a newer app, GitHub answered 422 to
    // every data commit and nothing a workflow measured reached main. The rule is therefore re-applied whenever the last applied row does not name the app in use now.
    const done = await db.prepare("SELECT detail FROM credential_events WHERE tenant = ? AND provider = 'github-admin' AND event = 'rulesets' ORDER BY at DESC, rowid DESC LIMIT 1").bind(tenant).first();
    const own = await db.prepare("SELECT meta FROM credentials WHERE tenant = ? AND provider = 'github-app'").bind(tenant).first();
    let ownId = 0;
    try { ownId = Number(JSON.parse((own && own.meta) || '{}').app_id) || 0; } catch (e) { ownId = 0; /* unreadable meta: treated as no app; the applied row then stands */ }
    if (done && (!ownId || String(done.detail || '').endsWith('own app ' + ownId))) { out.push({ tenant, action: 'done' }); continue; }
    // MAIN-WRITER-1 rollout guard: with the rule active only the org's own app may write to main, so wait until a workflow commit has landed through it.
    if (!opts.token && !(await db.prepare("SELECT 1 AS x FROM credential_events WHERE provider = 'github-app' AND event = 'main-writer' LIMIT 1").first())) { out.push({ tenant, action: 'await-main-writer' }); continue; }
    const recent = await db.prepare("SELECT 1 AS x FROM credential_events WHERE tenant = ? AND provider = 'github-admin' AND event = 'failed' AND detail LIKE 'ruleset %' AND at > ? LIMIT 1").bind(tenant, new Date((opts.now || Date.now()) - 3600e3).toISOString().slice(0, 19) + 'Z').first();
    if (recent) { out.push({ tenant, action: 'backoff' }); continue; }  // a refused rule is retried hourly, not every tick
    const r = await applyRulesets(db, env, tenant, opts).catch(e => ({ ok: false, error: String(e && e.message || e) }));
    out.push({ tenant, action: r.ok ? 'rulesets-applied' : 'retry', error: r.error });
  }
  return out;
}
