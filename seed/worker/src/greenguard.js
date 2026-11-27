// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// GREEN-GUARD-1: `mergeable_state: clean` only means no REQUIRED check is red, and main has no required checks, so a PR was merged while its
// `checks` run was still starting or had failed (#595, #596 on 2026-11-18). Every server-side merge asks this first: every check-run on the head
// commit is finished and green, and the repositories listed in REQUIRED must also show their full-suite run (`checks`) as success.
// An unreadable answer holds: unknown is not green. Returns null when green, otherwise the reason to hold.
export const FRESH_MS = 15 * 60000;
export const REQUIRED = { 'ultrastable/ultrastable': ['checks'] };
export async function notGreen(f, token, repo, sha, call) {
  const r = await call(f, token, 'GET', `/repos/${repo}/commits/${sha}/check-runs?per_page=100`);
  if (!r.ok) return `check-runs ${r.status}`;
  // SKIPPED-NOT-GREEN-1: one verdict per check name, the newest run's. A head can carry a dispatched run and a pull_request run of the same
  // name, or a re-run; an old failure a newer run replaced does not hold the merge, and an old success does not hide a newer failure.
  const byName = new Map();
  for (const c of ((r.json && r.json.check_runs) || []).filter(c => c.name !== 'lane')) {
    const seen = byName.get(c.name);
    if (!seen || String(c.started_at || '') >= String(seen.started_at || '')) byName.set(c.name, c);
  }
  const runs = [...byName.values()];
  // NO-RUNS-NOT-GREEN-1: an empty list is not green. ultrastable/what-works#8 was merged 7 s after it opened, before its `ci` and
  // `citations` runs existed, and `citations` then failed. With no runs yet, a check suite still queued, or a head pushed inside
  // FRESH_MS with no suite at all, holds; the check_suite event merges it once the runs report.
  if (!runs.length) {
    const s = await call(f, token, 'GET', `/repos/${repo}/commits/${sha}/check-suites?per_page=50`);
    if (!s.ok) return `check-suites ${s.status}`;
    const suites = ((s.json && s.json.check_suites) || []).filter(x => !(x.app && x.app.slug === 'lane'));
    const waiting = suites.find(x => x.status !== 'completed');
    if (waiting) return `checks queued (${(waiting.app && waiting.app.slug) || 'suite'} ${waiting.status})`;
    const c = await call(f, token, 'GET', `/repos/${repo}/commits/${sha}`);
    if (!c.ok) return `commit ${c.status}`;
    const at = Date.parse((c.json && c.json.commit && c.json.commit.committer && c.json.commit.committer.date) || 0);
    if (!suites.length && Date.now() - at < FRESH_MS) return `no checks reported yet on ${String(sha).slice(0, 7)}`;
  }
  const open = runs.find(c => c.status !== 'completed');
  if (open) return `${open.name} still running`;
  const red = runs.find(c => !['success', 'neutral', 'skipped'].includes(c.conclusion));
  if (red) return `${red.name} ${red.conclusion}`;
  // a skipped job is not a verdict for a required check: GitHub reads it as passed (#2661), this guard does not
  for (const need of REQUIRED[repo] || []) {
    if (!runs.some(c => c.name === need && c.conclusion === 'success')) return `${need} has not passed on ${String(sha).slice(0, 7)}`;
  }
  return null;
}
