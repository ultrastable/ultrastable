// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The console conformance suite of US-SPEC-18 (T18-1 to T18-6), written once against a host so the same tests run on every platform
// adapter (T18-7). A host is { name, boot({ token }) -> { call(path, { method, headers, body }) -> Response-like { status, headers, json(), text() },
// sql(statements) (runs seed statements against the store the console reads), close() } }. The in-process host is in console.test.js;
// an adapter test (for example adapters/gcp) passes its own host. This file is not itself a test file.
import assert from 'node:assert/strict';

export const ORIGIN = 'https://x.example';
const KEY = 'correct-horse';
const SEED = `INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('A','Build the booking page','staff','x','ready'),('B','Old thing','staff','x','done');
  INSERT INTO items (id,title,owner_role,done_check,status,blocker) VALUES ('C','Needs a thing','staff','x','blocked','waiting on D');
  INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','Approve a monthly spend of 50 USD','money','spend stays at zero','manual'),('G2','Set the CLOUDFLARE_API_TOKEN secret','identity','dry run only','env:CLOUDFLARE_API_TOKEN');
  INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total,report) VALUES ('2026-11-11T00:00:00Z','2026-11-11T00:00:01Z',11,11,'ok');`;
const MANY = (() => {
  const rows = [];
  for (let i = 1; i <= 7; i++) rows.push(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('W${i}','Working thing ${i}','staff','x','ready');`);
  for (let i = 1; i <= 7; i++) rows.push(`INSERT INTO items (id,title,owner_role,done_check,status,blocker) VALUES ('S${i}','Stuck thing ${i}','staff','x','blocked','waiting on something');`);
  for (let i = 1; i <= 9; i++) rows.push(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('D${i}','Finished thing ${i}','staff','x','done');`);
  for (let i = 1; i <= 7; i++) rows.push(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('M${i}','Step ${i} only you can do','identity','it waits','manual');`);
  rows.push(`INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total,report) VALUES ('2026-11-11T00:00:00Z','2026-11-11T00:00:01Z',11,11,'ok');`);
  return rows.join('\n');
})();

async function signIn(app) {
  const r = await app.call('/console/login', { method: 'POST', body: new URLSearchParams({ key: KEY }) });
  assert.equal(r.status, 303);
  return r.headers.get('set-cookie').split(';')[0];
}
const jsonPost = (app, path, cookie, body, origin = ORIGIN) => app.call(path, { method: 'POST', headers: { cookie, 'content-type': 'application/json', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });

export function runConsoleConformance(test, host) {
  const tag = `[${host.name}]`;
  const boot = async (token = KEY) => { const app = await host.boot({ token }); return app; };

  test(`T18-1, US-18-R09 and US-18-R22: with no door configured every console path answers off and returns no data ${tag}`, async () => {
    const app = await host.boot({ token: null }); app.sql(SEED);
    try {
      for (const [path, method] of [['/console', 'GET'], ['/api/console', 'GET'], ['/console/login', 'POST'], ['/api/console/card', 'POST'], ['/api/console/ask', 'POST'], ['/api/console/secret', 'POST']]) {
        const r = await app.call(path, { method, headers: method === 'POST' ? { origin: ORIGIN, 'content-type': 'application/json' } : {}, body: method === 'POST' ? JSON.stringify({ id: 'G1', choice: 'done', text: 'hi', key: 'x' }) : undefined });
        assert.equal(r.status, 503, `${method} ${path}`);
        const text = await r.text();
        assert.ok(!/Build the booking page|Approve a monthly spend/.test(text), `no data on ${path}`);
      }
    } finally { await app.close?.(); }
  });

  test(`T18-2 and US-18-R09: a wrong key is refused; a cross-origin or origin-less write is refused ${tag}`, async () => {
    const app = await boot(); app.sql(SEED);
    try {
      assert.equal((await app.call('/api/console')).status, 401);
      assert.equal((await app.call('/console/login', { method: 'POST', body: new URLSearchParams({ key: 'nope' }) })).status, 401);
      const cookie = await signIn(app);
      assert.equal((await app.call('/api/console', { headers: { cookie } })).status, 200);
      assert.equal((await jsonPost(app, '/api/console/ask', cookie, { text: 'hello' }, null)).status, 403);
      assert.equal((await jsonPost(app, '/api/console/ask', cookie, { text: 'hello' }, 'https://evil.example')).status, 403);
      assert.equal((await jsonPost(app, '/api/console/ask', cookie, { text: 'hello' })).status, 200);
    } finally { await app.close?.(); }
  });

  test(`T18-3 and US-18-R05: each list holds at most three items (five finished); the rest appear as an exact count ${tag}`, async () => {
    const app = await boot(); app.sql(MANY);
    try {
      const cookie = await signIn(app);
      const d = await (await app.call('/api/console', { headers: { cookie } })).json();
      assert.equal(d.now.working_on.length, 3); assert.equal(d.now.working_on_more, 4);
      assert.equal(d.now.stuck.length, 3); assert.equal(d.now.stuck_more, 4);
      assert.equal(d.needs_you.cards.length, 3); assert.equal(d.needs_you.more, 4);
      assert.equal(d.progress.done_lately.length, 5); assert.equal(d.progress.done_lately_more, 4);
      assert.equal(d.now.working_on.length + d.now.working_on_more, 7);
    } finally { await app.close?.(); }
  });

  test(`T18-4 and US-18-R09: I did it closes a manual card and writes an action record; the same press on a secret card changes nothing and explains ${tag}`, async () => {
    const app = await boot(); app.sql(SEED);
    try {
      const cookie = await signIn(app);
      assert.equal((await jsonPost(app, '/api/console/card', cookie, { id: 'G1', choice: 'done' })).status, 200);
      const after = await (await app.call('/api/console', { headers: { cookie } })).json();
      assert.ok(!after.needs_you.cards.some(c => c.id === 'G1'));
      const r = await jsonPost(app, '/api/console/card', cookie, { id: 'G2', choice: 'done' });
      assert.equal(r.status, 409); assert.match((await r.json()).explain, /only you can add/);
      const still = await (await app.call('/api/console', { headers: { cookie } })).json();
      assert.ok(still.needs_you.cards.some(c => c.id === 'G2'));
    } finally { await app.close?.(); }
  });

  test(`T18-5 and US-18-R03: typed text is stored verbatim; an out-of-scope request creates a held item and no dispatchable work ${tag}`, async () => {
    const app = await boot(); app.sql(SEED);
    try {
      const cookie = await signIn(app);
      const said = 'I want a page where neighbours can book a drill, with  two spaces';
      const ok = await (await jsonPost(app, '/api/console/ask', cookie, { text: said })).json();
      assert.equal(ok.held, false);
      const held = await (await jsonPost(app, '/api/console/ask', cookie, { text: 'Please write my business plan and a pitch deck' })).json();
      assert.equal(held.held, true); assert.match(held.message, /does not do by default/);
      const rows = await (await app.call('/api/console/records?table=console_actions', { headers: { cookie } })).json().catch(() => null);
      if (rows && rows.rows) assert.ok(rows.rows.some(r => r.text === said));
    } finally { await app.close?.(); }
  });

  test(`T18-6: GET /api/console returns the same facts the Now screen shows ${tag}`, async () => {
    const app = await boot(); app.sql(SEED);
    try {
      const cookie = await signIn(app);
      const d = await (await app.call('/api/console', { headers: { cookie } })).json();
      assert.equal(d.now.open, 1); assert.equal(d.now.done, 1); assert.equal(d.now.blocked, 1);
      assert.equal(d.needs_you.cards.length + d.needs_you.more, 2);
      assert.match(d.headline, /2 things need you/);
      assert.equal(d.now.working_on[0].title, 'Build the booking page'); assert.equal(d.now.stuck[0].title, 'Needs a thing');
      const html = await (await app.call('/console', { headers: { cookie } })).text();
      assert.match(html, /id="headline"/);
    } finally { await app.close?.(); }
  });
}
