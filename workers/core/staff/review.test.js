// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { MIGRATIONS_DIR as KERNEL_DIR } from '../kernel/index.js';
import { createRouter } from '../router/router.js';
import { createModelPort } from '../modelport/index.js';
import { MIGRATIONS_DIR, doersOf, recordReview, reviewsWithoutPlus } from './index.js';

const ROUTER_DIR = fileURLToPath(new URL('../router/migrations/', import.meta.url));
const NOW = Date.parse('2026-11-10T12:00:00Z');
const setup = () => makeDb([KERNEL_DIR, ROUTER_DIR, MIGRATIONS_DIR]);
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const mkItem = (db, id, o = {}) => db.raw.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, status, project) VALUES (?,?,?,?,?,?,?)`).run(id, id, 'work', 'staff', 'x', o.status || 'ready', o.project ?? null);
const rev = (o = {}) => ({ item_id: 'W1', reviewer: 'reviewer-1', verdict: 'pass', evidence: 'read the diff and ran the probe', now: NOW, ...o });

test('US-02-R03, US-02-T08: a review by an agent that claimed, was dispatched, recorded an outcome or leads the doer line of the item is refused', async () => {
  const db = setup(); mkItem(db, 'W1');
  db.raw.prepare(`INSERT INTO claims (item_id, agent) VALUES ('W1', 'staff-1')`).run();
  db.raw.prepare(`INSERT INTO dispatches (tick_id, role_id, item_id, model) VALUES (1, 'staff-2', 'W1', 'm')`).run();
  db.raw.prepare(`INSERT INTO outcomes (item_id, agent, surface, action_class, result) VALUES ('W1', 'agent-7', 'repo', 'edit', 'verified')`).run();
  db.raw.prepare(`INSERT INTO kernel_item_meta (item_id, doer) VALUES ('W1', 'writer: site/home.js')`).run();
  assert.deepEqual((await doersOf(db, 'W1')).agents, ['agent-7', 'staff-1', 'staff-2', 'writer']);
  for (const who of ['staff-1', 'staff-2', 'agent-7', 'writer']) await assert.rejects(recordReview(db, rev({ reviewer: who })), /reviewer must differ from the doer of the item/);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM outcomes WHERE surface = 'review'`).n, 0);                  // a refusal records no review
  const ok = await recordReview(db, rev());
  assert.deepEqual([ok.ok, ok.verdict], [true, 'pass']);
  assert.equal(one(db, `SELECT result FROM outcomes WHERE surface = 'review' AND item_id = 'W1'`).result, 'verified');
});

test('US-02-R03: a manager operation or an earlier review on the item does not make its actor a doer', async () => {
  const db = setup(); mkItem(db, 'W1');
  db.raw.prepare(`INSERT INTO outcomes (item_id, agent, surface, action_class, result) VALUES ('W1', 'pgm-ops', 'manager-ops', 'promote', 'verified')`).run();
  await recordReview(db, rev({ reviewer: 'reviewer-1', plus: { title: 'Add a link', expected_value: 'usage +5%' } }));
  assert.deepEqual((await doersOf(db, 'W1')).agents, []);
  await recordReview(db, rev({ reviewer: 'reviewer-2' }));
  await recordReview(db, rev({ reviewer: 'pgm-ops' }));
});

