// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-31 (tenant side of the vendoring): the file map a tenant vendors comes from the core registry, a recorded file stays, and the record carries a hash per file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { plan, parseRecord, record } from './vendor_sync.mjs';

const REG = { tenants: { t: { vendor: { 'seed/a.js': 'vendor/ultrastable/a.js', 'seed/b.js': 'vendor/ultrastable/b.js' } } } };
const files = { 'seed/a.js': 'A1', 'seed/b.js': 'B1' };
const getOf = (extra = {}) => async (url, as) => {
  if (url.endsWith('/commits/main')) return { sha: 'c0ffee' };
  if (url.endsWith('doctrine/tenant-repos.json')) return REG;
  const path = url.split('/c0ffee/')[1], body = { ...files, ...extra }[path];
  if (body === undefined) throw Object.assign(new Error('HTTP 404 ' + path), { status: 404 });
  return body;
};

test('US-31-R23: the map comes from the core registry, pinned to one commit, and each vendored file is recorded with its sha256', async () => {
  const p = await plan({ get: getOf(), slug: 't', have: async () => null });
  assert.equal(p.sha, 'c0ffee');
  assert.deepEqual(p.files.map(f => [f.src, f.dst, f.body]), [['seed/a.js', 'vendor/ultrastable/a.js', 'A1'], ['seed/b.js', 'vendor/ultrastable/b.js', 'B1']]);
  const text = record('ultrastable/ultrastable', p.sha, p.files);
  const [head, ...lines] = text.trim().split('\n');
  assert.equal(head, 'ultrastable/ultrastable@c0ffee');
  assert.equal(lines[0], 'seed/a.js -> vendor/ultrastable/a.js sha256:' + createHash('sha256').update('A1').digest('hex'));
  assert.deepEqual(parseRecord(text), { 'seed/a.js': 'vendor/ultrastable/a.js', 'seed/b.js': 'vendor/ultrastable/b.js' });
  assert.deepEqual(parseRecord(''), {});
});

test('US-31-R23: a file the record holds and the registry does not name stays as it is when core main lacks it, and a file the registry names must exist', async () => {
  const recorded = 'ultrastable/ultrastable@old\nseed/gone.js -> vendor/ultrastable/gone.js sha256:' + 'a'.repeat(64) + '\n';
  const have = async dst => (dst === 'vendor/ultrastable/gone.js' ? 'LOCAL' : null);
  const origWarn = console.warn; console.warn = () => {};
  try {
    const p = await plan({ get: getOf(), slug: 't', have, recorded });
    assert.equal(p.files.find(f => f.src === 'seed/gone.js').body, 'LOCAL');
    const named = { tenants: { t: { vendor: { 'seed/missing.js': 'vendor/ultrastable/missing.js' } } } };
    const get404 = async (url, as) => (url.endsWith('doctrine/tenant-repos.json') ? named : getOf()(url, as));
    await assert.rejects(plan({ get: get404, slug: 't', have: async () => null }), e => e.status === 404);
    const noMap = async (url, as) => (url.endsWith('doctrine/tenant-repos.json') ? { tenants: {} } : getOf()(url, as));
    await assert.rejects(plan({ get: noMap, slug: 'ghost', have: async () => null }), /no vendor map for ghost/);
  } finally { console.warn = origWarn; }
});

test('US-31-R23: a file the registry names wins over the recorded path of the same core file, and an unreadable core head is read by branch name', async () => {
  const recorded = 'ultrastable/ultrastable@old\nseed/a.js -> vendor/old-place/a.js sha256:' + 'b'.repeat(64) + '\n';
  const p = await plan({ get: getOf(), slug: 't', have: async () => null, recorded });
  assert.equal(p.files.filter(f => f.src === 'seed/a.js').length, 1);
  assert.equal(p.files.find(f => f.src === 'seed/a.js').dst, 'vendor/ultrastable/a.js');
  const origWarn = console.warn; console.warn = () => {};
  try {
    const get = async (url, as) => { if (url.endsWith('/commits/main')) throw new Error('rate limited'); return url.endsWith('doctrine/tenant-repos.json') ? REG : files[url.split('/main/')[1]]; };
    const q = await plan({ get, slug: 't', have: async () => null });
    assert.equal(q.sha, 'main');
  } finally { console.warn = origWarn; }
});
