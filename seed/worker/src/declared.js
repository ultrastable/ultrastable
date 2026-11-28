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

// GH-ONLY-WATCH-1 (2026-11-26): a GitHub-only system's clock is GitHub's cron, which skipped the first scheduled runs of base-rates entirely.
// Once an hour the tick reads each declared GitHub-only loop (config.gh_only, built from tenant rows with `gh_only` by deploy/deploy-workers.mjs)
// and dispatches its workflow when (a) no run started in max_gap_hours, or (b) Pages is on but nothing is published yet, so the site goes live
// the hour Pages is switched on, with no hand-off. A run already queued or in progress is left alone, so the step never stacks runs.
// GH-ONLY-WATCH-1: what the watch could not do, as "<repo>: reason" lines the tick files as items. Measured 2026-11-28: the tick never dispatched
// base-rates' or open-questions' loop (the only dispatches in either repository were by hand) through gaps of 8 to 12 hours, and nothing said so,
// because the unmeasured lines of this reading were returned and dropped. A reading that cannot dispatch is a failure, never a pass.
export function ghOnlyFailures(r, loops = []) {
  if (r && r.status === 'no-token') return loops.map(l => `${l.repo}: ${r.why}`);
  return (r && r.unmeasured) || [];
}

export async function watchGhOnly({ token, loops = [], fetchImpl = fetch, now = Date.now() } = {}) {
  if (!token) return { status: 'no-token', why: 'no GitHub token: GitHub-only loops cannot be read or dispatched from here' };
  const A = gh(fetchImpl, token), out = { status: 'ok', checked: 0, dispatched: [], unmeasured: [] };
  for (const l of loops.slice(0, 10)) {
    const repo = String(l.repo || ''), wf = String(l.workflow || 'loop.yml'), gap = Number(l.max_gap_hours) || 7;
    if (!VIS_REPO.test(repo) || !/^[\w.-]+\.ya?ml$/.test(wf)) { out.unmeasured.push(`${repo}: not a repository and workflow`); continue; }
    try {
      const runs = await A('GET', `/repos/${repo}/actions/workflows/${wf}/runs?per_page=1`);
      if (runs.status !== 200) { out.unmeasured.push(`${repo}: runs HTTP ${runs.status}`); continue; }
      out.checked++;
      const last = (runs.json.workflow_runs || [])[0];
      if (last && last.status !== 'completed') continue;
      const age = last ? (now - Date.parse(last.created_at)) / 36e5 : Infinity;
      let why = age > gap ? `no run for ${Number.isFinite(age) ? age.toFixed(1) + ' h' : 'ever'}` : '';
      if (!why) {
        const pg = await A('GET', `/repos/${repo}/pages`);
        if (pg.status === 200 && pg.json.html_url) {
          const site = await fetchImpl(pg.json.html_url, { headers: { 'user-agent': UA } }).then(r => r.status).catch(() => 0);
          if (site === 404) why = 'Pages is on and nothing is published yet';
        }
      }
      if (!why) continue;
      const d = await A('POST', `/repos/${repo}/actions/workflows/${wf}/dispatches`, { ref: 'main' });
      if (d.status === 204) out.dispatched.push(`${repo}: ${why}`); else out.unmeasured.push(`${repo}: dispatch HTTP ${d.status}`);
    } catch (e) { out.unmeasured.push(`${repo}: ${String(e && e.message).slice(0, 80)}`); }
  }
  return out;
}
