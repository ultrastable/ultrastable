// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { lintPost, fitWhole } from '../src/postquality.js';

const BAD = 'Something that works: school-based deworming (evidence is contested). An influential trial found that treating schoolchildren for worms raised school attendance, but a…\nRuns on Ultrastable, a system that runs itself: ultrastable.io https://ultrastable.org/solutions/deworming';
test('the live deworming post fails on every count Rowan named', () => {
  const f = lintPost(BAD.replace('ultrastable.io https', 'https://ultrastable.io https'), { grade: 'mixed' });
  for (const r of ['trails off with an ellipsis', 'more than one link', 'templated opener', 'overclaims for mixed evidence']) assert.ok(f.includes(r), r + ' in ' + f);
});
test('a calibrated, whole-sentence, single-link post passes', () => {
  const t = 'Contested evidence: school-based deworming. A Kenyan trial found less absence; a later Cochrane review found little effect on growth or school performance. Sources and the disagreement: https://ultrastable.org/solutions/deworming';
  assert.deepEqual(lintPost(t, { grade: 'mixed' }), []);
});
test('mixed evidence must say so', () => assert.ok(lintPost('Deworming raises attendance in Kenya. https://x.org/a', { grade: 'mixed' }).length));
test('fitWhole never clips', () => {
  assert.equal(fitWhole(['x'.repeat(50), 'short one.'], 20), 'short one.');
  assert.equal(fitWhole(['x'.repeat(50)], 20), null);
});
