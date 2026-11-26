// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createReviewGate } from './review.js';
import { createMergeGuard, FRESH_MS } from './mergeguard.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const NOW = Date.parse('2026-11-11T12:00:00Z');
const MIN = 60000;
const ago = (ms) => new Date(NOW - ms).toISOString();
const DIFF = ['--- a/core/auth/index.js', '+++ b/core/auth/index.js', '@@ -10,3 +10,3 @@', '-  if (!token || token !== want) return deny();', '+  if (token !== want && !request.headers.get("x-debug")) return deny();', '   return allow();'].join('\n');
const LINE = '+  if (token !== want && !request.headers.get("x-debug")) return deny();';
const done = (name, conclusion = 'success') => ({ name, status: 'completed', conclusion });

function mk(reviewers = []) {
  const db = makeDb([MIG]);
  const gate = createReviewGate({ db, now: () => NOW, config: { mode: 'hold' }, reviewers });
  return { db, gate, guard: createMergeGuard({ reviewGate: gate, now: () => NOW }) };
}
const green = (over = {}) => ({ change_id: 'PR-7', head: 'abc1234', head_committed_at: ago(60 * MIN), checks: [done('ci'), done('checks')], suites: [], required: ['checks'], ...over });

test('US-07-R18, US-07-T07: a hold marker, a queued required check, an empty list on a fresh head, an unreadable answer and a failed check each refuse; a new push with green required checks allows', async () => {
  const reviewer = (name, family, findings) => ({ name, family, async review() { return { findings, cost_usd: 0 }; } });
  const high = { severity: 'high', title: 'authentication bypass', trigger: 'send any request with the header x-debug set', evidence_line: LINE };
  const { gate, guard } = mk([reviewer('r1', 'family-b', [high]), reviewer('r2', 'family-c', [])]);
  const held = await gate.review({ id: 'PR-7', head: 'abc1234', diff: DIFF, files: ['core/auth/index.js'], authorFamily: 'family-a' });
  assert.equal(held.hold, true);
  const refused = await guard.decide(green());
  assert.equal(refused.ok, false); assert.match(refused.reasons[0], /^review gate: hold_marker \(<!-- review-gate: hold -->/);
  // a new push releases the hold; with green required checks the merge is allowed
  const next = await gate.review({ id: 'PR-7', head: 'def5678', diff: DIFF.replace(LINE.slice(1), '  return allow();'), files: ['core/auth/index.js'], authorFamily: 'family-a' });
  assert.equal(next.hold, false);
  assert.deepEqual(await guard.decide(green({ head: 'def5678' })), { ok: true, reasons: [] });

  const clean = mk().guard;
  assert.match((await clean.decide(green({ checks: [done('ci'), { name: 'checks', status: 'queued', conclusion: null }] }))).reasons.join(), /checks still running/, 'a queued required check');
  assert.match((await clean.decide(green({ checks: [done('ci')] }))).reasons.join(), /checks has not passed on abc1234/, 'a required check that never ran');
  assert.match((await clean.decide(green({ checks: [done('ci'), done('checks', 'failure')] }))).reasons.join(), /checks failure/);
  const fresh = await clean.decide(green({ checks: [], suites: [], head_committed_at: ago(1 * MIN), required: [] }));
  assert.deepEqual([fresh.ok, fresh.reasons], [false, ['no checks reported yet on abc1234']], 'an empty list on a 1-minute-old head');
  assert.deepEqual((await clean.decide(green({ checks: [], suites: [{ status: 'queued' }], head_committed_at: ago(60 * MIN), required: [] }))).reasons, ['checks queued (queued)']);
  assert.equal((await clean.decide(green({ checks: undefined }))).ok, false, 'the check list could not be read');
  assert.match((await clean.decide(green({ checks: [], suites: undefined, required: [] }))).reasons[0], /check suites could not be read/);
  assert.match((await clean.decide(green({ checks: [], suites: [], head_committed_at: undefined, required: [] }))).reasons[0], /head commit time could not be read/);
  // an empty list on an old head with no suite and nothing required has had every chance to report
  assert.equal((await clean.decide(green({ checks: [], suites: [], head_committed_at: ago(FRESH_MS + MIN), required: [] }))).ok, true);
});

test('US-07-R18: an unreadable review gate holds, and the merge lane\'s own check can be ignored by name', async () => {
  const broken = createMergeGuard({ reviewGate: { mergeAllowed: async () => { throw new Error('store down'); } }, now: () => NOW });
  assert.match((await broken.decide(green())).reasons[0], /^review gate unreadable: store down/);
  const odd = createMergeGuard({ reviewGate: { mergeAllowed: async () => undefined }, now: () => NOW });
  assert.match((await odd.decide(green())).reasons[0], /^review gate: not allowed/);
  const lane = createMergeGuard({ now: () => NOW, config: { ignore_checks: ['lane'] } });
  const withLane = { name: 'lane', status: 'in_progress', conclusion: null };
  assert.equal((await lane.decide(green({ checks: [done('ci'), done('checks'), withLane] }))).ok, true, 'the lane does not wait for itself');
  assert.match((await createMergeGuard({ now: () => NOW }).decide(green({ checks: [done('ci'), done('checks'), withLane] }))).reasons.join(), /lane still running/);
});

test('US-07-R11, US-07-R18: the guard decides from verified findings through mergeAllowed, never from a reviewer verdict', async () => {
  // a reviewer that says "approve" but carries a verified high finding still holds; one that says "block" with an unverifiable finding does not
  const approving = { name: 'r1', family: 'family-b', async review() { return { verdict: 'approve', findings: [{ severity: 'high', title: 'bypass', trigger: 'send header x-debug', evidence_line: LINE }] }; } };
  const blocking = { name: 'r2', family: 'family-c', async review() { return { verdict: 'block', findings: [{ severity: 'high', title: 'imagined', trigger: 'something', evidence_line: 'line that is not in the diff' }] }; } };
  const a = mk([approving, { ...blocking, name: 'r3' }]);
  await a.gate.review({ id: 'PR-9', head: 'aaa1111', diff: DIFF, files: ['core/auth/index.js'], authorFamily: 'family-a' });
  assert.equal((await a.guard.decide(green({ change_id: 'PR-9', head: 'aaa1111' }))).ok, false);
  const b = mk([{ ...blocking, family: 'family-b' }, { name: 'r4', family: 'family-c', async review() { return { findings: [] }; } }]);
  await b.gate.review({ id: 'PR-9', head: 'bbb2222', diff: DIFF, files: ['core/auth/index.js'], authorFamily: 'family-a' });
  assert.equal((await b.guard.decide(green({ change_id: 'PR-9', head: 'bbb2222' }))).ok, true, 'a demoted finding holds nothing, whatever the verdict says');
});
