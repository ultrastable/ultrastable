// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-18 principles that span the console (core/src/console.js) and the walkthrough: buttons first (R02), prompt second
// (R03), suggestions (R04), open outputs (R08), and the scope hold of US-00-R09.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createElicit } from '../elicit/index.js';
import { buildConsole, recordAsk, resolveCard, handleConsole } from '../src/console.js';
import { CONSOLE_HTML } from '../src/console-ui.js';
import { createWalkthrough, compose } from './index.js';
import { plain } from './plain.js';

const dir = p => fileURLToPath(new URL(p, import.meta.url));
const CATALOG = JSON.parse(readFileSync(dir('./catalog.json'), 'utf8'));
const T0 = Date.UTC(2026, 10, 15, 12, 0, 0);
const mk = () => { const db = makeDb([dir('../elicit/migrations/'), dir('./migrations/')]); const now = () => T0; return { db, wt: createWalkthrough({ db, elicit: createElicit({ db, now, config: { daily_cap: 20, max_open: 9, defer_below: 0 } }), now, config: { catalog: CATALOG } }) }; };

test('US-18-R02: every walkthrough step can be completed with no typing: suggestions on the first question, buttons on every card, Not sure on free-text ones', async () => {
  const { wt } = mk();
  const first = await wt.current('ana');
  assert.ok(first.suggestions.length >= 1);
  await wt.submitIdea('ana', first.suggestions[0]);
  let seen = 0;
  for (let i = 0; i < 12; i++) {
    const s = await wt.current('ana');
    if (s.kind !== 'ask') { assert.equal(s.kind, 'readback'); break; }
    seen++;
    assert.ok(s.card.buttons.includes('Not sure') && s.card.buttons.includes('Tell me more'), s.card.need_id);
    if (!s.card.free_text) assert.ok(s.card.buttons.length >= 4, 'at least two options plus the two standing buttons');
    assert.equal((await wt.answer('ana', s.card.need_id, { choice: 'Not sure' })).ok, true);
  }
  assert.ok(seen >= 5);
  assert.match(CONSOLE_HTML, /<button/); assert.match(CONSOLE_HTML, /id="chips"/);
});

test('US-18-R03 and T18-5: typed text is stored verbatim and becomes a work item; an out-of-scope request is held and is not dispatchable (US-00-R09)', async () => {
  const { db } = mk();
  const said = 'Could the page  also list the club champions since 1990?';
  const ok = await recordAsk(db, said);
  assert.equal(ok.body.held, false);
  assert.equal(db.raw.prepare(`SELECT text FROM console_actions WHERE ref=?`).get(ok.body.id).text, said);
  assert.equal(db.raw.prepare(`SELECT status, owner_role FROM items WHERE id=?`).get(ok.body.id).status, 'open');
  const held = await recordAsk(db, 'Write me a business plan for investors');
  assert.equal(held.body.held, true); assert.match(held.body.message, /does not do by default/);
  const item = db.raw.prepare(`SELECT status, blocker FROM items WHERE id=?`).get(held.body.id);
  assert.equal(item.status, 'blocked'); assert.match(item.blocker, /Out of scope by default \(SCOPE\.md\): a business plan/);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM items WHERE id=? AND status IN ('open','ready','claimed')`).get(held.body.id).n, 0);
  assert.match(CONSOLE_HTML, /id="asktext"/, 'the prompt box is part of the one page every screen shares');
});

test('US-18-R04: the prompt box comes with at most three suggested requests', async () => {
  const { db } = mk();
  const c = await buildConsole(db, {});
  assert.ok(c.suggestions.length >= 1 && c.suggestions.length <= 3);
});

test('US-18-R08 and T18-6: the same facts the screens show are served as records at GET /api/console, to a person or an agent alike', async () => {
  const { db } = mk();
  db.raw.exec(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('2026-11-15 12:00:00','2026-11-15 12:00:01',8,8);
    INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('A','a','staff','x','ready'),('B','b','staff','x','done');
    INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G','Approve','money','stays zero','manual')`);
  const res = await handleConsole(new Request('https://org.example/api/console', { headers: { cookie: 'us_console=k3y' } }), { DB: db, CONSOLE_TOKEN: 'k3y' }, { org: 'example', now: () => T0 });
  assert.equal(res.status, 200);
  const served = await res.json(); const shown = await buildConsole(db, { org: 'example' });
  for (const k of ['headline', 'now', 'needs_you', 'progress', 'suggestions']) assert.deepEqual(served[k], shown[k], k);
  assert.equal((await handleConsole(new Request('https://org.example/api/console'), { DB: db, CONSOLE_TOKEN: 'k3y' }, { now: () => T0 })).status, 401);
});

