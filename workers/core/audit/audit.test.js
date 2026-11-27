// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createAudit, applyPath, redact } from './index.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const T0 = Date.parse('2026-11-10T12:00:00Z'), DAY = 86400e3;
const mk = (extra = {}) => { let t = T0; const db = makeDb([MIG]), clock = { set: v => { t = v; } }; return { db, clock, a: createAudit({ db, now: () => t, config: { tenant: 'x', ...extra.config }, bucket: extra.bucket }) }; };
const fakeBucket = () => { const m = new Map(); return { m, put: async (k, v) => { m.set(k, v); }, get: async k => m.has(k) ? { arrayBuffer: async () => m.get(k).buffer.slice(m.get(k).byteOffset, m.get(k).byteOffset + m.get(k).byteLength) } : null, delete: async k => { m.delete(k); } }; };
const fill = async (a, clock, days, per) => { for (let d = 0; d < days; d++) for (let i = 0; i < per; i++) { clock.set(T0 + d * DAY + i * 1000); await a.append({ actor: 'deploy-loop', kind: 'deploy', subject: 's' + i, summary: `deploy ${d}/${i}`, payload: { d, i } }); } };

test('append chains events and verify passes', async () => {
  const { a } = mk(); await a.append({ actor: 'a', kind: 'merge', summary: 'merged PR' }); await a.append({ actor: 'a', kind: 'merge', summary: 'merged another' });
  const v = await a.verify(); assert.equal(v.ok, true); assert.equal(v.head.seq, 2); assert.equal(v.hot_events, 2);
});
test('kind and fields are validated, secrets and addresses are redacted, payload is hashed not stored', async () => {
  const { a, db } = mk(); await assert.rejects(a.append({ actor: 'a', kind: 'Bad Kind', summary: 'x' }));
  await a.append({ actor: 'a', kind: 'outreach_send', summary: 'sent to bob@example.org with ghp_abcdefghijklmnopqrstuvwx from 10.1.2.3', payload: { secret: 'hunter2' } });
  const r = await db.prepare(`SELECT * FROM audit_events`).all(); const row = r.results[0];
  assert.equal(/bob@|ghp_|10\.1/.test(row.summary), false); assert.equal(row.pay.length, 64); assert.equal(JSON.stringify(row).includes('hunter2'), false);
  assert.equal(redact('x@y.io'), '[removed]');
});
test('editing, deleting or reordering a hot event is detected', async () => {
  for (const attack of [`UPDATE audit_events SET summary='changed' WHERE seq=2`, `DELETE FROM audit_events WHERE seq=2`, `UPDATE audit_events SET seq=9 WHERE seq=3`]) {
    const { a, db } = mk(); await a.appendMany([1, 2, 3].map(n => ({ actor: 'a', kind: 'merge', summary: 'e' + n }))); db.raw.exec(attack);
    const v = await a.verify(); assert.equal(v.ok, false, attack);
  }
});
test('roll turns finished days into one batch row each, keeps the chain, and frees event rows', async () => {
  const { a, db, clock } = mk(); await fill(a, clock, 5, 20); clock.set(T0 + 5 * DAY);
  const r = await a.roll(); assert.equal(r.rolled.length, 3); // days 0-2 are older than hotDays=2 at day 5
  const hot = (await db.prepare(`SELECT COUNT(*) c FROM audit_events`).first()).c, days = (await db.prepare(`SELECT COUNT(*) c FROM audit_days`).first()).c;
  assert.equal(hot, 40); assert.equal(days, 3);
  const v = await a.verify(); assert.equal(v.ok, true, JSON.stringify(v.problems)); assert.equal(v.head.seq, 100); assert.ok(v.deep_days_checked >= 1);
  await a.append({ actor: 'a', kind: 'merge', summary: 'after the roll' }); assert.equal((await a.verify()).ok, true); // new events chain onto the rolled tail
  assert.equal((await a.roll()).rolled.length, 0); // idempotent
});
test('rolled batches in R2 verify; tampering with the archive or an anchor is detected', async () => {
  const bucket = fakeBucket(), { a, db, clock } = mk({ bucket }); await fill(a, clock, 4, 10); clock.set(T0 + 4 * DAY); await a.roll();
  assert.ok([...bucket.m.keys()][0].startsWith('audit/x/')); assert.equal((await a.verify({ deepDays: 5 })).ok, true);
  const k = [...bucket.m.keys()][0], b = bucket.m.get(k).slice(); b[b.length - 12] ^= 0xff; bucket.m.set(k, b);
  const v = await a.verify({ deepDays: 5 }); assert.equal(v.ok, false); assert.match(v.problems.join(), /archive|rebuild|sha/);
  const { a: a2, db: db2, clock: c2 } = mk(); await fill(a2, c2, 4, 5); c2.set(T0 + 4 * DAY); await a2.roll();
  db2.raw.exec(`UPDATE audit_days SET root='${'a'.repeat(64)}' WHERE day='2026-11-10'`); assert.equal((await a2.verify()).ok, false);
});
test('a Merkle proof ties an event to its day root, and the day to the chain', async () => {
  const { a, db, clock } = mk(); await fill(a, clock, 4, 7); clock.set(T0 + 4 * DAY); await a.roll();
  const seq = 10, p = await a.proof(seq); assert.equal(p.state, 'rolled'); assert.equal(await applyPath(p.hash, p.path), p.root);
  assert.equal((await a.proof(9999)).state, 'unknown'); assert.equal((await a.proof(27)).state, 'hot');
});
test('retention prunes batches but keeps anchors, and the chain still verifies', async () => {
  const { a, clock } = mk({ config: { archiveDays: 3 } }); await fill(a, clock, 6, 3); clock.set(T0 + 8 * DAY); const r = await a.roll();
  assert.ok(r.pruned.length >= 1); const v = await a.verify(); assert.equal(v.ok, true, JSON.stringify(v.problems)); assert.equal((await a.proof(1)).state, 'pruned');
  const s = await a.summary(); assert.ok(s.days_pruned >= 1);
});
test('summary is public-safe and bounded; row count stays small per day', async () => {
  const { a, db, clock } = mk(); await fill(a, clock, 10, 50); clock.set(T0 + 10 * DAY); await a.roll();
  const s = await a.summary(); assert.equal(s.events_total, 500); assert.equal(JSON.stringify(s).includes('deploy 0/0'), false); assert.ok(s.hot_events <= 100);
  const rows = (await db.prepare(`SELECT (SELECT COUNT(*) FROM audit_events)+(SELECT COUNT(*) FROM audit_days) c`).first()).c; assert.ok(rows <= 110, 'rows ' + rows);
});
test('loop_beats are digested per finished hour, once', async () => {
  const { a, db } = mk();
  db.raw.exec(`CREATE TABLE loop_beats (id INTEGER PRIMARY KEY AUTOINCREMENT, loop TEXT, slot INTEGER, source TEXT, started_at TEXT, finished_at TEXT, ok INTEGER, error TEXT, detail TEXT)`);
  for (const [i, ok] of [[0, 1], [1, 1], [2, 0]]) db.raw.exec(`INSERT INTO loop_beats (loop,slot,source,started_at,ok) VALUES ('tick',${i},'cron','2026-11-10T10:0${i}:00Z',${ok})`);
  db.raw.exec(`INSERT INTO loop_beats (loop,slot,source,started_at,ok) VALUES ('tick',9,'cron','2026-11-10T12:05:00Z',1)`); // current hour: not digested yet
  assert.equal((await a.digestLoopBeats()).digested, 1); assert.equal((await a.digestLoopBeats()).digested, 0);
  const e = (await a.events())[0]; assert.match(e.summary, /3 runs, 2 ok, 1 failed/); assert.equal(e.ref, 'loop_beats:1-3');
});
test('routes: public summary/verify/proof; events and writes need authorization', async () => {
  const { a } = mk(); const get = (p, auth) => a.handle(new Request('https://h' + p, { method: 'GET' }), { authorize: () => auth });
  assert.equal((await get('/audit/summary.json')).status, 200); assert.equal((await get('/audit/verify')).status, 200); assert.equal((await get('/audit/events')).status, 403);
  const post = auth => a.handle(new Request('https://h/audit/event', { method: 'POST', body: JSON.stringify({ actor: 'ci', kind: 'deploy', summary: 'deployed', ref: 'sha:abc123' }) }), { authorize: () => auth });
  assert.equal((await post(false)).status, 403); assert.equal((await post(true)).status, 200); assert.equal((await (await get('/audit/events', true)).json()).events.length, 1);
  assert.equal(await a.handle(new Request('https://h/other')), null);
});
test('the tick step digests, rolls, verifies and records an incident on a broken chain', async () => {
  const { a, db } = mk(); await a.appendMany([1, 2, 3].map(n => ({ actor: 'a', kind: 'merge', summary: 'e' + n }))); const notes = [];
  await a.step().run(db, { notes }); assert.match(notes[0], /chain intact`?/);
  db.raw.exec(`UPDATE audit_events SET summary='x' WHERE seq=1`); await a.step().run(db, { notes }); assert.match(notes[1], /BROKEN/);
});
test('US-01-R17: a sealed batch that does not read back keeps the day\'s rows, records the failure once, and the day is sealed when the store reads back again', async () => {
  for (const fault of ['damaged', 'missing', 'throws']) {
    const bucket = fakeBucket(), real = bucket.get;
    bucket.get = async k => {
      if (fault === 'missing') return null;
      if (fault === 'throws') throw new Error('bucket offline');
      const r = await real(k); const u8 = new Uint8Array(await r.arrayBuffer()); u8[u8.length - 12] ^= 0xff; return { arrayBuffer: async () => u8.buffer };
    };
    const { a, db, clock } = mk({ bucket }); await fill(a, clock, 4, 10); clock.set(T0 + 4 * DAY);
    const r = await a.roll();
    const oldRows = async () => (await db.prepare(`SELECT COUNT(*) c FROM audit_events WHERE kind='deploy' AND day < '2026-11-12'`).first()).c;
    assert.equal(r.rolled.length, 0, `${fault}: nothing counts as sealed`);
    assert.equal(r.kept.length, 2, `${fault}: both finished days are kept`);
    assert.match(r.kept[1].reason, /waits for 2026-11-10/, `${fault}: the day after waits, because its anchor chains to the one before`);
    assert.equal(await oldRows(), 20, `${fault}: every event row of the kept days is still in the store`);
    assert.equal((await db.prepare(`SELECT COUNT(*) c FROM audit_days`).first()).c, 0, `${fault}: no anchor stands for a batch that did not read back`);
    const incidents = async () => (await db.prepare(`SELECT COUNT(*) c FROM audit_events WHERE kind='incident' AND subject='seal'`).first()).c;
    assert.equal(await incidents(), 1, `${fault}: the failure is recorded`);
    await a.roll(); assert.equal(await incidents(), 1, `${fault}: a failure that repeats is recorded once`);
    assert.equal((await a.verify({ deepDays: 5 })).ok, true, `${fault}: the chain is whole`);
    bucket.get = real;
    const healed = await a.roll();
    assert.equal(healed.rolled.length, 2, `${fault}: sealed once the batch reads back`);
    assert.equal(await oldRows(), 0);
    assert.equal((await a.verify({ deepDays: 5 })).ok, true, JSON.stringify((await a.verify({ deepDays: 5 })).problems));
  }
});
test('US-01-R17: an anchor left by an interrupted roll is read back before its rows are deleted', async () => {
  const bucket = fakeBucket(), { a, db, clock } = mk({ bucket }); await fill(a, clock, 3, 5); clock.set(T0 + 3 * DAY);
  const first = (await db.prepare(`SELECT * FROM audit_events WHERE day='2026-11-10' ORDER BY seq`).all()).results;
  assert.equal((await a.roll()).rolled.length, 1);
  // a crash between the anchor and the delete leaves the rows beside their anchor; here the archive is also gone
  const put = rows => { for (const e of rows) db.prepare(`INSERT INTO audit_events (seq,day,at,actor,kind,subject,summary,ref,pay,prev,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(e.seq, e.day, e.at, e.actor, e.kind, e.subject, e.summary, e.ref, e.pay, e.prev, e.hash).run(); };
  put(first);
  const key = (await db.prepare(`SELECT archive_key FROM audit_days WHERE day='2026-11-10'`).first()).archive_key, bytes = bucket.m.get(key);
  bucket.m.delete(key);
  const r = await a.roll();
  assert.equal(r.kept.length, 1); assert.match(r.kept[0].reason, /archive missing/);
  assert.equal((await db.prepare(`SELECT COUNT(*) c FROM audit_events WHERE day='2026-11-10'`).first()).c, first.length, 'the rows stay while their batch does not read back');
  bucket.m.set(key, bytes);
  assert.deepEqual((await a.roll()).kept, []);
  assert.equal((await db.prepare(`SELECT COUNT(*) c FROM audit_events WHERE day='2026-11-10'`).first()).c, 0, 'deleted once the batch reads back and matches');
});
