// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the merged pull request reader (adapters/github/pulls.js): paged, bounded, read only, fake fetch only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { githubPulls } from './pulls.js';
import { measures } from '../../core/steward/measures.js';

const prRow = (n, o = {}) => ({ number: n, user: { login: 'someone' }, body: 'b' + n, labels: [{ name: 'x' }], merged_at: '2026-11-18T00:00:00Z', updated_at: '2026-11-18T00:00:00Z', ...o });
function host(pages, files = {}) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.authorization });
    const u = new URL(url);
    const ok = b => ({ ok: true, status: 200, json: async () => b });
    const m = /\/pulls\/(\d+)\/files/.exec(u.pathname);
    if (m) return ok((files[m[1]] || ['core/a.js']).map(f => ({ filename: f })));
    if (u.pathname.endsWith('/pulls')) return ok(pages[Number(u.searchParams.get('page')) - 1] || []);
    return { ok: false, status: 404 };
  };
  return { fetch, calls };
}
const env = { VCS_TOKEN: 'tok' };

test('US-20-R02: merged pull requests are read with their files and labels; closed-unmerged ones are left out', async () => {
  const { fetch, calls } = host([[prRow(1), prRow(2, { merged_at: null }), prRow(3)]], { 3: ['AGENTS.md'] });
  const r = await githubPulls({ fetch, repo: 'o/r', env }).mergedPulls();
  assert.deepEqual(r.prs.map(p => [p.number, p.files, p.labels, p.author]), [[1, ['core/a.js'], ['x'], 'someone'], [3, ['AGENTS.md'], ['x'], 'someone']]);
  assert.equal(r.complete, true);
  assert.ok(calls.every(c => c.auth === 'Bearer tok'));
});

test('incomplete pagination yields not_measured: a read cut by the page bound is not complete', async () => {
  const full = Array.from({ length: 100 }, (_, i) => prRow(i + 1));
  const { fetch } = host([full, full]);
  const r = await githubPulls({ fetch, repo: 'o/r', env, maxPages: 1 }).mergedPulls();
  assert.equal(r.complete, false);
  const out = measures({ ...r, now: Date.parse('2026-11-20T00:00:00Z') });
  assert.equal(out.contract_coverage, null);
  assert.match(out.not_measured.contract_coverage, /bounded/);
});

test('a pull request with more files than the file bound makes the read incomplete', async () => {
  const many = Array.from({ length: 100 }, (_, i) => 'f' + i);
  const { fetch } = host([[prRow(1)]], { 1: many });
  const r = await githubPulls({ fetch, repo: 'o/r', env, maxFilePages: 1 }).mergedPulls();
  assert.equal(r.complete, false);
});

test('since stops the read at the first pull request last updated before the window', async () => {
  const { fetch, calls } = host([[prRow(1), prRow(2, { updated_at: '2026-01-01T00:00:00Z' }), prRow(3)]]);
  const r = await githubPulls({ fetch, repo: 'o/r', env, since: '2026-11-01T00:00:00Z' }).mergedPulls();
  assert.deepEqual(r.prs.map(p => p.number), [1]);
  assert.equal(r.complete, true);
  assert.equal(calls.filter(c => c.url.includes('/files')).length, 1);
});

test('an unreadable host, a missing token or a bad repo name throws instead of returning an empty list', async () => {
  const bad = { fetch: async () => ({ ok: false, status: 403 }), repo: 'o/r', env };
  await assert.rejects(githubPulls(bad).mergedPulls(), /http 403/);
  await assert.rejects(githubPulls({ ...bad, env: {} }).mergedPulls(), /token variable/);
  assert.throws(() => githubPulls({ ...bad, repo: 'nope' }), /owner\/name/);
});
