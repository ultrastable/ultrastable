// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for earned trust for packs (US-21-R12, R29, R22): outcomes become trust on pack:<id>, a reviewed change applies the rung,
// and the rung a pack acts at is the minimum of earned, class ceiling and the ceiling of the policy surface its class maps to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { KERNEL_DIR } from '../kernel/testkit.js';
import { createPacks, loadManifest, MIGRATIONS_DIR, policyWithPacks, OUTCOMES, DEFAULT_POLICY_SURFACE } from './index.js';
import { MIGRATIONS_DIR as TRUST_MIG } from '../trust/index.js';

const EXAMPLE_DIR = fileURLToPath(new URL('./example/', import.meta.url));
const POLICY = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const clone = o => JSON.parse(JSON.stringify(o));
const T0 = Date.now() - 3600e3;
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

async function setup({ policy = POLICY, config = {} } = {}) {
  const db = makeDb([KERNEL_DIR, MIGRATIONS_DIR, fileURLToPath(TRUST_MIG)]);
  const channel = { sent: [], send: async m => { channel.sent.push(m); return { id: `p${channel.sent.length}` }; } };
  const packs = createPacks({ db, now: () => T0, config: { step_timeout_ms: 500, policy, ...config }, channels: { fake: channel } });
  const m = loadManifest(EXAMPLE_DIR);
  assert.equal((await packs.register(m, { dir: EXAMPLE_DIR })).ok, true);
  assert.equal((await packs.enablePack('example', { by: 'owner', cardText: m.enable_gate })).ok, true);
  await packs.guard.consent.grant({ channel: 'fake', recipient: 'person@example.com' });
  return { db, packs, channel };
}
const send = (packs, k, kind = 'notice') => packs.guard.send({ pack: 'example', channel: 'fake', kind, recipient: 'person@example.com', content: 'hello there', idempotencyKey: k });
const verified = async (packs, n, kind = 'notice') => { for (let i = 0; i < n; i++) await packs.boundGuard('example').outcome({ kind, event: 'verified', ref: `r${i}` }); };
// one reviewed ladder cycle: recompute proposes, a different agent applies
async function climb(packs) {
  const { rows } = await packs.trust.refresh();
  const row = rows.find(r => r.surface === 'pack:example' && r.action_class === 'notice');
  if (!row || !row.item || row.indicated === row.rung) return { moved: false, row };
  return { moved: true, row, applied: await packs.trust.apply(row.item, 'reviewer-agent') };
}

test('T21-11 US-21-R29: twenty verified outcomes with a policy whose mapped surface allows execute raise the rung to the act rung and the next send is delivered, not queued', async () => {
  const policy = clone(POLICY); policy.surfaces.outreach.max_permission = 'execute';
  const { db, packs, channel } = await setup({ policy });
  assert.equal((await send(packs, 'k0')).decision, 'queued_for_approval');                // a new pack starts at the lowest rung
  await verified(packs, 20);
  assert.equal((await climb(packs)).applied.rung, 'assisted');
  assert.equal((await climb(packs)).applied.rung, 'delegated');
  assert.equal(one(db, `SELECT rung FROM trust_ledger WHERE surface='pack:example' AND action_class='notice'`).rung, 'delegated');
  const r = await send(packs, 'k1');
  assert.equal(r.decision, 'sent'); assert.equal(channel.sent.length, 1);
});

test('US-21-R29: with the shipped policy a class B pack never passes the act rung (outreach is propose) and keeps queueing', async () => {
  const { packs, channel } = await setup();
  await verified(packs, 30);
  assert.equal((await climb(packs)).applied.rung, 'assisted');                            // the policy ceiling for propose
  assert.equal((await climb(packs)).moved, false);
  assert.equal((await send(packs, 'k1')).decision, 'queued_for_approval');
  assert.equal(channel.sent.length, 0);
});

test('US-21-R29: a promotion needs a different agent than the one that opened the item; the same agent is refused', async () => {
  const policy = clone(POLICY); policy.surfaces.outreach.max_permission = 'execute';
  const { packs } = await setup({ policy });
  await verified(packs, 20);
  const { rows } = await packs.trust.refresh();
  const row = rows.find(r => r.action_class === 'notice');
  const same = await packs.trust.apply(row.item, 'operations');
  assert.equal(same.applied, false); assert.match(same.reason, /opened the item/);
  assert.equal((await packs.trust.apply('not-a-ladder-item', 'x')).reason, 'not_a_pack_transition');
});

