// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for the person-facing surface, presence-only secrets, bounce hooks, the guard transport and read-only channel probes
// (US-21-R18, R20, R21, R23, R25). Fake channel ports and an in-memory database; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { KERNEL_DIR } from '../kernel/testkit.js';
import { runTick } from '../src/tick.js';
import { createPacks, loadManifest, MIGRATIONS_DIR } from './index.js';
import * as outreach from '../outreach/index.js';

const EXAMPLE_DIR = fileURLToPath(new URL('./example/', import.meta.url));
const OUTREACH_MIG = fileURLToPath(new URL('../outreach/migrations/', import.meta.url));
const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const tickConfig = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.now() - 3600e3;
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);

const fakeChannel = (extra = {}) => { const c = { sent: [], ...extra }; c.send = async m => { c.sent.push(m); return { id: `prov-${c.sent.length}` }; }; return c; };
function setup({ channel = fakeChannel(), config = {}, extraMigrations = [], rung = 'delegated', env = {} } = {}) {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR, ...extraMigrations]);
  const packs = createPacks({ db, now: () => T0, env, config: { step_timeout_ms: 500, packs: { example: { recipients: ['person@example.com'] } }, ...config }, channels: { fake: channel } });
  if (rung) db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('pack:example','notice',?,1,50)`).run(rung);
  return { db, packs, channel };
}
// A copy of the example pack whose single loop and bounce hook are the given sources.
function packWith(files, patch = (m) => m) {
  const dir = mkdtempSync(path.join(tmpdir(), 'pack-s-'));
  copyFileSync(path.join(EXAMPLE_DIR, 'noop.js'), path.join(dir, 'noop.js'));
  const m = patch(loadManifest(EXAMPLE_DIR));
  writeFileSync(path.join(dir, 'pack.json'), JSON.stringify(m));
  for (const [f, src] of Object.entries(files)) writeFileSync(path.join(dir, f), src);
  return { dir, m };
}
const register = async (packs, { dir, m }) => { const r = await packs.register(m, { dir }); assert.equal(r.ok, true, JSON.stringify(r.errors)); return m; };
const enable = (packs, m, by = 'owner') => packs.enablePack(m.id, { by, cardText: m.enable_gate });
const req = (method, url, body, headers = {}) => new Request(`https://host.example${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

// ---------------- US-21-R18: the person-facing surface ----------------
test('US-21-R18: an unauthenticated request to every /packs route is 401', async () => {
  const { packs, db } = setup();
  const routes = packs.routes({ authorize: () => null, bounceSecret: 's3cret' });
  for (const [m, u] of [['GET', '/packs'], ['POST', '/packs/example/enable'], ['POST', '/packs/example/disable'], ['GET', '/packs/switches'], ['POST', '/packs/switches'], ['GET', '/packs/queue'], ['POST', '/packs/queue/1/approve'], ['POST', '/packs/queue/1/reject']]) {
    assert.equal((await routes.handle(req(m, u, m === 'POST' ? {} : undefined))).status, 401, `${m} ${u}`);
  }
  assert.equal((await routes.handle(req('POST', '/packs/bounces', {}))).status, 401);   // its own shared secret, not the person's login
  assert.equal(one(db, `SELECT COUNT(*) n FROM packs_actions`).n, 0);
});

test('US-21-R18: GET /packs shows the enable card text exactly as the manifest states it; enabling with different text is refused and nothing is recorded', async () => {
  const { packs, db } = setup();
  const m = loadManifest(EXAMPLE_DIR); await packs.register(m, { dir: EXAMPLE_DIR });
  const routes = packs.routes({ authorize: () => 'rowan' });
  const list = await (await routes.handle(req('GET', '/packs'))).json();
  assert.equal(list.packs[0].enable_gate, m.enable_gate);
  assert.equal(list.packs[0].enabled, false);
  assert.deepEqual(list.packs[0].scope.does_not, m.scope.does_not);
  const bad = await routes.handle(req('POST', '/packs/example/enable', { cardText: 'Turn it on, trust me' }));
  assert.equal(bad.status, 409); assert.equal((await bad.json()).reason, 'card_text_mismatch');
  assert.equal(one(db, `SELECT enabled FROM packs_registry WHERE id='example'`).enabled, 0);
  assert.equal(one(db, `SELECT COUNT(*) n FROM kernel_decisions`).n, 0);
});

