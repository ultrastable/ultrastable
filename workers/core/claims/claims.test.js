// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for core/claims (US-SPEC-08 MUSTs and conformance tests T01-T06; US-SPEC-09 kill switch fence; US-SPEC-14 R01).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as C from './index.js';
import { STEPS } from '../src/tick.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const T0 = Date.parse('2026-11-11T10:00:00Z');
const MIN = 60000;

function setup(config = {}) {
  const db = makeDb([MIG]);
  const clock = { t: T0 };
  const ctx = { db, now: () => clock.t, config: { claim_ttl_minutes: 120, ...config } };
  return { db, clock, ctx };
}
const item = (db, id, extra = '') => db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status${extra ? ',' + extra.split('|')[0] : ''}) VALUES ('${id}','t','staff','x','ready'${extra ? ',' + extra.split('|')[1] : ''})`);

test('US-08-R01 / US-08-T01: at most one live claim per item; second is rejected', async () => {
  const { db, ctx } = setup(); item(db, 'A');
  const a = await C.acquire(ctx, { item_id: 'A', holder: 'agent-1', intent: 'build A' });
  assert.equal(a.acquired, true);
  const b = await C.acquire(ctx, { item_id: 'A', holder: 'agent-2', intent: 'something else' });
  assert.equal(b.acquired, false); assert.equal(b.reason, 'held'); assert.equal(b.status, 409);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_lock WHERE released_at IS NULL`).get().n, 1);
});

test('contention: two claimants race, exactly one wins; fences stay unique', async () => {
  const { ctx } = setup();
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => C.acquire(ctx, { path: 'src/x.js', holder: `h${i}`, intent: `intent ${i}` })));
  assert.equal(rs.filter(r => r.acquired).length, 1);
  assert.ok(rs.filter(r => !r.acquired).every(r => r.status === 409));
  const win = rs.find(r => r.acquired); assert.equal(win.fence, 1);
});

test('US-08-R07 / US-08-R08 / US-08-T05: fence is previous+1; a stale holder is rejected by check', async () => {
  const { ctx, clock } = setup();
  const h1 = await C.acquire(ctx, { path: 'p', holder: 'one' });
  assert.equal(h1.fence, 1);
  assert.equal((await C.check(ctx, { path: 'p', token: h1.token, fence: 1 })).valid, true);
  clock.t += 121 * MIN; // holder 1 pauses past expiry
  const h2 = await C.acquire(ctx, { path: 'p', holder: 'two' });
  assert.equal(h2.acquired, true); assert.equal(h2.fence, 2);
  const stale = await C.check(ctx, { path: 'p', token: h1.token, fence: 1 });
  assert.equal(stale.valid, false);
  const staleFence = await C.check(ctx, { path: 'p', token: h2.token, fence: 1 });
  assert.equal(staleFence.reason, 'stale_fence');
  assert.equal((await C.check(ctx, { path: 'p', token: h2.token, fence: 2 })).valid, true);
});

test('fence is monotonic across release and re-acquire', async () => {
  const { ctx } = setup();
  const a = await C.acquire(ctx, { path: 'q', holder: 'a' }); await C.release(ctx, { path: 'q', token: a.token });
  const b = await C.acquire(ctx, { path: 'q', holder: 'b' }); await C.release(ctx, { path: 'q', token: b.token });
  const c = await C.acquire(ctx, { path: 'q', holder: 'c' });
  assert.deepEqual([a.fence, b.fence, c.fence], [1, 2, 3]);
});

