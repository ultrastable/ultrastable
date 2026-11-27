// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMeter, guarded, SubrequestBudgetError, mentionsBudget } from '../src/subreq.js';
import { failed } from '../src/pulse.js';

test('meter refuses a call past the cap minus the reserve, before touching the network', async () => {
  const m = createMeter({ cap: 10, reserve: 4 }); let net = 0;
  const f = m.wrap(async () => { net++; return 'ok'; });
  for (let i = 0; i < 6; i++) assert.equal(await f(), 'ok');
  await assert.rejects(() => f(), SubrequestBudgetError);
  assert.equal(net, 6); assert.equal(m.exhausted(), true);
});

test('install counts the global fetch and restores it', async () => {
  const g = { fetch: async () => 'x' }, m = createMeter({ cap: 6, reserve: 4 });
  const restore = m.install(g); await g.fetch(); await g.fetch();
  await assert.rejects(() => g.fetch(), SubrequestBudgetError);
  restore(); assert.equal(typeof g.fetch, 'function'); assert.equal(g.__subreq, undefined);
});

test('US-09-R20: guarded: a loop that no longer fits, or hits the cap with nothing done, is deferred and carried, never failed', async () => {
  const m = createMeter({ cap: 12, reserve: 4 }), d = new Set(), g = guarded(m, d, failed, { big: 20, small: 1 });
  let r = await g('big', async () => assert.fail('must not start'));
  assert.equal(r.status, 'deferred'); assert.ok(d.has('big')); assert.equal(failed(r), null);
  r = await g('small', async () => { throw new SubrequestBudgetError('x'); });
  assert.equal(r.status, 'deferred');
  r = await g('small', async () => ({ status: 'errors', merged: [], errors: ['o/r Too many subrequests by single Worker invocation'] }));
  assert.equal(r.status, 'deferred'); assert.ok(mentionsBudget(r.partial));
});

test('guarded: real progress and real errors pass through unchanged', async () => {
  const m = createMeter({ cap: 20, reserve: 4 }), d = new Set(), g = guarded(m, d, failed, {});
  assert.deepEqual(await g('a', async () => ({ status: 'ok', merged: ['x'] })), { status: 'ok', merged: ['x'] });
  await assert.rejects(() => g('a', async () => { throw new Error('boom'); }), /boom/);
  assert.equal(d.size, 0);
});

import { makeDb } from './d1shim.js';
import { syncIssues } from '../src/issuesync.js';
import { runGate } from '../src/worker-gate.js';

test('issuesync remembers a not-open file by sha and does not fetch it again until it changes', async () => {
  const db = makeDb(); let fileCalls = 0;
  const body = { id: 'ROADMAP-Z', title: 'z', labels: ['roadmap'], body: '**Done check:** x\n**Status:** done' };
  const f = async (url) => { const list = url.includes('/contents/docs/issues?'); if (!list) fileCalls++; const j = list ? [{ name: 'ROADMAP-Z.json', sha: 's1' }] : { content: Buffer.from(JSON.stringify(body)).toString('base64') }; return { ok: true, status: 200, text: async () => JSON.stringify(j) }; };
  await syncIssues({ db, token: 't', repo: 'o/r', fetch: f }); await syncIssues({ db, token: 't', repo: 'o/r', fetch: f });
  assert.equal(fileCalls, 1);
});

test('gate: a 403 on one PR is its disposition, and the run stops at its call cap and resumes next run', async () => {
  const prs = [1, 2, 3].map(n => ({ number: n, head: { sha: 'h' + n, ref: 'feature/x' }, base: { sha: 'b' }, body: '' }));
  const f = async (url, o = {}) => {
    const p = url.replace('https://api.github.com', ''), post = o.method === 'POST';
    const j = p.includes('/pulls?') ? prs : p.includes('/statuses?') ? [] : p.includes('/files') ? [] : {};
    return { ok: !post || !p.includes('h1'), status: post && p.includes('h1') ? 403 : 200, text: async () => JSON.stringify(j) };
  };
  let r = await runGate({ token: 't', repos: ['o/r'], fetch: f });
  assert.deepEqual(r.forbidden, ['o/r#1']); assert.equal(r.status, 'ok'); assert.equal(failed(r), null);
  r = await runGate({ token: 't', repos: ['o/r'], fetch: f, maxCalls: 4 });
  assert.ok(r.deferred.length >= 1 && r.status === 'ok');
});

test('guarded: a loop is held to its own share so the loops behind it still run', async () => {
  const m = createMeter({ cap: 54, reserve: 4 }), d = new Set(), g = guarded(m, d, failed, {}, { hog: 5, next: 5 });
  const f = m.wrap(async () => 'x');
  const r1 = await g('hog', async () => { let n = 0; try { for (;;) { await f(); n++; } } catch { return { status: 'ok', calls: n }; } });
  assert.equal(r1.calls, 5);
  const r2 = await g('next', async () => { await f(); return { status: 'ok', merged: ['a'] }; });
  assert.equal(r2.status, 'ok'); assert.equal(m.used, 6);
});
