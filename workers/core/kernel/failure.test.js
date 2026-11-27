// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { kdb, setv, probe, item, one, rows, HOUR } from './testkit.js';
import { registerMetric } from './metrics.js';
import {
  registerFailureMode, runDetectors, detectStaleDetectors, confirmFiring, reviewProbation, payloadIsFailure, consumeRemediations,
  recordLoopRun, canAttempt, recordAttempt, proposeRemedy, judgeRemedies, pruneHits,
} from './failure.js';

const contract = (o = {}) => ({ owner: 'ops', doer: 'fixer', alt_doers: ['fixer', 'fixer2'], closing_probe: probe('queue_err'), pass: '= 0', max_attempts: 2, backoff_h: [1, 4], deadline_h: 72, ...o });
const fm = (o = {}) => ({ id: 'FM-Q', name: 'queue coverage', severity: 4, detector_sql: `SELECT v AS value, 10.0 AS expected FROM t_vals WHERE k = 'seen'`, fire_when: 'value < 0.8*expected', contract: contract(), ...o });
const now = () => Date.now();

test('US-17-T01: a detector that does not fire still writes a hit row (fired = 0)', async () => {
  const db = kdb(); setv(db, 'seen', 10);
  await registerFailureMode(db, fm());
  assert.deepEqual(await runDetectors(db, { now: now() }), []);
  const h = one(db, `SELECT * FROM kernel_failure_mode_hits`);
  assert.equal(h.fired, 0); assert.equal(h.value, 10); assert.equal(h.expected, 10);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items`).n, 0);
});

test('a firing detector opens an item carrying a full remediation contract, once (US-17-R04)', async () => {
  const db = kdb(); setv(db, 'seen', 2);
  await registerFailureMode(db, fm());
  const f = await runDetectors(db, { now: now() });
  assert.equal(f.length, 1);
  const it = one(db, `SELECT * FROM items WHERE id = ?`, f[0].item);
  assert.equal(it.priority, 1); assert.equal(it.owner_role, 'ops'); assert.match(it.done_check, /closing probe passes/);
  const r = one(db, `SELECT * FROM kernel_remediations WHERE item_id = ?`, f[0].item);
  assert.equal(r.doer, 'fixer'); assert.equal(r.max_attempts, 2); assert.equal(r.deadline_h, 72); assert.ok(r.closing_probe);
  await runDetectors(db, { now: now() });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_remediations`).n, 1, 'no second remediation while one is open');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits WHERE fired = 1`).n, 2);
});

test('a failure mode without a detector, severity or contract field cannot be registered (US-17-R03/R04)', async () => {
  const db = kdb();
  await assert.rejects(registerFailureMode(db, fm({ detector_sql: 'DELETE FROM items' })), /SELECT/);
  await assert.rejects(registerFailureMode(db, fm({ severity: 9 })), /severity/);
  await assert.rejects(registerFailureMode(db, fm({ fire_when: 'process.exit()' })), /fire_when/);
  for (const f of ['owner', 'doer', 'closing_probe', 'max_attempts', 'deadline_h']) {
    await assert.rejects(registerFailureMode(db, fm({ contract: contract({ [f]: undefined }) })), new RegExp(f));
  }
});

test('a detector that errors writes a hit row with the error, not silence', async () => {
  const db = kdb();
  await registerFailureMode(db, fm({ detector_sql: 'SELECT * FROM no_such_table' }));
  await runDetectors(db, { now: now() });
  const h = one(db, `SELECT * FROM kernel_failure_mode_hits`);
  assert.equal(h.value, null); assert.match(h.evidence, /detector error/);
});

test('US-17-T02: a detector that stopped writing is itself detected (frozen)', async () => {
  const db = kdb(); setv(db, 'seen', 10);
  await registerFailureMode(db, fm(), now() - 10 * HOUR);
  const filed = await detectStaleDetectors(db, { now: now() });
  assert.equal(filed.length, 1); assert.match(filed[0], /^FM-STALE-FM-Q-/);
  await runDetectors(db, { now: now() });
  const again = await detectStaleDetectors(db, { now: now() + 1 * HOUR });
  assert.deepEqual(again, [], 'a recent hit row clears it');
});

test('US-17-R09: a detector mostly refuted by verification goes to probation and stops opening items', async () => {
  const db = kdb(); setv(db, 'seen', 2);
  await registerFailureMode(db, fm());
  for (let i = 0; i < 10; i++) db.raw.prepare(`INSERT INTO kernel_failure_mode_hits (fm_id, ts, value, expected, fired, confirmed) VALUES ('FM-Q','2026-01-01 00:00:00',2,10,1,?)`).run(i < 4 ? 1 : 0);
  assert.deepEqual(await reviewProbation(db), ['FM-Q']);
  assert.equal(one(db, `SELECT status FROM kernel_failure_modes`).status, 'probation');
  await runDetectors(db, { now: now() });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_remediations`).n, 0);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits WHERE id > 10`).n, 1, 'it still writes hit rows');
  await confirmFiring(db, 1, false); assert.equal(one(db, `SELECT confirmed FROM kernel_failure_mode_hits WHERE id=1`).confirmed, 0);
});

test('US-17-T06: a count named failed is not a failure; structured errors are', () => {
  assert.equal(payloadIsFailure('{"queued":0,"failed":2,"published":19}'), false);
  assert.equal(payloadIsFailure({ ok: false }), true);
  assert.equal(payloadIsFailure('{"ok":true,"error":"timeout"}'), true);
  assert.equal(payloadIsFailure('not json'), false);
});

async function armed(o = {}) {
  const db = kdb(); setv(db, 'seen', 2); setv(db, 'queue_err', 3);
  await registerFailureMode(db, fm(o));
  const [{ item: id }] = await runDetectors(db, { now: now() });
  return { db, id };
}

test('the consumer books exactly one bucket per scanned item and closes only when the closing probe passes (US-17-R05/R06)', async () => {
  const { db, id } = await armed();
  const t0 = now();
  let r = await consumeRemediations(db, { now: t0 });
  assert.deepEqual([r.scanned, r.failed, r.executed], [1, 1, 0]);
  assert.equal(one(db, `SELECT status FROM items WHERE id = ?`, id).status, 'ready', 'a failing probe leaves the item open');
  r = await consumeRemediations(db, { now: t0 });
  assert.deepEqual([r.scanned, r.no_action], [1, 1], 'backoff: not due yet');
  setv(db, 'queue_err', 0);
  r = await consumeRemediations(db, { now: t0 + 2 * HOUR });
  assert.deepEqual([r.scanned, r.executed], [1, 1]);
  const it = one(db, `SELECT * FROM items WHERE id = ?`, id);
  assert.equal(it.status, 'done'); assert.match(it.disposition, /closed by probe/);
  assert.ok(rows(db, `SELECT balanced FROM kernel_loop_runs`).every(x => x.balanced === 1));
});

test('after max_attempts a non-eligible item is reassigned, then blocked when doers run out (US-17-R07)', async () => {
  const { db, id } = await armed();
  const t = now();
  await consumeRemediations(db, { now: t });
  let r = await consumeRemediations(db, { now: t + 2 * HOUR });
  assert.equal(r.needs_human, 1);
  assert.equal(one(db, `SELECT doer FROM kernel_remediations WHERE item_id=?`, id).doer, 'fixer2');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM gate_cards`).n, 0, 'not interrupt-eligible: no gate card');
  await consumeRemediations(db, { now: t + 3 * HOUR });
  await consumeRemediations(db, { now: t + 9 * HOUR });
  assert.equal(one(db, `SELECT status FROM kernel_remediations WHERE item_id=?`, id).status, 'exhausted');
  assert.equal(one(db, `SELECT status FROM items WHERE id=?`, id).status, 'blocked');
});