const O = 'https://org.example';
const seedMany = db => {
  const rows = [`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('2026-11-15 12:00:00','2026-11-15 12:00:01',8,8);`];
  for (let i = 1; i <= 7; i++) rows.push(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('W${i}','Working thing ${i}','portfolio-manager','x','ready');`);
  for (let i = 1; i <= 7; i++) rows.push(`INSERT INTO items (id,title,owner_role,done_check,status,blocker) VALUES ('S${i}','Stuck thing ${i}','staff','x','blocked','waiting on ELICIT-RERUN-DEMO-CHARTER and Q-PARITY-4');`);
  for (let i = 1; i <= 9; i++) rows.push(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('D${i}','Finished thing ${i}','staff','x','done');`);
  rows.push(`INSERT INTO trust_ledger (surface,action_class,rung,reliability) VALUES ('repo','open_pr','observed',0.99),('repo','branch_commit_push','assisted',0.95),('repo','merge','delegated',0.9),('repo','deploy','autonomous',0.8),('loops','close','self-directed',0.7),('console','ask','self-modifying',0.6),('docs','publish','self-extending',0.5)`);
  db.raw.exec(rows.join('\n'));
};

test('T18-8 and US-18-R09: pressing I did it or Use the default on an elicit gate card changes nothing, explains, and only answering the need closes the card', async () => {
  const { db, wt } = mk(); await wt.submitIdea('ana', 'a page for my chess club'); await wt.current('ana');
  const id = db.raw.prepare("SELECT id FROM gate_cards WHERE closing_probe LIKE 'elicit_answered:%'").get().id;
  assert.equal((await buildConsole(db)).needs_you.cards.find(c => c.id === id).kind, 'ask');
  for (const choice of ['done', 'default']) {
    const r = await resolveCard(db, id, choice);
    assert.equal(r.status, 409); assert.match(r.body.error, /closes when you answer it/); assert.match(r.body.explain, /only you can answer/);
  }
  assert.equal(db.raw.prepare('SELECT status FROM gate_cards WHERE id=?').get(id).status, 'open');
  assert.equal(db.raw.prepare("SELECT state FROM elicit_needs WHERE id='private_details'").get().state, 'gated');
  const ex = await resolveCard(db, id, 'explain');
  assert.equal(ex.status, 200); assert.ok(ex.body.explain.length > 20);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM console_actions').get().n, 1, 'only the idea record; no press was recorded as a card action');
  assert.equal((await wt.answer('ana', 'private_details', { choice: 'No' })).ok, true);
  assert.equal(db.raw.prepare('SELECT status FROM gate_cards WHERE id=?').get(id).status, 'closed');
});

