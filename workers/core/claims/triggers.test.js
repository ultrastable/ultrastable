// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for triggers at dispatch and the held-item release (US-SPEC-08 R03, R05, R27, R28, R29, T04).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { acquire } from './index.js';
import * as gate from './gate.js';
import { parseTriggers, triggerState } from './triggers.js';
import { STEPS } from '../src/tick.js';

const mig = fileURLToPath(new URL('./migrations/', import.meta.url));
function mk() {
  const clock = { t: Date.parse('2026-03-02T12:00:00Z') };
  return { ctx: { db: makeDb([mig]), now: () => clock.t, config: {} }, clock };
}
const one = async (ctx, sql, ...a) => ctx.db.prepare(sql).bind(...a).first();
const item = (ctx, id, status = 'open', { disposition = null, trigger = null, owner = 'staff' } = {}) =>
  ctx.db.prepare(`INSERT INTO items (id,title,owner_role,done_check,status,disposition,trigger_on) VALUES (?,?,?,?,?,?,?)`).bind(id, id, owner, 'x', status, disposition, trigger).run();
const status = async (ctx, id) => (await one(ctx, `SELECT status FROM items WHERE id = ?`, id)).status;
const card = (ctx, id, probe = 'item_done:never', st = 'open') =>
  ctx.db.prepare(`INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe, status) VALUES (?,?,?,?,?,?)`).bind(id, `do ${id}`, 'only the principal can', 'nothing changes', probe, st).run();
const tickCtx = (clock, extra = {}) => ({ now: clock.t, nowIso: new Date(clock.t).toISOString().replace('T', ' ').slice(0, 19), tickId: 1, notes: [], env: {}, config: { max_wip_per_role: 3, claim_ttl_minutes: 120 }, ...extra });

test('US-08-R28: a trigger is one item, a comma list of items, or gate:<card>', () => {
  assert.deepEqual(parseTriggers('A'), { items: ['A'], gates: [] });
  assert.deepEqual(parseTriggers(' A, B ,gate:G1,A'), { items: ['A', 'B'], gates: ['G1'] });
  assert.deepEqual(parseTriggers(null), { items: [], gates: [] });
});

