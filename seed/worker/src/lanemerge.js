// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// LANE-WORKER-MERGE-1: the merge lane's workflow-capable route. A PR that changes .github/workflows/** cannot be merged with the Actions token, and no
// LANE_PAT or lane app secret is bound. The tick Worker already holds the org GitHub App (workflows: write), so the lane asks the Worker to merge: the run's
// OIDC token proves the caller, the Worker re-checks every gate on the exact head commit and merges with the installation token. Nothing is minted by a person.
import { notGreen } from './greenguard.js';
import { heldByComment } from './holds.js';  // HOLD-COMMENT-1
import { ghFetch, mergedAnyway } from './ghfetch.js';  // GH-RETRY-1
const API = 'https://api.github.com';
async function gh(f, token, method, path, body) {
  const r = await ghFetch(f, API + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-lane-merge', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : null };
}
export async function mergeForLane({ token, repo, pr, sha, fetch: f = fetch }) {
  if (!token) return { ok: false, status: 503, error: 'no app token' };
  if (!Number.isInteger(pr) || !/^[0-9a-f]{40}$/.test(sha || '')) return { ok: false, status: 400, error: 'pr and a full head sha are required' };
  const d = await gh(f, token, 'GET', `/repos/${repo}/pulls/${pr}`);
  if (!d.ok) return { ok: false, status: 502, error: `read ${d.status}` };
  const p = d.json;
  if (p.state !== 'open' || p.draft) return { ok: false, status: 409, error: 'not an open ready PR' };
  if (!p.head || p.head.sha !== sha) return { ok: false, status: 409, error: 'head moved' };
  if (!p.head.repo || p.head.repo.full_name !== repo) return { ok: false, status: 409, error: 'fork PR' };
  if ((p.labels || []).some(l => l && l.name === 'hold')) return { ok: false, status: 409, error: 'hold' };  // HOLD-LABEL-1 (US-33-R13)
  const commentHold = await heldByComment((m, path) => gh(f, token, m, path), repo, pr);  // HOLD-COMMENT-1 (US-33-R103)
  if (commentHold) return { ok: false, status: 409, error: commentHold };
  if (p.mergeable_state !== 'clean') return { ok: false, status: 409, error: `mergeable_state ${p.mergeable_state}` };
  const hold = await notGreen(f, token, repo, sha, (ff, t, m, path) => gh(ff, t, m, path));  // GREEN-GUARD-1
  if (hold) return { ok: false, status: 409, error: hold };
  const m = await gh(f, token, 'PUT', `/repos/${repo}/pulls/${pr}/merge`, { merge_method: 'squash', sha });
  if (!m.ok && await mergedAnyway((mm, pp) => gh(f, token, mm, pp), repo, pr, m.status)) return { ok: true, status: 200, sha: null, confirmed_after: m.status };
  return m.ok ? { ok: true, status: 200, sha: m.json && m.json.sha } : { ok: false, status: 502, error: `merge ${m.status} ${(m.json && m.json.message) || ''}`.slice(0, 200) };
}
