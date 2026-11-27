// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { buildConsole, resolveCard, recordAsk, handleConsole } from '../src/console.js';
import { runConsoleConformance } from './console-conformance.js';
import { CONSOLE_HTML } from '../src/console-ui.js';

function seed(db) {
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('A','Build the booking page','staff','x','ready'),('B','Old thing','staff','x','done');
    INSERT INTO items (id,title,owner_role,done_check,status,blocker) VALUES ('C','Needs a thing','staff','x','blocked','waiting on D');
    INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','Approve a monthly spend of 50 USD','money','spend stays at zero','manual'),('G2','Set the CLOUDFLARE_API_TOKEN secret','identity','dry run only','env:CLOUDFLARE_API_TOKEN');
    INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total,report) VALUES ('2026-11-11T00:00:00Z','2026-11-11T00:00:01Z',11,11,'ok');`);
}

test('T18-6 and US-18-R05: three screens are small and say what needs the person', async () => {
  const db = makeDb(); seed(db);
  const c = await buildConsole(db);
  assert.match(c.headline, /2 things need you/);
  assert.equal(c.needs_you.cards.length, 2);
  assert.ok(c.needs_you.cards.every(x => x.kind === 'manual' || x.kind === 'secret'));
  assert.equal(c.now.working_on.length, 1); assert.equal(c.now.stuck[0].id, 'C');
  assert.ok(c.suggestions.length <= 3);
});

test('T18-4 and US-18-R09: a manual card closes by button and the press is recorded; a secret card cannot be closed by button', async () => {
  const db = makeDb(); seed(db);
  assert.equal((await resolveCard(db, 'G1', 'done')).status, 200);
  assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id='G1'").get().status, 'closed');
  assert.equal(db.raw.prepare("SELECT kind FROM console_actions").get().kind, 'card_done');
  const r = await resolveCard(db, 'G2', 'done');
  assert.equal(r.status, 409); assert.match(r.body.explain, /only you can add/);
  assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id='G2'").get().status, 'open');
  assert.equal((await resolveCard(db, 'NOPE', 'done')).status, 404);
});

test('T18-5 and US-18-R03: a typed request becomes a work item with the words kept verbatim; out-of-scope requests are held', async () => {
  const db = makeDb(); seed(db);
  const ok = await recordAsk(db, 'I want a page where neighbours can book a drill');
  assert.equal(ok.body.held, false);
  assert.equal(db.raw.prepare("SELECT status FROM items WHERE id=?").get(ok.body.id).status, 'open');
  const held = await recordAsk(db, 'Please write my business plan and a pitch deck');
  assert.equal(held.body.held, true); assert.match(held.body.message, /does not do by default/);
  const it = db.raw.prepare("SELECT status, blocker FROM items WHERE id=?").get(held.body.id);
  assert.equal(it.status, 'blocked'); assert.match(it.blocker, /SCOPE\.md/);
  assert.equal(db.raw.prepare("SELECT text FROM console_actions WHERE ref=?").get(held.body.id).text, 'Please write my business plan and a pitch deck');
  assert.equal((await recordAsk(db, '   ')).status, 400);
});

test('T18-1, T18-2, US-18-R09 and US-18-R13: console is off without a token, refuses a wrong key, and refuses cross-origin writes', async () => {
  const db = makeDb(); seed(db);
  const U = 'https://x.example';
  assert.equal((await handleConsole(new Request(U + '/console'), { DB: db })).status, 503);
  const env = { DB: db, CONSOLE_TOKEN: 'correct-horse' };
  assert.equal((await handleConsole(new Request(U + '/api/console'), env)).status, 401);
  const bad = new Request(U + '/console/login', { method: 'POST', body: new URLSearchParams({ key: 'nope' }) });
  assert.equal((await handleConsole(bad, env)).status, 401);
  const good = await handleConsole(new Request(U + '/console/login', { method: 'POST', body: new URLSearchParams({ key: 'correct-horse' }) }), env);
  assert.equal(good.status, 303);
  const ck = good.headers.get('set-cookie'); assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Strict/);
  const cookie = ck.split(';')[0];
  const api = await handleConsole(new Request(U + '/api/console', { headers: { cookie } }), env);
  assert.equal(api.status, 200); assert.equal((await api.json()).needs_you.cards.length, 2);
  const page = await handleConsole(new Request(U + '/console', { headers: { cookie } }), env);
  assert.equal(page.status, 200); assert.match(await page.text(), /Say what you want/);
  const post = (origin) => handleConsole(new Request(U + '/api/console/ask', { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify({ text: 'hello' }) }), env);
  assert.equal((await post(null)).status, 403);
  assert.equal((await post('https://evil.example')).status, 403);
  assert.equal((await post(U)).status, 200);
  assert.equal(await handleConsole(new Request(U + '/health'), env), null);
});

// T18-7: the same suite runs against the in-process handler here; adapters/gcp runs it against Cloud Run (integration request).
const inProcess = {
  name: 'in-process',
  async boot({ token }) {
    const db = makeDb();
    const env = token ? { DB: db, CONSOLE_TOKEN: token } : { DB: db };
    return { call: (path, init = {}) => handleConsole(new Request(ORIGIN_ + path, init), env), sql: s => db.raw.exec(s), close() {} };
  },
};
const ORIGIN_ = 'https://x.example';
runConsoleConformance(test, inProcess);

test('US-18-R10: the console page loads nothing from another host, inserts text only with textContent and carries a strict content policy', async () => {
  assert.ok(!/<script[^>]*\ssrc=/i.test(CONSOLE_HTML) && !/<link[^>]*href=/i.test(CONSOLE_HTML) && !/<img[^>]*src=/i.test(CONSOLE_HTML));
  assert.ok(!/https?:\/\/[a-z0-9]/i.test(CONSOLE_HTML), 'no URL naming a host');
  assert.ok(!/@import|url\(/i.test(CONSOLE_HTML));
  assert.ok(!/innerHTML|outerHTML|document\.write|insertAdjacentHTML/.test(CONSOLE_HTML));
  const db = makeDb(); const env = { DB: db, CONSOLE_TOKEN: 'k' };
  const login = await handleConsole(new Request('https://x.example/console/login', { method: 'POST', body: new URLSearchParams({ key: 'k' }) }), env);
  const res = await handleConsole(new Request('https://x.example/console', { headers: { cookie: login.headers.get('set-cookie').split(';')[0] } }), env);
  assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(res.headers.get('cache-control'), /no-store/);
});

test('US-18-R07: every decision card says what happens if the person does nothing, on the data and on the page', async () => {
  const db = makeDb(); seed(db);
  const c = await buildConsole(db);
  assert.ok(c.needs_you.cards.length > 0 && c.needs_you.cards.every(x => x.default_in_effect && x.default_in_effect.length > 3));
  assert.match(CONSOLE_HTML, /If you do nothing: /);
});

const O2 = 'https://org.example';
const signedIn = async env => {
  const login = await handleConsole(new Request(O2 + '/console/login', { method: 'POST', body: new URLSearchParams({ key: 'k' }) }), env);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return path => handleConsole(new Request(O2 + path, { headers: { cookie } }), env);
};

test('US-18-R20: the records route drops every secret-shaped column and returns nothing for a table with no readable column, whatever the table', async () => {
  const db = makeDb();
  db.raw.exec(`CREATE TABLE lifecycle_probe (id INTEGER PRIMARY KEY, note TEXT, api_token TEXT, client_secret TEXT, password_hash TEXT, credential_ref TEXT, signing_key TEXT);
    INSERT INTO lifecycle_probe (note, api_token, client_secret, password_hash, credential_ref, signing_key) VALUES ('hello', 'tok-AAA111', 'sec-BBB222', 'hash-CCC333', 'cred-DDD444', 'key-EEE555');
    CREATE TABLE lifecycle_onlysecret (api_token TEXT); INSERT INTO lifecycle_onlysecret VALUES ('tok-ZZZ');`);
  const get = await signedIn({ DB: db, CONSOLE_TOKEN: 'k' });
  const res = await get('/api/console/records?table=lifecycle_probe');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.columns, ['id', 'note'], 'only the columns that do not look like secrets are served');
  assert.deepEqual(body.rows.map(r => Object.keys(r).sort()), [['_rowid', 'id', 'note']]);
  const text = JSON.stringify(body);
  for (const v of ['tok-AAA111', 'sec-BBB222', 'hash-CCC333', 'cred-DDD444', 'key-EEE555']) assert.ok(!text.includes(v), `${v} is not served`);
  const nd = await (await get('/api/console/records?table=lifecycle_probe&format=ndjson')).text();
  assert.ok(!/tok-|sec-|hash-|cred-|key-E/.test(nd), 'the ndjson form drops them too');
  assert.equal((await get('/api/console/records?table=lifecycle_onlysecret')).status, 404, 'a table with nothing readable is refused');
});

test('US-18-R05 and T18-3: five open decision cards show three, say exactly "and 2 more", count five in the headline, and a typed "what do you need" counts five', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total) VALUES ('2026-11-11 00:00:00','2026-11-11 00:00:01',11,11)`);
  for (let i = 1; i <= 5; i++) db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G${i}','Decision ${i}','x','waits','manual')`);
  const c = await buildConsole(db);
  assert.equal(c.needs_you.cards.length, 3); assert.equal(c.needs_you.more, 2);
  assert.match(c.headline, /^Running well\. 5 things need you\.$/);
  const answer = (await recordAsk(db, 'What do you need from me?')).body.answer;
  assert.match(answer, /^5 things need you: Decision 1; Decision 2; Decision 3; and 2 more on the Needs you screen\.$/);
  db.raw.exec(`UPDATE gate_cards SET status='closed' WHERE id IN ('G3','G4','G5')`);
  const two = await buildConsole(db); assert.equal(two.needs_you.more, 0); assert.match(two.headline, /2 things need you/);
  db.raw.exec(`UPDATE gate_cards SET status='closed' WHERE id='G2'`);
  assert.match((await buildConsole(db)).headline, /1 thing needs you/);
});

