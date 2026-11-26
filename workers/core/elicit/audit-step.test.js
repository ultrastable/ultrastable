// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The ignorance audit as a tick duty: default inputs, triggers, an independent or floor red team (US-SPEC-16 section 6, R24, T16-9, T16-12).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as predict from '../predict/index.js';
import { createElicit } from './index.js';
import { auditInputs, auditDue, elicitAuditStep, MODEL_ROUTE_ITEM, MODEL_ROUTE_PROBE } from './audit-step.js';

const dir = p => fileURLToPath(new URL(p, import.meta.url));
const CATALOG = JSON.parse(readFileSync(dir('../walkthrough/catalog.json'), 'utf8'));
const MIGS = [dir('./migrations/'), dir('./outcomes/migrations/'), dir('../predict/migrations/')];
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const P = 'demo';
const mk = () => { const db = makeDb(MIGS); const t = { v: T0 }; return { db, t, e: createElicit({ db, now: () => t.v, config: { defer_below: 0, max_open: 20, daily_cap: 99 } }) }; };
const stepRun = async (step, db) => { const ctx = { notes: [] }; await step.run(db, ctx); return ctx.notes; };
const fakeModel = family => async ({ prompt }) => ({ family, findings: [{ pass: 'red_team', q: 2, challenge: `Seen through "${prompt.slice(0, 20)}": nobody has said what happens to the visitors' emails.`, falsifier: 'a log showing it', severity: 2 }] });

test('T16-9 and US-16-R24: the audit with no caller input still leaves evidence for the catalog and analogy sweeps, from the default data', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, CATALOG.needs, { idea: 'a page for my chess club' });
  const inputs = auditInputs({ mode: 'hybrid', catalog: CATALOG });
  assert.ok(inputs.required_fields.length > 10 && inputs.analogies.length >= 10);
  assert.ok(!inputs.required_fields.some(f => f.field === 'definition_of_done_probe'), 'a field the managers fill is not asked about');
  const r = await e.audit(P, inputs);
  assert.equal(r.ran.includes('catalog') && r.ran.includes('analogy'), true); assert.equal(r.new_needs, 0, 'every required field is fed by a catalog need or filled by the managers');
  assert.equal(db.raw.prepare("SELECT evidence FROM elicit_audit WHERE sweep='analogy' LIMIT 1").get().evidence, 'no source');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM gate_cards WHERE what LIKE 'needs a qualified professional%'").get().n, 0, 'professional topics are risks, not owner cards, unless blocking');
  assert.ok(db.raw.prepare("SELECT COUNT(*) AS n FROM elicit_audit WHERE disposition='needs_professional'").get().n >= 3);
});

test('T16-12 and US-16-R24: an audit is due at G1 readiness, at a gate entry and after a new failed prediction, and not otherwise', async () => {
  const { db, t, e } = mk(); await e.registerNeeds(P, [{ id: 'a', label: 'A', artifact: 'A-INI-2', question: 'Which a?', why: 'It changes a.', cue: 'Most pick first.', options: ['first', 'second'], default: 'first', default_consequence: 'redo a' }]);
  const ports = { db, elicit: e };
  assert.deepEqual(await auditDue(ports, P), { due: false, reason: null });
  await e.nextAsks(P); await e.answer(P, 'a', { choice: 'second' });
  assert.deepEqual(await auditDue(ports, P), { due: true, reason: 'g1' });
  await e.audit(P, { trigger: 'g1' });
  assert.equal((await auditDue(ports, P)).due, false);
  assert.deepEqual(await auditDue(ports, P, { gate: 'G2' }), { due: true, reason: 'gate:G2' });
  await e.audit(P, { trigger: 'gate:G2' });
  assert.equal((await auditDue(ports, P, { gate: 'G2' })).due, false);
  t.v += 3600e3;
  await predict.recordDecision(db, { id: 'D1', decision: 'x', predicted_outcome: 'm >= 1 within 1 h', revert_path: 'undo' }, { now: T0 });
  await predict.scoreDue(db, { now: t.v + 7200e3, metrics: { m: async () => 0 } });
  assert.deepEqual(await auditDue(ports, P), { due: true, reason: 'surprise' });
  await e.audit(P, { trigger: 'surprise' });
  assert.equal((await auditDue(ports, P)).due, false, 'a failed prediction is a lesson once');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM elicit_audit WHERE finding LIKE 'failed prediction P-D1%'").get().n, 1);
});

