// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOidc, ISSUER } from './actions-oidc.js';

test('a malformed token is refused without a network call', async () => {
  const r = await verifyOidc('nope', { fetch: () => { throw new Error('no network'); }, audience: 'a', repository: 'o/r' });
  assert.equal(r.ok, false);
  assert.equal(ISSUER, 'https://token.actions.githubusercontent.com');
});
