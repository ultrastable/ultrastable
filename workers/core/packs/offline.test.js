// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Proofs for US-21-R10 (testable with fake ports and no network), US-21-R11 (no tenant-specific names or hosts) and US-SPEC-21 s4
// (scope.does_not names the adjacent section 3 items for its class), taken over every shipped pack.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadManifest, validateManifest, scanPackSource } from './index.js';
import { assertReadOnly } from '../kernel/util.js';

const PACKS = fileURLToPath(new URL('../../packs/', import.meta.url));
const packDirs = () => readdirSync(PACKS, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(PACKS, e.name));
const walk = (d) => readdirSync(d).flatMap(n => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });

// Run every shipped pack's own tests in a child process whose network globals are throwers that record the attempt in a file.
test('US-21-R10: every shipped pack test file passes with the network globals replaced by throwers, and none is called', () => {
  const tests = packDirs().flatMap(d => walk(d).filter(f => f.endsWith('.test.js')));
  assert.ok(tests.length >= 6, `expected a test file per shipped pack, found ${tests.length}`);
  const dir = mkdtempSync(path.join(tmpdir(), 'offline-'));
  const log = path.join(dir, 'network.log'), pre = path.join(dir, 'preload.mjs');
  writeFileSync(log, '');
  writeFileSync(pre, `import { appendFileSync } from 'node:fs';
const note = (kind, what) => { appendFileSync(${JSON.stringify(log)}, kind + ' ' + what + '\\n'); throw new Error('network is forbidden in pack tests (US-21-R10)'); };
globalThis.fetch = (u) => note('fetch', String(u));
globalThis.WebSocket = class { constructor(u) { note('WebSocket', String(u)); } };
`);
  const r = spawnSync(process.execPath, ['--test', '--no-warnings', ...tests], { encoding: 'utf8', env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'NODE_TEST_CONTEXT')), NODE_OPTIONS: `--import=${pathToFileURL(pre).href}` }, timeout: 120000 });
  assert.equal(r.status, 0, `pack tests failed offline:\n${(r.stdout || '').split('\n').filter(l => /^\s*not ok|# (pass|fail)/.test(l)).join('\n')}\n${r.stderr || ''}`);
  assert.deepEqual(readFileSync(log, 'utf8').split('\n').filter(Boolean), [], 'a pack test reached for the network');
  assert.match(r.stdout, /# fail 0/);
});

test('US-21-R11: no shipped pack source or manifest names a tenant or a real host', () => {
  const TENANTS = ['qn' + 'fo', 'quni' + 'verse', 'ultrastable.io', 'rowan', 'quni-' + 'gudzinas', 'practical-' + 'solutions'];   // built from parts so this file does not itself trip the separation guard (core/test/no-qnfo.test.js)
  const REAL_HOST = /https?:\/\/(?!(?:[\w-]+\.)*(?:example\.(?:com|org|net)|invalid|localhost)\b)(?:[\w-]+\.)+(?:com|org|net|io|dev|app|ai|co|social)\b/i;
  const allowedProviderHosts = ['api.cloudflare.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'www.youtube.com', 'bsky.app'];   // public provider APIs a channel adapter speaks to by protocol, never an account
  for (const dir of packDirs()) {
    for (const f of walk(dir).filter(x => !x.endsWith('.test.js') && !x.endsWith('.md'))) {
      const body = readFileSync(f, 'utf8').replace(/^\s*(\/\/|--).*$/gm, '');
      for (const t of TENANTS) assert.ok(!body.toLowerCase().includes(t), `${path.relative(PACKS, f)} names ${t}`);
      for (const m of body.matchAll(new RegExp(REAL_HOST.source, 'gi'))) assert.ok(allowedProviderHosts.some(h => m[0].includes(h)), `${path.relative(PACKS, f)} names a real host ${m[0]}`);
    }
  }
});

// The adjacent section 3 items by class: the words a pack's does_not must contain (case-insensitive, any one of each group).
const ADJACENT = {
  B: [['bypass'], ['impersonate', 'pose as', 'post as']],
  D: [['money', 'billing'], ['bypass']],
  C: [['sign', 'submit', 'send'], ['advice', 'bypass']],
  A: [['send', 'sell', 'share', 'outward', 'profile', 'bypass']],
};
test('US-SPEC-21 s4: scope.does_not of each shipped pack names the adjacent section 3 items for its class', () => {
  for (const dir of packDirs()) {
    const m = loadManifest(dir);
    const text = m.scope.does_not.join(' ').toLowerCase();
    for (const group of ADJACENT[m.class]) assert.ok(group.some(w => text.includes(w)), `${m.id} (class ${m.class}) does_not names none of: ${group.join(', ')}`);
    if (m.outbound && m.outbound.consent !== 'none') assert.ok(/consent|confirm|unsubscribe/.test(text), `${m.id} sends to people but does_not does not name consent`);
  }
});

test('US-21-R04 every shipped manifest validates, its probes are read-only SELECTs, and every pack passes the source scan', () => {
  for (const dir of packDirs()) {
    const m = loadManifest(dir);
    assert.deepEqual(validateManifest(m, { readProbeCheck: assertReadOnly }), [], m.id);
    assert.ok(m.charter.guard_metrics.length >= 1, `${m.id} has a guard metric`);
    assert.deepEqual(scanPackSource(dir), [], m.id);
  }
});
