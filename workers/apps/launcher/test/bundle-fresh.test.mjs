// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-19-R10: the bundle the launcher deploys and whose hash it shows is the one built from the current source. Needs no network and no wrangler:
// build.mjs records the SHA-256 of every source file in the bundle's import closure, and this test recomputes them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { BUNDLE, BUNDLE_SHA256, MIGRATIONS_SQL, SOURCES, SOURCES_SHA256 } from '../src/bundle.generated.js';
import { importClosure, sourceClosure } from '../closure.mjs';

const REBUILD = 'run: node apps/launcher/build.mjs (it needs wrangler through npx) and commit src/bundle.generated.js';

test('US-19-R10 the committed bundle is self-consistent: its hash is the hash of its bytes', () => {
  assert.equal(createHash('sha256').update(BUNDLE).digest('hex'), BUNDLE_SHA256);
  assert.match(MIGRATIONS_SQL, /CREATE TABLE IF NOT EXISTS items/);
});

test('T19-8 US-19-R10 the committed bundle matches its source closure: no file the preview Worker imports changed since it was built', () => {
  const now = sourceClosure();
  const changed = Object.keys({ ...SOURCES, ...now.files }).filter(f => SOURCES[f] !== now.files[f]);
  assert.deepEqual(changed, [], `stale bundle: ${changed.join(', ')}; ${REBUILD}`);
  assert.equal(now.digest, SOURCES_SHA256);
});

test('US-19-R10 the recorded closure is complete: every module the bundler included is a file in the closure', () => {
  const included = [...BUNDLE.matchAll(/^\/\/ (\.\.\/\.\.\/\.\.\/[^\n]+)$/gm)].map(m => m[1].replace('../../../', ''));
  assert.ok(included.length > 0, 'the bundle names its modules in comments');
  for (const f of included) assert.ok(SOURCES[f], `${f} is in the bundle but not in the recorded closure`);
  for (const f of importClosure().filter(f => f !== 'apps/launcher/preview/entry.js')) assert.ok(included.includes(f), `${f} is in the closure but the bundle does not contain it; ${REBUILD}`);
});
