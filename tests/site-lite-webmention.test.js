// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { lite } from '../../site/lite.js';

/**
 * Unit tests for the webmention wire.
 * Validates that the receiver handles valid and invalid mentions correctly.
 */
export async function runTests(env) {
  const validSource = 'https://example.com/some-post';
  const validTarget = 'https://ultrastable.io/webmention';
  
  // Helper to test response code and text
  const testMention = async (source, target, expectedStatus) => {
    const body = JSON.stringify({ source, target });
    const req = new Request('https://ultrastable.io/webmention', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    const res = await lite(req, env);
    return res.status;
  };

  await it('should accept valid webmention with matching domains', async () => {
    const status = await testMention(validSource, validTarget, 202);
    if (status !== 202) throw new Error(`Expected 202, got ${status}`);
  });

  await it('should reject webmention with missing fields', async () => {
    const status = await testMention('https://no-target.com', null, 400);
    if (status !== 400) throw new Error(`Expected 400, got ${status}`);
  });

  await it('should reject webmention with invalid domain', async () => {
    const invalidTarget = 'https://evil.com';
    const status = await testMention(validSource, invalidTarget, 400);
    if (status !== 400) throw new Error(`Expected 400, got ${status}`);
  });
}
