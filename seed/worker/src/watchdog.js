// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// RESILIENCE-1: the Worker's half of the watchdog-of-watchdogs. The GitHub watchdog (.github/workflows/watchdog.yml, every 6 h) restarts a stalled tick through
// POST /pulse/watch; this loop does the reverse: when the GitHub watchdog's newest run is older than `maxAgeMs` (two of its intervals), the tick dispatches it
// again. Neither side is a single point of failure: Cloudflare cron restarts the GitHub schedule, and the GitHub schedule restarts the Cloudflare tick.
// Runs inside beat() as loop 'watchdog-gh', so the tick's pulse step also judges it. Costs at most two GitHub calls; never throws.
export const WATCHDOG_WORKFLOW = 'watchdog.yml';
export const WATCHDOG_MAX_AGE_MS = 12 * 3600e3;

export async function watchGithub({ token, repo, workflow = WATCHDOG_WORKFLOW, maxAgeMs = WATCHDOG_MAX_AGE_MS, ref = 'main', fetchImpl = fetch, now = Date.now } = {}) {
  if (!token || !repo) return { status: 'no-token', why: 'no GitHub credential or repository: the GitHub watchdog cannot be checked from here' };
  const h = { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-tick-watchdog', 'x-github-api-version': '2022-11-28' };
  const base = `https://api.github.com/repos/${repo}/actions/workflows/${workflow}`;
  let runs;
  try {
    const r = await fetchImpl(`${base}/runs?per_page=1`, { headers: h });
    if (r.status !== 200) return { status: `error reading ${workflow} runs: HTTP ${r.status}` };
    runs = ((await r.json()) || {}).workflow_runs || [];
  } catch (e) { return { status: 'error reading ' + workflow + ': ' + String(e && e.message).slice(0, 120) }; }
  const last = runs[0] ? Date.parse(runs[0].created_at) : null;
  const age = last == null ? null : now() - last;
  if (age != null && age <= maxAgeMs) return { status: 'fresh', age_s: Math.round(age / 1000) };
  try {
    const d = await fetchImpl(`${base}/dispatches`, { method: 'POST', headers: { ...h, 'content-type': 'application/json' }, body: JSON.stringify({ ref }) });
    if (d.status === 204) return { status: 'dispatched', age_s: age == null ? null : Math.round(age / 1000), why: age == null ? 'never ran' : 'stalled' };
    return { status: `error dispatching ${workflow}: HTTP ${d.status}`, age_s: age == null ? null : Math.round(age / 1000) };
  } catch (e) { return { status: 'error dispatching ' + workflow + ': ' + String(e && e.message).slice(0, 120) }; }
}