test('US-08-R02 / US-08-T02: expired claim is reaped and the item returns to ready (alongside the seed tick reaper)', async () => {
  const { db, ctx, clock } = setup(); item(db, 'A');
  await C.acquire(ctx, { item_id: 'A', holder: 'agent-1' });
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='A'`).get().status, 'claimed');
  clock.t += 180 * MIN;
  const r = await C.reapExpired(ctx);
  assert.equal(r.reaped, 1);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='A'`).get().status, 'ready');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims`).get().n, 0);
  assert.equal(db.raw.prepare(`SELECT outcome FROM claims_lock`).get().outcome, 'expired');
  assert.equal((await C.metrics(ctx)).orphaned_claims, 0);
});

test('US-08-R13: an unreaped expired claim counts as an orphan until the reaper runs', async () => {
  const { ctx, clock } = setup();
  await C.acquire(ctx, { path: 'o', holder: 'a' });
  clock.t += 200 * MIN;
  assert.equal((await C.metrics(ctx)).orphaned_claims, 1);
  await C.reapExpired(ctx);
  assert.equal((await C.metrics(ctx)).orphaned_claims, 0);
});

test('seed reaper and this module agree: when the tick frees the item, reconcile closes the claim', async () => {
  const { db, ctx, clock } = setup(); item(db, 'A');
  await C.acquire(ctx, { item_id: 'A', holder: 'agent-1' });
  clock.t += 180 * MIN;
  const nowIso = new Date(clock.t).toISOString().replace('T', ' ').slice(0, 19);
  await STEPS.reap_claims(db, { now: clock.t, nowIso, config: { claim_ttl_minutes: 120 }, notes: [] });
  const r = await C.reapExpired(ctx);
  assert.equal(r.reaped, 1);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_lock WHERE released_at IS NULL`).get().n, 0);
});

test('US-08-R06: heartbeat renews; a claim that heartbeats outlives its first expiry', async () => {
  const { ctx, clock } = setup();
  const a = await C.acquire(ctx, { path: 'h', holder: 'a' });
  clock.t += 100 * MIN;
  const hb = await C.heartbeat(ctx, { path: 'h', token: a.token });
  assert.equal(hb.renewed, true);
  clock.t += 100 * MIN; // 200 min since acquire, 100 since heartbeat
  assert.equal((await C.reapExpired(ctx)).reaped, 0);
  assert.equal((await C.check(ctx, { path: 'h', token: a.token, fence: a.fence })).valid, true);
  assert.equal((await C.heartbeat(ctx, { path: 'h', token: 'wrong' })).reason, 'token_mismatch');
  clock.t += 121 * MIN;
  assert.equal((await C.heartbeat(ctx, { path: 'h', token: a.token })).reason, 'expired');
});

