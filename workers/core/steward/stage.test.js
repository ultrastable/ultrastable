// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the self-hosting stage computation (US-SPEC-20 s4: US-20-R10..R13, T20-6). No network: every probe is a fake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { computeStage, parsePublishedStage, checkPublished, stageStep } from './stage.js';

const dir = rel => fileURLToPath(new URL(rel, import.meta.url));
const MIGS = [dir('./migrations/'), dir('../runner/migrations/'), dir('../kernel/migrations/')];
const NOW = Date.parse('2026-11-20T12:00:00Z');
const AT = '2026-11-18 10:00:00';
const AUTHORS = { 1: 'author-a', 2: 'author-a', 3: 'author-a', 4: 'author-a' };
const PROBERS = { 1: 'prober-b', 2: 'prober-b', 3: 'prober-b', 4: 'prober-b' };
const good = {
  contract: async () => ({ record_check: { green: 12, merged: 12 }, false_built: 0 }),
  stage2: async () => ({ result: 'pass', matched: ['I-1'] }),
  account: async () => ({ ok: true }),
};
const config = { stage_authors: AUTHORS, probe_authors: PROBERS, min_ticks: 3 };

function seed(db, { ticks = 3, merges = 2, traced = 2, rungMoved = true, l2 = true } = {}) {
  for (let i = 0; i < ticks; i++) db.raw.prepare(`INSERT INTO tick_runs (started_at, finished_at, steps_completed, steps_total) VALUES (?,?,8,8)`).run(AT, AT);
  for (let i = 0; i < merges; i++) {
    db.raw.prepare(`INSERT INTO outcomes (item_id, agent, surface, action_class, result, at) VALUES (?,?,?,?,?,?)`).run('M-' + i, 'a', 'repo', 'merge', 'verified', AT);
    if (i < traced) db.raw.prepare(`INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (1,'staff',?,'m')`).run('M-' + i);
  }
  if (rungMoved) db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('repo','merge','assisted',0.9,12)`).run();
  if (l2) db.raw.prepare(`INSERT INTO kernel_step_evidence (tick_id, step, ok, evidence, at) VALUES (1,'risk',1,'x',?)`).run(AT);
}
const compute = (db, probes = good, cfg = config) => computeStage({ db, now: () => NOW, probes, config: cfg });

test('US-20-R11: stage 2 is unknown, not claimed, when the tracker cannot be read', async () => {
  const db = makeDb(MIGS); seed(db);
  const r = await compute(db, { ...good, stage2: async () => ({ result: 'unknown', reason: 'http 503' }) });
  assert.equal(r.evidence[2].unknown, true);
  assert.equal(r.evidence[2].ok, false);
  assert.match(r.evidence[2].why, /503/);
  assert.equal(r.stage, 1); assert.equal(r.claimed, 1); assert.equal(r.blocked_at, 2);
});

test('US-20-R11: a probe written by the stage author is evidence but the stage is not claimed', async () => {
  const db = makeDb(MIGS); seed(db);
  const circular = { ...config, probe_authors: { ...PROBERS, 2: 'author-a' } };
  const r = await compute(db, good, circular);
  assert.equal(r.stage, 4, 'the evidence holds');
  assert.equal(r.evidence[2].claim_blocked, 'probe_not_independent');
  assert.equal(r.claimed, 1, 'stage 2 and everything above it stay unclaimed');
  const unknownAuthors = await compute(db, good, { min_ticks: 3 });
  assert.equal(unknownAuthors.claimed, 0);
  assert.equal(unknownAuthors.evidence[1].claim_blocked, 'probe_author_unknown');
});

test('US-20-R12: losing stage 2 evidence drops a computed stage 3 to 1', async () => {
  const db = makeDb(MIGS); seed(db);
  assert.equal((await compute(db)).stage, 4);
  const r = await compute(db, { ...good, stage2: async () => ({ result: 'fail', missing_on_tracker: ['I-9'] }) });
  assert.equal(r.stage, 1);
  assert.equal(r.blocked_at, 2);
  assert.equal(r.evidence[3].ok, true, 'stage 3 evidence is read, yet the stage does not count above a missing lower one');
});

test('US-20-R12: stage 3 is never reported while stage 2 does not hold', async () => {
  const db = makeDb(MIGS); seed(db, { rungMoved: false, l2: false });
  const r = await compute(db);
  assert.equal(r.stage, 3);
  const none = await compute(db, { contract: good.contract, account: good.account });
  assert.equal(none.stage, 1, 'no stage 2 probe is unknown, never a pass');
  assert.equal(none.evidence[2].unknown, true);
});

test('stage 3: merged outcomes without a dispatch or a runner run lower the execution ratio below the threshold', async () => {
  const db = makeDb(MIGS); seed(db, { merges: 4, traced: 2 });
  let r = await compute(db);
  assert.equal(r.evidence[3].numbers.execution_ratio, 0.5);
  assert.equal(r.evidence[3].ok, false);
  assert.equal(r.stage, 2);
  db.raw.prepare(`INSERT INTO runner_runs (item_id, state, pr_number, created_at, updated_at) VALUES ('M-2','pr_opened',7,?,?)`).run(AT, AT);
  db.raw.prepare(`INSERT INTO runner_runs (item_id, state, pr_number, created_at, updated_at) VALUES ('M-3','refused',NULL,?,?)`).run(AT, AT);
  r = await compute(db);
  assert.equal(r.evidence[3].numbers.execution_ratio, 0.75, 'a run with a pull request traces; a refused run does not');
  r = await compute(db, good, { ...config, min_execution_ratio: 0.75 });
  assert.equal(r.evidence[3].ok, true);
});

test('stage 3: no merge outcome is an unmeasured ratio, a failing account or too few ticks is a failure with the reason', async () => {
  const db = makeDb(MIGS); seed(db, { merges: 0, traced: 0 });
  let r = await compute(db);
  assert.equal(r.evidence[3].unknown, true); assert.equal(r.evidence[3].numbers.execution_ratio, null);
  const db2 = makeDb(MIGS); seed(db2, { ticks: 1 });
  r = await compute(db2, { ...good, account: async () => ({ ok: false, detail: 'health 503' }) });
  assert.equal(r.evidence[3].ok, false);
  assert.match(r.evidence[3].why, /1 complete ticks \(need 3\)/);
  assert.match(r.evidence[3].why, /health 503/);
  const thrown = await compute(db2, { ...good, account: async () => { throw new Error('boom'); } });
  assert.equal(thrown.evidence[3].unknown, true, 'a probe that throws is unknown, never ok');
});

test('stage 4: a trust rung moved by recorded outcomes with an L2 evidence row holds; a start rung does not', async () => {
  const db = makeDb(MIGS); seed(db, { rungMoved: false });
  db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('repo','read','observed',0.5,40)`).run();
  let r = await compute(db);
  assert.equal(r.evidence[4].ok, false);
  assert.equal(r.stage, 3);
  db.raw.prepare(`UPDATE trust_ledger SET rung='assisted' WHERE action_class='read'`).run();
  r = await compute(db);
  assert.equal(r.evidence[4].ok, true);
  assert.equal(r.stage, 4);
  db.raw.exec(`DELETE FROM kernel_step_evidence`);
  assert.equal((await compute(db)).stage, 3, 'without a managerial step in the window the stage falls back');
});

