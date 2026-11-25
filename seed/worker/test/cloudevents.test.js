// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// STANDARDS-FIRST-1: the CloudEvents 1.0 envelope every Worker shares, and its use on the handoff path.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { envelope as cloudEvent, conforms, unwrap, isCloudEvent, eventType } from '../src/cloudevents.js';
import { handoffEvent } from '../src/handoff.js';

const VEC = JSON.parse(readFileSync(new URL('../../standards/cloudevents-vectors.json', import.meta.url), 'utf8'));

test('cloudevents: shared vectors, valid events conform', () => { for (const e of VEC.valid) assert.deepEqual(conforms(e), [], JSON.stringify(e)); });
test('cloudevents: shared vectors, invalid events are refused', () => { for (const v of VEC.invalid) assert.ok(conforms(v.event).length, v.why); });
test('cloudevents: envelope carries the required attributes and a reverse-DNS type', () => {
  const e = cloudEvent({ area: 'item', event: 'done', source: '/tenants/t/loops/tick', subject: 'Q-1', data: { ok: true }, time: Date.UTC(2026, 10, 25) });
  assert.deepEqual(conforms(e), []);
  assert.equal(e.specversion, '1.0'); assert.equal(e.type, 'io.ultrastable.item.done'); assert.equal(e.time, '2026-11-25T00:00:00.000Z');
  assert.equal(e.datacontenttype, 'application/json'); assert.ok(e.id.length >= 16);
  assert.notEqual(cloudEvent({ area: 'a', event: 'b', source: '/s' }).id, cloudEvent({ area: 'a', event: 'b', source: '/s' }).id);
});
test('cloudevents: a missing source or an object extension attribute throws', () => {
  assert.throws(() => cloudEvent({ area: 'a', event: 'b' }), /source/);
  assert.throws(() => cloudEvent({ area: 'a', event: 'b', source: '/s', extensions: { origin: { class: 'loop' } } }), /extension attribute/);
  assert.throws(() => eventType('', 'b'));
});
test('cloudevents: unwrap returns the payload and leaves older rows and foreign events alone', () => {
  const old = { state: 'merged' };
  assert.equal(unwrap(old), old);
  assert.deepEqual(unwrap(cloudEvent({ area: 'handoff', event: 'merged', source: '/s', data: old })), old);
  const foreign = { specversion: '1.0', id: '1', source: '/x', type: 'com.example.thing', data: { a: 1 } };
  assert.ok(isCloudEvent(foreign)); assert.equal(unwrap(foreign), foreign);
});
test('cloudevents: a handoff state change is a conformant event that fits the audit row', () => {
  const e = handoffEvent('ultrastable/ultrastable#12', 'verify_failed', 'x'.repeat(900), 'unlearn');
  assert.deepEqual(conforms(e), []);
  assert.equal(e.type, 'io.ultrastable.handoff.verify_failed'); assert.equal(e.subject, 'ultrastable/ultrastable#12'); assert.equal(e.source, '/tenants/unlearn/loops/handoff');
  assert.equal(unwrap(e).state, 'verify_failed'); assert.equal(e.data.detail.length, 300);
  assert.ok(JSON.stringify(e).length < 2000, 'the audit chain keeps 2000 characters of data');
});