test('an interrupt-eligible item goes through the gate card after max_attempts (US-17-R07)', async () => {
  const { db, id } = await armed({ contract: contract({ max_attempts: 1, interrupt_eligible: true }) });
  await consumeRemediations(db, { now: now() });
  const g = one(db, `SELECT * FROM gate_cards`);
  assert.equal(g.id, `GATE-${id}`); assert.equal(g.closing_probe, `item_done:${id}`); assert.equal(g.status, 'open');
  assert.equal(one(db, `SELECT status FROM kernel_remediations WHERE item_id=?`, id).status, 'needs_human');
});

test('US-17-T04: a loop that scanned 25 and booked 0 raises an incident and reopens the 25 items', async () => {
  const db = kdb(); const ids = [];
  for (let i = 0; i < 25; i++) { ids.push(`X${i}`); item(db, `X${i}`, { status: 'done', disposition: 'x' }); }
  const r = await recordLoopRun(db, { loop: 'drain', scanned: 25, unaccounted_item_ids: ids, now: now() });
  assert.equal(r.balanced, false); assert.equal(r.reopened, 25);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE status='open' AND id LIKE 'X%'`).n, 25);
  assert.match(one(db, `SELECT id FROM items WHERE id LIKE 'UNACCOUNTED-%'`).id, /UNACCOUNTED-drain/);
  assert.equal((await recordLoopRun(db, { loop: 'drain', scanned: 5, executed: 3, failed: 1, no_action: 1 })).balanced, true);
});

test('US-17-T03: three identical failures suspend retry, file a root-cause item and schedule a half-open probe', async () => {
  const db = kdb(); const t = now();
  assert.equal((await canAttempt(db, 'deploy:a', 'E123', t)).allowed, true);
  await recordAttempt(db, { target: 'deploy:a', signature: 'E123', ok: false, now: t });
  await recordAttempt(db, { target: 'deploy:a', signature: 'E123', ok: false, now: t + HOUR });
  assert.equal((await canAttempt(db, 'deploy:a', 'E123', t + 2 * HOUR)).allowed, true, 'two failures: still allowed');
  const r = await recordAttempt(db, { target: 'deploy:a', signature: 'E123', ok: false, now: t + 2 * HOUR });
  assert.equal(r.state, 'open');
  assert.equal((await canAttempt(db, 'deploy:a', 'E123', t + 3 * HOUR)).allowed, false, 'retry suspended');
  assert.ok(one(db, `SELECT id FROM items WHERE id = ?`, r.root_item_id));
  assert.ok(one(db, `SELECT half_open_at FROM kernel_breakers`).half_open_at);
  assert.equal((await canAttempt(db, 'deploy:a', 'E123', t + 27 * HOUR)).half_open, true);
  const ext = await recordAttempt(db, { target: 'deploy:a', signature: 'E123', ok: false, now: t + 27 * HOUR });
  assert.equal(ext.extended, true); assert.equal(one(db, `SELECT interval_h FROM kernel_breakers`).interval_h, 48);
  await recordAttempt(db, { target: 'deploy:a', signature: 'E123', ok: true, now: t + 80 * HOUR });
  assert.equal((await canAttempt(db, 'deploy:a', 'E123', t + 81 * HOUR)).allowed, true);
  assert.equal(one(db, `SELECT state FROM kernel_breakers`).state, 'closed');
  assert.equal((await canAttempt(db, 'deploy:b', 'E123', t)).allowed, true, 'other targets are unaffected');
});

async function remedyDb() {
  const db = kdb();
  await registerMetric(db, { id: 'lat', op: '<=', target: 5, read_probe: probe('lat') });
  setv(db, 'lat', 20);
  return db;
}

test('a remedy that did not move its metric in the window is replaced, not repeated (conformance)', async () => {
  const db = await remedyDb(); const t = now();
  await proposeRemedy(db, { id: 'R1', metric_id: 'lat', description: 'Add a cache', window_h: 24, now: t - 48 * HOUR });
  await assert.rejects(proposeRemedy(db, { id: 'R1b', metric_id: 'lat', description: 'second at once' }), /one remedy at a time/);
  const out = await judgeRemedies(db, { now: t });
  assert.equal(out[0].status, 'replaced');
  assert.match(one(db, `SELECT title FROM items WHERE id = 'REMEDY-REPLACE-R1'`).title, /different approach/);
  await assert.rejects(proposeRemedy(db, { id: 'R2', metric_id: 'lat', description: '  add   a CACHE ' }), /repeats/);
  await proposeRemedy(db, { id: 'R3', metric_id: 'lat', description: 'Batch the writes', window_h: 1, now: t });
  setv(db, 'lat', 8);
  assert.equal((await judgeRemedies(db, { now: t + 2 * HOUR }))[0].status, 'effective');
  assert.equal(one(db, `SELECT status FROM kernel_remedies WHERE id='R3'`).status, 'effective');
});

test('a remedy window that has not ended is not judged; an unmeasured metric is not a success', async () => {
  const db = await remedyDb(); const t = now();
  await proposeRemedy(db, { id: 'R1', metric_id: 'lat', description: 'x', window_h: 24, now: t });
  assert.deepEqual(await judgeRemedies(db, { now: t + HOUR }), []);
  db.raw.exec(`DELETE FROM t_vals`);
  const out = await judgeRemedies(db, { now: t + 25 * HOUR });
  assert.equal(out[0].status, 'replaced');
  assert.equal(one(db, `SELECT outcome FROM kernel_remedies`).outcome, 'unmeasured');
});

// ---- US-17 R21, R24, R25 to R29: the register, remediation lifecycle and breaker ---------------------------------------------------------
// The module-local state of core/remediation (relapse counts, firing links, breaker sources) is optional; these tests run both with it and without.
const STATE_SQL = readFileSync(fileURLToPath(new URL('../remediation/migrations/0002_state.sql', import.meta.url)), 'utf8');
const sdb = () => { const db = kdb(); db.raw.exec(STATE_SQL); return db; };
const T = Date.parse('2026-03-02T12:00:00Z');
const MINUTE = 60e3;

test('US-17-R25: two consecutive runs of a detector over a missing table open DETECTOR-BROKEN-<id> once', async () => {
  const db = kdb();
  await registerFailureMode(db, fm({ detector_sql: 'SELECT * FROM no_such_table' }));
  const r1 = await runDetectors(db, { now: T });
  assert.deepEqual(r1.broken, []);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'DETECTOR-BROKEN-%'`).n, 0, 'one miss may be transient');
  const r2 = await runDetectors(db, { now: T + HOUR });
  assert.deepEqual(r2.broken, [{ fm: 'FM-Q', filed: 'DETECTOR-BROKEN-FM-Q' }]);
  const it = one(db, `SELECT * FROM items WHERE id = 'DETECTOR-BROKEN-FM-Q'`);
  assert.equal(it.owner_role, 'ops'); assert.equal(it.priority, 1); assert.match(it.closing_probe, /no_such_table/);
  assert.deepEqual((await runDetectors(db, { now: T + 2 * HOUR })).broken, [], 'filed once, not once per run');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'DETECTOR-BROKEN-%'`).n, 1);
});

test('US-17-R25: one erroring run followed by a good run opens nothing', async () => {
  const db = kdb();
  await registerFailureMode(db, fm());                       // reads t_vals 'seen', which is not set yet: no row, no value
  assert.equal((await runDetectors(db, { now: T })).length, 0);
  setv(db, 'seen', 10);
  await runDetectors(db, { now: T + HOUR });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items`).n, 0);
});

