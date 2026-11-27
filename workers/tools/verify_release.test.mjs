// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { manifest, signManifest } from './release_bundle.mjs';
import { verifyRelease, reader, main, EXIT } from './verify_release.mjs';

const BUNDLE = 'export default { fetch() { return new Response("ok"); } }';
const MIGRATIONS = 'CREATE TABLE IF NOT EXISTS items (id TEXT);';
const keys = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { priv: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') };
};
function release({ version = '1.2.3', sign = null, tamper = {} } = {}) {
  const m = manifest(BUNDLE, MIGRATIONS, version);
  const manifestText = JSON.stringify(m, null, 2) + '\n';
  const files = { 'bundle.js': BUNDLE, 'migrations.sql': MIGRATIONS, 'manifest.json': manifestText, ...(sign ? { 'manifest.sig': signManifest(manifestText, sign) + '\n' } : {}), ...tamper };
  return { files, read: async n => (n in files ? files[n] : null), m };
}

test('US-19-R16 a published release verifies: hashes, version, products and permissions', async () => {
  const r = await verifyRelease({ read: release().read });
  assert.deepEqual({ ok: r.ok, exit: r.exit, problems: r.problems }, { ok: true, exit: EXIT.ok, problems: [] });
});

test('T19-5 a flipped byte in the bundle or the migrations exits 3', async () => {
  const a = await verifyRelease({ read: release({ tamper: { 'bundle.js': BUNDLE + ' ' } }).read });
  assert.deepEqual({ ok: a.ok, exit: a.exit, problems: a.problems }, { ok: false, exit: 3, problems: ['digest_mismatch (bundle)'] });
  const b = await verifyRelease({ read: release({ tamper: { 'migrations.sql': MIGRATIONS + '--' } }).read });
  assert.equal(b.exit, 3);
});

test('US-19-R16 a missing manifest or file exits 2, and a version that is not semantic is a mismatch', async () => {
  const gone = release();
  delete gone.files['manifest.json'];
  const r = await verifyRelease({ read: async n => gone.files[n] ?? null });
  assert.equal(r.exit, 2);
  assert.match(r.problems.join(), /manifest\.json is missing/);
  assert.equal((await verifyRelease({ read: release({ version: 'latest' }).read })).exit, 3);
});

test('US-19-R30 with a public key the signature must verify; a changed manifest or a wrong key exits 3', async () => {
  const { priv, pub } = keys();
  const ok = await verifyRelease({ read: release({ sign: priv }).read, publicKey: pub });
  assert.equal(ok.ok, true);
  assert.equal((await verifyRelease({ read: release({ sign: keys().priv }).read, publicKey: pub })).exit, 3);
  assert.equal((await verifyRelease({ read: release().read, publicKey: pub })).exit, 2, 'no manifest.sig published');
});

test('T19-5 a running launcher must show the release fingerprint: a different one exits 3', async () => {
  const rel = release();
  const health = release_ => async () => Response.json({ ok: true, launcher: true, release: release_ });
  assert.equal((await verifyRelease({ read: rel.read, launcher: 'https://launch.example', fetchImpl: health(rel.m.bundle_sha256) })).ok, true);
  const bad = await verifyRelease({ read: rel.read, launcher: 'https://launch.example', fetchImpl: health('f'.repeat(64)) });
  assert.equal(bad.exit, 3);
  assert.match(bad.problems[0], /launcher shows bundle ffffffffffff/);
  const down = await verifyRelease({ read: rel.read, launcher: 'https://launch.example', fetchImpl: async () => { throw new Error('refused'); } });
  assert.equal(down.exit, 3);
});

test('US-19-R16 the reader takes an address or a directory, and main returns the exit status', async () => {
  const rel = release();
  const dir = mkdtempSync(path.join(tmpdir(), 'us-rel-'));
  for (const [n, t] of Object.entries(rel.files)) writeFileSync(path.join(dir, n), t);
  assert.equal(await reader(dir)('bundle.js'), BUNDLE);
  assert.equal(await reader(dir)('nope.txt'), null);
  const seen = [];
  const fetchImpl = async u => { seen.push(u); const n = u.split('/').pop(); return n in rel.files ? new Response(rel.files[n]) : new Response('', { status: 404 }); };
  assert.equal(await reader('https://example.test/releases/v1/', fetchImpl)('manifest.json'), rel.files['manifest.json']);
  assert.deepEqual(seen, ['https://example.test/releases/v1/manifest.json']);
  const out = [];
  assert.equal(await main(['--base', dir], { log: t => out.push(t) }), 0);
  assert.equal(JSON.parse(out[0]).version, '1.2.3');
  assert.equal(await main([], { log: t => out.push(t) }), 2);
});