test('US-21-R01 and US-21-R18: enable via the route records who, when and the card text; disable via the route stops the loops on the next tick', async () => {
  const { packs, db } = setup();
  const m = loadManifest(EXAMPLE_DIR); await packs.register(m, { dir: EXAMPLE_DIR });
  const routes = packs.routes({ authorize: r => r.headers.get('x-user') });
  const h = { 'x-user': 'rowan' };
  assert.equal((await routes.handle(req('POST', '/packs/example/enable', { cardText: m.enable_gate }, h))).status, 200);
  const row = one(db, `SELECT enabled, enabled_by, card_text_shown, decision_id FROM packs_registry WHERE id='example'`);
  assert.deepEqual([row.enabled, row.enabled_by, row.card_text_shown], [1, 'rowan', m.enable_gate]);
  assert.ok(row.decision_id);
  assert.equal((await packs.packSteps()).length, 1);
  assert.equal((await routes.handle(req('POST', '/packs/example/disable', {}, h))).status, 200);
  assert.equal((await packs.packSteps()).length, 0);
  assert.deepEqual(rows(db, `SELECT actor, action, target, result FROM packs_actions ORDER BY id`).map(r => `${r.actor}:${r.action}:${r.target}:${r.result}`), ['rowan:enable:example:ok', 'rowan:disable:example:ok']);
  assert.equal((await routes.handle(req('POST', '/packs/nope/disable', {}, h))).status, 404);
});

test('US-21-R18: approving a queued send through the route delivers it once; rejecting sends nothing and clears recipient and content', async () => {
  const { packs, db, channel } = setup({ rung: 'assisted' });                              // below the act rung: sends queue
  const m = loadManifest(EXAMPLE_DIR); await packs.register(m, { dir: EXAMPLE_DIR }); await enable(packs, m);
  await packs.guard.consent.grant({ channel: 'fake', recipient: 'person@example.com' });
  const send = k => packs.guard.send({ pack: 'example', channel: 'fake', kind: 'notice', recipient: 'person@example.com', content: 'hello there', idempotencyKey: k });
  const a = await send('k1'), b = await send('k2');
  assert.equal(a.decision, 'queued_for_approval');
  const routes = packs.routes({ authorize: () => 'rowan' });
  const q = await (await routes.handle(req('GET', '/packs/queue'))).json();
  assert.equal(q.queue.length, 2);
  assert.ok(!JSON.stringify(q).includes('person@example.com'), 'the queue view carries no recipient');
  const ok = await (await routes.handle(req('POST', `/packs/queue/${a.queueId}/approve`, {}))).json();
  assert.equal(ok.decision, 'sent'); assert.equal(channel.sent.length, 1);
  assert.equal((await routes.handle(req('POST', `/packs/queue/${a.queueId}/approve`, {}))).status, 404);   // a second approval delivers nothing
  assert.equal(channel.sent.length, 1);
  const no = await (await routes.handle(req('POST', `/packs/queue/${b.queueId}/reject`, {}))).json();
  assert.equal(no.reason, 'approval_rejected'); assert.equal(channel.sent.length, 1);
  const r = one(db, `SELECT recipient, content, status FROM guard_queue WHERE id = ?`, b.queueId);
  assert.deepEqual([r.recipient, r.content, r.status], [null, null, 'rejected']);
  assert.deepEqual(rows(db, `SELECT action, result FROM packs_actions WHERE action IN ('approve','reject') ORDER BY id`).map(x => `${x.action}:${x.result}`), ['approve:ok', 'approve:not_pending', 'reject:ok']);
});

test('US-21-R07 and US-21-R18: engaging a pack switch through the route stops that pack and no other', async () => {
  const { packs, db } = setup();
  const m = loadManifest(EXAMPLE_DIR); await packs.register(m, { dir: EXAMPLE_DIR }); await enable(packs, m);
  await packs.guard.consent.grant({ channel: 'fake', recipient: 'person@example.com' });
  const routes = packs.routes({ authorize: () => 'rowan' });
  assert.equal((await routes.handle(req('POST', '/packs/switches', { scope: 'pack:example', on: true, reason: 'trial' }))).status, 200);
  assert.equal((await packs.guard.send({ pack: 'example', channel: 'fake', kind: 'notice', recipient: 'person@example.com', content: 'x', idempotencyKey: 'a' })).reason, 'kill_switch_pack');
  assert.deepEqual((await (await routes.handle(req('GET', '/packs/switches'))).json()).switches.map(s => [s.scope, s.is_on]), [['pack:example', 1]]);
  assert.equal((await routes.handle(req('POST', '/packs/switches', { scope: 'bogus', on: true }))).status, 400);
  assert.equal((await routes.handle(req('POST', '/packs/switches', { scope: 'pack:example', on: false }))).status, 200);
  assert.equal((await packs.guard.send({ pack: 'example', channel: 'fake', kind: 'notice', recipient: 'person@example.com', content: 'x', idempotencyKey: 'b' })).decision, 'sent');
  assert.equal(one(db, `SELECT COUNT(*) n FROM packs_actions WHERE action = 'switch'`).n, 2);
});