test('US-18-R09: explain on every card kind returns plain text and writes no console_actions row, even when signed in with a session', async () => {
  const db = makeDb([dir('../elicit/migrations/'), dir('./migrations/')]);
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('m','Approve the plan','x','it waits','manual'),('s','Set a key','x','dry run','env:SOME_KEY'),('q','Answer a question','x','it waits','elicit_answered:main:name')`);
  for (const id of ['m', 's', 'q']) { const r = await resolveCard(db, id, 'explain'); assert.equal(r.status, 200); assert.match(r.body.explain, /If you do nothing/); }
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM console_actions').get().n, 0);
});

test('T18-3 and US-18-R05: with 7 working, 7 stuck and 9 finished every list shows three (five finished) and an exact count of the rest', async () => {
  const db = makeDb([dir('../elicit/migrations/'), dir('./migrations/')]); seedMany(db);
  const d = await buildConsole(db);
  assert.deepEqual([d.now.working_on.length, d.now.working_on_more], [3, 4]);
  assert.deepEqual([d.now.stuck.length, d.now.stuck_more], [3, 4]);
  assert.deepEqual([d.progress.done_lately.length, d.progress.done_lately_more], [5, 4]);
  assert.equal(d.now.working_on.length + d.now.working_on_more, 7); assert.equal(d.now.stuck.length + d.now.stuck_more, 7); assert.equal(d.progress.done_lately.length + d.progress.done_lately_more, d.now.done);
});

test('US-18-R05: compose at brief detail keeps counts equal to what it removed; nothing is dropped silently', async () => {
  const { db, wt } = mk(); seedMany(db);
  const raw = await buildConsole(db);
  const brief = compose(raw, {});
  assert.deepEqual([brief.now.working_on.length, brief.now.working_on_more], [1, 6]);
  assert.deepEqual([brief.progress.done_lately.length, brief.progress.done_lately_more], [1, 8]);
  assert.equal(brief.progress.autonomy.length + brief.progress.autonomy_more, raw.progress.autonomy.length + raw.progress.autonomy_more);
  const more = compose(raw, { detail: 'more' });
  assert.deepEqual([more.now.working_on.length, more.now.working_on_more], [3, 4]);
});

test('US-18-R04: suggestions are drawn from the state and never exceed three; a surface at observed or assisted is not listed as acting on its own', async () => {
  const db = makeDb([dir('../elicit/migrations/'), dir('./migrations/')]);
  db.raw.exec(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('2026-11-15 12:00:00','2026-11-15 12:00:01',8,8)`);
  const empty = await buildConsole(db);
  assert.ok(!empty.suggestions.includes('What is stuck?') && !empty.suggestions.includes('What do you need from me?') && !empty.suggestions.includes('What did you finish?'));
  assert.ok(empty.suggestions.length >= 1 && empty.suggestions.length <= 3);
  seedMany(db);
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('g','Approve','x','waits','manual')`);
  const full = await buildConsole(db);
  assert.deepEqual(full.suggestions, ['What do you need from me?', 'What is stuck?', 'What did you finish?']);
  const acts = full.progress.autonomy.concat([]);
  assert.equal(acts.length, 3); assert.equal(full.progress.autonomy_more, 2);
  assert.ok(acts.every(a => !['observed', 'assisted'].includes(a.raw.rung)), JSON.stringify(acts));
  assert.deepEqual(acts.map(a => a.raw.rung), ['delegated', 'autonomous', 'self-directed']);
});

test('US-18-R06: no string shown on Now, Needs you or Progress contains a role id, surface and action class, rung name or item id; an unknown role still reads as words; raw ids stay under raw', async () => {
  const db = makeDb([dir('../elicit/migrations/'), dir('./migrations/')]); seedMany(db);
  const d = await buildConsole(db);
  const shown = [];
  for (const i of d.now.working_on) shown.push(i.title, i.owner);
  for (const i of d.now.stuck) shown.push(i.title, i.blocker);
  for (const i of d.progress.done_lately) shown.push(i.title);
  for (const i of d.progress.autonomy) shown.push(i.what, i.level);
  const text = shown.join('\n');
  for (const bad of ['portfolio-manager', 'branch_commit_push', 'open_pr', 'self-directed', 'self-modifying', 'delegated', 'ELICIT-RERUN', 'Q-PARITY-4', 'mystery-role_x']) assert.ok(!text.includes(bad), `shows ${bad}`);
  assert.match(text, /the planning manager/); assert.equal(plain('role', 'mystery-role_x'), 'the mystery role x role');
  assert.equal(d.now.working_on[0].raw.owner_role, 'portfolio-manager'); assert.equal(d.progress.autonomy[0].raw.surface, 'repo');
  assert.equal(plain('role', 'portfolio-manager'), 'the planning manager'); assert.equal(plain('rung', 'brand-new-rung'), 'brand new rung');
});

test('US-18-R03: a 3000-character request is stored verbatim; 4001 is refused with a message and nothing is stored', async () => {
  const db = makeDb([dir('../elicit/migrations/'), dir('./migrations/')]);
  const long = 'Please add a page. ' + 'x'.repeat(2981);
  const ok = await recordAsk(db, long);
  assert.equal(ok.status, 200); assert.equal(long.length, 3000);
  assert.equal(db.raw.prepare('SELECT text FROM console_actions WHERE ref=?').get(ok.body.id).text, long);
  const before = db.raw.prepare('SELECT COUNT(*) AS n FROM console_actions').get().n;
  const refused = await recordAsk(db, 'y'.repeat(4001));
  assert.equal(refused.status, 413); assert.match(refused.body.error, /two parts/);
  assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM console_actions').get().n, before);
});

test('US-18-R03 and US-18-R04: typing a question the screens already answer returns the answer from the records, is stored verbatim as a question and creates no item; anything else still becomes work', async () => {
  const db = makeDb([dir('../elicit/migrations/'), dir('./migrations/')]); seedMany(db);
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('g','Approve the plan','x','waits','manual')`);
  const items = () => db.raw.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  const n0 = items();
  const cases = [['What do you need from me?', /Approve the plan/, 'needs'], ['What is stuck?', /Stuck: Stuck thing 1/, 'now'], ['What did you finish?', /Finished lately: Finished thing/, 'prog'], ['What are you working on?', /Working on: Working thing 1/, 'now'], ['How well is it doing?', /Running well/, 'prog']];
  for (const [q, re, screen] of cases) {
    const r = await recordAsk(db, q);
    assert.equal(r.status, 200, q); assert.equal(r.body.answered, true, q); assert.match(r.body.answer, re, q); assert.equal(r.body.screen, screen, q);
  }
  assert.equal(items(), n0, 'no work item was created for a question');
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM console_actions WHERE kind='question'").get().n, 5);
  assert.equal(db.raw.prepare("SELECT text FROM console_actions WHERE kind='question' ORDER BY id LIMIT 1").get().text, 'What do you need from me?');
  const work = await recordAsk(db, 'Please add a map of the club grounds');
  assert.equal(work.body.answered, undefined); assert.equal(items(), n0 + 1);
  assert.match((await recordAsk(db, 'What is stuck?')).body.answer, /and 4 more/);
});

