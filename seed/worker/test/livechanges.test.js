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