test('US-21-R21 and US-21-R18: provider bounce events reach the core intake through the route behind the shared secret', async () => {
  const { packs, db } = setup();
  const routes = packs.routes({ authorize: () => null, bounceSecret: 's3cret' });
  const bad = await routes.handle(req('POST', '/packs/bounces?channel=fake', { recipient: 'p@example.com', kind: 'hard', eventId: 'e1' }, { 'x-bounce-token': 'wrong' }));
  assert.equal(bad.status, 401);
  const ok = await routes.handle(req('POST', '/packs/bounces?channel=fake', { recipient: 'p@example.com', kind: 'hard', eventId: 'e1' }, { 'x-bounce-token': 's3cret' }));
  assert.equal(ok.status, 200);
  assert.equal(one(db, `SELECT COUNT(*) n FROM guard_suppression`).n, 1);
});

// ---------------- US-21-R20: presence-only secrets ----------------
test('US-21-R20: a loop reads a declared secret from the tick env; an undeclared name is refused and recorded; a thrown value never reaches a log', async () => {
  const src = `export async function run({ secrets, ctx }) {
    ctx.notes.push('has declared: ' + secrets.has('EXAMPLE_KEY') + ', has other: ' + secrets.has('OTHER_KEY'));
    const v = secrets.get('EXAMPLE_KEY'); const o = secrets.get('OTHER_KEY');
    if (o !== undefined) throw new Error('undeclared secret leaked');
    throw new Error('provider said no to ' + v);
  }`;
  const p = packWith({ 'noop.js': src }, m => { m.requires.secrets = ['EXAMPLE_KEY']; return m; });
  const { db, packs } = setup();
  const m = await register(packs, p); assert.equal((await enable(packs, m)).ok, true);
  const [step] = await packs.packSteps();
  const ctx = { tickId: 1, notes: [], errors: [], env: { EXAMPLE_KEY: 'key-value-12345', OTHER_KEY: 'other-value-98765' }, now: T0, nowIso: '2026-11-26 00:00:00' };
  await step.run(db, ctx);
  const dump = JSON.stringify([rows(db, `SELECT * FROM packs_runs`), rows(db, `SELECT * FROM items`), ctx.errors, ctx.notes]);
  assert.ok(!dump.includes('key-value-12345'), 'the declared value is redacted everywhere');
  assert.ok(!dump.includes('other-value-98765'));
  assert.ok(rows(db, `SELECT outcome, error FROM packs_runs`).some(r => r.outcome === 'secret_not_declared' && r.error === 'OTHER_KEY'));
  assert.ok(ctx.notes.some(n => /has declared: true, has other: false/.test(n)));
});