test('US-18-R08: an owner gets the rows of items and console_actions with their verbatim text; paging by next returns every row once; secrets and unknown tables are never served', async () => {
  const db = makeDb([dir('../elicit/migrations/'), dir('./migrations/')]); seedMany(db);
  await recordAsk(db, 'I want a page for the club, exactly as I said it');
  const env = { DB: db, CONSOLE_TOKEN: 'k' };
  const login = await handleConsole(new Request(O + '/console/login', { method: 'POST', body: new URLSearchParams({ key: 'k' }) }), env);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const get = async path => handleConsole(new Request(O + path, { headers: { cookie } }), env);
  const tables = (await (await get('/api/console/records')).json()).tables;
  assert.ok(tables.includes('items') && tables.includes('console_actions') && !tables.some(t => /vault|secret|session/.test(t)));
  const acts = await (await get('/api/console/records?table=console_actions')).json();
  assert.ok(acts.rows.some(r => r.text === 'I want a page for the club, exactly as I said it'));
  const seen = []; let after = 0;
  for (let i = 0; i < 10; i++) {
    const page = await (await get(`/api/console/records?table=items&limit=10&after=${after}`)).json();
    seen.push(...page.rows.map(r => r.id)); if (page.next === null) break; after = page.next;
  }
  assert.equal(seen.length, db.raw.prepare('SELECT COUNT(*) AS n FROM items').get().n); assert.equal(new Set(seen).size, seen.length);
  assert.equal((await get('/api/console/records?table=sqlite_master')).status, 404);
  assert.equal((await get('/api/console/records?table=walkthrough_state%22%3B--')).status, 404);
  const nd = await get('/api/console/records?table=items&format=ndjson&limit=5');
  assert.equal(nd.headers.get('content-type'), 'application/x-ndjson'); assert.equal((await nd.text()).trim().split('\n').length, 5);
  assert.equal((await handleConsole(new Request(O + '/api/console/records?table=items'), env)).status, 401);
  const post = await handleConsole(new Request(O + '/api/console/records?table=items', { method: 'POST', headers: { cookie, origin: O, 'content-type': 'application/json' }, body: '{}' }), env);
  assert.equal(post.status, 404, 'records are read-only');
  const hdr = db.raw.prepare("SELECT 1 FROM pragma_table_info('items') WHERE name LIKE '%token%' OR name LIKE '%secret%'").all();
  assert.deepEqual(hdr, [], 'no item column is secret-shaped (so the column filter is exercised by the table list, not hidden)');
});

test('US-18-R21 and US-18-R09: a card with an open owner link carries it and the page renders one button for it; a link with an unsafe scheme is not offered; without the table the card is unchanged', async () => {
  const db = makeDb([dir('../elicit/migrations/'), dir('./migrations/')]);
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('k','Add the model key','x','dry run only','env:SOME_KEY'),('j','Another','x','waits','manual')`);
  const plainCards = (await buildConsole(db)).needs_you.cards; assert.ok(plainCards.every(c => !('link' in c)));
  db.raw.exec(readFileSync(dir('../ownerlink/migrations/' + readdirSync(dir('../ownerlink/migrations/')).filter(f => f.endsWith('.sql')).sort()[0]), 'utf8'));
  db.raw.exec(`INSERT INTO ownerlink_actions (id,card_id,flow,title,link,created_at) VALUES ('a1','k','model','Add key','/owner/model','2026-11-15'),('a2','j','x','Bad','javascript:alert(1)','2026-11-15')`);
  const cards = (await buildConsole(db)).needs_you.cards;
  assert.equal(cards.find(c => c.id === 'k').link, '/owner/model'); assert.ok(!('link' in cards.find(c => c.id === 'j')));
  assert.match(CONSOLE_HTML, /okLink\(i\.link\)/);
  const cardsBefore = db.raw.prepare("SELECT status FROM gate_cards WHERE id='k'").get().status;
  assert.equal(cardsBefore, 'open', 'building the console closes nothing');
});
