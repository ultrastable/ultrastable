// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// OPEN-STANDARDS-1: events between loops are CloudEvents 1.0, built and checked by one shared module.
// Platform-only (monorepo-only.json): the platform's webhook deliveries use the kit's envelope; a standalone seed has no site/.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cloudEventErrors } from '../src/cloudevents.js';
import { cloudEvent as webhookEvent } from '../../../site/webhooks.js';

test('webhook deliveries already conform to the same envelope', () => {
  const ev = webhookEvent({ id: 'ev_1', type: 'item.closed', subject: 'Q-1', created_at: '2026-11-25T21:00:00Z', data: '{"a":1}' });
  assert.deepEqual(cloudEventErrors(JSON.parse(JSON.stringify(ev))), []);
});
