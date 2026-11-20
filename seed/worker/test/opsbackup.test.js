// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { opsBackup, opsAllowed } from '../src/opsbackup.js';

test('BACKUP-SINK-1: only files under backups/ in the ops repository pass, with the App token and the body untouched', async () => {
  assert.equal(opsAllowed('PUT', 'contents/backups/d1/ultrastable-org/2026-11-20.sql.gz'), true);
  assert.equal(opsAllowed('GET', 'contents/backups/d1/ultrastable-org'), true);
  for (const [m, p] of [['PUT', 'contents/README.md'], ['PUT', 'contents/backups/../x'], ['POST', 'contents/backups/x'], ['GET', 'git/refs'], ['DELETE', 'contents/.github/workflows/x.yml'], ['PATCH', 'contents/backups/x']]) assert.equal(opsAllowed(m, p), false, m + ' ' + p);
  const seen = [];
  const f = async (url, init) => { seen.push([String(url), init.method, init.headers.authorization]); return new Response('{"content":{"sha":"s"}}', { status: 201 }); };
  const req = (m, p, body) => new Request('https://tick/api/ops/backup', { method: 'POST', headers: { 'x-gh-method': m, 'x-gh-path': p }, body });
  const ok = await opsBackup(req('PUT', 'contents/backups/kv/a/2026-11-20.ndjson.gz', '{"message":"m","content":"eA=="}'), { token: 'app', repo: 'o/ops', fetch: f });
  assert.equal(ok.status, 201);
  assert.deepEqual(seen[0], ['https://api.github.com/repos/o/ops/contents/backups/kv/a/2026-11-20.ndjson.gz', 'PUT', 'Bearer app']);
  assert.equal((await opsBackup(req('PUT', 'contents/other', '{}'), { token: 'app', repo: 'o/ops', fetch: f })).status, 403);
  assert.equal((await opsBackup(req('GET', 'contents/backups/x'), { token: '', repo: 'o/ops', fetch: f })).status, 503);
  assert.equal(seen.length, 1, 'a refused request never reaches GitHub');
});