// ---------------- US-21-R21: delivery events reach the owning pack ----------------
test('US-21-R21: a hard bounce, a complaint and a duplicate event reach the pack hook once each; a pack without a hook is untouched', async () => {
  const hook = `export async function onBounce({ db, event, outcome, guard }) {
    await db.prepare('INSERT INTO items (id, title, kind, owner_role, done_check, status) VALUES (?,?,?,?,?,?)').bind('EXAMPLEHOOK-' + event.kind + '-' + event.eventId, 'hook saw ' + event.kind + ' ' + outcome.action, 'fix', 'pack-manager-example', 'x', 'done').run();
  }`;
  const p = packWith({ 'hook.js': hook }, m => { m.hooks = { bounce: './hook.js#onBounce' }; return m; });
  const { db, packs } = setup();
  const m = await register(packs, p); await enable(packs, m);
  await packs.bounces.ingest({ channel: 'fake', recipient: 'p@example.com', kind: 'hard', eventId: 'e1' });
  await packs.bounces.ingest({ channel: 'fake', recipient: 'p@example.com', kind: 'hard', eventId: 'e1' });          // duplicate: the hook is not called again
  await packs.bounces.ingest({ channel: 'fake', recipient: 'q@example.com', kind: 'complaint', eventId: 'e2' });
  assert.deepEqual(rows(db, `SELECT title FROM items WHERE id LIKE 'EXAMPLEHOOK-%' ORDER BY id`).map(r => r.title), ['hook saw complaint suppressed:*', 'hook saw hard suppressed:fake']);
  await packs.bounces.ingest({ channel: 'other', recipient: 'r@example.com', kind: 'hard', eventId: 'e3' });          // a channel the pack does not send on
  assert.equal(rows(db, `SELECT id FROM items WHERE id LIKE 'EXAMPLEHOOK-%'`).length, 2);
  assert.equal(one(db, `SELECT COUNT(*) n FROM guard_suppression`).n, 3);                                            // suppression applied for every event regardless
  // trust outcomes: complaint is a hidden failure, hard bounce a failure, both on pack:example
  assert.deepEqual(rows(db, `SELECT result FROM outcomes WHERE surface = 'pack:example' ORDER BY id`).map(r => r.result), ['failed', 'hidden_failure']);
});

test('US-21-R21: a failing hook files one item and the suppression it follows stays applied', async () => {
  const p = packWith({ 'hook.js': `export async function onBounce() { throw new Error('hook broke'); }` }, m => { m.hooks = { bounce: './hook.js#onBounce' }; return m; });
  const { db, packs } = setup();
  const m = await register(packs, p); await enable(packs, m);
  const r = await packs.bounces.ingest({ channel: 'fake', recipient: 'p@example.com', kind: 'hard', eventId: 'e9' });
  assert.equal(r.ok, true);
  assert.equal(one(db, `SELECT COUNT(*) n FROM guard_suppression`).n, 1);
  assert.equal(one(db, `SELECT COUNT(*) n FROM items WHERE id LIKE 'PACKFAIL-example-hook-bounce-%'`).n, 1);
  assert.equal(one(db, `SELECT outcome FROM packs_runs WHERE loop_id = 'hook:bounce'`).outcome, 'error');
});

// ---------------- US-21-R23: the guard-backed transport ----------------
test('US-21-R23: core/outreach.dispatch through the guard transport sends nothing for a guard-suppressed recipient and records the refusal', async () => {
  const { packs, db, channel } = setup({ extraMigrations: [OUTREACH_MIG] });
  const m = loadManifest(EXAMPLE_DIR); await packs.register(m, { dir: EXAMPLE_DIR }); await enable(packs, m);
  await packs.guard.consent.grant({ channel: 'fake', recipient: 'a@example.org' });
  const ctx = { db, now: () => T0, config: { sender: { name: 'Example Org', postal: '1 Example St', reply_to: 'hi@example.org' }, footer: 'Sent automatically.' } };
  await outreach.submit(ctx, { tenant: 't', id: 'i1', to: 'a@example.org', subject: 'hello', body: 'A note', evidence_url: 'https://example.org/e' });
  await outreach.approve(ctx, 'i1', 'a person');
  await packs.guard.suppress({ channel: 'fake', recipient: 'a@example.org', reason: 'manual' });
  const transport = packs.transport({ pack: 'example', channel: 'fake', kind: 'notice' });
  await assert.rejects(outreach.dispatch(ctx, { transport }), /guard_refused:suppressed/);
  assert.equal(channel.sent.length, 0);
  assert.equal(one(db, `SELECT status FROM outreach_intents WHERE id='i1'`).status, 'approved');       // not marked sent
  assert.equal(one(db, `SELECT reason FROM guard_ledger WHERE pack='example' ORDER BY id DESC LIMIT 1`).reason, 'suppressed');
});

