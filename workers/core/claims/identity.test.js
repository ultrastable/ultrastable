// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-08-R23: claims and core/trust read one rule for "this card carries an identity-bound line", so neither reroutes a card the other holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as gate from './gate.js';
import * as trust from '../trust/index.js';

const dir = p => fileURLToPath(new URL(p, import.meta.url));
function mk(config = {}) {
  const clock = { t: Date.parse('2026-03-02T12:00:00Z') };
  const db = makeDb([dir('./migrations/'), dir('../trust/migrations/')]);
  return { db, clock, ctx: { db, now: () => clock.t, config } };
}
const all = async (ctx, sql, ...a) => (await ctx.db.prepare(sql).bind(...a).all()).results;
const open = (ctx, id, extra = {}) => trust.openCard(ctx.db, { id, what: `do ${id}`, why_gated: 'the owner must act', default_in_effect: 'nothing changes', closing_probe: 'item_done:never', ...extra }, { now: ctx.now() });

test('US-08-R23: a card opened by core/trust with an identity_bound_line is not counted or rerouted by claims rerouteCards', async () => {
  const { ctx } = mk({ reroute_cards: true });
  await open(ctx, 'pay-1', { identity_bound_line: 'Sends money from the owner account.' });
  await open(ctx, 'sign-2', { identity_bound_line: 'A signature in the owner name.', why_gated: 'needs a decision' });
  assert.equal((await gate.cardsWithoutIdentityLine(ctx)).length, 0);
  assert.equal(await trust.cardsWithoutIdentityLine(ctx.db), 0);
  const r = await gate.rerouteCards(ctx);
  assert.deepEqual(r.rerouted, []);
  assert.deepEqual((await all(ctx, `SELECT id, status FROM gate_cards ORDER BY id`)).map(c => c.status), ['open', 'open']);
  assert.equal((await all(ctx, `SELECT id FROM items WHERE id LIKE 'REROUTE-%'`)).length, 0);
  const s = await gate.step(ctx);
  assert.equal(s.rerouted, 0);
});

test('US-08-R23: a card with closing_probe env:FOO_KEY counts as having an identity line', async () => {
  const { ctx } = mk();
  await ctx.db.prepare(`INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('k','add the key','unsure','none','env:FOO_KEY')`).run();
  assert.equal((await gate.cardsWithoutIdentityLine(ctx)).length, 0);
});

test('US-08-R14: a card with neither a line, an env probe nor a pattern is rerouted as before', async () => {
  const { ctx } = mk({ reroute_cards: true });
  await ctx.db.prepare(`INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('loose','rename it','needs a decision on naming','none','manual')`).run();
  assert.equal((await gate.cardsWithoutIdentityLine(ctx)).length, 1);
  const r = await gate.rerouteCards(ctx);
  assert.deepEqual(r.rerouted, [{ card: 'loose', item: 'REROUTE-loose' }]);
});

test('US-08-R23: claims and trust report the same cards_without_identity_line count over a mixed set of stored-line and env: cards', async () => {
  const { ctx } = mk();
  await ctx.db.prepare(`INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('a','x','vague','none','manual'), ('b','y','vague','none','env:KEY_B'), ('e','w','vague','none','manual')`).run();
  await open(ctx, 'c', { identity_bound_line: 'Owner account.' });
  assert.deepEqual((await gate.cardsWithoutIdentityLine(ctx)).map(c => c.id), ['a', 'e']);
  assert.equal(await trust.cardsWithoutIdentityLine(ctx.db), 2);
});

// A recorded deviation, asserted so that it cannot change unseen: the why_gated text rule is held by claims only. When core/trust adopts it,
// this test is rewritten to expect agreement and US-08-R23 is BUILT in both modules (integration request to cluster C).
test('US-08-R23 deviation: a line written only into why_gated text counts for claims but not for core/trust, and trust.rerouteUnbound moves that card', async () => {
  const { ctx } = mk();
  await ctx.db.prepare(`INSERT INTO gate_cards (id, what, why_gated, default_in_effect, closing_probe) VALUES ('d','z','This is irreversible and identity-bound.','none','manual')`).run();
  assert.deepEqual((await gate.cardsWithoutIdentityLine(ctx)).map(c => c.id), []);
  assert.equal(await trust.cardsWithoutIdentityLine(ctx.db), 1);
  assert.deepEqual(await trust.rerouteUnbound(ctx.db, { now: ctx.now() }), [{ card: 'd', item: 'REROUTE-d' }]);
  assert.equal((await all(ctx, `SELECT status FROM gate_cards WHERE id = 'd'`))[0].status, 'closed');
});