test('US-02-R03, US-02-T04: with two families configured the router gives a reviewer a family other than the doer\'s, and the review refuses the doer\'s family', async () => {
  const db = setup(); mkItem(db, 'W1');
  const provider = (family, kind, ids) => ({ kind, base_url: `https://${family}.example/v1`, key_env: `${family.toUpperCase()}_KEY`, family,
    models: { small: { id: ids, capabilities: ['json'], usd_per_1k_in: 0.0002, usd_per_1k_out: 0.0008, context: 1000 } } });
  const config = { rungs: ['small'], fallbacks: ['pa', 'pb'], providers: { pa: provider('fam-a', 'openai', 'a-small'), pb: provider('fam-b', 'anthropic', 'b-small') } };
  const fetch = async (url) => new Response(JSON.stringify(url.includes('fam-a')
    ? { choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } } : { content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 });
  const router = createRouter({ db, fetch, now: () => NOW, config, env: { 'FAM-A_KEY': 'ka-1234', 'FAM-B_KEY': 'kb-1234' } });
  assert.equal((await router.call({ rung: 'small', item_id: 'W1', kind: 'doer' })).provider, 'pa');
  assert.deepEqual((await doersOf(db, 'W1')).families, ['fam-a']);
  const route = await router.route({ rung: 'small', item_id: 'W1', kind: 'reviewer' });
  assert.deepEqual(route.candidates.map(c => c.family), ['fam-b']);
  await assert.rejects(recordReview(db, rev({ reviewer: 'reviewer-1', reviewer_family: 'fam-a' })), /differ from the doer by model family: fam-a/);
  const ok = await recordReview(db, rev({ reviewer: 'reviewer-1', reviewer_family: route.candidates[0].family }));
  assert.deepEqual(ok.families_checked, ['fam-a']);
  // the deploy-time check (US-14-R10) agrees: a reviewer alias on the doer's family is an error when two families exist
  const mp = (revFamily) => createModelPort({ config: { aliases: { small: { endpoint: 'e', model: 'm1', family: 'fam-a' }, large: { endpoint: 'e', model: 'm2', family: revFamily } }, roles: { doer: 'small', reviewer: 'large' } }, endpoints: { e: async () => ({ text: '', tokens_in: 0, tokens_out: 0 }) } });
  assert.equal(mp('fam-b').deployCheck().ok, true); assert.equal(mp('fam-a').deployCheck().ok, true);   // one family only: a warning
  const two = createModelPort({ config: { aliases: { small: { endpoint: 'e', model: 'm1', family: 'fam-a' }, medium: { endpoint: 'e', model: 'm3', family: 'fam-b' }, large: { endpoint: 'e', model: 'm2', family: 'fam-a' } }, roles: { doer: 'small', reviewer: 'large' } }, endpoints: { e: async () => ({ text: '', tokens_in: 0, tokens_out: 0 }) } });
  assert.equal(two.deployCheck().ok, false);
});

test('US-02-R03: families are resolved from the model id, a port, or the families the doer calls recorded; a model of unknown family is not guessed', async () => {
  const db = setup(); mkItem(db, 'W1');
  await assert.rejects(recordReview(db, rev({ reviewer_model: 'o3', doer_models: ['gpt-5'] })), /by model family: openai/);
  await recordReview(db, rev({ reviewer_model: '@cf/mistral/mistral-7b-instruct', doer_models: ['@cf/meta/llama-3.1-8b-instruct'] }));
  await assert.rejects(recordReview(db, rev({ reviewer_model: 'beta-1', doer_models: ['beta-2'], reviewer: 'reviewer-3' })), /by model family: beta/);
  await recordReview(db, rev({ reviewer: 'reviewer-4', reviewer_model: 'x-1', doer_models: ['y-1'], familyOf: (m) => (m === 'x-1' ? 'one' : 'two') }));
  await recordReview(db, rev({ reviewer: 'reviewer-5' }));                                                   // no model named: nothing to compare, the agent check stands
});

test('US-04-R04: a passing review carries a plus filed as a kind plus item with its expected value; one that proposes none is listed by the detector', async () => {
  const db = setup(); mkItem(db, 'W1', { project: 'OPS' });
  const a = await recordReview(db, rev({ plus: { title: 'Add the two links the summary refers to', expected_value: 'usage +5% in 7 days' } }));
  assert.equal(a.plus_item, 'PLUS-W1-1');
  const it = one(db, `SELECT kind, owner_role, project, done_check FROM items WHERE id = 'PLUS-W1-1'`);
  assert.deepEqual([it.kind, it.owner_role, it.project], ['plus', 'product-manager', 'OPS']); assert.match(it.done_check, /expected value: usage \+5% in 7 days/);
  const b = await recordReview(db, rev({ reviewer: 'reviewer-2', plus: { title: 'Another', expected_value: 'fewer errors' } }));
  assert.equal(b.plus_item, 'PLUS-W1-2');
  await recordReview(db, rev({ reviewer: 'reviewer-3', verdict: 'fail', evidence: 'the probe returns 0' }));   // no plus
  assert.deepEqual((await reviewsWithoutPlus(db)).map(r => [r.item_id, r.reviewer]), [['W1', 'reviewer-3']]);
  assert.deepEqual(await reviewsWithoutPlus(db, { since: NOW + 3600e3 }), []);
  await assert.rejects(recordReview(db, rev({ reviewer: 'r', plus: { title: 'x' } })), /expected value/);
  await assert.rejects(recordReview(db, rev({ reviewer: 'r', verdict: 'maybe' })), /pass or fail/);
  await assert.rejects(recordReview(db, rev({ reviewer: 'r', evidence: ' ' })), /evidence/);
  await assert.rejects(recordReview(db, rev({ item_id: 'NOPE' })), /no such item/);
});
