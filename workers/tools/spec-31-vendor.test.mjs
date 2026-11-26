// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-31 (tenant side of the vendoring): the file map a tenant vendors comes from the core registry, a recorded file stays, the record carries a hash per file,
// and each tool reads only its own form of VENDORED_FROM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plan, parseRecord, record, recordForm } from './vendor_sync.mjs';

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

test('US-31-R62: vendor_sync.mjs refuses a JSON-form VENDORED_FROM before it reads the core, so it never rewrites another tool\'s manifest in the text form', async () => {
  const json = JSON.stringify({ schema: 'vendored-from/1', source: 'ultrastable/workers', commit: 'c1', files: { 'core/x.js': 'a'.repeat(64) } }, null, 1);
  const text = 'ultrastable/ultrastable@c1\nseed/a.js -> vendor/ultrastable/a.js sha256:' + 'b'.repeat(64) + '\n';
  assert.equal(recordForm(json), 'json');
  assert.equal(recordForm('\n  ' + json), 'json', 'leading blank lines do not hide the JSON form');
  assert.equal(recordForm(text), 'text');
  assert.equal(recordForm(''), 'empty');
  // the line parser alone ignores lines it cannot read, which is why the refusal sits in plan(), before any read or write
  assert.deepEqual(parseRecord(json), {});
  assert.deepEqual(parseRecord(text), { 'seed/a.js': 'vendor/ultrastable/a.js' }, 'the text form is the one it reads');
  // the registry gives a JSON-form tenant a small map; run there, the tool must not replace its manifest with a two-line record
  const registry = { tenants: { js: { vendor: { 'seed/a.js': 'vendor/seed/a.js' } } } };
  const calls = [];
  const get = async (url, as) => { calls.push(url); return url.endsWith('doctrine/tenant-repos.json') ? registry : getOf()(url, as); };
  await assert.rejects(plan({ get, slug: 'js', have: async () => null, recorded: json }), e => e.code === 'json-form' && /JSON form/.test(e.message) && /tenant_sync\.py/.test(e.message));
  assert.deepEqual(calls, [], 'nothing is fetched once the record is refused');
  const p = await plan({ get: getOf(), slug: 't', have: async () => null, recorded: text });
  assert.equal(p.files.length, 2, 'a text-form record is read as before');
});

// US-31-R63 is PLANNED (US-SPEC-31 section 7): workers/tools/tenant_sync.py and workers/tools/vendor.py read only the JSON form today, so this
// probe fails and is recorded as todo. When the single reader lands, the same change removes the `todo` option and the probe is ordinary proof.
test('US-31-R63: tenant_sync.py and vendor.py read a text-form VENDORED_FROM, keyed by the path inside the vendor directory', { todo: 'one reader for both VENDORED_FROM forms is not built in workers/tools/tenant_sync.py and workers/tools/vendor.py (integration request)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'us31-r63-'));
  try {
    const vd = join(dir, 'vendor/ultrastable');
    mkdirSync(vd, { recursive: true });
    writeFileSync(join(vd, 'contract.js'), 'C1');
    const h = createHash('sha256').update('C1').digest('hex');
    writeFileSync(join(vd, 'VENDORED_FROM'), `ultrastable/ultrastable@c1\nseed/worker/src/contract.js -> vendor/ultrastable/contract.js sha256:${h}\n`);
    const script = [
      'import importlib.util, json, sys',
      'from pathlib import Path',
      'def load(n, p):',
      '    s = importlib.util.spec_from_file_location(n, p); m = importlib.util.module_from_spec(s); s.loader.exec_module(m); return m',
      'tools, d = Path(sys.argv[1]), Path(sys.argv[2])',
      'ts, v = load("tenant_sync", tools / "tenant_sync.py"), load("vendor", tools / "vendor.py")',
      'm = ts.read_manifest(d, {"vendor_dir": "vendor/ultrastable"})',
      'print(json.dumps({"commit": m.get("commit"), "files": m.get("files"), "check": v.check(d / "vendor/ultrastable")}))',
    ].join('\n');
    const r = spawnSync('python3', ['-I', '-c', script, dirname(fileURLToPath(import.meta.url)), dir], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(r.stdout), { commit: 'c1', files: { 'contract.js': h }, check: [] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
