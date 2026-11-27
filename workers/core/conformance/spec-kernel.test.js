// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Conformance tests of US-SPEC-00 and US-SPEC-01 that the module tests do not name: evidence is taken from the system and never constructed (US-00-R04),
// a standing limit outranks rung and override (US-00-R08), the scope hold (US-00-R09, US-00-T04) and the decision record (US-01-R10).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { kdb, setv, probe, one, rows } from '../kernel/testkit.js';
import { registerMetric, readMetric } from '../kernel/metrics.js';
import { recordDecision } from '../kernel/decisions.js';
import { evalProbe } from '../src/tick.js';
import { makeDb } from '../_shared/testdb.js';
import * as T from '../trust/index.js';
import { recordAsk, OUT_OF_SCOPE } from '../src/console.js';
import { scan, baseline } from '../../tools/timebomb.mjs';
import { runAll, runSuite } from '../../tools/run-suites.mjs';

const POLICY = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const NOW = Date.UTC(2026, 10, 26, 10, 0, 0);
const HOUR = 3600e3;

test('US-00-R04: a probe that errors or returns no row stores the reading as unmeasured (null) with the failure as its evidence, never as 0', async () => {
  const db = kdb();
  await registerMetric(db, { id: 'broken', op: '>=', target: 1, read_probe: 'SELECT v AS value FROM table_that_is_not_there' });
  await registerMetric(db, { id: 'empty', op: '>=', target: 1, read_probe: probe('nothing_recorded') });
  await registerMetric(db, { id: 'real', op: '>=', target: 1, read_probe: probe('real') });
  setv(db, 'real', 0);
  const broken = await readMetric(db, 'broken', NOW); const empty = await readMetric(db, 'empty', NOW); const real = await readMetric(db, 'real', NOW);
  assert.equal(broken.value, null); assert.match(broken.evidence, /^probe error: .*no such table/);
  assert.equal(empty.value, null); assert.equal(empty.evidence, 'probe returned no numeric value');
  assert.equal(real.value, 0, 'a reading of zero is a reading, and is kept as 0'); assert.equal(real.evidence, null);
  const stored = Object.fromEntries(rows(db, `SELECT metric_id, value, evidence FROM kernel_metric_readings`).map(r => [r.metric_id, r]));
  assert.equal(stored.broken.value, null); assert.equal(stored.empty.value, null); assert.equal(stored.real.value, 0);
  const state = Object.fromEntries(rows(db, `SELECT id, state FROM kernel_v_metric_trigger_state`).map(r => [r.id, r.state]));
  assert.deepEqual([state.broken, state.empty], ['unmeasured', 'unmeasured'], 'a missing reading is never on target');
});

test('US-00-R04: a reading older than the metric allows is unmeasured in the trigger view, not the last value carried forward', async () => {
  const db = kdb();
  await registerMetric(db, { id: 'old', op: '>=', target: 1, read_probe: probe('old'), max_age_h: 24 });
  setv(db, 'old', 5);
  await readMetric(db, 'old', Date.now() - 3 * 24 * HOUR);
  assert.equal(one(db, `SELECT state FROM kernel_v_metric_trigger_state WHERE id = 'old'`).state, 'unmeasured');
  await readMetric(db, 'old', Date.now());
  assert.equal(one(db, `SELECT state FROM kernel_v_metric_trigger_state WHERE id = 'old'`).state, 'on_target');
});

