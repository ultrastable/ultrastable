// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { armScores, engagementOf, score } from '../src/postfeedback.js';

test('a sparse arm is neutral and a measured arm is shrunk toward the mean', () => {
  const m = (arm, likes) => ({ arm, likes, reposts: 0, replies: 0, measured_at: 'x' });
  const s = armScores([m('a', 10), m('a', 10), m('a', 10), m('b', 0), m('b', 0), m('b', 0), m('c', 50)]);
  assert.ok(s.a > s.b); assert.equal(s.c, undefined);
  assert.ok(s.b > 0 && s.a < 11.5, 'shrinkage keeps small samples from extremes');
});
test('engagement reads public counts', async () => {
  const f = async () => ({ ok: true, json: async () => ({ posts: [{ likeCount: 3, repostCount: 1, replyCount: 2 }] }) });
  assert.deepEqual(await engagementOf('bluesky', 'at://x', f), { likes: 3, reposts: 1, replies: 2 });
  assert.equal(score({ likes: 3, reposts: 1, replies: 2 }), 11);
  assert.equal(await engagementOf('linkedin', 'x', f), null);
});
