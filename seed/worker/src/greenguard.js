// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// GREEN-GUARD-1: `mergeable_state: clean` only means no REQUIRED check is red, and main has no required checks, so a PR was merged while its
// `checks` run was still starting or had failed (#595, #596 on 2026-11-18). Every server-side merge asks this first: every check-run on the head
// commit is finished and green, and the repositories listed in REQUIRED must also show their full-suite run (`checks`) as success.
// An unreadable answer holds: unknown is not green. Returns null when green, otherwise the reason to hold.
export const REQUIRED = { 'ultrastable/ultrastable': ['checks'] };
export async function notGreen(f, token, repo, sha, call) {
  const r = await call(f, token, 'GET', `/repos/${repo}/commits/${sha}/check-runs?per_page=100`);
  if (!r.ok) return `check-runs ${r.status}`;
  const runs = ((r.json && r.json.check_runs) || []).filter(c => c.name !== 'lane');
  const open = runs.find(c => c.status !== 'completed');
  if (open) return `${open.name} still running`;
  const red = runs.find(c => !['success', 'neutral', 'skipped'].includes(c.conclusion));
  if (red) return `${red.name} ${red.conclusion}`;
  for (const need of REQUIRED[repo] || []) {
    if (!runs.some(c => c.name === need && c.conclusion === 'success')) return `${need} has not passed on ${String(sha).slice(0, 7)}`;
  }
  return null;
}
