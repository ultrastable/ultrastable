// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// UPTIME-1: repair hand for the uptime worker. A redeploy of the site re-attaches every custom domain and its proxied DNS record (deploy/deploy-site.mjs).
// Only this one workflow on main can be started, whatever the caller sends, and not more than once per THROTTLE_MS per isolate (the workflow's own concurrency group is the second guard).
export const WORKFLOW = 'deploy-site.yml', THROTTLE_MS = 10 * 60e3;
let lastAt = 0;
export const _reset = () => { lastAt = 0; };
export async function repairSites({ token, repo, fetchImpl = fetch, now = Date.now } = {}) {
  if (!token || !repo) return { ok: false, why: 'no GitHub credential' };
  if (now() - lastAt < THROTTLE_MS) return { ok: false, why: 'throttled' };
  lastAt = now();
  try {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW}/dispatches`, { method: 'POST', headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-uptime-repair', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'main' }) });
    return r.status === 204 ? { ok: true, dispatched: WORKFLOW } : { ok: false, why: 'HTTP ' + r.status };
  } catch (e) { return { ok: false, why: String(e && e.message || e).slice(0, 80) }; }
}