test('release requires the token and frees the item; wrong token is refused', async () => {
  const { db, ctx } = setup(); item(db, 'A');
  const a = await C.acquire(ctx, { item_id: 'A', holder: 'x' });
  assert.equal((await C.release(ctx, { item_id: 'A', token: 'nope' })).reason, 'token_mismatch');
  const r = await C.release(ctx, { item_id: 'A', token: a.token, outcome: 'abandoned' });
  assert.equal(r.released, true);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='A'`).get().status, 'ready');
  assert.equal((await C.acquire(ctx, { item_id: 'A', holder: 'y' })).acquired, true);
});

test('terminal release: a claim on a done item is released', async () => {
  const { db, ctx } = setup(); item(db, 'A');
  await C.acquire(ctx, { item_id: 'A', holder: 'x' });
  db.raw.exec(`UPDATE items SET status='done', disposition='verified' WHERE id='A'`);
  assert.equal((await C.releaseTerminal(ctx)).released, 1);
  assert.equal(db.raw.prepare(`SELECT outcome FROM claims_lock`).get().outcome, 'terminal');
  assert.equal((await C.acquire(ctx, { item_id: 'A', holder: 'y' })).reason, 'item_terminal');
});

test('US-08-R03 / US-08-T04: an item whose trigger is not done cannot be claimed', async () => {
  const { db, ctx } = setup(); item(db, 'A');
  item(db, 'C', 'trigger_on|\'A\'');
  assert.equal((await C.acquire(ctx, { item_id: 'C', holder: 'x' })).reason, 'trigger_not_done');
  db.raw.exec(`UPDATE items SET status='done', disposition='v' WHERE id='A'`);
  assert.equal((await C.acquire(ctx, { item_id: 'C', holder: 'x' })).acquired, true);
});

test('seed dispatch claims are respected (one live claim per item across both tables)', async () => {
  const { db, ctx } = setup(); item(db, 'A');
  db.raw.exec(`INSERT INTO claims (item_id, agent) VALUES ('A','role-1')`);
  const r = await C.acquire(ctx, { item_id: 'A', holder: 'other' });
  assert.equal(r.acquired, false); assert.equal(r.holder, 'role-1');
});

test('US-08-R09: same intent from a second claimant is told to shepherd, not duplicate', async () => {
  const { ctx } = setup();
  await C.acquire(ctx, { path: 'a.js', holder: 'one', intent: 'Fix the  login bug' });
  const same = await C.acquire(ctx, { path: 'a.js', holder: 'two', intent: 'fix the login BUG' });
  assert.equal(same.acquired, false); assert.equal(same.same_intent, true); assert.match(same.advice, /shepherd/);
  const elsewhere = await C.acquire(ctx, { path: 'b.js', holder: 'two', intent: 'fix the login bug' });
  assert.equal(elsewhere.reason, 'same_intent'); assert.equal(elsewhere.holder, 'one');
  const diff = await C.acquire(ctx, { path: 'a.js', holder: 'three', intent: 'rename a function' });
  assert.equal(diff.same_intent, false); assert.match(diff.advice, /review/);
});

test('secret lease: exclusive, short, names only; a value is refused and never stored', async () => {
  const { db, ctx, clock } = setup({ lease_ttl_minutes: 2 });
  const refused = await C.acquire(ctx, { kind: 'secret', key: 'API_KEY', holder: 'a', value: 'hunter2-sekret' });
  assert.equal(refused.reason, 'secret_values_never_accepted');
  const l = await C.acquire(ctx, { kind: 'secret', key: 'API_KEY', holder: 'a', ttl_minutes: 999 });
  assert.equal(l.acquired, true); assert.equal(l.ttl_minutes, 2);
  assert.equal((await C.acquire(ctx, { kind: 'secret', key: 'API_KEY', holder: 'b' })).acquired, false);
  assert.equal((await C.acquire(ctx, { kind: 'secret', key: 'OTHER', holder: 'b' })).acquired, true);
  clock.t += 3 * MIN;
  assert.equal((await C.acquire(ctx, { kind: 'secret', key: 'API_KEY', holder: 'b' })).acquired, true);
  assert.ok(!JSON.stringify(db.raw.prepare(`SELECT * FROM claims_lock`).all()).includes('hunter2'));
});

test('deploy lock uses the same primitives and is independent of work claims', async () => {
  const { ctx } = setup();
  const d = await C.acquire(ctx, { kind: 'deploy', key: 'service-a', holder: 'ci' });
  assert.equal(d.acquired, true); assert.equal(d.fence, 1);
  assert.equal((await C.acquire(ctx, { kind: 'deploy', key: 'service-a', holder: 'ci2' })).acquired, false);
  assert.equal((await C.acquire(ctx, { kind: 'work', key: 'service-a', holder: 'ci2' })).acquired, true);
  assert.equal((await C.release(ctx, { kind: 'deploy', key: 'service-a', token: d.token })).released, true);
});

test('kill switch refuses new claims and renewals; releases and reads keep working', async () => {
  const { ctx } = setup();
  const a = await C.acquire(ctx, { path: 'k', holder: 'a' });
  ctx.killSwitch = async () => true;
  assert.equal((await C.acquire(ctx, { path: 'k2', holder: 'a' })).reason, 'kill-switch');
  assert.equal((await C.acquire(ctx, { kind: 'secret', key: 's', holder: 'a' })).status, 503);
  assert.equal((await C.acquire(ctx, { kind: 'deploy', key: 'd', holder: 'a' })).status, 503);
  assert.equal((await C.heartbeat(ctx, { path: 'k', token: a.token })).status, 503);
  assert.equal((await C.status(ctx, { path: 'k' })).count, 1);
  assert.equal((await C.release(ctx, { path: 'k', token: a.token })).released, true);
});

test('token: from crypto.getRandomValues, opaque, never stored, never logged, never in status', async () => {
  const { db, ctx } = setup();
  const logs = [];
  const orig = [console.log, console.error, console.warn, console.info];
  console.log = console.error = console.warn = console.info = (...a) => logs.push(a.join(' '));
  let a, hb, st, h;
  try {
    a = await C.acquire(ctx, { path: 'tok', holder: 'a', intent: 'x', idempotency_key: 'k1' });
    hb = await C.heartbeat(ctx, { path: 'tok', token: a.token });
    st = await C.status(ctx, {});
    h = await C.handle(new Request('https://x/work-lock/status?key=tok'), ctx);
    await C.release(ctx, { path: 'tok', token: a.token, idempotency_key: 'k2' });
  } finally { [console.log, console.error, console.warn, console.info] = orig; }
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.notEqual(a.token, (await C.acquire(ctx, { path: 'tok2', holder: 'a' })).token);
  for (const t of ['claims_lock', 'claims_events', 'claims_idem', 'claims_incidents', 'claims_pulls'])
    assert.ok(!JSON.stringify(db.raw.prepare(`SELECT * FROM ${t}`).all()).includes(a.token), `${t} leaks the token`);
  assert.ok(!JSON.stringify([hb, st, await h.json(), logs]).includes(a.token));
  assert.ok(!JSON.stringify(st).includes(await C.hashToken(a.token)));
});

test('US-08-R15: idempotency key replays without a second effect and without re-disclosing the token', async () => {
  const { db, ctx } = setup();
  const a = await C.acquire(ctx, { path: 'i', holder: 'a', idempotency_key: 'same' });
  const b = await C.acquire(ctx, { path: 'i', holder: 'a', idempotency_key: 'same' });
  assert.equal(b.replayed, true); assert.equal(b.token, undefined);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_lock`).get().n, 1);
  assert.ok(a.token);
});

