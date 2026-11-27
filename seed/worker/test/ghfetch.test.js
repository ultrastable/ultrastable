// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// GH-RETRY-1: a GitHub 5xx is retried, and a merge that answered 5xx but landed counts as merged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ghFetch, mergedAnyway } from '../src/ghfetch.js';
import { mergeForLane } from '../src/lanemerge.js';

const res = (status, body = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const nowait = { wait: async () => {} };

test('US-24-R63: a 502 then 200 is retried to success; a 404 is not retried', async () => {
  let n = 0; const f = async () => (++n === 1 ? res(502) : res(200, { ok: 1 }));
  assert.equal((await ghFetch(f, 'u', {}, nowait)).status, 200); assert.equal(n, 2);
  let m = 0; const g = async () => { m++; return res(404); };
  assert.equal((await ghFetch(g, 'u', {}, nowait)).status, 404); assert.equal(m, 1);
});

test('US-24-R63: three 503s return the last 503; a network error is retried', async () => {
  let n = 0; assert.equal((await ghFetch(async () => { n++; return res(503); }, 'u', {}, nowait)).status, 503); assert.equal(n, 3);
  let k = 0; const f = async () => { if (++k < 3) throw new Error('reset'); return res(200); };
  assert.equal((await ghFetch(f, 'u', {}, nowait)).status, 200);
});

test('US-24-R63: a merge that answered 5xx is read back and counts when GitHub says merged', async () => {
  const gh = async () => ({ ok: true, json: { merged: true } });
  assert.equal(await mergedAnyway(gh, 'o/r', 1, 502), true);
  assert.equal(await mergedAnyway(gh, 'o/r', 1, 422), false);
  assert.equal(await mergedAnyway(async () => ({ ok: true, json: { merged: false } }), 'o/r', 1, 405), false);
});

test('every merge path imports the shared fetch (no local copies)', () => {
  for (const f of ['lane', 'lanemerge', 'sweeper', 'mergenow']) {
    const s = readFileSync(new URL(`../src/${f}.js`, import.meta.url), 'utf8');
    assert.match(s, /from '\.\/ghfetch\.js'/, f);
    assert.match(s, /mergedAnyway\(/, f);
  }
});

// MERGE-RUNNING-1: the worker gate merged #2222 while its checks run was still running; that run then failed and main went red.
test('the zero-minutes gate waits for a run that is really running, and not for one stuck in a queue for hours', async () => {
  const { realRed } = await import('../src/lane.js');
  const at = iso => ({ workflow_runs: [{ id: 1, name: 'checks', status: 'in_progress', conclusion: null, run_started_at: iso }] });
  const f1 = async () => new Response(JSON.stringify(at(new Date(Date.now() - 60e3).toISOString())), { status: 200 });
  assert.match(await realRed(f1, 't', 'o/r', 'abc'), /checks still running/);
  const f2 = async () => new Response(JSON.stringify(at(new Date(Date.now() - 5 * 3600e3).toISOString())), { status: 200 });
  assert.equal(await realRed(f2, 't', 'o/r', 'abc'), null);
});