test('US-17-R25: the item closes with a disposition when the detector returns a value again, and reopens if it breaks again', async () => {
  const db = kdb();
  await registerFailureMode(db, fm());
  await runDetectors(db, { now: T }); await runDetectors(db, { now: T + HOUR });
  assert.equal(one(db, `SELECT status FROM items WHERE id='DETECTOR-BROKEN-FM-Q'`).status, 'ready');
  setv(db, 'seen', 10);
  const r = await runDetectors(db, { now: T + 2 * HOUR });
  assert.deepEqual(r.broken, [{ fm: 'FM-Q', closed: 'DETECTOR-BROKEN-FM-Q' }]);
  const it = one(db, `SELECT status, disposition FROM items WHERE id='DETECTOR-BROKEN-FM-Q'`);
  assert.equal(it.status, 'done'); assert.match(it.disposition, /returned a value again/);
  db.raw.exec(`DELETE FROM t_vals`);
  await runDetectors(db, { now: T + 3 * HOUR });
  const again = await runDetectors(db, { now: T + 4 * HOUR });
  assert.deepEqual(again.broken, [{ fm: 'FM-Q', filed: 'DETECTOR-BROKEN-FM-Q', reopened: true }]);
  assert.equal(one(db, `SELECT status FROM items WHERE id='DETECTOR-BROKEN-FM-Q'`).status, 'ready');
});

