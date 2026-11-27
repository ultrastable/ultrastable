// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the GitHub issue store of the visibility ratio (adapters/github/issuestore.js): paged by the Link header, fake fetch only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { githubIssuePages, githubIssueStore } from './issuestore.js';
import { makeDb } from '../../core/_shared/testdb.js';
import * as gate from '../../core/claims/gate.js';

const env = { VCS_TOKEN: 'tok-123456789' };
const issue = n => ({ number: n, state: 'open' });
// a host with `total` open issues and one pull request, served `size` to a page, with a Link header when `link` is set
function host(total, size, { link = true } = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url: String(url), auth: init.headers.authorization });
    const u = new URL(url), page = Number(u.searchParams.get('page'));
    const all = [...Array.from({ length: total }, (_, i) => issue(i + 1)), { number: 9999, state: 'open', pull_request: {} }];
    const body = all.slice((page - 1) * size, page * size), last = Math.ceil(all.length / size);
    const headers = new Headers(link && page < last ? { link: `<https://api.github.com/repos/o/r/issues?state=open&per_page=${size}&page=${page + 1}>; rel="next", <https://api.github.com/repos/o/r/issues?page=${last}>; rel="last"` } : {});
    return { ok: true, status: 200, headers, json: async () => body };
  };
  return { fetch, calls };
}

test('US-08-R11, US-17-R11: githubIssuePages follows the Link header to the last page, leaves pull requests out and sends the token only in the Authorization header', async () => {
  const { fetch, calls } = host(25, 10);
  const r = await githubIssueStore({ fetch, repo: 'o/r', env, perPage: 10, name: 'github', visible: true }).readAll();
  assert.deepEqual([r.pages, r.truncated, r.rows.length], [3, false, 25]);
  assert.ok(r.rows.every(x => x.status === 'open') && !r.rows.some(x => x.key === '9999'));
  assert.deepEqual(calls.map(c => new URL(c.url).searchParams.get('page')), ['1', '2', '3']);
  assert.ok(calls.every(c => c.auth === 'Bearer tok-123456789' && !c.url.includes('tok-123456789')));
});

test('US-08-R11: without a Link header a full page means another page; a page bound that stops the read is reported truncated, and the visibility ratio reads it as unmeasured', async () => {
  const { fetch } = host(250, 100, { link: false });
  const whole = await githubIssueStore({ fetch, repo: 'o/r', env }).readAll();
  assert.deepEqual([whole.pages, whole.truncated, whole.rows.length], [3, false, 250]);
  const cut = githubIssueStore({ fetch, repo: 'o/r', env, maxPages: 2, name: 'hidden', visible: false });
  assert.equal((await cut.readAll()).truncated, true);
  const ctx = { db: makeDb([fileURLToPath(new URL('../../core/claims/migrations/', import.meta.url))]), now: () => Date.parse('2026-11-27T00:00:00Z'), config: {} };
  const v = await gate.visibilityRatio(ctx, { stores: [githubIssueStore({ fetch: host(3, 100).fetch, repo: 'o/r', env, visible: true }), cut] });
  assert.deepEqual([v.fired, v.unread], [false, ['hidden']], 'a truncated store is unread, so the ratio does not fire on a partial count');
});

test('US-08-R11: an unset token makes no request, a failed page or a body that is not a list throws, and a bad repo name is refused', async () => {
  const { fetch, calls } = host(3, 100);
  await assert.rejects(githubIssuePages({ fetch, repo: 'o/r', env: {} })(1), /VCS_TOKEN is not set/);
  assert.equal(calls.length, 0);
  await assert.rejects(githubIssuePages({ fetch: async () => ({ ok: false, status: 502 }), repo: 'o/r', env })(1), /http 502/);
  await assert.rejects(githubIssuePages({ fetch: async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ message: 'x' }) }), repo: 'o/r', env })(1), /not a list/);
  assert.throws(() => githubIssuePages({ fetch, repo: 'nope', env }), /owner\/name/);
  assert.throws(() => githubIssuePages({ repo: 'o/r', env }), /fetch port/);
});