test('T21-11 US-21-R29: a removed post (hidden failure) lowers the rung and the next send queues again', async () => {
  const policy = clone(POLICY); policy.surfaces.outreach.max_permission = 'execute';
  const { packs, channel } = await setup({ policy });
  await verified(packs, 20); await climb(packs); await climb(packs);
  assert.equal((await send(packs, 'k1')).decision, 'sent');
  await packs.boundGuard('example').outcome({ kind: 'notice', event: 'removed', ref: 'post-1' });
  const down = await climb(packs);
  assert.equal(down.row.indicated, 'assisted'); assert.equal(down.applied.rung, 'assisted');
  assert.equal((await send(packs, 'k2')).decision, 'queued_for_approval');
  assert.equal(channel.sent.length, 1);
});

test('US-21-R12: earned trust above the class ceiling is still clamped, and an unknown outcome is refused', async () => {
  const policy = clone(POLICY); policy.surfaces.outreach.max_permission = 'execute';
  const { db, packs } = await setup({ policy });
  db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('pack:example','notice','self-extending',1,99)`).run();
  assert.equal(one(db, `SELECT rung_ceiling FROM packs_registry WHERE id='example'`).rung_ceiling, 'autonomous');   // class B
  assert.equal((await send(packs, 'k1')).decision, 'sent');                                                          // clamped to autonomous, still at or above act
  assert.deepEqual(await packs.trust.outcome({ pack: 'example', kind: 'notice', event: 'liked' }), { ok: false, reason: 'unknown_outcome' });
  assert.equal(one(db, `SELECT COUNT(*) n FROM outcomes WHERE surface = 'pack:example'`).n, 0);
});

test('US-21-R22: act_rungs {notice: autonomous} queues a notice at delegated while a default kind still acts at delegated', async () => {
  const policy = clone(POLICY); policy.surfaces.outreach.max_permission = 'execute';        // a policy that allows the delegated rung the ledger below holds (US-21-R29)
  const { db, packs, channel } = await setup({ policy, config: { act_rungs: { notice: 'autonomous' } } });
  for (const kind of ['notice', 'update']) db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('pack:example',?, 'delegated',1,50)`).run(kind);
  const q = await send(packs, 'k1', 'notice');
  assert.equal(q.decision, 'queued_for_approval'); assert.equal(q.reason, 'rung_delegated_below_autonomous');
  assert.equal((await send(packs, 'k2', 'update')).decision, 'sent');
  assert.equal(channel.sent.length, 1);
});

test('US-21-R29: the policy overlay gives each pack a surface bounded by the surface its class maps to, and outcome kinds are stated', async () => {
  const o = policyWithPacks(POLICY, [{ id: 'a1', class: 'A' }, { id: 'b1', class: 'B' }, { id: 'd1', class: 'D' }]);
  assert.equal(o.surfaces['pack:a1'].max_permission, POLICY.surfaces[DEFAULT_POLICY_SURFACE.A].max_permission);
  assert.equal(o.surfaces['pack:b1'].max_permission, 'propose');
  assert.equal(o.surfaces['pack:d1'].max_permission, POLICY.surfaces.runtime.max_permission);
  assert.equal(POLICY.surfaces['pack:b1'], undefined, 'the input policy is not mutated');
  assert.deepEqual(Object.keys(OUTCOMES).sort(), ['complaint', 'failed', 'hidden_failure', 'removed', 'silent_drop', 'verified']);
});

test('T21-11 US-21-R29: a rung above the policy ceiling is clamped at send time: a ledger at delegated under the shipped policy (propose) queues, and a policy tightened after the rung was earned takes effect on the next send', async () => {
  const { db, packs, channel } = await setup();
  assert.equal(await packs.trust.policyCeiling('example'), 'assisted');
  db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('pack:example','notice','delegated',1,50)`).run();
  const q = await send(packs, 'k1');
  assert.equal(q.decision, 'queued_for_approval'); assert.equal(q.reason, 'rung_assisted_below_delegated');
  assert.equal(channel.sent.length, 0);
  // earned under a policy that allowed it, then tightened to the shipped one
  const loose = clone(POLICY); loose.surfaces.outreach.max_permission = 'execute';
  const b = await setup({ policy: loose });
  b.db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('pack:example','notice','delegated',1,50)`).run();
  assert.equal((await send(b.packs, 'k1')).decision, 'sent');
  const tight = createPacks({ db: b.db, now: () => T0, config: { step_timeout_ms: 500, policy: POLICY }, channels: { fake: b.channel } });
  assert.equal((await tight.guard.send({ pack: 'example', channel: 'fake', kind: 'notice', recipient: 'person@example.com', content: 'hello there', idempotencyKey: 'k2' })).decision, 'queued_for_approval');
  // no policy configured: the class ceiling alone applies, as before
  const none = await setup({ policy: null });
  none.db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('pack:example','notice','delegated',1,50)`).run();
  assert.equal((await send(none.packs, 'k1')).decision, 'sent');
});