test('US-17-R01: every erroring run still writes its hit row', async () => {
  const db = kdb();
  await registerFailureMode(db, fm({ detector_sql: 'SELECT * FROM no_such_table' }));
  for (let i = 0; i < 3; i++) await runDetectors(db, { now: T + i * HOUR });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits WHERE evidence LIKE 'detector error:%'`).n, 3);
});

async function closedOnce(db, t, { queue_err = 3 } = {}) {
  setv(db, 'seen', 2); setv(db, 'queue_err', queue_err);
  await registerFailureMode(db, fm());
  const [{ item: id }] = await runDetectors(db, { now: t });
  setv(db, 'queue_err', 0);
  await consumeRemediations(db, { now: t + 2 * HOUR });
  assert.equal(one(db, `SELECT status FROM items WHERE id = ?`, id).status, 'done');
  return id;
}

test('US-17-R04: without the state tables a relapse inside the same clock hour opens a new remediation under a fresh item id', async () => {
  const db = kdb(); const t = T;
  const first = await closedOnce(db, t);
  setv(db, 'queue_err', 3);
  const f = await runDetectors(db, { now: t + 2 * HOUR + 5 * MINUTE });   // same clock hour as the closure; the detector still fires
  assert.equal(f.length, 1);
  assert.notEqual(f[0].item, first);
  assert.equal(one(db, `SELECT status FROM items WHERE id = ?`, f[0].item).status, 'ready', 'an item is open: the relapse is not lost');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_remediations`).n, 2);
  const sameHour = await runDetectors(db, { now: t + 2 * HOUR + 10 * MINUTE });
  assert.equal(sameHour.length, 1); assert.equal(sameHour[0].item, null, 'while one is open no second is opened');
});