test('US-08-R03: a ready item whose trigger item is reopened is demoted to open by the claims step and cannot be claimed or dispatched', async () => {
  const { ctx, clock } = mk();
  await item(ctx, 'A', 'done', { disposition: 'shipped' });
  await item(ctx, 'C', 'ready', { trigger: 'A' });
  assert.equal((await acquire(ctx, { item_id: 'C', holder: 'x' })).acquired, true);   // A is done: C may be claimed
  await ctx.db.prepare(`DELETE FROM claims_lock`).run(); await ctx.db.prepare(`DELETE FROM claims`).run(); await ctx.db.prepare(`UPDATE items SET status='ready' WHERE id='C'`).run();
  await ctx.db.prepare(`UPDATE items SET status='open', disposition=NULL WHERE id='A'`).run();   // a silent-drop reconcile reopened the trigger
  const s = await gate.step(ctx);
  assert.deepEqual(s.triggers_demoted, ['C']);
  assert.equal(await status(ctx, 'C'), 'open');
  const refused = await acquire(ctx, { item_id: 'C', holder: 'y' });
  assert.deepEqual([refused.acquired, refused.reason, refused.waiting_on], [false, 'trigger_not_done', ['A']]);
  await ctx.db.prepare(`INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m')`).run();
  await STEPS.dispatch(ctx.db, tickCtx(clock));
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM dispatches WHERE item_id='C'`)).n, 0);
  assert.equal((await one(ctx, `SELECT 1 AS x FROM outcomes WHERE item_id='C' AND action_class='trigger_guard'`)).x, 1);
});

test('US-08-R28: a trigger naming two items becomes ready only when both are done with a disposition', async () => {
  const { ctx } = mk();
  await item(ctx, 'A', 'done', { disposition: 'ok' }); await item(ctx, 'B', 'ready');
  await item(ctx, 'C', 'open', { trigger: 'A,B' });
  assert.deepEqual((await gate.step(ctx)).triggers_promoted, undefined);
  assert.equal(await status(ctx, 'C'), 'open');
  const st = await triggerState(ctx, 'A,B');
  assert.deepEqual([st.done, st.waiting_on], [false, ['B']]);
  await ctx.db.prepare(`UPDATE items SET status='done', disposition='ok' WHERE id='B'`).run();
  assert.deepEqual((await gate.step(ctx)).triggers_promoted, ['C']);
  assert.equal(await status(ctx, 'C'), 'ready');
});

test('US-08-R28: a trigger gate:<card> waits for the card to close, then the item becomes ready', async () => {
  const { ctx } = mk();
  await card(ctx, 'G1');
  await item(ctx, 'C', 'open', { trigger: 'gate:G1' });
  await gate.step(ctx);
  assert.equal(await status(ctx, 'C'), 'open');
  assert.equal((await acquire(ctx, { item_id: 'C', holder: 'x' })).reason, 'trigger_not_done');
  await ctx.db.prepare(`UPDATE gate_cards SET status='closed' WHERE id='G1'`).run();
  await gate.step(ctx);
  assert.equal(await status(ctx, 'C'), 'ready');
  assert.equal((await acquire(ctx, { item_id: 'C', holder: 'x' })).acquired, true);
  assert.equal((await triggerState(ctx, 'gate:no-such-card')).done, false);   // a card that does not exist is not closed
});

test('US-08-R03: an item whose trigger is done without a disposition is not released', async () => {
  const { ctx } = mk();
  await item(ctx, 'A', 'done', { disposition: null }); await item(ctx, 'C', 'open', { trigger: 'A' });
  await gate.step(ctx);
  assert.equal(await status(ctx, 'C'), 'open');
  const st = await triggerState(ctx, 'A');
  assert.equal(st.reasons.A, 'done without a disposition');
  await ctx.db.prepare(`UPDATE items SET disposition='accounted' WHERE id='A'`).run();
  await gate.step(ctx);
  assert.equal(await status(ctx, 'C'), 'ready');
});

test('US-08-R03: a single-id trigger behaves as before: not done refuses, done admits, a claimed item is never demoted', async () => {
  const { ctx } = mk();
  await item(ctx, 'A', 'ready'); await item(ctx, 'C', 'ready', { trigger: 'A' }); await item(ctx, 'D', 'claimed', { trigger: 'A' });
  assert.equal((await acquire(ctx, { item_id: 'C', holder: 'x' })).reason, 'trigger_not_done');
  assert.deepEqual((await gate.step(ctx)).triggers_demoted, ['C']);
  assert.equal(await status(ctx, 'D'), 'claimed');
  await ctx.db.prepare(`UPDATE items SET status='done', disposition='v' WHERE id='A'`).run();
  assert.equal((await acquire(ctx, { item_id: 'C', holder: 'x' })).acquired, true);
});

test('US-08-R03: a dispatched item whose list or gate trigger is not done loses its claim and returns to open; a claim granted by acquire stays with its holder', async () => {
  const { ctx } = mk();
  await item(ctx, 'A', 'open'); await item(ctx, 'B', 'done', { disposition: 'merged' });
  await item(ctx, 'L', 'claimed', { trigger: 'A,B' }); await item(ctx, 'G', 'claimed', { trigger: 'gate:card-1' });
  // a dispatcher that does not read list or gate triggers (the seed's pickForRole, or a host's) has claimed both in the tick's claims table
  await ctx.db.prepare(`INSERT INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES ('L','staff-1','2026-03-02 12:00:00','2026-03-02 12:00:00'), ('G','staff-1','2026-03-02 12:00:00','2026-03-02 12:00:00')`).run();
  const claimed = async () => (await ctx.db.prepare(`SELECT item_id FROM claims ORDER BY item_id`).all()).results.map(r => r.item_id);
  assert.deepEqual(await claimed(), ['G', 'L']);
  // M was claimed through acquire while its trigger was done; the trigger is reopened afterwards
  await item(ctx, 'R', 'done', { disposition: 'ok' }); await item(ctx, 'M', 'ready', { trigger: 'R' });
  assert.equal((await acquire(ctx, { item_id: 'M', holder: 'agent' })).acquired, true);
  await ctx.db.prepare(`UPDATE items SET status='open', disposition=NULL WHERE id='R'`).run();
  const s = await gate.step(ctx);
  assert.deepEqual(s.triggers_released, ['G', 'L']);
  assert.deepEqual([await status(ctx, 'G'), await status(ctx, 'L'), await status(ctx, 'M')], ['open', 'open', 'claimed']);
  assert.deepEqual(await claimed(), ['M'], 'only the claim acquire granted is kept');
  const why = (await one(ctx, `SELECT evidence FROM outcomes WHERE item_id='L' AND action_class='trigger_guard'`)).evidence;
  assert.match(why, /^claim of staff-1 released, back to open: trigger not done \(A: status open\)$/);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM claims_events WHERE event='trigger-not-done'`)).n, 2);
  // once the trigger is done the item is promoted again and can be dispatched
  await ctx.db.prepare(`UPDATE items SET status='done', disposition='ok' WHERE id='A'`).run();
  assert.deepEqual((await gate.step(ctx)).triggers_promoted, ['L']);
  assert.equal((await gate.step(ctx)).triggers_released, undefined, 'a step with nothing to release reports nothing');
});

