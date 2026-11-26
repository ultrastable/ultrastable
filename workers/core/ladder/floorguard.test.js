// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The floor guard (US-09-R11) and the standards gate with its exemption registry (US-09 section 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as L from './index.js';
import { scan, floorGuardRun } from './floorguard.js';
import { standardsGate, verifyLayers, registerExemption, standardsRun, MIN_MAX_OUT, MIN_CONTEXT } from './standards.js';

const MIG = fileURLToPath(L.MIGRATIONS_DIR);
const NOW = Date.UTC(2026, 10, 26, 10, 0, 0);
const BANNED = [{ pattern: '-(mini|nano|fast)\\b', reason: 'small or quantized fast variant' }, { pattern: '^legacy-', reason: 'legacy class' }];
const worker = (name, text, bundle = null, role) => ({ name, role, source: [{ path: 'src/index.js', text }], bundle });
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

test('US-09-R11: a banned model pattern in a worker source files an item and exits 1', async () => {
  const db = makeDb([MIG]); await L.setFloor(db, BANNED);
  const r = await floorGuardRun({ db, now: () => NOW, listWorkers: async () => [worker('site', "const MODEL = 'vendor-large-fast';\nconst ok = 'vendor-large';"), worker('clean', "const MODEL = 'vendor-large';")] });
  assert.equal(r.exit_code, 1);
  assert.deepEqual(r.findings.map(f => [f.worker, f.where, f.line, f.match]), [['site', 'source', 1, '-fast']]);
  const it = one(db, `SELECT priority, status, closing_probe FROM items WHERE id='FLOOR-site'`);
  assert.deepEqual([it.priority, it.status, it.closing_probe], [5, 'ready', 'floor guard: worker clean']);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id='FLOOR-clean'`).n, 0, 'one item per offending worker only');
});

test('US-09-R11: a banned pattern only in the deployed bundle is found (the concurrent redeploy case)', () => {
  const r = scan({ banned: BANNED, workers: [worker('site', "const MODEL = 'vendor-large';", "var m='vendor-large-fast';")] });
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].where, 'bundle');
  assert.match(r.findings[0].note, /reverted by a concurrent redeploy/);
});

test('US-09-R11: comment-only lines, the banned list own declarations and marked lines are skipped', () => {
  const text = ["// the old model vendor-large-fast was removed", "# legacy-x is banned", "/* vendor-mini */", "{ pattern: '-(mini|nano|fast)\\\\b' }",
    "// floor-list:begin", "const bannedModels = ['m-nano'];", "// floor-list:end", "const diag = 'vendor-mini'; // floor-ok: a test fixture"].join('\n');
  assert.deepEqual(scan({ banned: BANNED, workers: [worker('w', text)] }).findings, []);
  assert.equal(scan({ banned: BANNED, workers: [worker('w', "run('vendor-mini')")] }).findings.length, 1);
});

test('US-09-R11: an unreadable worker is unmeasured, never clean; a clean scan exits 0 and closes the earlier item', async () => {
  const db = makeDb([MIG]); await L.setFloor(db, BANNED);
  const u = await floorGuardRun({ db, now: () => NOW, listWorkers: async () => [{ name: 'ghost', source: null, bundle: null }] });
  assert.deepEqual([u.exit_code, u.unmeasured], [1, ['ghost']]);
  assert.equal(one(db, `SELECT status FROM items WHERE id='FLOOR-ghost'`).status, 'ready');
  const down = await floorGuardRun({ db, now: () => NOW, listWorkers: async () => { throw new Error('registry offline'); } });
  assert.deepEqual([down.exit_code, down.unmeasured], [1, ['*']]);
  await floorGuardRun({ db, now: () => NOW, listWorkers: async () => [worker('site', "const M = 'vendor-mini';")] });
  assert.equal(one(db, `SELECT status FROM items WHERE id='FLOOR-site'`).status, 'ready');
  const clean = await floorGuardRun({ db, now: () => NOW + 60000, listWorkers: async () => [worker('site', "const M = 'vendor-large';"), { name: 'ghost', source: [{ path: 'a.js', text: '' }] }] });
  assert.equal(clean.exit_code, 0);
  assert.equal(one(db, `SELECT status FROM items WHERE id='FLOOR-site'`).status, 'done');
  assert.equal(one(db, `SELECT status FROM items WHERE id='FLOOR-UNMEASURED'`).status, 'done');
});

test('US-09-R11: an exemption with evidence suppresses a finding for a non-reader-facing role only', () => {
  const ex = [{ kind: 'floor', model: '-fast\\b', role: 'executor-author', evidence: 'checks plus a disjoint-family review gate its output', expires_at: null }];
  const w = role => worker('exec', "run('vendor-large-fast')", null, role);
  assert.equal(scan({ banned: BANNED, workers: [w('executor-author')], exemptions: ex }).findings.length, 0);
  assert.equal(scan({ banned: BANNED, workers: [w('executor-author')], exemptions: ex }).exempt.length, 1);
  assert.equal(scan({ banned: BANNED, workers: [w('other-role')], exemptions: ex }).findings.length, 1, 'another role is not covered');
  const reader = [{ ...ex[0], role: 'reader-facing' }];
  assert.equal(scan({ banned: BANNED, workers: [w('reader-facing')], exemptions: reader }).findings.length, 1, 'a reader-facing role is never exempt');
  assert.equal(scan({ banned: BANNED, workers: [w('executor-author')], exemptions: [{ ...ex[0], evidence: ' ' }] }).findings.length, 1, 'no evidence, no exemption');
  assert.equal(scan({ banned: BANNED, workers: [w('executor-author')], exemptions: [{ ...ex[0], expires_at: '2026-01-01 00:00:00' }], nowIso: '2026-11-26 10:00:00' }).findings.length, 1, 'an expired exemption does not count');
});

test('US-09-R11: the command line exits 0 on a clean input and 1 on a finding', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'floor-')), cli = fileURLToPath(new URL('./cli-floor-guard.js', import.meta.url));
  const f = (name, body) => { const p = path.join(dir, name); writeFileSync(p, JSON.stringify(body)); return p; };
  const clean = spawnSync(process.execPath, [cli, f('a.json', { banned: BANNED, workers: [worker('w', "const m = 'vendor-large';")] })], { encoding: 'utf8' });
  const bad = spawnSync(process.execPath, [cli, f('b.json', { banned: BANNED, workers: [worker('w', "const m = 'vendor-nano';")] })], { encoding: 'utf8' });
  assert.deepEqual([clean.status, bad.status], [0, 1]);
  assert.match(bad.stdout, /w source src\/index\.js:1 -nano/);
});

// ---- standards gate ----

const ok = { id: 'big', layer: 'catalog', max_out: 65536, context: 200000 };

test('standards gate: a model below the output or context minimum is a violation; a missing limit is a violation, never a pass', () => {
  const g = standardsGate([ok, { id: 'small', max_out: 4096, context: 128000 }, { id: 'blind', max_out: 40000 }]);
  assert.equal(g.ok, false);
  assert.deepEqual(g.violations.map(v => [v.id, v.field, v.reason]), [['small', 'max_out', 'below'], ['blind', 'context', 'unmeasured']]);
  assert.deepEqual([MIN_MAX_OUT, MIN_CONTEXT], [32768, 128000]);
  assert.equal(standardsGate([{ id: 'edge', max_out: 32768, context: 128000 }]).ok, true, 'the minimums are inclusive');
});

test('standards gate: an exemption needs evidence and stops counting when it expires; a reader-facing role is refused', async () => {
  const db = makeDb([MIG]);
  await assert.rejects(registerExemption(db, { model: 'small', role: 'triage', field: 'max_out', evidence: ' ' }), /needs evidence/);
  await assert.rejects(registerExemption(db, { model: 'small', role: 'reader-facing', field: 'max_out', evidence: 'x' }), /never exempt/);
  await assert.rejects(registerExemption(db, { model: 'small', role: 'triage', field: 'colour', evidence: 'x' }), /names the field/);
  await registerExemption(db, { model: 'small', role: 'triage', field: 'max_out', evidence: 'the free tier caps output at about 4k tokens, observed', expires_at: '2026-12-01 00:00:00' }, { now: NOW });
  const models = [{ id: 'small', role: 'triage', max_out: 4096, context: 128000 }];
  const ex = db.raw.prepare(`SELECT * FROM ladder_exemptions`).all();
  assert.equal(standardsGate(models, { exemptions: ex, nowIso: '2026-11-26 10:00:00' }).ok, true);
  assert.equal(standardsGate(models, { exemptions: ex, nowIso: '2026-12-02 00:00:00' }).ok, false);
  assert.equal(standardsGate([{ ...models[0], role: 'other' }], { exemptions: ex, nowIso: '2026-11-26 10:00:00' }).ok, false, 'the exemption names the role');
});

test('standards gate: verifyLayers reports a model whose limit differs between server, client and catalog', () => {
  const same = verifyLayers({ server: [ok], client: [ok], catalog: [ok] });
  assert.equal(same.ok, true);
  const v = verifyLayers({ server: [ok], client: [{ ...ok, max_out: 8192 }], catalog: [ok] });
  assert.deepEqual([v.ok, v.mismatches.map(m => [m.id, m.field, m.server, m.client, m.catalog])], [false, [['big', 'max_out', 65536, 8192, 65536]]]);
  assert.equal(verifyLayers({ server: [ok], client: [], catalog: [ok] }).mismatches[0].client, 'absent');
});

test('standards gate: the step files one item per violating model and closes it when the limit or an exemption appears', async () => {
  const db = makeDb([MIG]);
  const bad = [{ id: 'small', role: 'triage', max_out: 4096, context: 128000 }, ok];
  const s = await L.step({ db, now: NOW, config: { standards_models: bad } });
  assert.deepEqual(s.standards, { ok: false, violations: 1 });
  assert.equal(one(db, `SELECT status FROM items WHERE id='STANDARDS-small'`).status, 'ready');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'STANDARDS-%'`).n, 1);
  await registerExemption(db, { model: 'small', role: 'triage', field: 'max_out', evidence: 'observed free-tier output limit' }, { now: NOW });
  assert.equal((await standardsRun(db, { models: bad, now: NOW + 1000 })).ok, true);
  assert.equal(one(db, `SELECT status FROM items WHERE id='STANDARDS-small'`).status, 'done');
  const layers = await standardsRun(db, { models: [ok], layers: { server: [ok], client: [{ ...ok, context: 8000 }], catalog: [ok] }, now: NOW });
  assert.equal(layers.ok, false);
  assert.equal(one(db, `SELECT status FROM items WHERE id='STANDARDS-LAYERS'`).status, 'ready');
});
