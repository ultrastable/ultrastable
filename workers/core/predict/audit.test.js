// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-05-R18: the outside audit of the scorer, with a fake auditor. No network, no real second party.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as P from './index.js';

const MIG = fileURLToPath(P.MIGRATIONS_DIR);
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const H = 3600e3;
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

async function scored() {
  const db = makeDb([MIG]);
  await P.registerMetric(db, { name: 'queue_depth', read_sql: `SELECT 3` });
  await P.recordDecision(db, { id: 'D1', decision: 'drain the queue', predicted_outcome: 'queue_depth <= 5 within 1 h', revert_path: 'restore the old consumer', actor: 'agent-1' }, { now: NOW - 2 * H });
  await P.recordDecision(db, { id: 'D2', decision: 'raise the limit', predicted_outcome: 'queue_depth <= 1 within 1 h', revert_path: 'lower the limit', actor: 'agent-2' }, { now: NOW - 2 * H });
  await P.scoreDue(db, { now: NOW });
  const ids = db.raw.prepare(`SELECT id, matched FROM predict_predictions ORDER BY decision_id`).all();
  return { db, hit: ids[0].id, miss: ids[1].id };
}

test('US-05-R18: the migration is idempotent and the audit table is predict_ prefixed', () => {
  const db = makeDb([MIG]);
  const sql = readFileSync(MIG + '0002_audit.sql', 'utf8');
  db.raw.exec(sql); db.raw.exec(sql);
  for (const m of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)) assert.match(m[1], /^predict_/);
});

test('US-05-R18: the export gives an outside party the scored rows with the decision text and revert path, and its hash is stable for the same rows', async () => {
  const { db, hit } = await scored();
  const a = await P.exportForAudit(db);
  assert.equal(a.count, 2);
  const row = a.rows.find(r => r.id === hit);
  assert.deepEqual([row.verdict, row.decision, row.revert_path, row.observed], ['hit', 'drain the queue', 'restore the old consumer', 3]);
  const b = await P.exportForAudit(db);
  assert.equal(a.sha256, b.sha256);
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  db.raw.prepare(`UPDATE predict_predictions SET matched = 1 WHERE decision_id = 'D2'`).run();
  assert.notEqual((await P.exportForAudit(db)).sha256, a.sha256, 'a changed score changes the hash');
  assert.equal((await P.exportForAudit(db, { limit: 1 })).count, 1);
});

test('US-05-R18: an auditor equal to the decision actor is refused, and an unscored prediction cannot be audited', async () => {
  const { db, hit } = await scored();
  const self = await P.recordAudit(db, { prediction_id: hit, auditor: 'agent-1', verdict: 'hit', evidence: 'looked again' }, { now: NOW });
  assert.equal(self.ok, false);
  assert.match(self.reason, /cannot audit itself/);
  await P.recordDecision(db, { id: 'D3', decision: 'x', predicted_outcome: 'queue_depth <= 5 within 9 h', revert_path: 'y', actor: 'agent-3' }, { now: NOW });
  const open = db.raw.prepare(`SELECT id FROM predict_predictions WHERE decision_id = 'D3'`).get().id;
  assert.match((await P.recordAudit(db, { prediction_id: open, auditor: 'outside-1', verdict: 'hit', evidence: 'e' }, { now: NOW })).reason, /not scored yet/);
  await assert.rejects(P.recordAudit(db, { prediction_id: hit, auditor: 'outside-1', verdict: 'maybe', evidence: 'e' }), /unknown verdict/);
  await assert.rejects(P.recordAudit(db, { prediction_id: hit, auditor: 'outside-1', verdict: 'hit', evidence: '' }), /requires/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM predict_audits`).n, 0);
});

test('US-05-R18: a disagreeing verdict files one item with its probe; an agreeing one files nothing; agreement is counted per auditor and cannot-tell counts for neither side', async () => {
  const { db, hit, miss } = await scored();
  assert.deepEqual(await P.auditAgreement(db), { n: 0, agreed: 0, share: null, per_auditor: [] }, 'no outside party has acted: nothing is claimed');
  const ok = await P.recordAudit(db, { prediction_id: hit, auditor: 'outside-1', verdict: 'hit', evidence: 'queue_depth read 3' }, { now: NOW });
  assert.deepEqual([ok.ok, ok.agrees, ok.item], [true, true, null]);
  const bad = await P.recordAudit(db, { prediction_id: miss, auditor: 'outside-1', verdict: 'hit', evidence: 'the limit was met by my reading' }, { now: NOW });
  assert.deepEqual([bad.ok, bad.agrees], [true, false]);
  assert.equal(bad.item, `PREDICT-AUDIT-${miss}`);
  const item = one(db, `SELECT closing_probe, status FROM items WHERE id = ?`, bad.item);
  assert.equal(item.status, 'ready');
  const probe = () => Object.values(one(db, item.closing_probe))[0];
  assert.equal(probe(), 0, 'the closing probe is false while the disagreement stands');
  db.raw.prepare(`UPDATE predict_predictions SET matched = 1 WHERE id = ?`).run(miss); // the score is corrected
  assert.equal(probe(), 1, 'it is true once the score agrees with the outside verdict');
  db.raw.prepare(`UPDATE predict_predictions SET matched = 0 WHERE id = ?`).run(miss);
  const again = await P.recordAudit(db, { prediction_id: miss, auditor: 'outside-2', verdict: 'miss', evidence: 'agrees with the score' }, { now: NOW });
  assert.equal(again.agrees, true);
  await P.recordAudit(db, { prediction_id: hit, auditor: 'outside-2', verdict: 'cannot-tell', evidence: 'no access to the metric' }, { now: NOW });
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM items WHERE id LIKE 'PREDICT-AUDIT-%'`).n, 1, 'one item for the one disagreement');
  const ag = await P.auditAgreement(db);
  assert.deepEqual(ag.per_auditor, [{ auditor: 'outside-1', n: 2, agreed: 1, share: 0.5 }, { auditor: 'outside-2', n: 1, agreed: 1, share: 1 }]);
  assert.deepEqual([ag.n, ag.agreed], [3, 2]);
  // a second verdict by the same auditor on the same prediction replaces the first
  await P.recordAudit(db, { prediction_id: miss, auditor: 'outside-1', verdict: 'miss', evidence: 'corrected my reading' }, { now: NOW });
  assert.equal((await P.auditAgreement(db)).per_auditor[0].agreed, 2);
});
