// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// PR-NEVER-LOSE-1 (2026-11-27): automation never discards unmerged work. PR #2615 was closed on a stale `conflict` reading although its branch merged cleanly with main.
// Every Worker closer of an unmerged pull request goes through safeClose: read it again live (a null `mergeable` is retried, and still unknown is NOT a conflict),
// never close a mergeable one, try GitHub's update-branch once, and pin the head under refs/archive/pr-<n>-<sha7> (read back) before the close.
// Twin of foundation/prsafe.py. `call(method, path, body)` returns { ok, status, json }.
export const MERGEABLE_STATES = ['clean', 'unstable', 'behind', 'has_hooks', 'blocked', 'draft'];
export const verdict = d => {
  if (!d || d.state !== 'open') return 'closed';
  const ms = String(d.mergeable_state || 'unknown').toLowerCase();
  if (d.mergeable === false || ms === 'dirty') return 'conflict';
  if (d.mergeable === true || MERGEABLE_STATES.includes(ms)) return 'mergeable';
  return 'unknown';
};
export async function livePr(call, repo, n, tries = 4, sleep = ms => new Promise(r => setTimeout(r, ms))) {
  let d = (await call('GET', `/repos/${repo}/pulls/${n}`)).json;
  for (let i = 1; i < tries && d && d.state === 'open' && d.mergeable == null && ['', 'unknown'].includes(String(d.mergeable_state || '').toLowerCase()); i++) { await sleep(1500); d = (await call('GET', `/repos/${repo}/pulls/${n}`)).json; }
  return d;
}
export async function pinHead(call, repo, n, sha) {
  const name = `pr-${n}-${String(sha).slice(0, 7)}`;
  const c = await call('POST', `/repos/${repo}/git/refs`, { ref: `refs/archive/${name}`, sha });
  if (!c.ok && c.status !== 422) return null;  // 422: the ref already exists
  const g = await call('GET', `/repos/${repo}/git/ref/archive/${name}`);
  return g.ok && g.json && g.json.object && g.json.object.sha === sha ? `refs/archive/${name}` : null;
}
export async function inMain(call, repo, sha, base = 'main') {
  const c = await call('GET', `/repos/${repo}/compare/${base}...${sha}`);
  return Boolean(c.ok && c.json && c.json.ahead_by === 0);  // unreadable is not carried
}
// -> { closed, reason, ref }. Never throws on a refusal.
export async function safeClose(call, repo, n, why, sleep) {
  const d = await livePr(call, repo, n, 4, sleep);
  const v = verdict(d);
  if (v === 'closed') return { closed: false, reason: 'already closed' };
  if (v !== 'conflict') {  // mergeable or unknown: a stale label or a not-yet-computed state is not a conflict
    for (const lab of ['conflict', 'ci-failed']) if ((d.labels || []).some(l => l.name === lab)) await call('DELETE', `/repos/${repo}/issues/${n}/labels/${lab}`);
    return { closed: false, reason: `${v}: not closed (${why})` };
  }
  const u = await call('PUT', `/repos/${repo}/pulls/${n}/update-branch`);
  if (u.ok) return { closed: false, reason: 'refreshed from main; re-read next pass' };
  const sha = d.head && d.head.sha;
  if (!sha) return { closed: false, reason: 'head sha unreadable' };
  const ref = (await inMain(call, repo, sha)) ? null : await pinHead(call, repo, n, sha);
  if (!ref && !(await inMain(call, repo, sha))) return { closed: false, reason: 'head not pinned, not closed' };
  await call('POST', `/repos/${repo}/issues/${n}/comments`, { body: `PR-NEVER-LOSE-1: closing after ${why}. Head ${sha.slice(0, 10)} is pinned at ${ref || 'main (already contained)'}; the queue item carries it onto current main.` });
  const c = await call('PATCH', `/repos/${repo}/pulls/${n}`, { state: 'closed' });
  return c.ok ? { closed: true, reason: why, ref, sha } : { closed: false, reason: `close ${c.status}` };
}