test('US-17-R27: a closed remediation whose detector fires again is reopened and counts one relapse', async () => {
  const db = sdb(); const t = T;
  const id = await closedOnce(db, t);
  setv(db, 'queue_err', 3);
  const f = await runDetectors(db, { now: t + 2 * HOUR + 5 * MINUTE });
  assert.equal(f[0].item, id);
  assert.deepEqual({ ...one(db, `SELECT status, attempts FROM kernel_remediations WHERE item_id = ?`, id) }, { status: 'open', attempts: 0 });
  assert.deepEqual({ ...one(db, `SELECT status, disposition FROM items WHERE id = ?`, id) }, { status: 'ready', disposition: null });
  assert.equal(one(db, `SELECT count FROM remediation_relapses WHERE fm_id = 'FM-Q'`).count, 1);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_remediations`).n, 1);
});

test('US-17-R27: a closure outside the relapse window is a new remediation, not a reopen', async () => {
  const db = sdb(); const t = T;
  const id = await closedOnce(db, t);
  setv(db, 'queue_err', 3);
  const f = await runDetectors(db, { now: t + 30 * 24 * HOUR });
  assert.notEqual(f[0].item, id);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM remediation_relapses`).n, 0);
});

test('US-17-R28: after three relapses closure needs two consecutive passes of the closing probe', async () => {
  const db = sdb(); let t = T;
  await closedOnce(db, t);
  for (let i = 1; i <= 3; i++) {
    t += 3 * HOUR; setv(db, 'queue_err', 3);
    await runDetectors(db, { now: t });
    setv(db, 'queue_err', 0);
    const r = await consumeRemediations(db, { now: t + 1 * MINUTE });
    if (i < 3) assert.equal(r.executed, 1, `relapse ${i} closes on one pass`);
    else assert.deepEqual([r.executed, r.no_action], [0, 1], 'the third relapse needs a second pass');
  }
  assert.equal(one(db, `SELECT count FROM remediation_relapses`).count, 3);
  assert.match(one(db, `SELECT evidence FROM kernel_remediations`).evidence, /pass 1 of 2/);
  assert.equal(one(db, `SELECT status FROM kernel_remediations`).status, 'open');
  const r2 = await consumeRemediations(db, { now: t + 2 * MINUTE });
  assert.equal(r2.executed, 1);
  assert.equal(one(db, `SELECT status FROM kernel_remediations`).status, 'closed');
  // a failing reading in between resets the streak
  t += 3 * HOUR; setv(db, 'queue_err', 3); await runDetectors(db, { now: t });
  setv(db, 'queue_err', 0); await consumeRemediations(db, { now: t + MINUTE });
  setv(db, 'queue_err', 3); await consumeRemediations(db, { now: t + 2 * MINUTE });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM remediation_passes`).n, 0);
});

test('US-17-R07: when no alternate doer remains an ESCALATE item is filed once and the remediation is exhausted', async () => {
  const db = kdb(); setv(db, 'seen', 2); setv(db, 'queue_err', 3);
  await registerFailureMode(db, fm({ contract: contract({ alt_doers: [], max_attempts: 1 }) }));
  const [{ item: id }] = await runDetectors(db, { now: T });
  await consumeRemediations(db, { now: T });
  assert.equal(one(db, `SELECT status FROM kernel_remediations WHERE item_id=?`, id).status, 'exhausted');
  const esc = one(db, `SELECT * FROM items WHERE id = ?`, `ESCALATE-${id}`);
  assert.equal(esc.owner_role, 'portfolio-manager'); assert.match(esc.title, /change the approach/);
  await consumeRemediations(db, { now: T + HOUR });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'ESCALATE-%'`).n, 1);
});

