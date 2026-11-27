// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-16 5.3 and R01: value-of-information estimates are logged as predictions, scored, and learned from outcomes (US-16-R32).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as predict from '../predict/index.js';
import { createElicit } from './index.js';

const dir = p => fileURLToPath(new URL(p, import.meta.url));
const MIGS = [dir('./migrations/'), dir('./outcomes/migrations/'), dir('../predict/migrations/')];
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const need = (id, extra = {}) => ({ id, label: `Thing ${id}`, artifact: 'charter', question: `Which ${id} do you want?`, why: `This changes the ${id} we build.`, cue: 'Similar projects pick the first one.',
  options: ['first', 'second', 'third'], default: 'first', default_consequence: 'We rebuild one page; change it any time.', p_wrong: 0.3, ...extra });
const mk = (config = {}, withPredict = true) => { const db = makeDb(MIGS); const t = { v: T0 }; return { db, t, e: createElicit({ db, now: () => t.v, config: { max_open: 9, daily_cap: 99, ...config }, predict: withPredict ? predict : null }) }; };

test('T16-10 and US-16-R32: asking a need logs a decision and a parsable prediction with confidence 1 - p_wrong and registers its metric', async () => {
  const { db, e } = mk(); await e.registerNeeds('demo', [need('colour')]); await e.nextAsks('demo'); await e.nextAsks('demo');
  const d = db.raw.prepare("SELECT * FROM predict_decisions WHERE id='ELICIT-VOI-demo-colour'").get();
  assert.equal(d.parsable, 1); assert.equal(d.decision_type, 'elicit_voi'); assert.ok(Math.abs(d.confidence - 0.7) < 1e-9); assert.match(d.revert_path, /read-back/);
  const p = db.raw.prepare("SELECT * FROM predict_predictions WHERE decision_id=?").get(d.id);
  assert.match(p.subject, /^elicit_default_held\.\d+$/); assert.equal(p.op, '>='); assert.equal(p.value, 1); assert.equal(p.due_at, '2026-11-16 12:00:00');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM predict_metrics WHERE name=?').get(p.subject).n, 1);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM predict_decisions').get().n, 1, 'asking again logs nothing new');
});

test('T16-10: after the person answers differently the scorer records a miss; answering with the default, Not sure or a timeout records a hit', async () => {
  const { db, t, e } = mk(); await e.registerNeeds('demo', [need('a'), need('b'), need('c'), need('d')]); await e.nextAsks('demo');
  await e.answer('demo', 'a', { choice: 'second' });          // changed the default: miss
  await e.answer('demo', 'b', { choice: 'first' });           // the default itself: hit
  await e.answer('demo', 'c', { choice: 'Not sure' });        // default taken: hit
  t.v += 73 * 3600e3; await e.expire('demo');                 // d times out to the default: hit
  t.v += 30 * 3600e3;
  await predict.scoreDue(db, { now: t.v });
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM predict_predictions WHERE matched IS NOT NULL').get().n, 4);
  const byNeed = Object.fromEntries(db.raw.prepare(`SELECT o.need_id AS n, p.matched AS m FROM predict_predictions p JOIN elicit_outcomes o ON p.subject = 'elicit_default_held.' || o.id`).all().map(x => [x.n, x.m]));
  assert.deepEqual(byNeed, { a: 0, b: 1, c: 1, d: 1 });
});

test('T16-10 and US-16-R01: after three agreeing stated answers across projects the fourth project derives the need from the record and does not ask it', async () => {
  const { db, e } = mk();
  for (const p of ['p1', 'p2', 'p3']) { await e.registerNeeds(p, [need('colour')]); await e.nextAsks(p); await e.answer(p, 'colour', { choice: 'third' }); db.raw.exec(`UPDATE elicit_needs SET answered_at='2026-11-1${p.slice(1)} 10:00:00' WHERE project='${p}'`); }
  await e.registerNeeds('p4', [need('colour')]);
  assert.deepEqual((await e.nextAsks('p4')).map(c => c.need_id), []);
  const row = db.raw.prepare("SELECT state, value, provenance, source FROM elicit_needs WHERE project='p4'").get();
  assert.deepEqual({ ...row }, { state: 'derived', value: 'third', provenance: 'derived', source: 'record: last 3 answers agree' });
  await e.registerNeeds('p5', [need('colour', { reversible: false })]); // a gated need is never derived from other people's answers
  await e.nextAsks('p5'); assert.equal(db.raw.prepare("SELECT state FROM elicit_needs WHERE project='p5'").get().state, 'gated');
  const mixed = mk(); for (const [p, v] of [['p1', 'third'], ['p2', 'second'], ['p3', 'third']]) { await mixed.e.registerNeeds(p, [need('colour')]); await mixed.e.nextAsks(p); await mixed.e.answer(p, 'colour', { choice: v }); }
  await mixed.e.registerNeeds('p4', [need('colour')]); assert.equal((await mixed.e.nextAsks('p4')).length, 1, 'answers that disagree teach nothing');
});

test('T16-10: the learned estimate replaces the catalog p_wrong only from five settled outcomes and the priority changes with it; five held defaults stop the asking', async () => {
  const { db, e } = mk({ learn_after: 5 });
  for (let i = 1; i <= 4; i++) { const p = `q${i}`; await e.registerNeeds(p, [need('colour', { p_wrong: 0.3 })]); await e.nextAsks(p); await e.answer(p, 'colour', { choice: i % 2 ? 'second' : 'first' }); }
  await e.registerNeeds('q5', [need('colour', { p_wrong: 0.3 })]); await e.nextAsks('q5');
  assert.equal(db.raw.prepare("SELECT p_wrong FROM elicit_needs WHERE project='q5'").get().p_wrong, 0.3, 'four outcomes are not enough');
  await e.answer('q5', 'colour', { choice: 'second' });
  await e.registerNeeds('q6', [need('colour', { p_wrong: 0.3 })]); await e.nextAsks('q6');
  const learned = db.raw.prepare("SELECT p_wrong, priority FROM elicit_needs WHERE project='q6'").get();
  assert.ok(Math.abs(learned.p_wrong - 4 / 7) < 1e-9, 'three of five changed the default: (3 + 1) / (5 + 2)');
  const held = mk({ learn_after: 5, agree_after: 99 });
  for (let i = 1; i <= 5; i++) { const p = `h${i}`; await held.e.registerNeeds(p, [need('colour')]); await held.e.nextAsks(p); await held.e.answer(p, 'colour', { choice: 'first' }); }
  await held.e.registerNeeds('h6', [need('colour')]); assert.deepEqual((await held.e.nextAsks('h6')).map(c => c.need_id), []);
  assert.equal(held.db.raw.prepare("SELECT reason FROM elicit_assumptions WHERE project='h6'").get().reason, 'learned_default');
});

test('T16-10: without a predict port and without config.outcomes nothing is written to the outcome tables and the register behaves as before', async () => {
  const db = makeDb([dir('./migrations/')]); const e = createElicit({ db, now: () => T0 });
  await e.registerNeeds('demo', [need('a'), need('b')]); const cards = await e.nextAsks('demo'); await e.answer('demo', 'a', { choice: 'second' });
  assert.deepEqual(cards.map(c => c.need_id), ['a', 'b']);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('elicit_outcomes','elicit_derivations','predict_decisions')").get().n, 0);
});