test('US-08-R04 / US-08-T03: item done with no disposition is reopened with one silent_drop', async () => {
  const { db, ctx } = setup(); item(db, 'A');
  db.raw.exec(`UPDATE items SET status='done' WHERE id='A'`);
  await C.reconcile(ctx); await C.reconcile(ctx);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='A'`).get().status, 'open');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM outcomes WHERE result='silent_drop'`).get().n, 1);
});

test('US-08-R11 / US-08-T06: a loop that scans 25 and books 0 opens an incident and reopens 25 items', async () => {
  const { db, ctx } = setup();
  const ids = Array.from({ length: 25 }, (_, i) => `L${i}`);
  for (const id of ids) { item(db, id); db.raw.exec(`UPDATE items SET status='done', disposition='x' WHERE id='${id}'`); }
  const r = await C.recordLoopRun(ctx, { loop: 'triage', scanned_ids: ids, executed: [], failed: [], needs_human: [], no_action: [] });
  assert.equal(r.gap, 25); assert.ok(r.incident_id); assert.equal(r.reopened.length, 25);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM items WHERE status='open'`).get().n, 25);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM outcomes WHERE result='silent_drop'`).get().n, 25);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_incidents WHERE kind='accounting_gap'`).get().n, 1);
  const ok = await C.recordLoopRun(ctx, { loop: 'triage', scanned: 4, executed: 2, failed: 1, needs_human: 1, no_action: 0 });
  assert.equal(ok.gap, 0); assert.equal(ok.incident_id, null);
});

test('US-08-R12: rework at the threshold escalates once as a root-cause item', async () => {
  const { db, ctx } = setup(); item(db, 'A');
  assert.equal((await C.recordRework(ctx, { item_id: 'A' })).escalated, false);
  assert.equal((await C.recordRework(ctx, { item_id: 'A' })).escalated, false);
  const r = await C.recordRework(ctx, { item_id: 'A' });
  assert.equal(r.escalated, true); assert.equal(r.count, 3);
  await C.recordRework(ctx, { item_id: 'A' });
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM items WHERE id='root-cause-A'`).get().n, 1);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_incidents WHERE kind='rework_escalation'`).get().n, 1);
});

test('US-08-R10: queue pulls are recorded with puller, item and route', async () => {
  const { db, ctx } = setup();
  await C.recordPull(ctx, { puller: 'agent-1', item_id: 'A', route: 'ready-queue' });
  assert.deepEqual({ ...db.raw.prepare(`SELECT puller,item_id,route FROM claims_pulls`).get() }, { puller: 'agent-1', item_id: 'A', route: 'ready-queue' });
});

test('US-08-R14: an identity-bound step becomes one gate card and leaves the doer path; others are rerouted', async () => {
  const { db, ctx } = setup(); item(db, 'A');
  await C.acquire(ctx, { item_id: 'A', holder: 'x' });
  assert.equal((await C.escalateToGate(ctx, { item_id: 'A', what: 'w', why_gated: 'y', default_in_effect: 'd', identity_bound: false })).rerouted, true);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM gate_cards`).get().n, 0);
  const g = await C.escalateToGate(ctx, { item_id: 'A', what: 'sign', why_gated: 'identity', default_in_effect: 'unsigned', closing_probe: 'manual', identity_bound: true });
  assert.equal(g.card, 'gate-A');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_lock WHERE released_at IS NULL`).get().n, 0);
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='A'`).get().status, 'blocked');
});