test('US-17-R21: closing a remediation calls the scorePrediction port with the item id', async () => {
  const { db, id } = await armed();
  setv(db, 'queue_err', 0);
  const seen = [];
  await consumeRemediations(db, { now: now(), scorePrediction: async item_id => { seen.push(item_id); return { verdict: 'hit' }; } });
  assert.deepEqual(seen, [id]);
  assert.match(one(db, `SELECT evidence FROM kernel_remediations WHERE item_id=?`, id).evidence, /prediction: \{"verdict":"hit"\}/);
  const second = await armed();
  setv(second.db, 'queue_err', 0);
  await consumeRemediations(second.db, { now: now(), scorePrediction: async () => { throw new Error('no prediction logged'); } });
  assert.match(one(second.db, `SELECT evidence FROM kernel_remediations WHERE item_id=?`, second.id).evidence, /prediction not scored: no prediction logged/);
  assert.equal(one(second.db, `SELECT status FROM items WHERE id=?`, second.id).status, 'done', 'a scoring failure never blocks the closure');
});

test('US-17-R06: a doer that throws leaves its message in the remediation evidence', async () => {
  const { db, id } = await armed();
  await consumeRemediations(db, { now: now(), invokeDoer: async () => { throw new Error('deploy refused: quota'); } });
  assert.match(one(db, `SELECT evidence FROM kernel_remediations WHERE item_id=?`, id).evidence, /doer fixer threw: deploy refused: quota/);
  assert.equal(one(db, `SELECT status FROM items WHERE id=?`, id).status, 'ready');
});

