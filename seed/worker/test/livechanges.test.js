// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshLiveChanges } from '../src/livechanges.js';
test('only merged PRs are cached, with origin', async () => {
  const batches = [];
  const db = { prepare: sql => ({ bind: (...a) => ({ sql, a }) }), batch: async s => { batches.push(s); } };
  const prs = [{ number: 7, title: 't', merged_at: '2026-11-18T01:00:00Z', html_url: 'u', head: { ref: 'claude/x' }, body: '' }, { number: 8, title: 'c', merged_at: null, head: { ref: 'a' } }];
  const f = async () => ({ ok: true, status: 200, text: async () => JSON.stringify(prs) });
  const r = await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: f });
  assert.equal(r.merged_seen, 1);
  assert.equal(batches[0][0].a[3], 'agent session');
});
test('no token is reported, not thrown', async () => { assert.equal((await refreshLiveChanges({ db: {}, repo: 'o/r' })).status, 'no-token'); });

// SUBSTANCE-1: merged PRs are classified from their diff, two per pass, and the verdict survives the next refresh.
import { makeDb } from './d1shim.js';
import { classifyPending, readLiveChanges } from '../src/livechanges.js';
import { readFileSync } from 'node:fs';
test('classifyPending marks a trivial merge trivial and a logic change substantive, and a refresh keeps the verdict', async () => {
  const db = makeDb();
  for (const s of readFileSync(new URL('../migrations/0022_live_changes.sql', import.meta.url), 'utf8').split(';').map(x => x.trim()).filter(Boolean)) await db.prepare(s).run();
  Object.assign(db, { batch: async ss => { for (const s of ss) await s.run(); } });
  const prs = [{ number: 1, title: 'remove unused import', merged_at: '2026-11-21T01:00:00Z', html_url: 'u1', head: { ref: 'agent/x' }, body: 'Executor run x' },
    { number: 2, title: 'fix the lane', merged_at: '2026-11-21T02:00:00Z', html_url: 'u2', head: { ref: 'claude/y' }, body: '' }];
  const files = { 1: [{ filename: 'scripts/a.py', status: 'modified', patch: '@@ -1 +1 @@\n-import json, os\n+import os' }],
    2: [{ filename: 'seed/worker/src/lane.js', status: 'modified', patch: '@@ -1 +1 @@\n-if (a) go();\n+if (a && !b) go();' }] };
  const f = async u => { const m = /pulls\/(\d+)\/files/.exec(u); return m ? { ok: true, status: 200, text: async () => JSON.stringify(files[m[1]]) } : { ok: true, status: 200, text: async () => JSON.stringify(prs) }; };
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: f });
  const r = await classifyPending({ db, token: 't', max: 2, fetch: f });
  assert.deepEqual(r.classified, { 'o/r#2': 'substantive', 'o/r#1': 'trivial' });
  await refreshLiveChanges({ db, token: 't', repo: 'o/r', fetch: f });
  const seen = Object.fromEntries((await readLiveChanges(db, 'o/r')).changes.map(c => [c.n, c.substance]));
  assert.deepEqual(seen, { 1: 'trivial', 2: 'substantive' });
  assert.deepEqual((await classifyPending({ db, token: 't', fetch: f })).classified, {}, 'nothing left to classify');
});