test('US-00-R04: a tick probe that cannot be read reports the error as its detail and does not pass; the evidence quotes what was read', async () => {
  const db = kdb();
  const ctx = { env: { SOME_SETTING: true } };
  const bad = await evalProbe(db, ctx, { id: 'X1', closing_probe: 'select n from no_such_table', created_at: '2026-11-26 00:00:00' });
  assert.equal(bad.ok, false); assert.match(bad.detail, /^probe could not run: .*no such table/);
  const empty = await evalProbe(db, ctx, { id: 'X2', closing_probe: 'SELECT COUNT(*) FROM items', created_at: '' });
  assert.equal(empty.ok, false); assert.equal(empty.detail, 'probe returned 0', 'the detail is the number the probe returned');
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check) VALUES ('Y','y','o','x')`);
  const full = await evalProbe(db, ctx, { id: 'X3', closing_probe: 'SELECT COUNT(*) FROM items', created_at: '' });
  assert.deepEqual([full.ok, full.detail], [true, 'probe returned 1']);
  assert.equal((await evalProbe(db, ctx, { id: 'X4', closing_probe: 'env:SOME_SETTING' })).detail, 'setting SOME_SETTING is present');
  assert.equal((await evalProbe(db, ctx, { id: 'X5', closing_probe: 'env:OTHER_SETTING' })).detail, 'setting OTHER_SETTING is absent');
  assert.equal(await evalProbe(db, ctx, { id: 'X6', closing_probe: 'manual' }), null, 'a probe the tick cannot read is not guessed');
});

test('US-00-R08 and US-06-R13: a standing limit wins over the rung, the reliability and an allow override', async () => {
  const MIG = fileURLToPath(T.MIGRATIONS_DIR);
  const db = makeDb([MIG]);
  db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability) VALUES ('repo','open_pr','self-extending',1.0)`).run();
  const go = (extra) => T.authorize(db, { surface: 'repo', action_class: 'open_pr', executor: 'doer-1', required_rung: 'delegated', ...extra }, { policy: POLICY, now: NOW });
  assert.equal((await go({ target: 'a' })).allowed, true, 'the rung and the score alone would allow it');
  for (const [target, limits, check] of [['b', { harness: { refused: true, reason: 'command not permitted' } }, 'harness'], ['c', { touches_secret_value: true }, 'secret_lock'], ['d', { outreach: { consent: false } }, 'outreach_consent']]) {
    const r = await go({ target, limits, override: 'allow' });
    assert.deepEqual([r.allowed, r.refused, r.standing_limit], [false, check, true], check);
  }
  const denied = await go({ target: 'e', override: 'deny' });
  assert.deepEqual([denied.allowed, denied.refused], [false, 'principal_override']);
});

test('US-00-T04 and US-00-R09: a request for a business plan with no pack enabled is declined with its reason and held, not dispatched', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('pm-1','portfolio-manager',1,'m')`);
  const r = await recordAsk(db, 'Please write me a business plan for the bakery');
  assert.equal(r.status, 200); assert.equal(r.body.held, true);
  assert.match(r.body.message, /a business plan or funding material/); assert.match(r.body.message, /does not do by default/);
  const item = await db.prepare(`SELECT status, project, blocker FROM items WHERE id = ?`).bind(r.body.id).first();
  assert.deepEqual([item.status, item.project], ['blocked', 'scope-gate']);
  assert.match(item.blocker, /Out of scope by default \(SCOPE\.md\)/);
  const { runTick } = await import('../src/tick.js');
  await runTick(db, { config: { policy: POLICY }, now: NOW });
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM claims`).get().n, 0, 'a held item is never claimed');
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id = ?`).get(r.body.id).status, 'blocked');
  const fine = await recordAsk(db, 'Add a contact form to the site');
  assert.equal(fine.body.held, false);
  assert.equal(OUT_OF_SCOPE.length >= 4, true);
});

test('US-00-T04 (todo): the decline names the pack that would cover the request', { todo: 'needs a `pack` field on OUT_OF_SCOPE in core/src/console.js (integration request): drafts covers plans and documents, social covers posts' }, async () => {
  const db = makeDb();
  const r = await recordAsk(db, 'Please write me a business plan for the bakery');
  assert.match(r.body.message, /drafts/);
});

test('US-01-R10: a decision is stored with its prediction, authority and revert path before it runs, and one without any of the three is refused', async () => {
  const db = kdb();
  await registerMetric(db, { id: 'm', op: '>=', target: 1, read_probe: probe('m') });
  setv(db, 'm', 0);
  const full = { id: 'D-1', decision: 'raise the cap', authority: 'portfolio-manager rule', prediction: 'm >= 1 within 24 h', revert_path: 'set the cap back', now: NOW };
  for (const missing of ['prediction', 'authority', 'revert_path', 'decision', 'id']) {
    await assert.rejects(() => recordDecision(db, { ...full, id: `D-${missing}`, [missing]: '' }), new RegExp(`decision requires ${missing}|requires`), missing);
  }
  await assert.rejects(() => recordDecision(db, { ...full, id: 'D-bad', prediction: 'it will get better' }), /not parsable/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_decisions`).n, 0, 'nothing was stored for a refused decision');
  const ok = await recordDecision(db, full);
  assert.equal(ok.prediction.metric, 'm');
  const stored = one(db, `SELECT decision, authority, prediction, revert_path, due_at, status FROM kernel_decisions WHERE id = 'D-1'`);
  assert.deepEqual([stored.authority, stored.prediction, stored.revert_path, stored.status], ['portfolio-manager rule', 'm >= 1 within 24 h', 'set the cap back', 'open']);
  assert.equal(stored.due_at, '2026-11-27 10:00:00', 'the window is part of the stored prediction');
});