test('handle(): router acquires, heartbeats, checks, releases; auth is required for writes', async () => {
  const { ctx } = setup();
  const post = (p, b) => new Request('https://h' + p, { method: 'POST', body: JSON.stringify(b) });
  assert.equal((await C.handle(post('/work-lock/acquire', { key: 'r', holder: 'a' }), ctx)).status, 401);
  ctx.authorize = async req => req.headers.get('authorization') === 'Bearer ok' || true;
  ctx.authorize = async () => true;
  const r1 = await C.handle(post('/work-lock/acquire', { key: 'r', holder: 'a' }), ctx);
  const a = await r1.json(); assert.equal(r1.status, 200); assert.ok(a.token);
  const r2 = await C.handle(post('/work-lock/acquire', { key: 'r', holder: 'b' }), ctx);
  assert.equal(r2.status, 409);
  assert.equal((await (await C.handle(post('/work-lock/heartbeat', { key: 'r', token: a.token }), ctx)).json()).renewed, true);
  assert.equal((await (await C.handle(post('/work-lock/check', { key: 'r', token: a.token, fence: a.fence }), ctx)).json()).valid, true);
  const st = await (await C.handle(new Request('https://h/work-lock/status?key=r'), ctx)).json();
  assert.equal(st.count, 1); assert.equal(st.fence, 1);
  assert.equal((await C.handle(post('/work-lock/release', { key: 'r', token: a.token }), ctx)).status, 200);
  assert.equal((await C.handle(post('/secret-lock/acquire', { key: 'S', holder: 'a', value: 'v' }), ctx)).status, 400);
  assert.equal((await C.handle(post('/deploy-lock/acquire', { key: 'D', holder: 'a' }), ctx)).status, 200);
  assert.equal((await C.handle(new Request('https://h/nope'), ctx)).status, 404);
  ctx.killSwitch = () => true;
  assert.equal((await C.handle(post('/work-lock/acquire', { key: 'z', holder: 'a' }), ctx)).status, 503);
});

