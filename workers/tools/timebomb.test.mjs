// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Q-TEST-TIMEBOMB-1: no new test pins a calendar date while loading SQL windowed on the real clock (datetime('now', '-7 days')); the baseline only shrinks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan, baseline, WINDOW, PINNED } from './timebomb.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the window pattern matches a real-clock window, not a bare default', () => {
  assert.ok(WINDOW.test("finished_at >= datetime('now', '-7 days')"));
  assert.ok(!WINDOW.test("created_at TEXT DEFAULT (datetime('now'))"));
  assert.ok(PINNED.test("const T0 = Date.parse('2026-11-11T00:00:00Z');"));
  assert.ok(!PINNED.test('const T0 = Date.now() - 3600e3;'));
});

test('a pinned-date test over a windowed manifest is found; a relative clock is not', () => {
  const d = mkdtempSync(join(tmpdir(), 'timebomb-'));
  mkdirSync(join(d, 'packs/x'), { recursive: true });
  writeFileSync(join(d, 'packs/x/pack.json'), JSON.stringify({ read_probe: "SELECT COUNT(*) FROM t WHERE at >= datetime('now', '-7 days')" }));
  writeFileSync(join(d, 'packs/x/x.test.js'), "const T0 = Date.parse('2026-11-11T00:00:00Z');\n");
  writeFileSync(join(d, 'packs/x/y.test.js'), 'const T0 = Date.now() - 3600e3;\n');
  assert.deepEqual(scan(d).map(f => f.test), ['packs/x/x.test.js']);
});

test('the repository has no timebomb outside the shrink-only baseline', () => {
  const found = scan(ROOT).map(f => f.test), base = baseline(ROOT);
  assert.deepEqual(found.filter(t => !base.includes(t)), [], 'start the test clock relative to Date.now()');
  assert.deepEqual(base.filter(t => !found.includes(t)), [], 'a fixed test leaves tools/timebomb-baseline.json');
  assert.ok(!found.includes('packs/cloud/cloud.test.js'), 'the 2026-11-18 failure stays fixed');
});