test('T16-12: with a fake model of another family the red-team sweep is recorded with its family; with none the floor runs and one item is filed, once', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, [{ id: 'a', label: 'A', artifact: 'A-INI-2', question: 'Which a?', why: 'It changes a.', cue: 'Most pick first.', options: ['first', 'second'], default: 'first', default_consequence: 'redo a' }]);
  await e.nextAsks(P); await e.answer(P, 'a', { choice: 'second' });
  const withModel = elicitAuditStep({ db, elicit: e, catalog: CATALOG, model: fakeModel('family-b'), author_family: 'family-a' });
  const notes = await stepRun(withModel, db);
  assert.match(notes[0], /elicit audit demo \(g1\): complete/);
  assert.equal(db.raw.prepare("SELECT evidence FROM elicit_audit WHERE sweep='redteam' LIMIT 1").get().evidence, 'model family: family-b');
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM items WHERE id=?').get(MODEL_ROUTE_ITEM).n, 0);
  assert.ok(db.raw.prepare(MODEL_ROUTE_PROBE).get()['COUNT(*)'] >= 1, 'the closing probe of the live act reads a known, non-floor family');
  assert.deepEqual(await stepRun(withModel, db), [], 'nothing is due the second time');

  const bare = mk(); await bare.e.registerNeeds(P, [{ id: 'a', label: 'A', artifact: 'A-INI-2', question: 'Which a?', why: 'It changes a.', cue: 'Most pick first.', options: ['first', 'second'], default: 'first', default_consequence: 'redo a' }]);
  await bare.e.nextAsks(P); await bare.e.answer(P, 'a', { choice: 'second' });
  const noModel = elicitAuditStep({ db: bare.db, elicit: bare.e, catalog: CATALOG, model: null });
  assert.match((await stepRun(noModel, bare.db))[0], /incomplete.*red team not independent/);
  assert.match(bare.db.raw.prepare("SELECT evidence FROM elicit_audit WHERE sweep='redteam' LIMIT 1").get().evidence, /model family: none \(rule floor\); no independent model available/);
  assert.equal(bare.db.raw.prepare('SELECT COUNT(*) AS n FROM items WHERE id=?').get(MODEL_ROUTE_ITEM).n, 1);
  await bare.e.audit(P, { trigger: 'manual' }); await stepRun(noModel, bare.db);
  assert.equal(bare.db.raw.prepare('SELECT COUNT(*) AS n FROM items WHERE id=?').get(MODEL_ROUTE_ITEM).n, 1, 'one item, never a pile');
  assert.equal(bare.db.raw.prepare(MODEL_ROUTE_PROBE).get()['COUNT(*)'], 0, 'the floor never satisfies the live probe');
});

test('T16-9: a model of the author\'s family, or an unknown family when the author\'s is known, is not accepted as the independent sweep', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, [{ id: 'a', label: 'A', artifact: 'A-INI-2', question: 'Which a?', why: 'It changes a.', cue: 'Most pick first.', options: ['first', 'second'], default: 'first', default_consequence: 'redo a' }]);
  await assert.rejects(() => e.audit(P, { redteam: async () => ({ family: 'family-a', points: [] }), author_family: 'family-a' }), /different model family/);
  const unknown = await e.audit(P, { redteam: async () => ({ points: [] }), author_family: 'family-a' });
  assert.equal(unknown.independent, false); assert.equal(unknown.complete, false);
  assert.match(db.raw.prepare("SELECT evidence FROM elicit_audit WHERE sweep='redteam' ORDER BY id DESC LIMIT 1").get().evidence, /unverified independence/);
  // US-16 section 6 (R24): independence is a known family that is not the author's. With the author's family unknown nothing can be called independent.
  const noAuthor = await e.audit(P, { redteam: async () => ({ family: 'x', points: [] }) });
  assert.equal(noAuthor.independent, false); assert.equal(noAuthor.complete, false);
  assert.match(db.raw.prepare("SELECT evidence FROM elicit_audit WHERE sweep='redteam' ORDER BY id DESC LIMIT 1").get().evidence, /author family unknown; unverified independence/);
  assert.equal(db.raw.prepare(MODEL_ROUTE_PROBE).get()['COUNT(*)'], 0, 'an unverified family never satisfies the live probe');
  const failing = elicitAuditStep({ db, elicit: e, catalog: CATALOG, model: async () => { throw new Error('endpoint down'); }, author_family: 'family-a' });
  await e.nextAsks(P); await e.answer(P, 'a', { choice: 'second' });
  const notes = await stepRun(failing, db);
  assert.match(notes.join(' '), /model route failed \(endpoint down\); the rule floor ran instead/);
});