test('seed tick still dispatches around item claims taken here', async () => {
  const { db, ctx } = setup(); item(db, 'A');
  await C.acquire(ctx, { item_id: 'A', holder: 'agent-1' });
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims WHERE item_id='A'`).get().n, 1);
});

// ---- US-08-R08 / R21 guarded writes and R18 check under the kill switch ----
test('US-08-R21: a stale holder (fence 1 after holder 2 took 2) is refused by guardedWrite and the write function is not called', async () => {
  const { ctx, clock } = setup();
  const h1 = await C.acquire(ctx, { path: 'doc', holder: 'one' });
  clock.t += 121 * MIN;
  const h2 = await C.acquire(ctx, { path: 'doc', holder: 'two' });
  let writes = 0;
  const stale = await C.guardedWrite(ctx, { path: 'doc', token: h1.token, fence: h1.fence }, async () => { writes++; });
  assert.deepEqual([stale.ok, stale.written, stale.status, stale.reason], [false, false, 409, 'token_mismatch']);
  const staleFence = await C.guardedWrite(ctx, { path: 'doc', token: h2.token, fence: 1 }, async () => { writes++; });
  assert.deepEqual([staleFence.written, staleFence.reason, staleFence.current_fence], [false, 'stale_fence', 2]);
  assert.equal(writes, 0);
  const good = await C.guardedWrite(ctx, { path: 'doc', token: h2.token, fence: 2 }, async ({ fence }) => { writes++; return `wrote at fence ${fence}`; });
  assert.deepEqual([good.ok, good.written, good.result], [true, true, 'wrote at fence 2']);
  assert.equal(writes, 1);
});

test('US-08-R21: fenceGuardSql lets a conditional UPDATE change a row for the live token and fence and zero rows otherwise, including after expiry', async () => {
  const { db, ctx, clock } = setup();
  db.raw.exec(`CREATE TABLE doc (id TEXT PRIMARY KEY, body TEXT)`); db.raw.exec(`INSERT INTO doc VALUES ('d','v0')`);
  const a = await C.acquire(ctx, { path: 'doc', holder: 'one' });
  const upd = async (req, body) => {
    const g = await C.fenceGuardSql(ctx, req);
    return (await db.prepare(`UPDATE doc SET body = ? WHERE id = 'd' AND ${g.sql}`).bind(body, ...g.binds).run()).meta.changes;
  };
  assert.equal(await upd({ path: 'doc', token: a.token, fence: 1 }, 'v1'), 1);
  assert.equal(await upd({ path: 'doc', token: a.token, fence: 7 }, 'v2'), 0);       // wrong fence
  assert.equal(await upd({ path: 'doc', token: 'x'.repeat(64), fence: 1 }, 'v3'), 0); // wrong token
  clock.t += 121 * MIN;                                                              // the claim expires between check and write
  assert.equal(await upd({ path: 'doc', token: a.token, fence: 1 }, 'v4'), 0);
  assert.equal(db.raw.prepare(`SELECT body FROM doc`).get().body, 'v1');
});

test('US-08-R08: a refused write records a write-refused event without any token', async () => {
  const { db, ctx } = setup();
  const a = await C.acquire(ctx, { path: 'w', holder: 'one' });
  await C.guardedWrite(ctx, { path: 'w', token: a.token, fence: 99 }, async () => {});
  const ev = db.raw.prepare(`SELECT event, detail FROM claims_events WHERE event='write-refused'`).all();
  assert.deepEqual(ev.map(e => [e.event, e.detail]), [['write-refused', 'stale_fence']]);
  assert.ok(!JSON.stringify(db.raw.prepare(`SELECT * FROM claims_events`).all()).includes(a.token));
  await assert.rejects(() => C.guardedWrite(ctx, { path: 'w', token: a.token, fence: 1 }), /write function/);
});

test('US-08-R18: with the kill switch on, check answers invalid with reason kill-switch, guardedWrite refuses and the router answers 503', async () => {
  const { db, ctx, clock } = setup();
  const a = await C.acquire(ctx, { path: 'k', holder: 'one' });
  assert.equal((await C.check(ctx, { path: 'k', token: a.token, fence: 1 })).valid, true);
  ctx.killSwitch = async () => true;
  const c = await C.check(ctx, { path: 'k', token: a.token, fence: 1 });
  assert.deepEqual([c.valid, c.reason, c.status, c.fence], [false, 'kill-switch', 503, 1]);
  let called = 0;
  const g = await C.guardedWrite(ctx, { path: 'k', token: a.token, fence: 1 }, async () => { called++; });
  assert.deepEqual([g.written, g.status, g.reason, called], [false, 503, 'kill-switch', 0]);
  assert.equal((await C.fenceGuardSql(ctx, { path: 'k', token: a.token, fence: 1 })).sql, '(0 = 1)');
  ctx.authorize = async () => true;
  const r = await C.handle(new Request('https://h/work-lock/check', { method: 'POST', body: JSON.stringify({ key: 'path:k', token: a.token, fence: 1 }) }), ctx);
  assert.equal(r.status, 503);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_events WHERE event='kill-switch' AND detail='check refused'`).get().n, 1, 'recorded once inside 5 minutes');
  clock.t += 6 * MIN;
  await C.check(ctx, { path: 'k', token: a.token, fence: 1 });
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_events WHERE event='kill-switch' AND detail='check refused'`).get().n, 2);
  ctx.killSwitch = async () => false;                                                // with the switch off the same token and fence are valid
  assert.equal((await C.check(ctx, { path: 'k', token: a.token, fence: 1 })).valid, true);
});

// ---- US-08-R19 pull-request release ----
const pulls = map => async (repo, pr) => { const v = map[`${repo}#${pr}`]; if (v instanceof Error) throw v; return v; };

test('US-08-R19: a claim linked to a merged pull request is released at once with outcome merged and the item returns to ready', async () => {
  const { db, ctx } = setup(); item(db, 'A');
  await C.acquire(ctx, { item_id: 'A', holder: 'agent', repo: 'org/app', pr: 7 });
  const r = await C.reapClosedPulls(ctx, { readPull: pulls({ 'org/app#7': { state: 'merged', merged_at: '2026-11-11T09:50:00Z' } }) });
  assert.deepEqual(r.released, ['item:A']);
  assert.equal(db.raw.prepare(`SELECT outcome FROM claims_lock`).get().outcome, 'merged');
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='A'`).get().status, 'ready');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims`).get().n, 0, 'the seed mirror is released too');
  assert.equal((await C.reapClosedPulls(ctx, { readPull: pulls({ 'org/app#7': { state: 'merged' } }) })).released.length, 0, 'running twice releases once');
});

