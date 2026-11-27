// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert';
import { manifest, PRODUCTS } from './release_bundle.mjs';
test('manifest hashes bundle and migrations and lists products', () => {
  const m = manifest('a', 'b', '1.0.0');
  assert.equal(m.bundle_sha256, 'ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb');
  assert.equal(m.version, '1.0.0');
  assert.deepEqual(m.products, PRODUCTS);
});

// ---- US-19-R16 / T19-5: the released bundle's hash is the hash the launcher shows, and the installer refuses a bundle that differs ----
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { main, signManifest, PERMISSIONS } from './release_bundle.mjs';
import { verifyBundle, verifySignature } from '../core/install/index.js';
import { BUNDLE, BUNDLE_SHA256, MIGRATIONS_SQL } from '../apps/launcher/src/bundle.generated.js';

const keys = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { priv: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') };
};
const fetched = (m, extra = {}) => ({ bundle: BUNDLE, migrations: MIGRATIONS_SQL, manifestText: JSON.stringify(m, null, 2) + '\n', ...extra });

test('T19-5 US-19-R16: the manifest of the committed bundle carries the very hash the launcher shows, and the installer accepts it', async () => {
  const m = manifest(BUNDLE, MIGRATIONS_SQL, '1.2.3');
  assert.equal(m.bundle_sha256, BUNDLE_SHA256);
  assert.deepEqual(m.permissions, PERMISSIONS);
  const v = await verifyBundle(fetched(m));
  assert.equal(v.ok, true);
});

test('T19-5 US-19-R16: a bundle whose bytes differ from the published hash is refused, whichever part changed', async () => {
  const m = manifest(BUNDLE, MIGRATIONS_SQL, '1.2.3');
  const flipped = BUNDLE.slice(0, 100) + (BUNDLE[100] === 'x' ? 'y' : 'x') + BUNDLE.slice(101);
  const a = await verifyBundle(fetched(m, { bundle: flipped }));
  assert.deepEqual({ ok: a.ok, reason: a.reason, part: a.part }, { ok: false, reason: 'digest_mismatch', part: 'bundle' });
  const b = await verifyBundle(fetched(m, { migrations: MIGRATIONS_SQL + '\n-- extra' }));
  assert.deepEqual({ ok: b.ok, reason: b.reason, part: b.part }, { ok: false, reason: 'digest_mismatch', part: 'migrations' });
});

test('US-19-R30 US-19-R16: a signed manifest verifies with the public key and a manifest changed after signing does not', async () => {
  const { priv, pub } = keys();
  const m = manifest(BUNDLE, MIGRATIONS_SQL, '1.2.3');
  const text = JSON.stringify(m, null, 2) + '\n';
  const signature = signManifest(text, priv);
  assert.equal((await verifyBundle(fetched(m, { signature }), { publicKey: pub, requireSignature: true })).signed, true);
  assert.equal(await verifySignature(text.replace('1.2.3', '9.9.9'), signature, pub), false);
  assert.equal((await verifyBundle(fetched(m), { publicKey: pub })).reason, 'signature_missing');
});

// Slow (builds with wrangler through npx): run with ULTRASTABLE_BUILD_TEST=1. It writes the release files the way CI would.
test('T19-5 US-19-R16: main writes bundle.js, migrations.sql, manifest.json and manifest.sig whose hashes equal the generated bundle', { skip: process.env.ULTRASTABLE_BUILD_TEST !== '1' }, async () => {
  const out = mkdtempSync(path.join(tmpdir(), 'us-release-'));
  const { priv, pub } = keys();
  process.env.US_TEST_SIGNING_KEY = priv;
  const code = await main(['--outdir', out, '--version', '0.0.1', '--sign-key-env', 'US_TEST_SIGNING_KEY']);
  assert.equal(code, 0);
  for (const f of ['bundle.js', 'migrations.sql', 'manifest.json', 'manifest.sig']) assert.ok(existsSync(path.join(out, f)), f);
  const gen = await import(pathToFileURL(path.join(out, 'bundle.generated.js')).href);
  const man = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'));
  assert.equal(man.bundle_sha256, gen.BUNDLE_SHA256);
  assert.equal(man.version, '0.0.1');
  assert.deepEqual(man.products, PRODUCTS);
  const got = { bundle: readFileSync(path.join(out, 'bundle.js'), 'utf8'), migrations: readFileSync(path.join(out, 'migrations.sql'), 'utf8'),
    manifestText: readFileSync(path.join(out, 'manifest.json'), 'utf8'), signature: readFileSync(path.join(out, 'manifest.sig'), 'utf8').trim() };
  assert.equal((await verifyBundle(got, { publicKey: pub, requireSignature: true })).ok, true);
  delete process.env.US_TEST_SIGNING_KEY;
});