test('US-16-R24: the author\'s family is compared as a name, not a spelling: another case or stray spaces are still the author\'s family', async () => {
  const { db, e } = mk(); await e.registerNeeds(P, [{ id: 'a', label: 'A', artifact: 'A-INI-2', question: 'Which a?', why: 'It changes a.', cue: 'Most pick first.', options: ['first', 'second'], default: 'first', default_consequence: 'redo a' }]);
  for (const spelled of ['Claude', ' claude ', 'CLAUDE']) {
    await assert.rejects(() => e.audit(P, { redteam: async () => ({ family: spelled, points: [] }), author_family: 'claude' }), /different model family/, `"${spelled}" is the author's family`);
    await assert.rejects(() => e.audit(P, { redteam: async () => ({ family: 'claude', points: [] }), author_family: spelled }), /different model family/, `an author written "${spelled}" is the same family`);
  }
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM elicit_audit WHERE sweep='redteam'").get().n, 0, 'a refused sweep leaves no independent-looking row');
  const ok = await e.audit(P, { analogies: [{ item: 'who recovers it when it breaks' }], redteam: async () => ({ family: ' Gemma ', points: [] }), author_family: 'Claude' });
  assert.equal(ok.independent, true); assert.equal(ok.complete, true);
  assert.match(db.raw.prepare("SELECT evidence FROM elicit_audit WHERE sweep='redteam' ORDER BY id DESC LIMIT 1").get().evidence, /^model family: Gemma$/);
  const none = await e.audit(P, { required_fields: [] });
  assert.equal(none.independent, false, 'with no red-team sweep nothing is independent'); assert.ok(none.missing_sweeps.includes('redteam'));
});

test('T16-12 and US-16-R24: a failed prediction graded after the last audit makes an audit due and becomes one lesson, though its due time is older than that audit', async () => {
  const { db, t, e } = mk(); await e.registerNeeds(P, [{ id: 'a', label: 'A', artifact: 'A-INI-2', question: 'Which a?', why: 'It changes a.', cue: 'Most pick first.', options: ['first', 'second'], default: 'first', default_consequence: 'redo a' }]);
  await e.nextAsks(P); await e.answer(P, 'a', { choice: 'second' });
  db.raw.prepare("INSERT INTO predictions (id, metric, op, target, due_at) VALUES ('7', 'plan_holds', '>=', 1, ?)").run('2026-11-12 11:00:00');
  await e.audit(P, { trigger: 'g1' }); // the audit runs at 12:00, after the due time and before the grade
  assert.deepEqual(await auditDue({ db, elicit: e }, P), { due: false, reason: null });
  db.raw.prepare("UPDATE predictions SET verdict='miss' WHERE id='7'").run();
  t.v += 3600e3;
  assert.equal((await e.surprisesSince(P)).length, 1);
  assert.deepEqual(await auditDue({ db, elicit: e }, P), { due: true, reason: 'surprise' });
  await e.audit(P, { trigger: 'surprise' });
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM elicit_audit WHERE finding LIKE 'failed prediction 7:%'").get().n, 1);
  assert.deepEqual(await auditDue({ db, elicit: e }, P), { due: false, reason: null }, 'a miss becomes a lesson once');
});
