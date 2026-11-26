// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Stores for the visibility ratio (US-SPEC-08 s5, US-17-R11): a paged-store builder and a mapper for issue-tracker payloads.
// No network here: the host supplies `listPage`, which is where a real tracker's REST call (fetch, token, per_page) lives.

/**
 * A store whose rows arrive in pages. `listPage(page)` (page starts at 1) returns { rows: [{ key, status }], next } where
 * `next` is the next page number or null. list() follows the pages and never truncates silently: when `maxPages` is reached
 * with pages left, it throws an error with `truncated = true`, which the visibility ratio reports as an unread store (a
 * partial count is unmeasured, never a pass or a zero). readAll() returns { rows, pages, truncated } without throwing.
 */
export function pagedStore({ name, visible = false, listPage, maxPages = 50 } = {}) {
  if (!name || typeof listPage !== 'function') throw new Error('a paged store needs a name and a listPage function');
  async function readAll() {
    const seen = new Map();
    let page = 1, pages = 0;
    while (page !== null && page !== undefined) {
      if (pages >= maxPages) return { rows: [...seen.values()], pages, truncated: true };
      const res = await listPage(page);
      pages++;
      for (const r of (res && res.rows) || []) seen.set(String(r.key), { key: String(r.key), status: r.status });
      page = res && res.next != null && res.next !== page ? res.next : null;
    }
    return { rows: [...seen.values()], pages, truncated: false };
  }
  return {
    name, visible, readAll,
    async list() {
      const r = await readAll();
      if (r.truncated) { const e = new Error(`store ${name} truncated after ${r.pages} pages`); e.truncated = true; throw e; }
      return r.rows;
    },
  };
}

/** Map a GitHub-style issues payload to store rows. Pull requests (entries with a `pull_request` field) are not issues. */
export function fromGithubIssues(json, { prefix = '' } = {}) {
  return (Array.isArray(json) ? json : []).filter(i => i && i.number != null && !i.pull_request)
    .map(i => ({ key: `${prefix}${i.number}`, status: String(i.state || 'open').toLowerCase() }));
}
