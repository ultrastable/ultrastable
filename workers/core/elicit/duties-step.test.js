// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The elicitation duties of the tick (US-SPEC-16 R10, R20, R21, R27): nobody opens the walkthrough for them to happen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createElicit } from './index.js';
import { createResearch, RESEARCH_PROBE } from './research.js';
import { elicitDutiesStep } from './duties-step.js';

const dir = p => fileURLToPath(new URL(p, import.meta.url));
const MIGS = [dir('./migrations/'), dir('./outcomes/migrations/')];
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const need = (id, extra = {}) => ({ id, label: `Thing ${id}`, artifact: 'charter', question: `Which ${id} do you want?`, why: `This changes the ${id} we build.`, cue: 'Similar projects pick the first one.',
  options: ['first', 'second'], default: 'first', default_consequence: 'We rebuild one page; change it any time.', p_wrong: 0.5, ...extra });
const mk = () => { const db = makeDb(MIGS); const t = { v: T0 }; return { db, t, e: createElicit({ db, now: () => t.v, config: { defer_below: 0, max_open: 9, daily_cap: 99 } }) }; };
const stepRun = async (step, db) => { const ctx = { notes: [] }; await step.run(db, ctx); return ctx.notes; };
const state = (db, id, project = 'demo') => db.raw.prepare('SELECT state, provenance FROM elicit_needs WHERE project=? AND id=?').get(project, id);
const page = (status, body = '') => ({ status, text: async () => body });

test('US-16-R10: the tick step defaults every overdue Ask in every project with nobody opening the walkthrough, and only the overdue ones', async () => {
  const { db, t, e } = mk();
  await e.registerNeeds('one', [need('a')]); await e.registerNeeds('two', [need('b')]);
  await e.nextAsks('one'); t.v += 40 * 3600e3; await e.nextAsks('two'); // 'one' was asked 40 h before 'two'
  t.v += 40 * 3600e3; // 'one' is 80 h old (past 72 h), 'two' is 40 h old
  const notes = await stepRun(elicitDutiesStep({ db, elicit: e, now: () => t.v }), db);
  assert.equal(state(db, 'a', 'one').state, 'defaulted'); assert.equal(state(db, 'a', 'one').provenance, 'default');
  assert.equal(state(db, 'b', 'two').state, 'asked');
  assert.match(notes.join(' '), /1 overdue Ask fell to the default/);
  assert.deepEqual(await stepRun(elicitDutiesStep({ db, elicit: e, now: () => t.v }), db), [], 'a second pass has nothing to do and says nothing');
});

test('US-16-R20: the tick step finds a card that would leak jargon before a person sees it and files one item per card, once', async () => {
  const { db, e } = mk();
  await e.registerNeeds('demo', [need('a')]);
  db.raw.prepare("UPDATE elicit_needs SET question='Which database do you want?' WHERE id='a'").run();
  const step = elicitDutiesStep({ db, elicit: e });
  assert.match((await stepRun(step, db)).join(' '), /1 card break the card rules/);
  await stepRun(step, db);
  const items = db.raw.prepare("SELECT id, status, title FROM items WHERE id LIKE 'ELICIT-CARD-%'").all();
  assert.equal(items.length, 1); assert.equal(items[0].id, 'ELICIT-CARD-DEMO-A'); assert.equal(items[0].status, 'open'); assert.match(items[0].title, /jargon without definition: database/);
  db.raw.prepare("UPDATE elicit_needs SET question='Which of these do you want?' WHERE id='a'").run();
  assert.deepEqual(await stepRun(step, db), [], 'a clean card files nothing');
});

test('US-16-R21: with derive ports the tick step settles an open need from a record instead of asking it', async () => {
  const { db, e } = mk(); await e.registerNeeds('demo', [need('a'), need('b')]);
  const step = elicitDutiesStep({ db, elicit: e, derive: async project => ({ records: project === 'demo' ? { a: async () => 'second' } : {} }) });
  assert.match((await stepRun(step, db)).join(' '), /1 need derived for demo instead of asked/);
  assert.equal(state(db, 'a').state, 'derived'); assert.equal(state(db, 'b').state, 'open');
  const bad = elicitDutiesStep({ db, elicit: e, derive: async () => { throw new Error('port down'); } });
  assert.match((await stepRun(bad, db)).join(' '), /derivation for demo failed \(port down\)/);
});

test('US-16-R27: with a fetch port the tick step reads researched sources again and reopens a need whose source is gone, and the probe reads the survivors', async () => {
  const { db, e } = mk(); await e.registerNeeds('demo', [need('a'), need('b')]);
  const sources = { a: [{ url: 'https://example.org/a', options: { first: 'alpha' } }], b: [{ url: 'https://example.org/b', options: { first: 'alpha' } }] };
  await e.derive('demo', { research: createResearch({ fetch: async () => page(200, 'alpha'), sources }) });
  const f = async url => (url.endsWith('/b') ? page(410) : page(200, 'alpha'));
  const notes = await stepRun(elicitDutiesStep({ db, elicit: e, fetch: f }), db);
  assert.match(notes.join(' '), /1 researched need reopened in demo/);
  assert.equal(state(db, 'a').state, 'derived'); assert.equal(state(db, 'b').state, 'open');
  assert.equal(db.raw.prepare(RESEARCH_PROBE).get()['COUNT(*)'], 1);
});

test('US-16-R10: a duty that throws is noted and the others still run', async () => {
  const { db, t, e } = mk(); await e.registerNeeds('demo', [need('a')]); await e.nextAsks('demo'); t.v += 80 * 3600e3;
  const broken = { ...e, reviewAll: async () => { throw new Error('glossary unreadable'); }, expireAll: e.expireAll.bind(e) };
  const notes = await stepRun(elicitDutiesStep({ db, elicit: broken }), db);
  assert.match(notes.join(' '), /the card review failed \(glossary unreadable\)/);
  assert.equal(state(db, 'a').state, 'defaulted');
});
