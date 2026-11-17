// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ensembleRun, askPanel, candidates, effectiveVotes, mostCorrelatedVendor, reviewDecision, evidenceChecks, ledgerView, genModule, swapLiteral } from './index.js';
import { crossReview, vendorOfModel } from './review.js';
import { makeScope } from './scope.js';
const pool = [['openai','gpt'],['meta','llama'],['mistral','mistral'],['google','gemma'],['alibaba','qwen'],['zai','glm']].map(([v,l]) => ({ id: l, route: 'workers-ai', model: '@cf/' + v + '/' + l, vendor: v, lineage: l }));
const ENSEMBLE = { author_family: 'anthropic', min_verifiers: 2, channel_overlap_max: 0.25, proposals_per_run: 3, review_panel: 2, health: { flag_error_share: 0.3, min_calls: 12 }, min_effective_votes: 1.3, fields: ['claim', 'limits', 'works_where', 'takes', 'first_test'], max_growth: 1.5, pool };
const NOW = Date.parse('2026-11-17T06:00:00Z'), TEXT = 'The trial found a 12 percent reduction in deaths among infants.';
const entries = [{ id: 'e1', title: 'Kangaroo care', claim: 'Old claim of about 10 percent here', limits: 'l', works_where: 'w', takes: 't', first_test: 'f' }];
const fileSrc = "x = { claim: 'Old claim of about 10 percent here' };";
const epmc = async () => ({ ok: true, json: async () => ({ resultList: { result: [{ id: '1', source: 'MED', title: 'T', pubYear: '2020', abstractText: TEXT }] } }) });
const PROPOSAL = { field: 'claim', new: 'A claim of a 12 percent reduction in infant deaths', source: 1, quote: TEXT, why: 'w' };
// verdicts by vendor; the proposer is whichever model answers the proposal prompt
const mk = (verdicts, proposal = PROPOSAL) => async (m, prompt) => {
  if (/Propose at most ONE/.test(prompt)) return { ok: true, model: m.model, text: JSON.stringify(proposal) };
  const v = verdicts[m.vendor] ?? verdicts.default; return v ? { ok: true, model: m.model, text: JSON.stringify({ verdict: v, reason: 'r' }) } : { ok: false, error: 'HTTP 500' };
};
const run = (ask, extra = {}) => ensembleRun({ ledger: {}, entries, fileSrc, fetch: epmc, ask, now: () => NOW, cfg: ENSEMBLE, seed: 1, ...extra });