test('US-08-R19: a claim linked to a pull request closed 10 minutes ago is kept; after 30 minutes it is released as closed', async () => {
  const { db, ctx, clock } = setup(); item(db, 'A');
  await C.acquire(ctx, { item_id: 'A', holder: 'agent', repo: 'org/app', pr: 8 });
  const closedAt = new Date(T0 + 50 * MIN).toISOString();
  clock.t = T0 + 60 * MIN;
  const read = pulls({ 'org/app#8': { state: 'closed', closed_at: closedAt } });
  assert.deepEqual((await C.reapClosedPulls(ctx, { readPull: read })).kept, ['item:A']);
  clock.t = T0 + 81 * MIN;
  const r = await C.reapClosedPulls(ctx, { readPull: read });
  assert.deepEqual(r.released, ['item:A']);
  assert.equal(db.raw.prepare(`SELECT outcome FROM claims_lock`).get().outcome, 'closed');
});

test('US-08-R19: a claim on an open pull request or with no link is never touched', async () => {
  const { db, ctx } = setup(); item(db, 'A'); item(db, 'B');
  await C.acquire(ctx, { item_id: 'A', holder: 'agent', repo: 'org/app', pr: 9 });
  await C.acquire(ctx, { item_id: 'B', holder: 'agent' });
  const r = await C.reapClosedPulls(ctx, { readPull: pulls({ 'org/app#9': { state: 'open' } }) });
  assert.deepEqual([r.released, r.kept], [[], ['item:A']]);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_lock WHERE released_at IS NULL`).get().n, 2);
  assert.deepEqual((await C.releaseForPull(ctx, { repo: 'org/other', pr: 9, merged: true })).claims, []);
});

test('US-08-R19: an unreadable pull request releases nothing and is reported as unmeasured', async () => {
  const { db, ctx } = setup(); item(db, 'A'); item(db, 'B');
  await C.acquire(ctx, { item_id: 'A', holder: 'agent', repo: 'org/app', pr: 1 });
  await C.acquire(ctx, { item_id: 'B', holder: 'agent', repo: 'org/app', pr: 2 });
  const r = await C.reapClosedPulls(ctx, { readPull: pulls({ 'org/app#1': new Error('rate limited'), 'org/app#2': undefined }) });
  assert.deepEqual([r.released, r.unmeasured], [[], ['item:A', 'item:B']]);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_lock WHERE released_at IS NULL`).get().n, 2);
  const run = db.raw.prepare(`SELECT scanned, failed, gap FROM claims_loop_runs WHERE loop='claims_pr_reap'`).get();
  assert.deepEqual({ ...run }, { scanned: 2, failed: 2, gap: 0 });
  await assert.rejects(() => C.reapClosedPulls(ctx, {}), /readPull/);
});

test('US-08-R19: releaseForPull ends the claims of one pull request directly', async () => {
  const { ctx, db } = setup(); item(db, 'A');
  await C.acquire(ctx, { item_id: 'A', holder: 'agent', repo: 'org/app', pr: 3 });
  assert.deepEqual(await C.releaseForPull(ctx, { repo: 'org/app', pr: 3, merged: true }), { released: 1, claims: ['item:A'] });
  assert.equal(db.raw.prepare(`SELECT outcome FROM claims_lock`).get().outcome, 'merged');
});

