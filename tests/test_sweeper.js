// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { gh } from '../seed/worker/src/sweeper.js';

describe('sweeper', () => {
  it('gh throws on non-2xx status', async () => {
    const fetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found')
      } as Response)
    );
    const token = 'dummy';
    await expect(gh(fetch, token, 'GET', '/repos/owner/repo/branches', undefined)).rejects.toThrow('GH GET 404 /repos/owner/repo/branches: Not Found');
  });

  it('gh returns parsed json on success', async () => {
    const mockData = { name: 'main', commit: { sha: 'abc' } };
    const fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify(mockData))
      } as Response)
    );
    const token = 'dummy';
    const res = await gh(fetch, token, 'GET', '/repos/owner/repo/branches', undefined);
    expect(res.ok).toBe(true);
    expect(res.json).toEqual(mockData);
  });
});
