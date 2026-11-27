// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-31 (tenant side of the vendoring): the file map a tenant vendors comes from the core registry, a recorded file stays, the record carries a hash per file,
// and each tool reads only its own form of VENDORED_FROM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
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

// US-31-R63: workers/tools/vendor.py parse_vendored is the one reader of both VENDORED_FROM forms, and tenant_sync.py reads through it.
test('US-31-R63: tenant_sync.py and vendor.py read a text-form VENDORED_FROM, keyed by the path inside the vendor directory', () => {
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

test('US-31-R63: revendoring writes the manifest back in the form the tenant uses, and the JSON form reads as before', () => {
  const script = [
    'import importlib.util, json, sys',
    'from pathlib import Path',
    's = importlib.util.spec_from_file_location("vendor", Path(sys.argv[1]) / "vendor.py"); v = importlib.util.module_from_spec(s); s.loader.exec_module(v)',
    'h = "a" * 64',
    'text = v.render_vendored("text", "ultrastable/ultrastable", "c2", {"contract.js": h}, "vendor/ultrastable", {"contract.js": "seed/worker/src/contract.js"})',
    'back = v.parse_vendored(text, vendor_rel="vendor/ultrastable")',
    'js = v.parse_vendored(v.render_vendored("json", "ultrastable/ultrastable:workers", "c3", {"core/a.js": h}, "vendor/ultrastable"))',
    'print(json.dumps({"text": text, "back": [back["form"], back["commit"], back["files"], back["paths"]], "json": [js["form"], js["commit"], js["files"]]}))',
  ].join('\n');
  const r = spawnSync('python3', ['-I', '-c', script, dirname(fileURLToPath(import.meta.url))], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const o = JSON.parse(r.stdout), h = 'a'.repeat(64);
  assert.equal(o.text, `ultrastable/ultrastable@c2\nseed/worker/src/contract.js -> vendor/ultrastable/contract.js sha256:${h}\n`, 'the text form vendor_sync.mjs writes');
  assert.deepEqual(o.back, ['text', 'c2', { 'contract.js': h }, { 'contract.js': 'seed/worker/src/contract.js' }]);
  assert.deepEqual(o.json, ['json', 'c3', { 'core/a.js': h }]);
});

// US-31-R63: revendor and send-up on a text-form tenant work file by file from each recorded core path (relative to the repository
// root), named by where it sits under vendor/ultrastable; the workers selection is never compared with the record, so nothing is deleted.
test('US-31-R63: revendor --apply and send-up --apply on a text-form tenant keep the vendored files and their recorded core paths', () => {
  const dir = mkdtempSync(join(tmpdir(), 'us31-r63-rv-'));
  const tools = dirname(fileURLToPath(import.meta.url));
  const py = (...a) => spawnSync('python3', ['-I', join(tools, 'tenant_sync.py'), ...a], { encoding: 'utf8' });
  const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  const h = (s) => createHash('sha256').update(s).digest('hex');
  try {
    const repo = join(dir, 'core'), ten = join(dir, 'ten'), vd = join(ten, 'vendor/ultrastable');
    mkdirSync(join(repo, 'seed/worker/src'), { recursive: true });
    mkdirSync(join(repo, 'workers/core/contract'), { recursive: true });
    writeFileSync(join(repo, 'seed/worker/src/contract.js'), 'C2');
    writeFileSync(join(repo, 'seed/worker/src/gone-later.js'), 'G1');
    writeFileSync(join(repo, 'workers/core/contract/index.js'), 'W1');
    writeFileSync(join(repo, 'workers/core/other.js'), 'O1');
    assert.equal(sh(repo, 'init', '-q').status, 0);
    sh(repo, 'add', '-A');
    assert.equal(sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'c').status, 0);
    sh(repo, 'rm', '-q', 'seed/worker/src/gone-later.js');
    sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'gone');
    mkdirSync(vd, { recursive: true });
    writeFileSync(join(ten, 'upstream.json'), '{}\n');
    writeFileSync(join(vd, 'contract.js'), 'C1');
    writeFileSync(join(vd, 'gone.js'), 'G1');
    const rec = `ultrastable/ultrastable@c1\nseed/worker/src/contract.js -> vendor/ultrastable/contract.js sha256:${h('C1')}\n`
      + `seed/worker/src/gone-later.js -> vendor/ultrastable/gone.js sha256:${h('G1')}\n`;
    writeFileSync(join(vd, 'VENDORED_FROM'), rec);
    const dry = py('revendor', '--tenant', ten, '--core', join(repo, 'workers'));
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(JSON.parse(dry.stdout), { changed: 1, removed: [], settled: [], files: 2, missing_in_core: ['gone.js'] });
    const r = py('revendor', '--tenant', ten, '--core', join(repo, 'workers'), '--apply');
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(join(vd, 'contract.js'), 'utf8'), 'C2', 'the listed file is re-vendored from its recorded core path');
    assert.equal(readFileSync(join(vd, 'gone.js'), 'utf8'), 'G1', 'a file whose core path is gone is kept, not deleted');
    assert.equal(existsSync(join(vd, 'core')), false, 'the workers selection is not written into a text-form tenant');
    const out = readFileSync(join(vd, 'VENDORED_FROM'), 'utf8').split('\n');
    assert.match(out[0], /^ultrastable\/ultrastable@[0-9a-f]{40}$/);
    assert.deepEqual(out.slice(1).filter(Boolean), [
      `seed/worker/src/contract.js -> vendor/ultrastable/contract.js sha256:${h('C2')}`,
      `seed/worker/src/gone-later.js -> vendor/ultrastable/gone.js sha256:${h('G1')}`,
    ]);
    writeFileSync(join(vd, 'contract.js'), 'C3');
    const up = py('send-up', '--tenant', ten, '--core', join(repo, 'workers'), '--apply');
    assert.equal(up.status, 0, up.stderr);
    assert.equal(readFileSync(join(repo, 'seed/worker/src/contract.js'), 'utf8'), 'C3', 'a hand edit goes up to its recorded core path');
    assert.equal(existsSync(join(repo, 'workers/contract.js')), false, 'never to a path under workers/ named by the vendor key');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// US-31-R63: a lifting entry names its core path relative to workers/, while a text-form record keys files by their place under the vendor
// directory. revendor resolves each entry through the record: one the record lists settles to a shim of its vendored file, one whose code
// reached the core but that the record does not list is reported as unsettled (and kept), and one not yet in the core stays lifting.
test('US-31-R63: on a text-form tenant revendor settles lifting entries through the record and reports the ones it cannot resolve', () => {
  const dir = mkdtempSync(join(tmpdir(), 'us31-r63-settle-'));
  const tools = dirname(fileURLToPath(import.meta.url));
  const py = (...a) => spawnSync('python3', ['-I', join(tools, 'tenant_sync.py'), ...a], { encoding: 'utf8' });
  const sh = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  const h = (s) => createHash('sha256').update(s).digest('hex');
  try {
    const repo = join(dir, 'core'), ten = join(dir, 'ten'), vd = join(ten, 'vendor/ultrastable');
    mkdirSync(join(repo, 'seed/worker/src'), { recursive: true });
    mkdirSync(join(repo, 'workers/core'), { recursive: true });
    writeFileSync(join(repo, 'seed/worker/src/contract.js'), 'export const c = 2;\n');
    writeFileSync(join(repo, 'workers/core/other.js'), 'export const o = 1;\n');
    assert.equal(sh(repo, 'init', '-q').status, 0);
    sh(repo, 'add', '-A');
    assert.equal(sh(repo, '-c', 'user.name=t', '-c', 'user.email=t@e', 'commit', '-qm', 'c').status, 0);
    mkdirSync(join(ten, 'src'), { recursive: true });
    mkdirSync(vd, { recursive: true });
    writeFileSync(join(ten, 'src/contract.js'), 'export const c = 1;\n');
    writeFileSync(join(ten, 'src/other.js'), 'export const o = 0;\n');
    writeFileSync(join(ten, 'src/later.js'), 'export const l = 0;\n');
    writeFileSync(join(ten, 'upstream.json'), JSON.stringify({ lifting: {
      'src/contract.js': { core: '../seed/worker/src/contract.js' },
      'src/other.js': { core: 'core/other.js' },
      'src/later.js': { core: 'core/later.js' },
    } }) + '\n');
    writeFileSync(join(vd, 'contract.js'), 'export const c = 1;\n');
    writeFileSync(join(vd, 'VENDORED_FROM'),
      `ultrastable/ultrastable@c1\nseed/worker/src/contract.js -> vendor/ultrastable/contract.js sha256:${h('export const c = 1;\n')}\n`);
    const dry = py('revendor', '--tenant', ten, '--core', join(repo, 'workers'));
    assert.equal(dry.status, 0, dry.stderr);
    assert.deepEqual(JSON.parse(dry.stdout), { changed: 1, removed: [], settled: ['src/contract.js'], files: 1, unsettled: ['src/other.js'] });
    const r = py('revendor', '--tenant', ten, '--core', join(repo, 'workers'), '--apply');
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(join(ten, 'src/contract.js'), 'utf8'), /export \* from "\.\.\/vendor\/ultrastable\/contract\.js";/,
      'the settled file becomes a shim of the vendored file the record names');
    const cfg = JSON.parse(readFileSync(join(ten, 'upstream.json'), 'utf8'));
    assert.deepEqual(cfg.lifted, { 'src/contract.js': '../seed/worker/src/contract.js' });
    assert.deepEqual(Object.keys(cfg.lifting).sort(), ['src/later.js', 'src/other.js'], 'an unresolved entry is kept, never dropped');
    assert.equal(readFileSync(join(ten, 'src/other.js'), 'utf8'), 'export const o = 0;\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// US-31-R63: the one reader reports a text-form line it cannot read, and vendor.py --check reports a file recorded with no hash, so an
// edited vendored file never passes the offline drift check by a malformed line.
test('US-31-R63: vendor.py --check reports an unreadable record line and a file recorded with no hash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'us31-r63-ck-'));
  try {
    const vd = join(dir, 'vendor/ultrastable');
    mkdirSync(vd, { recursive: true });
    writeFileSync(join(vd, 'a.js'), 'A1');
    writeFileSync(join(vd, 'b.js'), 'B2');
    const hb = createHash('sha256').update('B1').digest('hex');
    writeFileSync(join(vd, 'VENDORED_FROM'), `ultrastable/ultrastable@c1\nsrc/a.js -> vendor/ultrastable/a.js\nsrc/b.js  ->  vendor/ultrastable/b.js sha256:${hb}\n`);
    const r = spawnSync('python3', ['-I', join(dirname(fileURLToPath(import.meta.url)), 'vendor.py'), '--check', vd], { encoding: 'utf8' });
    assert.equal(r.status, 1, 'the check fails');
    assert.deepEqual(r.stdout.trim().split('\n'), ['unreadable record line 3', 'no hash for a.js']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
