// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ROLE-DUTIES-1 and ROLE-IDLE-1: each role reads its own signal, files one item when out of bounds, settles it when clear, and an idle role is named.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { ensureItem } from '../src/tick.js';
import { roleDutiesStep, headline, signature, DUTIES } from '../src/roleduties.js';

const T0 = Date.parse('2026-11-26T06:00:00Z');
const iso = t => new Date(t).toISOString().replace('T', ' ').slice(0, 19);
const page = (h) => `<html><head><title>Changelog</title><script>v=${Math.random()}</script></head><body><h1>${h}</h1></body></html>`;

test('headline reads the first feed entry, else the page title; signature ignores scripts', () => {
  assert.equal(headline('<feed><title>x</title><entry><title>v2.0 adds review agents</title></entry></feed>'), 'v2.0 adds review agents');
  assert.equal(headline(page('a')), 'Changelog');
  assert.equal(signature(page('same')), signature(page('same')));
  assert.notEqual(signature(page('one')), signature(page('two')));
});

test('portfolio files a blocked-share item, then settles it when the share falls', async () => {
  const db = makeDb();
  for (let i = 0; i < 4; i++) db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status,blocker) VALUES ('B${i}','b','staff','x','blocked','loop-breaker: dispatched 3 times')`);
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status) VALUES ('O','o','staff','x','open')`);
  const ctx = { now: T0, notes: [], config: {}, env: { fetch: async () => ({ ok: false, status: 503 }) } };
  const r = await roleDutiesStep(db, ctx, ensureItem);
  assert.ok(r.filed.some(id => id.startsWith('PORTFOLIO-BLOCKED-')), JSON.stringify(r));
  assert.ok(r.filed.some(id => id.startsWith('PROJECT-RESCOPE-')));
  db.raw.exec(`UPDATE items SET status='done', disposition='fixed' WHERE id LIKE 'B%'`);
  await roleDutiesStep(db, { ...ctx, now: T0 + 3600e3, notes: [] }, ensureItem);
  const p = db.raw.prepare(`SELECT status FROM items WHERE id LIKE 'PORTFOLIO-BLOCKED-%'`).get();
  assert.equal(p.status, 'done');
  assert.ok(db.raw.prepare(`SELECT COUNT(*) n FROM role_beats WHERE role='portfolio-manager'`).get().n >= 2);
});

test('market research snapshots a source and files a MKT item naming it when it changes', async () => {
  const db = makeDb();
  let h = 'v1';
  const market = { competitors: [{ id: 'pr-agent', name: 'PR-Agent', sources: [{ url: 'https://example.test/releases.atom' }] }] };
  const ctx = (now) => ({ now, notes: [], config: { market }, env: { fetch: async () => ({ ok: true, text: async () => `<feed><entry><title>${h}</title></entry></feed>` }) } });
  await roleDutiesStep(db, ctx(T0), ensureItem);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM items WHERE id LIKE 'MKT-%'`).get().n, 0, 'first snapshot is a baseline, not news');
  h = 'v2 adds auto-fix';
  await roleDutiesStep(db, ctx(T0 + 3600e3), ensureItem);
  const it = db.raw.prepare(`SELECT title, owner_role FROM items WHERE id LIKE 'MKT-%'`).get();
  assert.equal(it.owner_role, 'product-manager');
  assert.match(it.title, /PR-Agent changed.*v2 adds auto-fix.*https:\/\/example\.test\/releases\.atom/);
});

test('an unreadable source is unmeasured, never a change', async () => {
  const r = await DUTIES['product-manager'].run(makeDb(), { now: T0, limits: {}, market: { competitors: [{ id: 'x', sources: [{ url: 'https://x.test' }] }] }, fetch: async () => { throw new Error('down'); } });
  assert.equal(r.breach, false);
  assert.match(r.reading, /unmeasured/);
});

test('ROLE-IDLE-1: a role with no dispatch and no duty beat for a day is named; a role with a duty is not', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO tick_runs (started_at, steps_total) VALUES ('${iso(T0 - 3 * 864e5)}', 20)`);
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('marketing-manager-1','marketing-manager',1,'m'), ('sre-1','sre',1,'m'), ('staff-1','staff',1,'m')`);
  db.raw.exec(`INSERT INTO dispatches (tick_id, role_id, item_id, model, at) VALUES (1, 'staff-1', 'X', 'm', '${iso(T0 - 3600e3)}')`);
  const r = await roleDutiesStep(db, { now: T0, notes: [], config: {}, env: { fetch: async () => ({ ok: false, status: 404 }) } }, ensureItem);
  assert.deepEqual(r.idle, ['marketing-manager']);
  assert.ok(db.raw.prepare(`SELECT 1 FROM items WHERE id='IDLE-ROLES-2026-11-26' AND owner_role='portfolio-manager'`).get());
});
