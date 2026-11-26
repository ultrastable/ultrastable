// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// OPEN-STANDARDS-1: events between loops are CloudEvents 1.0, built and checked by one shared module.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudEvent, cloudEventErrors, toHttp, CONTENT_TYPE } from '../src/cloudevents.js';

test('cloudEvent builds a conforming CloudEvents 1.0 event with a stable id', async () => {
  const a = await cloudEvent({ type: 'io.ultrastable.tick.done', source: '/ultrastable/tick', data: { ok: 1 }, time: '2026-11-25T21:00:00Z' });
  const b = await cloudEvent({ type: 'io.ultrastable.tick.done', source: '/ultrastable/tick', data: { ok: 1 }, time: '2026-11-25T21:00:00Z' });
  assert.deepEqual(cloudEventErrors(a), []);
  assert.equal(a.id, b.id);
  assert.equal(a.specversion, '1.0');
  assert.equal(a.datacontenttype, 'application/json');
  assert.equal(toHttp(a).headers['content-type'], CONTENT_TYPE);
});

test('cloudEventErrors names missing attributes and bad extension names', async () => {
  assert.deepEqual(cloudEventErrors({ specversion: '1.0', id: 'x', source: '/s' }), ['missing type']);
  assert.ok(cloudEventErrors({ specversion: '1.0', id: 'x', source: '/s', type: 't', Bad_Name: 1 }).some((e) => e.includes('Bad_Name')));
  await assert.rejects(cloudEvent({ type: 't', source: '/s', BadExt: 1 }));
});