test('unanimous support from other-vendor verifiers is accepted and recorded with every vote', async () => {
  const r = await run(mk({ default: 'supports' }));
  assert.equal(r.accepted.length, 1); const p = r.ledger.proposals[0];
  assert.equal(p.status, 'accepted'); assert.ok(p.votes.length >= 2); assert.ok(!p.votes.some(v => v.vendor === p.proposer.vendor), 'the proposer voted');
  assert.equal(new Set(p.votes.map(v => v.vendor)).size, p.votes.length); assert.ok(p.source.url.startsWith('https://europepmc.org/article/'));
});
test('one dissenting verifier makes it uncertain and nothing is applied', async () => {
  let n = 0; const base = mk({ default: 'supports' }), ask = async (m, p) => (/Propose at most ONE/.test(p) ? base(m, p) : (n++ === 1 ? { ok: true, model: m.model, text: '{"verdict":"contradicts","reason":"r"}' } : base(m, p)));
  const r = await run(ask); assert.equal(r.accepted.length, 0); assert.equal(r.ledger.proposals[0].status, 'uncertain'); assert.match(r.ledger.proposals[0].reason, /disagree/);
  const view = ledgerView(r.ledger); assert.equal(view.by_entry.e1[0].status, 'uncertain');
});
test('a model outage never applies a change', async () => {
  const r = await run(mk({ default: null })); assert.equal(r.accepted.length, 0); assert.equal(r.ledger.proposals[0].status, 'pending');
});
test('an invented quote or number is rejected before any model votes', async () => {
  let votes = 0; const base = mk({ default: 'supports' }, { ...PROPOSAL, quote: 'A sentence no abstract contains at all' }), ask = async (m, p) => { if (!/Propose at most ONE/.test(p)) votes++; return base(m, p); };
  const r = await run(ask); assert.equal(votes, 0); assert.equal(r.ledger.proposals[0].status, 'rejected'); assert.match(r.ledger.proposals[0].reason, /quote/);
  const r2 = await run(mk({ default: 'supports' }, { ...PROPOSAL, new: 'A claim of a 99 percent reduction in infant deaths' })); assert.match(r2.ledger.proposals[0].reason, /numbers not in the abstract/);
});
test('a model that substitutes another vendor cannot sit twice on a panel', async () => {
  const ask = async m => ({ ok: true, model: ENSEMBLE.pool[0].model, text: '{"verdict":"supports","reason":"r"}' }), r = await askPanel({ cands: candidates({ cfg: ENSEMBLE }), want: 3, ask, prompt: 'p', parse: t => JSON.parse(t), cfg: ENSEMBLE });
  assert.equal(r.got.length, 1, 'one vendor answered for every member, so one seat is filled');
});
test('effective votes are measured from verdicts and identical judges count as one', () => {
  const h = Array.from({ length: 12 }, (_, i) => ({ votes: { a: i % 3 ? 'supports' : 'contradicts', b: i % 3 ? 'supports' : 'contradicts', c: i % 2 ? 'supports' : 'contradicts' } }));
  const e = effectiveVotes(h); assert.ok(e.measured); assert.ok(e.pairs.find(p => p.a === 'a' && p.b === 'b').phi === 1); assert.ok(['a', 'b'].includes(mostCorrelatedVendor(e.pairs)));
  assert.equal(effectiveVotes(h.slice(0, 4)).measured, false);
});
test('a pool with a correlated pair benches the most correlated vendor', async () => {
  const history = Array.from({ length: 12 }, (_, i) => ({ id: 'h' + i, votes: { openai: i % 2 ? 'supports' : 'contradicts', meta: i % 2 ? 'supports' : 'contradicts' } }));
  const r = await run(mk({ default: 'supports' }), { ledger: { history } }); assert.ok(Object.keys(r.ledger.benched).length >= 1); assert.equal(r.ledger.metrics.measured, true);
});
test('code review: an other-vendor majority blocks, a single answer proceeds and the gap is recorded', async () => {
  assert.equal(vendorOfModel('@cf/openai/gpt', ENSEMBLE), 'openai'); assert.equal(vendorOfModel('@cf/meta/llama-3.3-70b-instruct-fp8-fast', ENSEMBLE), 'meta'); assert.equal(vendorOfModel('mistral-ai/x', ENSEMBLE), 'mistral');
  const seen = []; const rej = async m => { seen.push(m.vendor); return { ok: true, model: m.model, text: '{"verdict":"reject","reason":"bug"}' }; };
  const r = await crossReview({ title: 't', diff: 'd', authorModel: '@cf/openai/gpt', cfg: ENSEMBLE, ask: rej }); assert.equal(r.merge, false); assert.ok(!seen.includes('openai'), 'the author vendor reviewed its own change');
  const one = (() => { let n = 0; return async m => (n++ ? { ok: false, error: 'x' } : { ok: true, model: m.model, text: '{"verdict":"reject","reason":"bug"}' }); })();
  const r2 = await crossReview({ title: 't', diff: 'd', authorModel: '@cf/openai/gpt', cfg: ENSEMBLE, ask: one }); assert.equal(r2.merge, true); assert.equal(r2.gap, true);
  assert.equal(reviewDecision([{ verdict: 'approve' }, { verdict: 'approve' }, { verdict: 'reject' }]).merge, true);
});
test('evidence checks need the editable field and an exactly-once match in the file', () => {
  const src = [{ url: 'u', title: 's', year: 1, text: TEXT }], p = { field: 'claim', source: 1, quote: TEXT, new: 'The trial found a 12 percent reduction in infant deaths' };
  assert.ok(evidenceChecks({ proposal: p, entry: entries[0], sources: src, fileSrc, cfg: ENSEMBLE }).ok); assert.ok(!evidenceChecks({ proposal: p, entry: entries[0], sources: src, fileSrc: 'nothing here', cfg: ENSEMBLE }).ok);
});

test('the scope guard allows only the stated paths and refuses traversal and absolute paths', () => {
  const a = makeScope({ scope: ['src/*', 'src/**/*'], deny: ['src/rules.js'] });
  assert.ok(a('src/a/b.js')); assert.ok(!a('src/rules.js')); assert.ok(!a('../x')); assert.ok(!a('/etc/passwd')); assert.ok(!a('lib/y.js'));
});
test('the generated ledger module is exactly what the ledger view says', () => { assert.match(genModule({}), /export const ENSEMBLE_LEDGER/); assert.equal(ledgerView({}).totals.applied, 0); });