test('US-00-R15: a test that pins a calendar date and loads code that reads a window relative to the real clock is found; an injected clock, a bare default and a plain test are not', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'us-timebomb-'));
  try {
    mkdirSync(path.join(root, 'a'));
    writeFileSync(path.join(root, 'a/window.js'), "export const SQL = `SELECT 1 FROM t WHERE at >= datetime('now', '-7 days')`;\n");
    writeFileSync(path.join(root, 'a/plain.js'), "export const SQL = `CREATE TABLE t (at TEXT DEFAULT (datetime('now')))`;\n");
    writeFileSync(path.join(root, 'a/bomb.test.js'), "import { SQL } from './window.js';\nconst T0 = Date.parse('2026-11-10T00:00:00Z');\n");
    writeFileSync(path.join(root, 'a/clock.test.js'), "import { SQL } from './window.js';\nconst T0 = Date.now();\n");
    writeFileSync(path.join(root, 'a/default.test.js'), "import { SQL } from './plain.js';\nconst T0 = Date.parse('2026-11-10T00:00:00Z');\n");
    assert.deepEqual(scan(root).map(f => [f.test, f.loads]), [['a/bomb.test.js', ['a/window.js']]]);
  } finally { rmSync(root, { recursive: true, force: true }); }
  const base = new Set(baseline(path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')));
  assert.deepEqual(scan(path.join(path.dirname(fileURLToPath(import.meta.url)), '../..')).filter(f => !base.has(f.test)), [], 'this repository has none outside the shrink-only baseline');
});

test('US-00-R16: the suites run from one list, all of them even when one fails, and a suite that cannot start fails with its reason, never skipped', () => {
  const fake = (results) => (cmd, args) => { const r = results[args[1]]; return typeof r === 'function' ? r() : r; };
  const spawn = fake({ ok: { status: 0 }, bad: { status: 2, stderr: 'line1\nline2\nthree failed' }, gone: { status: null, error: new Error('spawn sh ENOENT') } });
  const res = runAll([{ name: 'a', cmd: 'ok' }, { name: 'b', cmd: 'bad' }, { name: 'c', cmd: 'gone' }, { name: 'd', cmd: 'ok' }], null, spawn);
  assert.deepEqual(res.map(r => [r.name, r.ok]), [['a', true], ['b', false], ['c', false], ['d', true]], 'a failure does not stop the suites after it');
  assert.match(res[1].reason, /three failed/); assert.match(res[2].reason, /spawn sh ENOENT/);
  assert.deepEqual(runAll([{ name: 'a', cmd: 'ok' }, { name: 'd', cmd: 'ok' }], ['d'], spawn).map(r => r.name), ['d']);
  assert.equal(runSuite({ name: 'x', cmd: 'true' }, () => ({ status: null, error: new Error('timed out') })).ok, false, 'a suite that did not finish is not a pass');
});
