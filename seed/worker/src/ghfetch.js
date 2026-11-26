// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// GH-RETRY-1 (2026-11-25): GitHub answers 500/502/503/504 for a few seconds during its own incidents, and every merge path (lane, sweeper, lanemerge,
// mergenow) gave up on the first one; the merges were only finished by a person retrying by hand. One shared fetch for every GitHub call the Worker
// makes: a 5xx answer or a network error is retried with backoff (3 tries), and a merge that still answered 5xx is read back, because GitHub can
// merge and then fail to answer (a merged PR is a success, not an error). USER-BACKEND-1: one module, imported by each caller, no local copies.
export const RETRY_STATUSES = new Set([500, 502, 503, 504]);
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function ghFetch(f, url, init = {}, { tries = 3, baseMs = 800, wait = sleep } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await f(url, init);
      if (!RETRY_STATUSES.has(r.status) || i === tries - 1) return r;
      last = r;
    } catch (e) {
      if (i === tries - 1) throw e;
      last = e;
    }
    await wait(baseMs * 2 ** i);
  }
  if (last instanceof Error) throw last;
  return last;
}

// After a merge PUT answered non-ok: true when GitHub reports the PR merged anyway (a 5xx after the merge landed, or a 405 on a retry of it).
export async function mergedAnyway(gh, repo, n, status) {
  if (!(RETRY_STATUSES.has(status) || status === 405 || status === 409)) return false;
  const r = await gh('GET', `/repos/${repo}/pulls/${n}`);
  return Boolean(r && r.ok && r.json && r.json.merged);
}