test('US-17-R29: after 3 failures, a success and one new failure inside the window the breaker stays closed', async () => {
  const db = sdb(); const t = T;
  for (let i = 0; i < 3; i++) await recordAttempt(db, { target: 'deploy:a', signature: 'E1', ok: false, now: t + i * HOUR });
  assert.equal(one(db, `SELECT state FROM kernel_breakers`).state, 'open');
  await recordAttempt(db, { target: 'deploy:a', signature: 'E1', ok: true, now: t + 3 * HOUR });
  const r = await recordAttempt(db, { target: 'deploy:a', signature: 'E1', ok: false, now: t + 4 * HOUR });
  assert.deepEqual([r.state, r.failures], ['closed', 1]);
  assert.equal(one(db, `SELECT state FROM kernel_breakers`).state, 'closed');
  assert.equal((await canAttempt(db, 'deploy:a', 'E1', t + 5 * HOUR)).allowed, true);
});

test('US-17-R29: a changed source_hash re-arms an open breaker and the next attempt is allowed', async () => {
  const db = sdb(); const t = T;
  for (let i = 0; i < 3; i++) await recordAttempt(db, { target: 'w', signature: 'E9', ok: false, now: t + i * HOUR, source_hash: 'h1' });
  assert.equal((await canAttempt(db, 'w', 'E9', t + 3 * HOUR, { source_hash: 'h1' })).allowed, false, 'same source: still suspended');
  assert.deepEqual(await canAttempt(db, 'w', 'E9', t + 3 * HOUR, { source_hash: 'h2' }), { allowed: true, rearmed: true });
  assert.equal(one(db, `SELECT state FROM kernel_breakers`).state, 'closed');
  assert.match(one(db, `SELECT detail FROM remediation_breaker_log WHERE event='rearmed'`).detail, /h1 to h2/);
  for (let i = 0; i < 2; i++) assert.equal((await recordAttempt(db, { target: 'w', signature: 'E9', ok: false, now: t + (4 + i) * HOUR, source_hash: 'h2' })).state, 'closed');
  assert.equal((await recordAttempt(db, { target: 'w', signature: 'E9', ok: false, now: t + 6 * HOUR, source_hash: 'h2' })).state, 'open', 'three failures of the new source open it again');
});

test('US-17-R08: a failed half-open probe doubles the interval, a failure recorded before the half-open time does not', async () => {
  const db = kdb(); const t = T;
  for (let i = 0; i < 3; i++) await recordAttempt(db, { target: 'x', signature: 'E', ok: false, now: t + i * HOUR });
  const early = await recordAttempt(db, { target: 'x', signature: 'E', ok: false, now: t + 5 * HOUR });
  assert.equal(early.extended, false); assert.equal(one(db, `SELECT interval_h FROM kernel_breakers`).interval_h, 24);
  const probeFailed = await recordAttempt(db, { target: 'x', signature: 'E', ok: false, now: t + 27 * HOUR });
  assert.equal(probeFailed.extended, true); assert.equal(one(db, `SELECT interval_h FROM kernel_breakers`).interval_h, 48);
});

test('US-17-R26: with due_only a detector with interval_h 1 run twice 10 minutes apart writes one hit row; 61 minutes later it writes a second', async () => {
  const db = kdb(); setv(db, 'seen', 10);
  await registerFailureMode(db, fm({ interval_h: 1 }));
  await runDetectors(db, { now: T, due_only: true });
  await runDetectors(db, { now: T + 10 * MINUTE, due_only: true });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits`).n, 1);
  await runDetectors(db, { now: T + 61 * MINUTE, due_only: true });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits`).n, 2);
});

test('US-17-R26: without due_only every call writes a row as before', async () => {
  const db = kdb(); setv(db, 'seen', 10);
  await registerFailureMode(db, fm({ interval_h: 1 }));
  await runDetectors(db, { now: T }); await runDetectors(db, { now: T + 10 * MINUTE });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits`).n, 2);
});

test('US-17-R26: a due_only run that skipped everything still lets detectStaleDetectors fire after 2 intervals of silence', async () => {
  const db = kdb(); setv(db, 'seen', 10);
  await registerFailureMode(db, fm({ interval_h: 1 }), T);
  await runDetectors(db, { now: T, due_only: true });
  assert.deepEqual(await detectStaleDetectors(db, { now: T + 90 * MINUTE }), []);
  await runDetectors(db, { now: T + 30 * MINUTE, due_only: true });                       // skipped: nothing is due
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits`).n, 1);
  assert.equal((await detectStaleDetectors(db, { now: T + 3 * HOUR })).length, 1);
});

