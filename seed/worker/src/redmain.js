// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// REDMAIN-LANE-1: when the newest commit on main fails the required `checks` gate and stays red for redMin minutes, the tick Worker opens a
// revert pull request (a commit that restores the parent's tree) with a Handoff block, so the lane that merges green PRs lands it. Server side only,
// through the git data API: no workflow edit, no client session. One revert per red commit, never a revert of a revert, and only a gate that
// completed with failure counts (a missing or running gate is not red).
const API = 'https://api.github.com';
async function gh(f, token, method, path, body) {
  const r = await f(API + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-redmain', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : null };
}
export async function revertRedMain({ token, repo, fetch: f = fetch, now = Date.now(), redMin = 15, gate = 'checks', base = 'main' }) {
  if (!token) return { status: 'no-token' };
  const head = await gh(f, token, 'GET', `/repos/${repo}/commits/${base}`);
  if (!head.ok) return { status: 'error', why: 'head ' + head.status };
  const c = head.json, sha = c.sha, parent = (c.parents || [])[0];
  if ((c.parents || []).length !== 1) return { status: 'skip', why: 'not a single-parent commit' };
  if (/^Revert /.test(c.commit.message)) return { status: 'skip', why: 'head is already a revert' };
  const runs = await gh(f, token, 'GET', `/repos/${repo}/commits/${sha}/check-runs?per_page=100`);
  if (!runs.ok) return { status: 'error', why: 'check-runs ' + runs.status };
  const g = (runs.json.check_runs || []).find(r => r.name === gate);
  if (!g) return { status: 'no-gate' };
  if (g.status !== 'completed') return { status: 'pending' };
  if (g.conclusion !== 'failure') return { status: 'green' };
  const ageMin = (now - Date.parse(c.commit.committer.date)) / 6e4;
  if (ageMin < redMin) return { status: 'waiting', age_min: Math.round(ageMin) };
  const branch = `agent/revert-${sha.slice(0, 7)}`;
  const open = await gh(f, token, 'GET', `/repos/${repo}/pulls?state=open&head=${repo.split('/')[0]}:${branch}`);
  if (open.ok && (open.json || []).length) return { status: 'open', pr: open.json[0].number };
  const p = await gh(f, token, 'GET', `/repos/${repo}/git/commits/${parent.sha}`);
  if (!p.ok) return { status: 'error', why: 'parent ' + p.status };
  const msg = `Revert ${sha.slice(0, 7)}: ${base} was red for ${Math.round(ageMin)} minutes (REDMAIN-LANE-1)`;
  const nc = await gh(f, token, 'POST', `/repos/${repo}/git/commits`, { message: msg, tree: p.json.tree.sha, parents: [sha] });
  if (!nc.ok) return { status: 'error', why: 'commit ' + nc.status };
  const ref = await gh(f, token, 'POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: nc.json.sha });
  if (!ref.ok) return { status: 'error', why: 'ref ' + ref.status };
  const pr = await gh(f, token, 'POST', `/repos/${repo}/pulls`, { title: msg, head: branch, base, body: `The \`${gate}\` gate failed on ${sha} and stayed red for ${Math.round(ageMin)} minutes. This restores the parent's tree.\n\n## Handoff\nitem: Q-REDMAIN-revert-lane\nagent: tick-worker\nverify: GET https://ultrastable.io/api/freshness expect "ok"\ndeploy: site` });
  if (!pr.ok) return { status: 'error', why: 'pr ' + pr.status };
  return { status: 'reverted', sha, branch, pr: pr.json.number };
}