test('US-18-R03 and R19: a request that only contains question words is stored and becomes work; the standing questions, however punctuated, are answered and create none', async () => {
  const db = makeDb();
  for (const said of ['What should be done about the logo colours?', 'What is the best colour for me?', 'What do you want for me to write on the about page?', 'How do I make the page load well',
    'What should I be doing about taxes', 'What is the stuck-on-mobile bug', 'Please add a page; what is done is fine', 'What is stuck? Also add a map of the grounds']) {
    const r = await recordAsk(db, said);
    assert.equal(r.status, 200, said); assert.ok(!r.body.answered, `"${said}" is a request, not a standing question`); assert.equal(r.body.held, false);
    const item = db.raw.prepare('SELECT title, status FROM items WHERE id=?').get(r.body.id);
    assert.equal(item.status, 'open'); assert.ok(item.title.startsWith('Request: '));
    assert.equal(db.raw.prepare('SELECT text FROM console_actions WHERE ref=?').get(r.body.id).text, said, 'stored whole');
  }
  for (const [said, screen] of [['what is stuck', 'now'], ["What's  STUCK?!", 'now'], ['Please, tell me what is blocked.', 'now'], ['anything you need from me', 'needs'], ['what did you finish lately?', 'prog'], ['how is it going', 'prog'], ['Where are things?', 'now']]) {
    const before = db.raw.prepare('SELECT COUNT(*) AS n FROM items').get().n;
    const r = await recordAsk(db, said);
    assert.equal(r.body.answered, true, said); assert.equal(r.body.screen, screen, said);
    assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM items').get().n, before, 'a question creates no work');
  }
});