test('US-17-R09: ten firings whose verify_probe passes (the problem was not there) put the detector in probation without any manual confirmFiring call', async () => {
  const db = sdb(); let t = T;
  setv(db, 'seen', 2); setv(db, 'queue_err', 0); setv(db, 'verify_ok', 0);
  await registerFailureMode(db, fm({ contract: contract({ verify_probe: probe('verify_ok') }) }));
  for (let i = 0; i < 10; i++) {
    t += 3 * HOUR;
    await runDetectors(db, { now: t });
    await consumeRemediations(db, { now: t + MINUTE }); await consumeRemediations(db, { now: t + 2 * MINUTE });
  }
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits WHERE fired = 1 AND confirmed = 0`).n, 10);
  assert.deepEqual(await reviewProbation(db), ['FM-Q']);
  assert.equal(one(db, `SELECT status FROM kernel_failure_modes`).status, 'probation');
});

test('US-17-R09: firings whose verify_probe still fails are confirmed and the detector stays armed', async () => {
  const db = sdb(); setv(db, 'seen', 2); setv(db, 'queue_err', 3); setv(db, 'verify_ok', 4);
  await registerFailureMode(db, fm({ contract: contract({ verify_probe: probe('verify_ok') }) }));
  await runDetectors(db, { now: T });
  await consumeRemediations(db, { now: T + MINUTE });
  assert.equal(one(db, `SELECT confirmed FROM kernel_failure_mode_hits WHERE fired = 1`).confirmed, 1);
  assert.equal(one(db, `SELECT status FROM kernel_failure_modes`).status, 'armed');
  await consumeRemediations(db, { now: T + 5 * HOUR });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM remediation_firings WHERE verified_at IS NOT NULL`).n, 1, 'a firing is judged once');
});

test('US-17-R09: a probation detector keeps writing hit rows and opens no item', async () => {
  const db = sdb(); setv(db, 'seen', 2);
  await registerFailureMode(db, fm());
  db.raw.exec(`UPDATE kernel_failure_modes SET status = 'probation'`);
  await runDetectors(db, { now: T });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits`).n, 1);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_remediations`).n, 0);
});

test('US-17-R24: pruneHits keeps the newest hit row per failure mode and deletes older ones past keep_days', async () => {
  const db = kdb(); setv(db, 'seen', 10);
  await registerFailureMode(db, fm());
  for (const d of [90, 60, 45, 1]) await runDetectors(db, { now: T - d * 24 * HOUR });
  const r = await pruneHits(db, { keep_days: 30, now: T });
  assert.equal(r.hits, 3);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits`).n, 1);
  const old = await pruneHits(db, { keep_days: 0, now: T + 1000 * 24 * HOUR });
  assert.equal(old.hits, 0, 'the newest row per mode is never pruned');
  await assert.rejects(() => pruneHits(db, { keep_days: -1 }), /non-negative/);
});

test('US-17-R24: a mode with a firing in the window keeps its evidence rows, and an open remediation keeps its hit', async () => {
  const db = sdb(); setv(db, 'seen', 2); setv(db, 'queue_err', 3);
  await registerFailureMode(db, fm());
  await runDetectors(db, { now: T - 40 * 24 * HOUR });                  // fires, opens a remediation that stays open
  for (let i = 0; i < 5; i++) await runDetectors(db, { now: T - (5 - i) * 24 * HOUR });
  const r = await pruneHits(db, { keep_days: 30, now: T });
  assert.equal(r.hits, 0, 'the old hit is the open remediation firing and is kept');
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM kernel_failure_mode_hits`).n, 6);
});
