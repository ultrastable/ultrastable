// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DECLARED-LIVE-1 (Rowan, 2026-11-25: "Audit and remediate all of your failures and their root causes and fix them all in code."): the root cause
// shared by several of the day's failures was a fact declared in the repository that nothing reconciled with the live system. A tenant repository
// was created private while doctrine/tenant-repos.json said public, so its CI and deploy could not read it; Practical Solutions' back end had no
// schedule because its only route to run was its own cron, and the account had hit its cron-trigger limit. Two server-side loops close both:
//   reconcileVisibility: every repository whose visibility the repo declares (org/repos.json, doctrine/tenant-repos.json, built into
//     config.repo_visibility by deploy/deploy-workers.mjs) is read on GitHub with the administration app the tick already holds, and a drift is set
//     back to the declared value. The declaration wins; nobody is asked to flip a switch.
//   pulseTenants: every tenant back end that declares a `pulse` URL in doctrine/topology.json (built into config.tenant_pulse) is called once an
//     hour from the tick's single cron. A tenant's own cron becomes one of two routes, so a cron-trigger limit, a deploy that dropped the trigger
//     or a cron that never fired cannot stop a back end. The routes are idempotent: they run a beat only when the last one is older than its interval.
// Both return what they read and did; neither throws, and an unreadable answer is reported as unmeasured, never as in order.
const API = 'https://api.github.com', UA = 'ultrastable-declared-live';
const gh = (f, token) => async (method, path, body) => {
  const r = await f(API + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': UA, 'x-github-api-version': '2022-11-28', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
// Only repositories of the org, never another owner's; the core and ops repositories keep the visibility they have unless declared here.
export const VIS_REPO = /^[a-z0-9][a-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export async function reconcileVisibility({ token, repos = [], apply = true, fetchImpl = fetch } = {}) {
  if (!token) return { status: 'no-token', why: 'the administration app gave no token: visibility cannot be read or set from here' };
  const A = gh(fetchImpl, token), out = { status: 'ok', checked: 0, drift: [], fixed: [], unmeasured: [] };
  for (const d of repos.slice(0, 40)) {
    const repo = String(d.repo || ''), want = d.private === true;
    if (!VIS_REPO.test(repo)) { out.unmeasured.push(`${repo}: not a repository name`); continue; }
    let seen;
    try { seen = await A('GET', `/repos/${repo}`); } catch (e) { out.unmeasured.push(`${repo}: ${String(e && e.message).slice(0, 80)}`); continue; }
    if (seen.status === 404) { out.unmeasured.push(`${repo}: not visible to the administration app (HTTP 404)`); continue; }
    if (seen.status !== 200) { out.unmeasured.push(`${repo}: HTTP ${seen.status}`); continue; }
    out.checked++;
    if (seen.json.archived) continue;  // an archived repository is read-only; its visibility is history
    if (Boolean(seen.json.private) === want) continue;
    out.drift.push(`${repo}: ${seen.json.private ? 'private' : 'public'}, declared ${want ? 'private' : 'public'}`);
    if (!apply) continue;
    const p = await A('PATCH', `/repos/${repo}`, { private: want });
    if (p.status === 200 && Boolean(p.json.private) === want) out.fixed.push(repo);
    else out.unmeasured.push(`${repo}: set ${want ? 'private' : 'public'} refused, HTTP ${p.status} ${String(p.json.message || '').slice(0, 80)}`);
  }
  if (out.drift.length > out.fixed.length) out.status = 'drift';
  return out;
}

// A tenant's restart route: POST, JSON back. 'ran' when it started a beat, 'fresh' when its last beat was recent, 'failed' otherwise.
export async function pulseTenants({ targets = [], fetchImpl = fetch } = {}) {
  const out = { status: 'ok', ran: [], fresh: [], failed: [] };
  for (const t of targets.slice(0, 20)) {
    const id = String(t.id || t.url);
    if (!/^https:\/\//.test(String(t.url || ''))) { out.failed.push(`${id}: no https pulse URL`); continue; }
    try {
      const r = await fetchImpl(t.url, { method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/json' }, body: '{}' });
      const j = await r.json().catch(() => ({}));
      if (r.status >= 300 || j.ok === false || j.error) out.failed.push(`${id}: HTTP ${r.status} ${String(j.error || '').slice(0, 80)}`.trim());
      else if (j.skipped) out.fresh.push(id);
      else out.ran.push(id);
    } catch (e) { out.failed.push(`${id}: ${String(e && e.message).slice(0, 80)}`); }
  }
  if (out.failed.length) out.status = 'failed';
  return out;
}
