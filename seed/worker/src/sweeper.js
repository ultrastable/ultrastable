// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// SERVER-OWNS-LOOPS-1: the tick Worker closes every loop a client session (code agent, chat, person) leaves open. A client only produces work; this sweeper owns closing it.
// For each open PR on a client branch: refresh a stale branch, merge when green, and once it is older than maxAgeH file one tracked item (Q-OPENLOOP-<repo>-<n>) with owner, trigger and probe.
// For each issue still labelled claimed/dispatched past maxAgeH: release the claim so the executor re-takes it. Returns open_loop_age_hours, the probe value (target 0).
import { notGreen } from './greenguard.js';
const API = 'https://api.github.com';
// BRANCH-ROOT-CAUSE-1: `worker/` branches (the Worker executor's own PRs) were never swept, so they sat blocked; every automation prefix is swept.
const CLIENT_PREFIX = ['claude/', 'agent/', 'worker/'];
async function gh(f, token, method, path, body) {
  const r = await f(API + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-sweeper', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : null };
}
const hours = (iso, now) => Math.max(0, (now - Date.parse(iso)) / 36e5);

export async function sweepOpenLoops({ token, repos = [], fetch: f = fetch, now = Date.now(), maxAgeH = 24 }) {
  const out = { status: 'ok', merged: [], refreshed: [], filed: [], lane_owned: [], released: [], errors: [], open_loop_age_hours: 0 };
  if (!token) return { ...out, status: 'no-token' };
  for (const repo of repos) {
    try {
      const prs = await gh(f, token, 'GET', `/repos/${repo}/pulls?state=open&per_page=50`);
      if (!prs.ok) { out.errors.push(`${repo} pulls ${prs.status}`); continue; }
      for (const p of prs.json.filter(p => CLIENT_PREFIX.some(x => (p.head && p.head.ref || '').startsWith(x)))) {
        const tag = `${repo}#${p.number}`;
        let d = (await gh(f, token, 'GET', `/repos/${repo}/pulls/${p.number}`)).json || p;
        if (d.draft) { const r = await gh(f, token, 'POST', `/repos/${repo}/pulls/${p.number}/ready_for_review`); if (r.ok) d = (await gh(f, token, 'GET', `/repos/${repo}/pulls/${p.number}`)).json || d; }
        if (d.mergeable_state === 'behind') { const u = await gh(f, token, 'PUT', `/repos/${repo}/pulls/${p.number}/update-branch`); if (u.ok) out.refreshed.push(tag); }
        // BRANCH-ROOT-CAUSE-1: a PR opened with the built-in token never fires `pull_request`, so the required `checks` never reports and the PR sits BLOCKED forever.
        // Close and reopen it once (the `reopened` trigger runs checks) when its head has no check run at all; never when a run exists, so a real failure is not looped.
        if (['blocked', 'unknown'].includes(d.mergeable_state) && d.head && d.head.sha && hours(p.updated_at || p.created_at, now) > 0.1) {
          const cr = await gh(f, token, 'GET', `/repos/${repo}/commits/${d.head.sha}/check-runs?per_page=1`);
          if (cr.ok && cr.json && cr.json.total_count === 0) {
            const c1 = await gh(f, token, 'PATCH', `/repos/${repo}/pulls/${p.number}`, { state: 'closed' });
            const c2 = c1.ok ? await gh(f, token, 'PATCH', `/repos/${repo}/pulls/${p.number}`, { state: 'open' }) : c1;
            (c2.ok ? (out.retriggered ||= []) : out.errors).push(c2.ok ? tag : `${tag} retrigger ${c2.status}`);
          }
        }
        const hold = d.mergeable_state === 'clean' ? await notGreen(f, token, repo, d.head && d.head.sha, (ff, t, m, path) => gh(ff, t, m, path)) : null;  // GREEN-GUARD-1
        if (hold) out.held = [...(out.held || []), `${tag} ${hold}`];
        if (d.mergeable_state === 'clean' && !hold) {
          const m = await gh(f, token, 'PUT', `/repos/${repo}/pulls/${p.number}/merge`, { merge_method: 'squash' });
          if (m.ok) { out.merged.push(tag); continue; }
        }
        const age = hours(p.updated_at || p.created_at, now);
        out.open_loop_age_hours = Math.max(out.open_loop_age_hours, Math.round(age * 10) / 10);
        if (age < maxAgeH) continue;
        const title = `Q-OPENLOOP-${repo.replace('/', '-')}-${p.number}: close the open client loop on #${p.number}`;
        const have = await gh(f, token, 'GET', `/repos/${repo}/issues?state=open&labels=open-loop&per_page=100`);
        // Issues can be off on a repository (items are then docs/issues files): GitHub answers 410 with an object, not a list. That loop is not an
        // error and must not abort the sweep: the merge lane files its tracked item (OL-PR-<n>, `foundation loopowner --adopt`) on the same pass.
        if (have.status === 410 || have.status === 404) { out.lane_owned.push(tag); continue; }
        if ((Array.isArray(have.json) ? have.json : []).some(i => i.title.startsWith(`Q-OPENLOOP-${repo.replace('/', '-')}-${p.number}:`))) continue;
        const body = `Owner: ultrastable-tick sweeper. Trigger: every tick. State: ${d.mergeable_state}, idle ${age.toFixed(0)} h.\nDone: PR #${p.number} merged or superseded with evidence. Closing probe: open_loop_age_hours for this PR is 0.\nSERVER-OWNS-LOOPS-1: the server closes this loop, never a client session.`;
        const c = await gh(f, token, 'POST', `/repos/${repo}/issues`, { title, body, labels: ['open-loop'] });
        if (c.status === 410 || c.status === 404) { out.lane_owned.push(tag); continue; }
        (c.ok ? out.filed : out.errors).push(c.ok ? tag : `${tag} file ${c.status}`);
      }
      const iss = await gh(f, token, 'GET', `/repos/${repo}/issues?state=open&labels=claimed&per_page=50`);
      for (const i of iss.ok && Array.isArray(iss.json) ? iss.json : []) {
        if (i.pull_request || hours(i.updated_at, now) < maxAgeH) continue;
        const r = await gh(f, token, 'DELETE', `/repos/${repo}/issues/${i.number}/labels/claimed`);
        if (r.ok || r.status === 404) out.released.push(`${repo}#${i.number}`);
      }
    } catch (e) { out.errors.push(`${repo} ${e.message}`); }
  }
  if (out.errors.length) out.status = 'errors';
  return out;
}

// Persist one pass (D1) so the live probe can prove the sweeper ran: /live exposes the newest row.
export async function recordSweep(db, out, at = new Date().toISOString().replace('T', ' ').slice(0, 19)) {
  await db.prepare(`INSERT INTO sweeper_runs (at, status, merged, filed, released, errors, open_loop_age_hours) VALUES (?,?,?,?,?,?,?)`)
    .bind(at, out.status, out.merged.length, out.filed.length, out.released.length, out.errors.join('; ').slice(0, 500), out.open_loop_age_hours).run();
  await db.prepare(`DELETE FROM sweeper_runs WHERE id NOT IN (SELECT id FROM sweeper_runs ORDER BY id DESC LIMIT 500)`).run();
}
export async function lastSweep(db) { return (await db.prepare(`SELECT at, status, merged, filed, released, errors, open_loop_age_hours FROM sweeper_runs ORDER BY id DESC LIMIT 1`).first()) || null; }
