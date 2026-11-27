// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// A GitHub repository's issues as a store for the visibility ratio (US-SPEC-08 s5, US-17-R11): `githubIssuePages` is the `listPage`
// port of core/claims/stores.js pagedStore, read through the REST API one page at a time; `githubIssueStore` wraps it in that store.
// The next page comes from the Link header (rel="next"), and without one from a full page, so a read is never cut short in silence:
// pagedStore reports a read its page bound stopped as truncated. Read only. The token is read from `env` by name and sent only as an
// Authorization header; fetch is the host's.
import { pagedStore, fromGithubIssues } from '../../core/claims/stores.js';

const nextFromLink = link => {
  for (const part of String(link || '').split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part);
    if (m) { const p = Number(new URL(m[1], 'https://x.invalid').searchParams.get('page')); return Number.isInteger(p) && p > 0 ? p : null; }
  }
  return undefined;   // no Link header: the caller falls back to the size of the page
};

export function githubIssuePages({ fetch, repo, env = {}, tokenEnv = 'VCS_TOKEN', apiBase = 'https://api.github.com', perPage = 100, prefix = '' } = {}) {
  if (typeof fetch !== 'function') throw new Error('issues: a fetch port is required');
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) throw new Error('issues: repo must be "owner/name"');
  const size = Math.min(100, Math.max(1, Math.floor(Number(perPage)) || 100));
  return async function listPage(page) {
    const t = env[tokenEnv]; if (!t) throw new Error('issues: token variable ' + tokenEnv + ' is not set');
    const res = await fetch(`${String(apiBase).replace(/\/+$/, '')}/repos/${repo}/issues?state=open&per_page=${size}&page=${page}`,
      { headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + t, 'user-agent': 'ultrastable-steward' } });
    if (!res || !res.ok) throw new Error(`issues: GET /issues page ${page} -> http ${res ? res.status : 'no response'}`);
    const json = await res.json();
    if (!Array.isArray(json)) throw new Error(`issues: page ${page} is not a list`);
    const link = nextFromLink(res.headers && typeof res.headers.get === 'function' ? res.headers.get('link') : null);
    return { rows: fromGithubIssues(json, { prefix }), next: link === undefined ? (json.length >= size ? page + 1 : null) : link };
  };
}

/** The store itself: { name, visible, list(), readAll() } for core/claims gate.js visibilityRatio. */
export function githubIssueStore({ name = 'github', visible = false, maxPages = 50, ...port } = {}) {
  return pagedStore({ name, visible, maxPages, listPage: githubIssuePages(port) });
}