test('US-21-R23 and US-21-R14: below the act rung the dispatch is queued as a decision card and dispatch does not mark it sent; at the act rung it sends through the same guard', async () => {
  const { packs, db, channel } = setup({ extraMigrations: [OUTREACH_MIG], rung: 'assisted' });
  const m = loadManifest(EXAMPLE_DIR); await packs.register(m, { dir: EXAMPLE_DIR }); await enable(packs, m);
  await packs.guard.consent.grant({ channel: 'fake', recipient: 'a@example.org' });
  const ctx = { db, now: () => T0, config: { sender: { name: 'Example Org', postal: '1 Example St', reply_to: 'hi@example.org' }, footer: 'Sent automatically.' } };
  await outreach.submit(ctx, { tenant: 't', id: 'i1', to: 'a@example.org', subject: 'hello', body: 'A note', evidence_url: 'https://example.org/e' });
  await outreach.approve(ctx, 'i1', 'a person');
  const transport = packs.transport({ pack: 'example', channel: 'fake', kind: 'notice' });
  await assert.rejects(outreach.dispatch(ctx, { transport }), /guard_queued_for_approval/);
  assert.equal(channel.sent.length, 0);
  assert.equal(one(db, `SELECT COUNT(*) n FROM guard_queue WHERE status='pending'`).n, 1);
  assert.equal(one(db, `SELECT status FROM outreach_intents WHERE id='i1'`).status, 'approved');
  const q = rows(db, `SELECT id FROM guard_queue`)[0];
  await packs.guard.approve(q.id, { by: 'rowan' });                                                       // the person approves the card
  assert.equal(channel.sent.length, 1);
  assert.match(channel.sent[0].content, /Example Org, 1 Example St/);                                    // the footer and identity core/outreach renders travel with it
});

// ---------------- US-21-R25: read-only probes and the live-trial gate ----------------
test('US-21-R25: enabling an outbound pack opens the live-trial card with its default in effect; a passing probe closes it through the tick', async () => {
  const probed = [];
  const channel = fakeChannel({ probe: async () => { probed.push('read'); return { ok: true, detail: 'session ok' }; } });
  const { db, packs } = setup({ channel });
  const m = loadManifest(EXAMPLE_DIR); await packs.register(m, { dir: EXAMPLE_DIR }); await enable(packs, m);
  const card = one(db, `SELECT * FROM gate_cards WHERE id = 'pack-trial-example'`);
  assert.equal(card.status, 'open'); assert.match(card.default_in_effect, /approval/); assert.equal(card.closing_probe, 'item_done:PACKTRIAL-example');
  const r = await packs.probeChannels();
  assert.deepEqual(r, [{ pack: 'example', channel: 'fake', ok: true, detail: 'session ok' }]);
  assert.equal(channel.sent.length, 0, 'a probe never calls send');
  assert.equal(one(db, `SELECT status FROM items WHERE id = 'PACKTRIAL-example'`).status, 'done');
  await runTick(db, { config: tickConfig, now: T0, env: {} });
  assert.equal(one(db, `SELECT status FROM gate_cards WHERE id = 'pack-trial-example'`).status, 'closed');
});

test('US-21-R25: a failing probe on an enabled pack files one PACKPROBE item with a redacted detail; a disabled pack is not probed', async () => {
  let calls = 0;
  const channel = fakeChannel({ probe: async () => { calls++; throw new Error('401 Bearer abcdefghijklmnopqrstuvwxyz0123'); } });
  const { db, packs } = setup({ channel });
  const m = loadManifest(EXAMPLE_DIR); await packs.register(m, { dir: EXAMPLE_DIR });
  assert.deepEqual(await packs.probeChannels(), []);                                                         // registered but not enabled
  await enable(packs, m);
  await packs.probeChannels(); await packs.probeChannels();
  assert.equal(calls, 2);
  assert.equal(one(db, `SELECT COUNT(*) n FROM items WHERE id = 'PACKPROBE-example-fake'`).n, 1);
  const d = one(db, `SELECT ok, detail FROM packs_probes ORDER BY id DESC LIMIT 1`);
  assert.equal(d.ok, 0); assert.ok(!d.detail.includes('abcdefghijklmnopqrstuvwxyz0123'));
  assert.equal(one(db, `SELECT status FROM items WHERE id = 'PACKTRIAL-example'`).status, 'ready');         // the trial stays open
  await packs.disablePack('example');
  assert.deepEqual(await packs.probeChannels(), []);
  assert.equal(calls, 2);
});

test('US-21-R25: a channel without a probe is reported no_probe and does not close the trial', async () => {
  const { db, packs } = setup();
  const m = loadManifest(EXAMPLE_DIR); await packs.register(m, { dir: EXAMPLE_DIR }); await enable(packs, m);
  assert.deepEqual(await packs.probeChannels(), [{ pack: 'example', channel: 'fake', ok: null, detail: 'no_probe' }]);
  assert.equal(one(db, `SELECT status FROM items WHERE id = 'PACKTRIAL-example'`).status, 'ready');
});