test('US-08-R29: an item held by gate card G returns to ready with its blocker cleared when G closes', async () => {
  const { ctx } = mk();
  await item(ctx, 'X', 'ready'); await item(ctx, 'ship', 'ready');
  const held = await gate.routeToPrincipal(ctx, { item_id: 'ship', what: 'Sign the filing', why_gated: 'legal signature', default_in_effect: 'the filing stays a draft', closing_probe: 'item_done:X', identity_bound_line: 'A legal signature of the owner.' });
  assert.equal(held.card, 'gate-ship');
  await gate.step(ctx);
  assert.equal(await status(ctx, 'ship'), 'blocked');                     // while G is open the item stays blocked
  await ctx.db.prepare(`UPDATE items SET status='done', disposition='signed' WHERE id='X'`).run();
  const tc = tickCtx({ t: Date.parse('2026-03-02T12:10:00Z') });
  await STEPS.probe_gates(ctx.db, tc);                                      // US-08-R05: the card closes itself on its probe
  assert.equal((await one(ctx, `SELECT status FROM gate_cards WHERE id='gate-ship'`)).status, 'closed');
  const s = await gate.step(ctx);
  assert.deepEqual(s.held_released, ['ship']);
  assert.deepEqual(await one(ctx, `SELECT status, blocker FROM items WHERE id='ship'`), { status: 'ready', blocker: null });
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM claims_events WHERE event='gate-released'`)).n, 1);
  assert.equal((await gate.releaseHeld(ctx)).released.length, 0);          // idempotent
});

test('US-08-R29: an item blocked with another blocker text is never released by the step', async () => {
  const { ctx } = mk();
  await card(ctx, 'G2', 'manual', 'closed');
  await item(ctx, 'P', 'blocked');
  await ctx.db.prepare(`UPDATE items SET blocker='waiting on probe: file:x' WHERE id='P'`).run();
  await item(ctx, 'Q', 'blocked');
  await ctx.db.prepare(`UPDATE items SET blocker='gate card G-open' WHERE id='Q'`).run();
  await card(ctx, 'G-open');
  await gate.step(ctx);
  assert.equal(await status(ctx, 'P'), 'blocked'); assert.equal(await status(ctx, 'Q'), 'blocked');
});

test('US-08-R05: a gate card closes itself when its closing probe passes (env: and item_done:), and open cards stay open', async () => {
  const { ctx, clock } = mk();
  await item(ctx, 'D1', 'done', { disposition: 'x' });
  await card(ctx, 'by-env', 'env:SOME_KEY'); await card(ctx, 'by-item', 'item_done:D1'); await card(ctx, 'stays', 'item_done:nothing');
  const tc = tickCtx(clock, { env: { SOME_KEY: 'present' } });
  await STEPS.probe_gates(ctx.db, tc);
  const rows = (await ctx.db.prepare(`SELECT id, status, closed_at FROM gate_cards ORDER BY id`).all()).results;
  assert.deepEqual(rows.map(r => [r.id, r.status]), [['by-env', 'closed'], ['by-item', 'closed'], ['stays', 'open']]);
  assert.ok(rows[0].closed_at);
  assert.equal(tc.openGates, 1);
});

test('US-08-R28: the trigger step reads in a number of statements that does not grow with the number of triggered items', async () => {
  const { ctx } = mk();
  await item(ctx, 'ROOT', 'done', { disposition: 'ok' });
  for (let i = 0; i < 150; i++) await item(ctx, `I${i}`, 'open', { trigger: i % 3 === 0 ? 'ROOT' : i % 3 === 1 ? 'ROOT,NOPE' : 'gate:NOGATE' });
  let n = 0;
  const counting = { ...ctx, db: { prepare(sql) { n++; return ctx.db.prepare(sql); } } };
  const r = await gate.enforceTriggers(counting);
  assert.equal(r.promoted.length, 50);                       // only the items whose single trigger is done
  assert.ok(n < 50 + 15, `statements used: ${n}`);            // 50 updates plus a bounded number of reads
  const states = await (await import('./triggers.js')).triggerStates(ctx, ['ROOT', 'ROOT,NOPE', 'gate:NOGATE']);
  assert.deepEqual([...states.values()].map(s => s.done), [true, false, false]);
});

test('US-08-R27: the trigger scan pages past trigger_scan_max, so old items waiting on a trigger do not starve a newer item that is ready to promote', async () => {
  const { ctx } = mk();
  ctx.config = { ...(ctx.config || {}), trigger_scan_max: 2 };
  await item(ctx, 'NEVER', 'open');
  await item(ctx, 'ROOT', 'done', { disposition: 'ok' });
  await item(ctx, 'A', 'open', { trigger: 'NEVER' });
  await item(ctx, 'B', 'open', { trigger: 'NEVER' });
  await item(ctx, 'C', 'open', { trigger: 'ROOT' });
  const r = await gate.enforceTriggers(ctx);
  assert.deepEqual(r.promoted, ['C']);
  assert.deepEqual(r.truncated, []);
  assert.equal(r.scanned, 3);
});

test('US-08-R27: a trigger scan cut by the page budget is reported (truncated, scanned) and written to claims_events, never silent', async () => {
  const { ctx } = mk();
  ctx.config = { ...(ctx.config || {}), trigger_scan_max: 2, trigger_scan_pages: 1 };
  await item(ctx, 'NEVER', 'open');
  await item(ctx, 'ROOT', 'done', { disposition: 'ok' });
  await item(ctx, 'A', 'open', { trigger: 'NEVER' });
  await item(ctx, 'B', 'open', { trigger: 'NEVER' });
  await item(ctx, 'C', 'open', { trigger: 'ROOT' });
  const r = await gate.enforceTriggers(ctx);
  assert.deepEqual([r.promoted, r.truncated, r.scanned], [[], ['open'], 2]);
  const ev = (await ctx.db.prepare(`SELECT event, detail FROM claims_events WHERE event = 'scan-truncated'`).all()).results;
  assert.equal(ev.length, 1);
  assert.match(ev[0].detail, /stopped after 1 page\(s\) of 2 for status open; 2 item\(s\) read/);
  assert.deepEqual((await gate.step(ctx)).triggers_truncated, ['open']);
  // exactly as many items as the budget reads is not a cut
  const { ctx: c2 } = mk();
  c2.config = { ...(c2.config || {}), trigger_scan_max: 2, trigger_scan_pages: 1 };
  await item(c2, 'X', 'open', { trigger: 'GONE' }); await item(c2, 'Y', 'open', { trigger: 'GONE' });
  assert.deepEqual((await gate.enforceTriggers(c2)).truncated, []);
});