// ---- US-08-R22 retention ----
test('US-08-R22: prune removes claims_events older than keep_days and keeps newer ones', async () => {
  const { db, ctx, clock } = setup();
  await C.acquire(ctx, { path: 'old', holder: 'a' });
  clock.t += 40 * 86400000;
  await C.acquire(ctx, { path: 'new', holder: 'a' });
  const before = db.raw.prepare(`SELECT COUNT(*) n FROM claims_events`).get().n;
  const r = await C.prune(ctx, { keep_days: 30 });
  assert.equal(r.events, 1);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_events`).get().n, before - 1);
  assert.equal(db.raw.prepare(`SELECT key FROM claims_events`).get().key, 'path:new');
  await assert.rejects(() => C.prune(ctx, { keep_days: -1 }), /non-negative/);
});

test('US-08-R22: prune never removes a live claim and keeps the newest row per key so the next fence is previous + 1', async () => {
  const { db, ctx, clock } = setup();
  const a = await C.acquire(ctx, { path: 'f', holder: 'a' }); await C.release(ctx, { path: 'f', token: a.token });
  const b = await C.acquire(ctx, { path: 'f', holder: 'b' }); await C.release(ctx, { path: 'f', token: b.token });
  const live = await C.acquire(ctx, { path: 'g', holder: 'c' });
  const gone = await C.acquire(ctx, { path: 'h', holder: 'd', repo: 'o/r', pr: 5 }); await C.release(ctx, { path: 'h', token: gone.token });
  clock.t += 90 * 86400000;
  await C.heartbeat(ctx, { path: 'g', token: live.token }).catch(() => null);
  const r = await C.prune(ctx, { keep_days: 30 });
  assert.equal(r.claims, 1, 'only the older released row of f goes; the newest row of every key stays');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_lock WHERE released_at IS NULL`).get().n, 1);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_lock WHERE key='path:f'`).get().n, 1);
  const c = await C.acquire(ctx, { path: 'f', holder: 'e' });
  assert.equal(c.fence, 3);
});

test('US-08-R22: reconcile prunes at most once a day and keeps the newest loop run of every loop', async () => {
  const { db, ctx, clock } = setup({ prune_keep_days: 1 });
  await C.recordLoopRun(ctx, { loop: 'drain', scanned: 1, executed: 1 });
  clock.t += 3 * 86400000;
  await C.recordLoopRun(ctx, { loop: 'other', scanned: 0 });
  const first = await C.reconcile(ctx);
  assert.equal(first.pruned.keep_days, 1);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM claims_loop_runs`).get().n, 2, 'drain keeps its only (newest) run');
  assert.equal((await C.reconcile(ctx)).pruned, undefined, 'the second call the same day does not prune again');
  clock.t += 25 * 3600000;
  assert.ok((await C.reconcile(ctx)).pruned);
});

// ---- US-08-R20 unworked release (the tick's reaper; the claims module's own store agrees) ----
test('US-08-R20: a claim released with no heartbeat is recorded as an unworked release, and the item is parked after max_unworked_releases', async () => {
  const { db, clock } = setup();
  item(db, 'A');
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m')`);
  const cfg = { claim_ttl_minutes: 120, max_unworked_releases: 2 };
  const tick = () => ({ now: clock.t, nowIso: new Date(clock.t).toISOString().replace('T', ' ').slice(0, 19), config: cfg, notes: [], tickId: 1 });
  for (let round = 1; round <= 2; round++) {
    db.raw.exec(`INSERT OR REPLACE INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES ('A','staff-1','${new Date(clock.t).toISOString().replace('T', ' ').slice(0, 19)}','${new Date(clock.t).toISOString().replace('T', ' ').slice(0, 19)}')`);
    db.raw.exec(`UPDATE items SET status='claimed' WHERE id='A'`);
    clock.t += 130 * MIN;
    await STEPS.reap_claims(db, tick());
    const st = db.raw.prepare(`SELECT status FROM items WHERE id='A'`).get().status;
    assert.equal(st, round < 2 ? 'ready' : 'blocked');
  }
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM outcomes WHERE item_id='A' AND surface='dispatch' AND action_class='claim_release' AND result='unworked'`).get().n, 2);
  assert.match(db.raw.prepare(`SELECT blocker FROM items WHERE id='A'`).get().blocker, /dispatched and released unworked 2 times/);
});

test('US-08-R20: a claim that was heartbeated is released without an unworked outcome', async () => {
  const { db, clock } = setup(); item(db, 'B');
  const at = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
  db.raw.exec(`INSERT INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES ('B','staff-1','${at(clock.t - 300 * MIN)}','${at(clock.t - 200 * MIN)}')`);
  db.raw.exec(`UPDATE items SET status='claimed' WHERE id='B'`);
  await STEPS.reap_claims(db, { now: clock.t, nowIso: at(clock.t), config: { claim_ttl_minutes: 120 }, notes: [] });
  assert.equal(db.raw.prepare(`SELECT status FROM items WHERE id='B'`).get().status, 'ready');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) n FROM outcomes WHERE item_id='B'`).get().n, 0);
});
