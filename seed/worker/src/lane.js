// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// Worker-side lane: each tick merges green PRs and hands open issues to the agent workflow, with no person in the loop.
// Needs a GITHUB_TOKEN secret binding; without one it reports "no-token" and the other hosts (deploy/routes.json) carry the lane.
const API = 'https://api.github.com';

async function gh(f, token, method, path, body) {
  const r = await f(API + path, {
    method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-lane', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  return { ok: r.ok, status: r.status, json: text ? JSON.parse(text) : null };
}

export async function runLane({ token, repos = [], fetch: f = fetch, issueWorkflow = 'issues.yml', maxIssues = 3, maxMerges = 5 }) {
  if (!token) return { status: 'no-token', merged: [], dispatched: [], errors: [] };
  const out = { status: 'ok', merged: [], dispatched: [], held: [], errors: [] };
  for (const repo of repos) {
    try {
      const prs = await gh(f, token, 'GET', `/repos/${repo}/pulls?state=open&per_page=30`);
      if (!prs.ok) { out.errors.push(`${repo} pulls ${prs.status}`); continue; }
      for (const pr of prs.json) {
        if (out.merged.length >= maxMerges) break;
        let d = (await gh(f, token, 'GET', `/repos/${repo}/pulls/${pr.number}`)).json;
        if (d && d.draft) { // a draft with finished work is marked ready by the lane
          if (pr.labels && pr.labels.some(l => l.name === 'handoff')) continue;
          const m = await gh(f, token, 'POST', `/repos/${repo}/pulls/${pr.number}/ready_for_review`);
          if (!m.ok) { out.held.push(`${repo}#${pr.number} draft`); continue; }
          d = (await gh(f, token, 'GET', `/repos/${repo}/pulls/${pr.number}`)).json;
        }
        const comments = (await gh(f, token, 'GET', `/repos/${repo}/issues/${pr.number}/comments?per_page=30`)).json || [];
        if (comments.some(c => /^HOLD:/.test(c.body || ''))) { out.held.push(`${repo}#${pr.number} HOLD`); continue; }
        if (!d || d.mergeable_state !== 'clean') { out.held.push(`${repo}#${pr.number} ${d && d.mergeable_state}`); continue; }
        const m = await gh(f, token, 'PUT', `/repos/${repo}/pulls/${pr.number}/merge`, { merge_method: 'squash' });
        (m.ok ? out.merged : out.errors).push(m.ok ? `${repo}#${pr.number}` : `${repo}#${pr.number} merge ${m.status}`);
      }
      const iss = await gh(f, token, 'GET', `/repos/${repo}/issues?state=open&per_page=30`);
      let n = 0;
      for (const i of iss.ok ? iss.json : []) {
        if (i.pull_request || n >= maxIssues) continue;
        if ((i.labels || []).some(l => ['claimed', 'dispatched', 'blocked'].includes(l.name)) || (i.assignees || []).length) continue;
        const dsp = await gh(f, token, 'POST', `/repos/${repo}/actions/workflows/${issueWorkflow}/dispatches`, { ref: 'main', inputs: { issue: String(i.number) } });
        if (!dsp.ok) { out.errors.push(`${repo}#${i.number} dispatch ${dsp.status}`); continue; }
        await gh(f, token, 'POST', `/repos/${repo}/issues/${i.number}/labels`, { labels: ['dispatched'] });
        out.dispatched.push(`${repo}#${i.number}`); n++;
      }
    } catch (e) { out.errors.push(`${repo} ${e.message}`); }
  }
  if (out.errors.length) out.status = 'errors';
  return out;
}
