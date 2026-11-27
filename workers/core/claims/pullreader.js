// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// A readPull port over a code host's REST API (US-SPEC-08 US-08-R19). reapClosedPulls (index.js) takes readPull(repo, pr) ->
// { state: 'open' | 'closed' | 'merged', merged_at?, closed_at? }. This factory builds one from three things the host supplies:
// `fetch` (the platform's), `apiBase` (the code host's REST root, no default here: core names no host) and `headers` (an object, or a
// function returning one, so a token is read by the host at call time and never held or logged here). The endpoint is
// GET {apiBase}/repos/{owner/name}/pulls/{n}, answering `state` (open | closed), `merged_at` and `closed_at`, the shape the common
// hosts share. A failed read throws, which reapClosedPulls records as unmeasured and never as closed.

export function restPullReader({ fetch, apiBase, headers = {} } = {}) {
  if (typeof fetch !== 'function') throw new Error('restPullReader needs the fetch port');
  if (!/^https?:\/\/[^\s]+$/.test(String(apiBase || ''))) throw new Error('restPullReader needs apiBase, the code host REST root');
  const root = String(apiBase).replace(/\/+$/, '');
  return async function readPull(repo, pr) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) throw new Error('readPull: repo must be "owner/name"');
    const n = Number(pr);
    if (!Number.isInteger(n) || n < 1) throw new Error('readPull: pr must be a positive integer');
    const h = typeof headers === 'function' ? await headers() : headers;
    const res = await fetch(`${root}/repos/${repo}/pulls/${n}`, { headers: { accept: 'application/json', ...(h || {}) } });
    if (!res || !res.ok) throw new Error(`readPull: GET pulls/${n} -> http ${res ? res.status : 'no response'}`);
    const p = await res.json();
    if (!p || (p.state !== 'open' && p.state !== 'closed')) throw new Error('readPull: the response carries no pull request state');
    if (p.merged_at) return { state: 'merged', merged_at: p.merged_at, closed_at: p.closed_at ?? p.merged_at };
    return p.state === 'open' ? { state: 'open' } : { state: 'closed', closed_at: p.closed_at ?? null };
  };
}
