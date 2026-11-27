// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The elicitation duties of the tick (US-SPEC-16 R10, R27, R29, R30): nobody opens the walkthrough for them to happen.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createElicit } from './index.js';
import { createResearch, RESEARCH_PROBE } from './research.js';
import { elicitDutiesStep } from './duties-step.js';
import { elicitMetrics, DEFAULT_HOLDS_METRIC } from './index.js';

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

test('US-16-R29: the tick step finds a card that would leak jargon before a person sees it and files one item per card, once; the item closes when the card is clean and reopens if it leaks again', async () => {
  const { db, e } = mk();
  await e.registerNeeds('demo', [need('a')]);
  db.raw.prepare("UPDATE elicit_needs SET question='Which database do you want?' WHERE id='a'").run();
  const step = elicitDutiesStep({ db, elicit: e });
  assert.match((await stepRun(step, db)).join(' '), /1 card break the card rules/);
  assert.deepEqual(await stepRun(step, db), [], 'a second pass over the same leak files nothing new and says nothing');
  const item = () => db.raw.prepare("SELECT id, status, title, disposition, closing_probe FROM items WHERE id LIKE 'ELICIT-CARD-%'").all();
  let items = item();
  assert.equal(items.length, 1); assert.equal(items[0].id, 'ELICIT-CARD-DEMO-A'); assert.equal(items[0].status, 'open'); assert.match(items[0].title, /jargon without definition: database/);
  assert.notEqual(items[0].closing_probe, 'manual', 'the item names the review that closes it');
  db.raw.prepare("UPDATE elicit_needs SET question='Which of these do you want?' WHERE id='a'").run();
  assert.match((await stepRun(step, db)).join(' '), /1 card item closed: the card passes the card rules/);
  items = item(); assert.equal(items[0].status, 'done'); assert.match(items[0].disposition, /card review finds no problem/);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM outcomes WHERE item_id='ELICIT-CARD-DEMO-A' AND result='verified'").get().n, 1, 'the close is recorded as a verified outcome');
  assert.deepEqual(await stepRun(step, db), [], 'a clean card files nothing and closes nothing twice');
  db.raw.prepare("UPDATE elicit_needs SET question='Which endpoint do you want?' WHERE id='a'").run();
  assert.match((await stepRun(step, db)).join(' '), /1 card break the card rules/);
  items = item(); assert.equal(items.length, 1); assert.equal(items[0].status, 'open', 'a card that leaks again reopens its item'); assert.match(items[0].title, /endpoint/);
});

test('US-16-R30: with derive ports the tick step settles an open need from a record instead of asking it', async () => {
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

test('US-16-R30: derivation through the host ports runs once per cadence: a pass inside it calls no port and writes no row, a need registered later is tried at once', async () => {
  const { db, t, e } = mk(); await e.registerNeeds('demo', [need('a')]);
  let calls = 0; const step = elicitDutiesStep({ db, elicit: e, now: () => t.v, derive: async () => { calls++; return { records: {} }; } });
  const rows = () => db.raw.prepare("SELECT COUNT(*) AS n FROM elicit_derivations WHERE surface IN ('record','probe','research')").get().n;
  await stepRun(step, db); const first = rows();
  assert.equal(calls, 1); assert.equal(first, 3, 'one attempt row per surface');
  for (let i = 0; i < 6; i++) { t.v += 10 * 60e3; await stepRun(step, db); }
  assert.equal(calls, 1, 'no port call inside the cadence'); assert.equal(rows(), first, 'no row inside the cadence');
  await e.registerNeeds('demo', [need('b')]); t.v += 10 * 60e3; await stepRun(step, db);
  assert.equal(calls, 2); assert.equal(rows(), first + 3, 'only the new need is tried');
  t.v += 24 * 3600e3; await stepRun(step, db);
  assert.equal(rows(), first + 9, 'after the cadence both needs are tried again');
});

test('US-16-R27: the tick step reads each cited source again at most once per cadence', async () => {
  const { db, t, e } = mk(); await e.registerNeeds('demo', [need('a')]);
  await e.derive('demo', { research: createResearch({ fetch: async () => page(200, 'alpha'), sources: { a: [{ url: 'https://example.org/a', options: { first: 'alpha' } }] } }) });
  const seen = []; const step = elicitDutiesStep({ db, elicit: e, now: () => t.v, fetch: async url => { seen.push(url); return page(200, 'alpha'); } });
  for (let i = 0; i < 6; i++) { await stepRun(step, db); t.v += 10 * 60e3; }
  assert.equal(seen.length, 1, 'six passes in an hour read the page once');
  t.v += 24 * 3600e3; await stepRun(step, db); assert.equal(seen.length, 2);
});

test('US-16-R19: a default prediction the tick cannot read files one item, which closes on the first pass whose tick carries the reader; rows in the older shape are rewritten', async () => {
  const { db, t, e } = mk(); await e.registerNeeds('demo', [need('a')]); await e.nextAsks('demo'); t.v += 80 * 3600e3;
  db.raw.prepare(`INSERT INTO predictions (id, metric, op, target, due_at) VALUES ('ELICIT-old-x', 'elicit_default_holds:old:x', '=', 1, '2026-12-01T00:00:00.000Z')`).run();
  const step = elicitDutiesStep({ db, elicit: e, now: () => t.v });
  const notes = (await stepRun(step, db)).join(' ');
  assert.match(notes, /1 default prediction rewritten so the kernel scorer can read it/);
  assert.match(notes, new RegExp(`the tick has no reader for ${DEFAULT_HOLDS_METRIC}; filed ELICIT-DEFAULT-METRIC`));
  const it = () => db.raw.prepare("SELECT status, owner_role, disposition FROM items WHERE id='ELICIT-DEFAULT-METRIC'").get();
  assert.equal(it().status, 'open'); assert.equal(it().owner_role, 'operations');
  assert.deepEqual(await stepRun(step, db), [], 'filed once');
  const wired = { notes: [], metrics: { ...elicitMetrics } }; await step.run(db, wired);
  assert.match(wired.notes.join(' '), /the tick now reads elicit_default_holds/);
  assert.equal(it().status, 'done'); assert.match(it().disposition, /the tick reads elicit_default_holds/);
});