test('US-20-R13: parsePublishedStage reads the contract stage line and a measured declaration', () => {
  const contract = readFileSync(dir('../../agents/CONTRACT.md'), 'utf8');
  assert.deepEqual(parsePublishedStage(contract), { stage: null, measured: true }, 'the contract says the stage is measured, never declared');
  assert.deepEqual(parsePublishedStage('The stage is measured, never declared.'), { stage: null, measured: true });
  assert.equal(parsePublishedStage('Today the repositories are at stage 2.').stage, 2);
  assert.equal(parsePublishedStage('no stage here').stage, null);
});

test('US-20-R10 and T20-6: a published stage above the computed stage is reported and an equal or lower one is accepted', async () => {
  const db = makeDb(MIGS); seed(db);
  const failing = await compute(db, { ...good, stage2: async () => ({ result: 'fail' }) });
  const bad = checkPublished({ published: { stage: 3, measured: false }, computed: failing });
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /published stage 3 exceeds the computed stage 1/);
  assert.equal(checkPublished({ published: 1, computed: failing }).ok, true);
  assert.equal(checkPublished({ published: 0, computed: failing }).ok, true);
  const strict = checkPublished({ published: 2, computed: await compute(db, good, { min_ticks: 3 }), strict: true });
  assert.equal(strict.ok, false, 'with no independent probe the claim is held at 0');
  assert.match(strict.problems[0], /independently confirmed/);
  assert.equal(checkPublished({ published: { stage: null, measured: true }, computed: null }).ok, false, '"measured" needs a computation behind it');
});

test('the stage step writes the stage, files an item for the first missing stage and closes it when the evidence holds', async () => {
  const db = makeDb(MIGS); seed(db);
  let stage2 = { result: 'fail' };
  const step = stageStep({ db, now: () => NOW, probes: { ...good, stage2: async () => stage2 }, config });
  const notes = [];
  await step.run(db, { notes });
  assert.equal(JSON.parse(db.raw.prepare(`SELECT value FROM org WHERE key='self_hosting_stage'`).get().value).stage, 1);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='STAGE-2'`).get().status, 'open');
  assert.match(notes[0], /stage 2 lacks evidence/);
  stage2 = { result: 'pass' };
  await step.run(db, { notes });
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='STAGE-2'`).get().status, 'done');
});