test('US-19-R30 the report says whether a signature was checked: a present signature with no key is unchecked, never silently verified', async () => {
  const { priv, pub } = keys();
  const absent = await verifyRelease({ read: release().read });
  assert.equal(absent.signature, 'absent');
  const garbage = await verifyRelease({ read: release({ tamper: { 'manifest.sig': 'AAAAGARBAGESIG\n' } }).read });
  assert.deepEqual({ ok: garbage.ok, exit: garbage.exit, signature: garbage.signature }, { ok: true, exit: 0, signature: 'unchecked' }, 'without a key the signature is not read as proof');
  const required = await verifyRelease({ read: release({ tamper: { 'manifest.sig': 'AAAAGARBAGESIG\n' } }).read, requireSignature: true });
  assert.deepEqual({ ok: required.ok, exit: required.exit, problems: required.problems }, { ok: false, exit: 3, problems: ['no_public_key'] });
  const verified = await verifyRelease({ read: release({ sign: priv }).read, publicKey: pub, requireSignature: true });
  assert.deepEqual({ ok: verified.ok, signature: verified.signature }, { ok: true, signature: 'verified' });
  const forged = await verifyRelease({ read: release({ tamper: { 'manifest.sig': 'AAAAGARBAGESIG\n' } }).read, publicKey: pub });
  assert.equal(forged.exit, 3, 'a garbage signature against a key is refused');
  const out = [];
  const dir = mkdtempSync(path.join(tmpdir(), 'us-rel-sig-'));
  for (const [n, t] of Object.entries(release({ tamper: { 'manifest.sig': 'AAAAGARBAGESIG\n' } }).files)) writeFileSync(path.join(dir, n), t);
  assert.equal(await main(['--base', dir, '--require-signature'], { log: t => out.push(t) }), 3);
  assert.equal(await main(['--base', dir], { log: t => out.push(t) }), 0);
  assert.equal(JSON.parse(out[1]).signature, 'unchecked');
});

test('US-19-R30 a network or disk error while reading the release is exit 2 with a problem line and a JSON report, never a crash', async () => {
  const down = await verifyRelease({ read: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:1'); } });
  assert.equal(down.exit, 2);
  assert.match(down.problems.join(), /bundle\.js could not be read: connect ECONNREFUSED/);
  const out = [];
  const code = await main(['--base', 'http://127.0.0.1:1'], { fetchImpl: async () => { throw new TypeError('fetch failed'); }, log: t => out.push(t) });
  assert.equal(code, 2);
  const report = JSON.parse(out[0]);
  assert.equal(report.ok, false);
  assert.match(report.problems[0], /could not be read: fetch failed/);
});

test('US-19-R30 the signature is reported verified only when it was checked: an unreadable manifest, a required signature with nothing to check, and a missing one under --require-signature', async () => {
  const { priv, pub } = keys();
  const unreadable = await verifyRelease({ read: release({ sign: priv, tamper: { 'manifest.json': '{not json' } }).read, publicKey: pub });
  assert.deepEqual({ exit: unreadable.exit, signature: unreadable.signature, problems: unreadable.problems }, { exit: 3, signature: 'unchecked', problems: ['manifest_unreadable'] }, 'nothing was checked, so nothing is verified');
  const nothing = await verifyRelease({ read: release().read, requireSignature: true });
  assert.deepEqual({ exit: nothing.exit, signature: nothing.signature }, { exit: 3, signature: 'absent' }, 'no key and no manifest.sig: the signature is absent, not unchecked');
  const missing = await verifyRelease({ read: release().read, publicKey: pub, requireSignature: true });
  assert.deepEqual({ exit: missing.exit, signature: missing.signature, problems: missing.problems }, { exit: 3, signature: 'absent', problems: ['signature_missing'] }, '--require-signature refuses with exit 3');
  const tampered = await verifyRelease({ read: release({ sign: priv, tamper: { 'bundle.js': BUNDLE + ' ' } }).read, publicKey: pub });
  assert.deepEqual({ exit: tampered.exit, signature: tampered.signature }, { exit: 3, signature: 'verified' }, 'the signature matched; the bundle digest is what failed');
  const forged = await verifyRelease({ read: release({ sign: keys().priv }).read, publicKey: pub });
  assert.notEqual(forged.signature, 'verified');
});
