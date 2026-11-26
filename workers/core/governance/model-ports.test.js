// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-07-R02 and US-07-R17 through the real model ladder (core/router) with a fake fetch: no network, no key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { createRouter } from '../router/router.js';
import * as G from './index.js';
import { createModelPorts, parseJson } from './model-ports.js';

const EXAMPLE = JSON.parse(readFileSync(new URL('../router/example-config.json', import.meta.url), 'utf8'));
const KEYS = { PROVIDER_A_API_KEY: 'sk-test-secret-aaaa', PROVIDER_B_API_KEY: 'sk-test-secret-bbbb' };
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const dirs = [fileURLToPath(G.MIGRATIONS_DIR), fileURLToPath(new URL('../router/migrations/', import.meta.url))];
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

// provider-a answers as an openai-style API, provider-b as an anthropic-style one; `say` maps a provider letter to the JSON it returns.
function fakeFetch(say) {
  const calls = [];
  const f = async (url, init) => {
    const a = url.includes('provider-a');
    calls.push({ provider: a ? 'a' : 'b', body: JSON.parse(init.body) });
    const text = say[a ? 'a' : 'b'];
    if (text === undefined) return new Response('down', { status: 500 });
    return new Response(JSON.stringify(a ? { choices: [{ message: { content: text } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }
      : { content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 50 } }), { status: 200 });
  };
  f.calls = calls;
  return f;
}
async function mk({ say, config = EXAMPLE } = {}) {
  const db = makeDb(dirs);
  await G.seedRegister(db, { now: NOW });
  const fetch = fakeFetch(say);
  const router = createRouter({ db, fetch, now: () => NOW, config, env: KEYS });
  return { db, fetch, router, ports: createModelPorts({ router }) };
}
const RULE = JSON.stringify({ rule_text: 'Also recognise "shall I proceed" as a conditional offer.', changes: [{ op: 'add_phrase', pattern_key: 'conditional_offer', phrase: 'shall i proceed' }, { op: 'bogus' }] });
const collected = (db, id) => db.raw.prepare(`INSERT INTO governance_proposals (id, created_at, origin, pattern_key, source, evidence, status) VALUES (?, '2026-11-11 09:00:00', 'threshold', 'conditional_offer', 'doer-1', '{}', 'collected')`).run(id);

test('US-07-R02: a proposal authored by one family is red-teamed through the router by a different family', async () => {
  const { db, ports, fetch } = await mk({ say: { a: RULE, b: JSON.stringify({ harm: false, case: '' }) } });
  collected(db, 'P1');
  assert.deepEqual(await G.generateRules(db, { generate: ports.generate }), ['P1']);
  const p = one(db, `SELECT author, author_family, rule_text, changes FROM governance_proposals WHERE id='P1'`);
  assert.equal(p.author_family, 'family-a');
  assert.match(p.author, /^provider-a\//);
  assert.deepEqual(JSON.parse(p.changes).map(c => c.op), ['add_phrase'], 'an op outside the allowed list is dropped by code');
  const r = await G.redTeam(db, 'P1', { redteam: ports.redteam, now: NOW });
  assert.equal(r.status, 'redteamed');
  assert.equal(JSON.parse(one(db, `SELECT redteam FROM governance_proposals WHERE id='P1'`).redteam).family, 'family-b');
  assert.deepEqual(fetch.calls.map(c => c.provider), ['a', 'b'], 'the second call went to the other family');
  // the router's own ledger shows a doer call and a reviewer call on the same item, in different families
  const fam = db.raw.prepare(`SELECT kind, family FROM router_calls WHERE item_id='P1' ORDER BY id`).all().map(x => [x.kind, x.family]);
  assert.deepEqual(fam, [['doer', 'family-a'], ['reviewer', 'family-b']]);
  // the rule text is data: it travels in the user message, never joined into the system instructions
  const body = fetch.calls[1].body;
  assert.ok(!body.system.includes('shall i proceed') && body.messages[0].content.includes('shall i proceed'));
});

test('US-07-R02: with only one family configured the proposal waits: no red-team model, and no reply is taken from the author\'s family', async () => {
  const one_family = { ...EXAMPLE, providers: { 'provider-a': EXAMPLE.providers['provider-a'] }, fallbacks: ['provider-a'] };
  const { db, ports, fetch } = await mk({ say: { a: RULE }, config: one_family });
  collected(db, 'P2');
  await G.generateRules(db, { generate: ports.generate });
  const r = await G.redTeam(db, 'P2', { redteam: ports.redteam, now: NOW });
  assert.equal(r.status, 'generated');
  assert.match(r.reason, /no red-team model/);
  assert.equal(fetch.calls.length, 1, 'only the generator was called');
});

test('US-07-R02: a hand-raised proposal whose stored author family is the first candidate is red-teamed by the other family', async () => {
  const { db, ports, fetch } = await mk({ say: { a: '{"harm":false}', b: '{"harm":true,"case":"a refusal report would be rewritten"}' } });
  await G.propose(db, { id: 'M1', rule_text: 'Allow the word proceed.', changes: [], author: 'agent-7', author_family: 'family-a' }, { now: NOW });
  const r = await G.redTeam(db, 'M1', { redteam: ports.redteam, now: NOW });
  assert.equal(r.status, 'rejected');
  assert.match(r.reason, /red-team found harm: a refusal report would be rewritten/);
  assert.deepEqual(fetch.calls.map(c => c.provider), ['b']);
});

test('a reply that is not the expected JSON is an outage, never a guess: the proposal waits and the engine keeps phrase matching', async () => {
  const { db, ports } = await mk({ say: { a: 'sure, here you go!', b: 'not json either' } });
  collected(db, 'P3');
  await assert.rejects(G.generateRules(db, { generate: ports.generate }), /not a JSON object/);
  await G.propose(db, { id: 'M2', rule_text: 'x', changes: [], author: 'agent-7', author_family: 'family-a' }, { now: NOW });
  const r = await G.redTeam(db, 'M2', { redteam: ports.redteam, now: NOW });
  assert.match(r.reason, /red-team outage: the model reply was not a JSON object/);
  // the classifier port throws, recognize() records the error on its result and phrase matching still fires
  const rec = await G.recognize(db, { draft: "Let me know if you'd like me to open the pull request?", source: 'doer-1' }, { classifier: ports.classifier, now: NOW });
  assert.match(rec.classifier_error, /not a JSON object/);
  assert.ok(rec.hits.length >= 1);
});

test('classifier and revise ports: unknown pattern keys are dropped, scores are clamped, and a failed revision returns the draft unchanged', async () => {
  const { ports } = await mk({ say: { a: JSON.stringify({ hits: [{ pattern_key: 'question_ending', score: 7, excerpt: 'ok?' }, { pattern_key: 'invented', score: 1 }] }) } });
  const hits = await ports.classifier('text', [{ pattern_key: 'question_ending', pattern: 'q' }]);
  assert.deepEqual(hits, [{ pattern_key: 'question_ending', score: 1, excerpt: 'ok?' }]);
  const rev = await mk({ say: { a: JSON.stringify({ draft: 'The pull request PR-1 is open.' }) } });
  assert.equal(await rev.ports.revise({ draft: 'Shall I open it?', attempt: 1, max: 2, hits: [] }), 'The pull request PR-1 is open.');
  const bad = await mk({ say: { a: JSON.stringify({ nothing: true }) } });
  assert.equal(await bad.ports.revise({ draft: 'Shall I open it?', attempt: 1, max: 2, hits: [] }), 'Shall I open it?');
});

test('US-07-R17: preEmit with the revise port returns a rewritten draft that carries no hit', async () => {
  const { db, ports } = await mk({ say: { a: JSON.stringify({ draft: 'The pull request PR-42 is open.' }) } });
  const r = await G.preEmit(db, { draft: "The timeout is fixed. Let me know if you'd like me to open the pull request?", source: 'doer-1' }, { revise: ports.revise, now: NOW });
  assert.equal(r.revisions, 1);
  assert.equal(r.emitted, 'The pull request PR-42 is open.');
});

test('parseJson accepts a fenced object and refuses prose', () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.equal(parseJson('hello'), null);
});
