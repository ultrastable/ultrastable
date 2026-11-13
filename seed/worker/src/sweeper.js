// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// SERVER-OWNS-LOOPS-1: the tick Worker closes every loop a client session (code agent, chat, person) leaves open. A client only produces work; this sweeper owns closing it.
// For each open PR on a client branch: refresh a stale branch, merge when green, and once it is older than maxAgeH file one tracked item (Q-OPENLOOP-<repo>-<n>) with owner, trigger and probe.
// For each issue still labelled claimed/dispatched past maxAgeH: release the claim so the executor re-takes it. Returns open_loop_age_hours, the probe value (target 0).
const API = 'https://api.github.com';
const CLIENT_PREFIX = ['claude/', 'agent/'];
async function gh(f, token, method, path, body) {
  const r = await f(API + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-sweeper', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : null };
}
const hours = (iso, now) => Math.max(0, (now - Date.parse(iso)) / 36e5);

export async function sweepOpenLoops({ token, repos = [], fetch: f = fetch, now = Date.now(), maxAgeH = 24 }) {
  const out = { status: 'ok', merged: [], refreshed: [], filed: [], released: [], errors: [], open_loop_age_hours: 0 };
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
        if (d.mergeable_state === 'clean') {
          const m = await gh(f, token, 'PUT', `/repos/${repo}/pulls/${p.number}/merge`, { merge_method: 'squash' });
          if (m.ok) { out.merged.push(tag); continue; }
        }
        const age = hours(p.updated_at || p.created_at, now);
        out.open_loop_age_hours = Math.max(out.open_loop_age_hours, Math.round(age * 10) / 10);
        if (age < maxAgeH) continue;
        const title = `Q-OPENLOOP-${repo.replace('/', '-')}-${p.number}: close the open client loop on #${p.number}`;
        const have = await gh(f, token, 'GET', `/repos/${repo}/issues?state=open&labels=open-loop&per_page=100`);
        if ((have.json || []).some(i => i.title.startsWith(`Q-OPENLOOP-${repo.replace('/', '-')}-${p.number}:`))) continue;
        const body = `Owner: ultrastable-tick sweeper. Trigger: every tick. State: ${d.mergeable_state}, idle ${age.toFixed(0)} h.\nDone: PR #${p.number} merged or superseded with evidence. Closing probe: open_loop_age_hours for this PR is 0.\nSERVER-OWNS-LOOPS-1: the server closes this loop, never a client session.`;
        const c = await gh(f, token, 'POST', `/repos/${repo}/issues`, { title, body, labels: ['open-loop'] });
        (c.ok ? out.filed : out.errors).push(c.ok ? tag : `${tag} file ${c.status}`);
      }
      const iss = await gh(f, token, 'GET', `/repos/${repo}/issues?state=open&labels=claimed&per_page=50`);
      for (const i of iss.ok ? iss.json : []) {
        if (i.pull_request || hours(i.updated_at, now) < maxAgeH) continue;
        const r = await gh(f, token, 'DELETE', `/repos/${repo}/issues/${i.number}/labels/claimed`);
        if (r.ok || r.status === 404) out.released.push(`${repo}#${i.number}`);
      }
    } catch (e) { out.errors.push(`${repo} ${e.message}`); }
  }
  if (out.errors.length) out.status = 'errors';
  return out;
}
