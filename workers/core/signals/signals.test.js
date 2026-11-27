// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as sig from './index.js';

const mig = fileURLToPath(new URL('./migrations/', import.meta.url));
const Q = sig.AUDIT_QUESTIONS;
function mk(extra = {}) {
  const ctx = { db: makeDb([mig]), now: () => Date.parse('2026-03-02T12:00:00Z'), config: { domains: ['research', 'operations'], reentry_domain: 'research' }, ...extra };
  return ctx;
}
const all = async (ctx, sql, ...a) => (await ctx.db.prepare(sql).bind(...a).all()).results;
const one = async (ctx, sql, ...a) => ctx.db.prepare(sql).bind(...a).first();
// An artifact whose open-question set is given directly, deposited and published.
async function artifact(ctx, id, { open = Q, weight = 0.8, review = 'verified', state = 'published', content = 'Body.', assertions = [] } = {}) {
  await ctx.db.prepare(`INSERT INTO signals_artifacts (id, type, title, abstract, content, assertions, open_questions, state, created_at) VALUES (?, 'note', ?, 'abstract', ?, ?, ?, 'audited', '2026-03-01 00:00:00')`)
    .bind(id, `Title ${id}`, content, JSON.stringify(assertions), open === null ? null : JSON.stringify(open)).run();
  if (state) await sig.deposit(ctx, id, { deposit_id: `dep:${id}`, attribution: 'synthesis-worker', review, reentry_weight: weight, state });
}

test('US-12-R01: a record without an evidential weight is noise and is never triaged', async () => {
  const ctx = mk({ scorers: [async () => 1, async () => 1] });
  const a = await sig.intake(ctx, { id: 's1', source: 'feed', content: 'observed x', weight: 0.9, domain: 'research' });
  const b = await sig.intake(ctx, { id: 's2', source: 'feed', content: 'no weight', domain: 'research' });
  const c = await sig.intake(ctx, { id: 's3', source: 'feed', content: 'bad weight', weight: 'high', domain: 'research' });
  assert.deepEqual([a.status, b.status, c.status], ['proposed', 'noise', 'noise']);
  const t = await sig.triage(ctx);
  assert.equal(t.triaged, 1);
  const rows = await all(ctx, `SELECT id, status, decision, evidential_weight FROM signals_signals ORDER BY id`);
  assert.deepEqual(rows.map(r => [r.status, r.decision]), [['triaged', 'ACCEPT'], ['noise', 'IGNORE'], ['noise', 'IGNORE']]);
  assert.equal(rows[1].evidential_weight, null);
  await assert.rejects(() => sig.intake(ctx, { content: 'no source', weight: 1 }));
});

test('L1 triage: the two-model scorecard decides ACCEPT, LOG or IGNORE; disagreeing models cannot accept', async () => {
  const scores = { hi: [0.9, 0.8], mid: [0.5, 0.5], low: [0.1, 0.2], split: [1, 0.5] };
  const ctx = mk({ scorers: [async s => scores[s.id][0], async s => scores[s.id][1]] });
  for (const id of Object.keys(scores)) await sig.intake(ctx, { id, source: 'feed', content: id, weight: 1, domain: 'research' });
  const t = await sig.triage(ctx);
  assert.deepEqual([t.method, t.accept, t.log, t.ignore], ['scorecard', 1, 2, 1]);
  const d = Object.fromEntries((await all(ctx, `SELECT id, decision FROM signals_signals`)).map(r => [r.id, r.decision]));
  assert.deepEqual(d, { hi: 'ACCEPT', mid: 'LOG', low: 'IGNORE', split: 'LOG' });
  const single = mk({ scorers: [async () => 1] });
  await sig.intake(single, { id: 'x', source: 'feed', content: 'x', weight: 1 });
  assert.equal((await sig.triage(single)).skipped, 'scorecard_needs_two_models');
  assert.equal((await one(single, `SELECT status FROM signals_signals`)).status, 'proposed');
});

test('US-12-R08: while the fitness threshold is null triage uses the scorecard; a number needs a winning experiment', async () => {
  const fitness = async s => ({ expected_reduction: s.id === 'big' ? 6 : 1, effort: 2 });
  const ctx = mk({ scorers: [async () => 0.9, async () => 0.9], fitness });
  assert.equal(await sig.fitnessThreshold(ctx), null);
  await sig.intake(ctx, { id: 'a', source: 'feed', content: 'a', weight: 1 });
  assert.equal((await sig.triage(ctx)).method, 'scorecard');           // a fitness port alone does not switch the method
  assert.deepEqual(await sig.proposeFitnessThreshold(ctx, { threshold: 1, n: 40, fitness_yield: 0.9, recency_yield: 1.1 }), { adopted: false, reason: 'fitness_did_not_beat_recency', threshold: null });
  assert.equal((await sig.proposeFitnessThreshold(ctx, { threshold: 1, n: 5, fitness_yield: 2, recency_yield: 1 })).reason, 'sample_too_small');
  assert.equal(await sig.fitnessThreshold(ctx), null);
  const won = await sig.proposeFitnessThreshold(ctx, { threshold: 1, n: 40, fitness_yield: 1.6, recency_yield: 1.1 });
  assert.deepEqual([won.adopted, won.threshold], [true, 1]);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM signals_experiments`)).n, 3); // every experiment is on record
  await sig.intake(ctx, { id: 'big', source: 'feed', content: 'b', weight: 1 });
  await sig.intake(ctx, { id: 'small', source: 'feed', content: 's', weight: 1 });
  const t = await sig.triage(ctx);
  assert.deepEqual([t.method, t.accept, t.log], ['fitness', 1, 1]);     // 6/2 = 3 > 1 accepted; 1/2 = 0.5 logged
});

test('US-12-T01, US-12-R02 and US-12-R03: no boundary row denies and writes an incident; the worker carries on with its other signals', async () => {
  const ctx = mk({ scorers: [async () => 1, async () => 1], synthesize: async ss => ({ title: 'T', content: ss.map(s => s.content).join(' ') }) });
  await sig.intake(ctx, { id: 'r1', source: 'research-feed', content: 'finding one', weight: 1, domain: 'research' });
  await sig.intake(ctx, { id: 't1', source: 'fleet-telemetry', content: 'cpu high', weight: 1, domain: 'operations' });
  await sig.intake(ctx, { id: 'r2', source: 'research-feed', content: 'finding two', weight: 1, domain: 'research' });
  await sig.triage(ctx);
  const denied = await sig.consume(ctx, { worker: 'synth', signal_id: 'r1' });
  assert.deepEqual(denied, { permitted: false, reason: 'no_boundary_row' });
  assert.deepEqual((await all(ctx, `SELECT kind, worker, source, ref, detail FROM signals_incidents`)), [{ kind: 'boundary_denial', worker: 'synth', source: 'research-feed', ref: 'r1', detail: 'no_boundary_row' }]);
  await sig.permit(ctx, { worker: 'synth', source: 'research-feed', domain: 'research' });
  assert.equal((await sig.consume(ctx, { worker: 'synth', signal_id: 'r1' })).permitted, true);
  const made = await sig.synthesize(ctx, { worker: 'synth', signal_ids: ['r1', 't1', 'r2'], id: 'art-1' });
  assert.deepEqual([made.used, made.denied], [['r1', 'r2'], [{ id: 't1', reason: 'no_boundary_row' }]]); // the denial did not stop the rest
  assert.equal((await one(ctx, `SELECT content FROM signals_artifacts WHERE id = 'art-1'`)).content, 'finding one finding two');
});

test('boundary: permitted = 0 denies; the cross-domain guard refuses an unlisted domain and a domain mismatch', async () => {
  const ctx = mk();
  await sig.intake(ctx, { id: 'e1', source: 'engagement', content: 'x', weight: 1, domain: 'research' });
  await sig.permit(ctx, { worker: 'ops', source: 'engagement', domain: 'operations' });
  assert.equal((await sig.consume(ctx, { worker: 'ops', signal_id: 'e1' })).reason, 'cross_domain');
  await sig.permit(ctx, { worker: 'ops', source: 'engagement', domain: 'research', permitted: false });
  assert.equal((await sig.consume(ctx, { worker: 'ops', signal_id: 'e1' })).reason, 'not_permitted');
  await assert.rejects(() => sig.permit(ctx, { worker: 'ops', source: 'engagement', domain: 'finance' }), /not listed/);
  await sig.permit(ctx, { worker: 'ops', source: 'engagement', domain: 'research' });
  assert.equal((await sig.consume({ ...ctx, config: { domains: ['operations'] } }, { worker: 'ops', signal_id: 'e1' })).reason, 'domain_not_listed');
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM signals_incidents WHERE kind = 'boundary_denial'`)).n, 3);
});

test('L3 / L4: synthesis uses accepted signals only; the ignorance audit records U(a) from the fixed list of 15', async () => {
  const answered = new Set(Q.slice(0, 3));
  const ctx = mk({
    scorers: [async s => (s.id === 'weak' ? 0.1 : 1), async s => (s.id === 'weak' ? 0.1 : 1)],
    synthesize: async ss => ({ title: 'Synthesis', abstract: 'A', content: `We measured 4 units.\n\n${ss.length} signals.`, assertions: ['We measured 4 units.'] }),
    auditor: async (a, q) => answered.has(q),
  });
  await sig.permit(ctx, { worker: 'synth', source: 'feed', domain: 'research' });
  await sig.intake(ctx, { id: 'strong', source: 'feed', content: 's', weight: 1, domain: 'research' });
  await sig.intake(ctx, { id: 'weak', source: 'feed', content: 'w', weight: 1, domain: 'research' });
  await sig.triage(ctx);
  const made = await sig.synthesize(ctx, { worker: 'synth', signal_ids: ['strong', 'weak'], id: 'a1' });
  assert.deepEqual([made.used, made.skipped], [['strong'], [{ id: 'weak', reason: 'decision IGNORE' }]]);
  assert.equal(Q.length, 15);
  const au = await sig.audit(ctx, 'a1');
  assert.equal(au.count, 12);
  const row = await one(ctx, `SELECT state, open_questions FROM signals_artifacts WHERE id = 'a1'`);
  assert.deepEqual([row.state, JSON.parse(row.open_questions).length], ['audited', 12]);
  assert.equal((await sig.synthesize(ctx, { worker: 'synth', signal_ids: ['weak'] })).artifact_id, null);
});

test('US-12-T04 and US-12-R07: 15 to 12 is accepted, 12 against 12 is rejected, 9 by narrowing is logged as a violation and rejected', async () => {
  const ctx = mk();
  const body = 'Method.\n\nResult one holds at 4 units.\n\nResult two holds at 9 units.';
  await artifact(ctx, 'a', { open: Q, state: null, content: body, assertions: ['Result one holds at 4 units.', 'Result two holds at 9 units.'] });
  const r1 = await sig.revise(ctx, 'a', { content: body + '\n\nAnswers three questions.', open_questions: Q.slice(3) });
  assert.deepEqual(r1, { accepted: true, reason: 'strict_shrink', before: 15, after: 12 });
  const r2 = await sig.revise(ctx, 'a', { content: body + '\n\nReworded.', open_questions: Q.slice(3) });
  assert.deepEqual([r2.accepted, r2.reason, r2.before, r2.after], [false, 'no_shrink', 12, 12]);
  const r3 = await sig.revise(ctx, 'a', { content: 'Method.\n\nAnswers six questions.', open_questions: Q.slice(6) });
  assert.deepEqual([r3.accepted, r3.reason, r3.after], [false, 'narrowing', 9]);
  const inc = await one(ctx, `SELECT kind, ref, detail FROM signals_incidents WHERE kind = 'narrowing'`);
  assert.match(inc.detail, /^2 result-asserting statement/);
  const row = await one(ctx, `SELECT content, open_questions FROM signals_artifacts WHERE id = 'a'`);
  assert.equal(JSON.parse(row.open_questions).length, 12);              // the rejected revisions changed nothing
  assert.match(row.content, /Result two holds/);
  assert.deepEqual((await all(ctx, `SELECT accepted, reason FROM signals_revisions ORDER BY id`)).map(r => [r.accepted, r.reason]), [[1, 'strict_shrink'], [0, 'no_shrink'], [0, 'narrowing']]);
});

test('US-12-R07: fewer questions is not a shrink when a closed question is reopened; an unaudited artifact cannot be revised', async () => {
  const ctx = mk({ auditor: async (a, q) => a.content.includes('ANSWER') && Q.indexOf(q) < 5 });
  await artifact(ctx, 'a', { open: Q.slice(2), state: null });           // questions 0 and 1 are closed
  const swap = await sig.revise(ctx, 'a', { content: 'x', open_questions: [Q[0], ...Q.slice(5)] });
  assert.deepEqual([swap.accepted, swap.reason], [false, 'no_shrink']);  // 11 < 13 but question 0 came back
  const audited = await sig.revise(ctx, 'a', { content: 'Body. ANSWER' }); // no list given: the auditor port audits the revision
  assert.deepEqual([audited.accepted, audited.after], [true, 10]);
  await artifact(ctx, 'b', { open: null, state: null });
  assert.equal((await sig.revise(ctx, 'b', { content: 'y', open_questions: [] })).reason, 'not_audited');
});

test('US-12-T02 and US-12-R04: re-entry run twice on one artifact writes one signal', async () => {
  const ctx = mk();
  await artifact(ctx, 'a');
  assert.deepEqual((await sig.reenter(ctx)).entered, ['a']);
  const again = await sig.reenter(ctx);
  assert.deepEqual([again.entered, again.logged], [[], []]);
  const rows = await all(ctx, `SELECT source, source_ref, status, evidential_weight, content FROM signals_signals`);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].source, rows[0].source_ref, rows[0].status, rows[0].evidential_weight], ['artifact_reentry', 'dep:a', 'proposed', 0.8]);
  assert.match(rows[0].content, /Title a\nabstract\ndep:a\nOpen questions: What is claimed\?/);
  assert.equal((await sig.status(ctx)).deposited_not_reentered, 0);
});

test('US-12-T03 and US-12-R05: an artifact with U(a) empty or unrecorded re-enters with weight 0 and status logged', async () => {
  const ctx = mk();
  await artifact(ctx, 'empty', { open: [], weight: 0.9 });
  await artifact(ctx, 'unrecorded', { open: null, weight: 0.9 });
  const r = await sig.reenter(ctx);
  assert.deepEqual([r.entered, r.logged], [[], ['empty', 'unrecorded']]);
  const rows = await all(ctx, `SELECT status, evidential_weight, decision FROM signals_signals`);
  assert.deepEqual(rows.map(x => [x.status, x.evidential_weight, x.decision]), [['logged', 0, 'LOG'], ['logged', 0, 'LOG']]);
});

test('US-12-R06: the re-entry weight is stored at deposit, never inferred; a failed review stores 0', async () => {
  const ctx = mk({ scorers: [async () => 1, async () => 1] });
  await artifact(ctx, 'draft', { state: null });
  await assert.rejects(() => sig.deposit(ctx, 'draft', { deposit_id: 'd', attribution: 'w', review: 'verified' }), /stored at deposit/);
  await assert.rejects(() => sig.deposit(ctx, 'draft', { deposit_id: 'd', attribution: 'w', review: 'failed', reentry_weight: 0.5 }), /stores weight 0/);
  await assert.rejects(() => sig.deposit(ctx, 'draft', { deposit_id: 'd', review: 'clean', reentry_weight: 0.5 }), /attribution/);
  await artifact(ctx, 'good', { weight: 0.8, review: 'verified' });
  await artifact(ctx, 'failed', { weight: 0, review: 'failed' });
  await artifact(ctx, 'held', { weight: 0.7, state: 'deposited' });      // deposited, not yet published: does not re-enter
  // a row written around deposit() with no stored weight is entered at 0 and reported, not guessed from its review
  await ctx.db.prepare(`INSERT INTO signals_artifacts (id, type, title, content, open_questions, state, deposit_id, review, created_at) VALUES ('legacy','note','L','c',?, 'published','dep:legacy','verified','2026-03-01 00:00:00')`).bind(JSON.stringify(Q)).run();
  const r = await sig.reenter(ctx);
  assert.deepEqual([r.entered, r.logged], [['failed', 'good'], ['legacy']]);
  const w = Object.fromEntries((await all(ctx, `SELECT source_ref, evidential_weight FROM signals_signals`)).map(x => [x.source_ref, x.evidential_weight]));
  assert.deepEqual(w, { 'dep:good': 0.8, 'dep:failed': 0, 'dep:legacy': 0 });
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM signals_incidents WHERE kind = 'unstored_weight'`)).n, 1);
  await sig.setState(ctx, 'held', 'distributed');
  const s = await sig.step(ctx);                                         // L8 back to L1: the tick re-enters, then triages
  assert.deepEqual([s.reentered, s.triage.accept, s.triage.ignore], [1, 2, 1]);
  await assert.rejects(() => sig.setState(ctx, 'draft', 'published'), /deposited/);
});

// ---- round 1 additions ---------------------------------------------------------------------------

test('US-12-R18: status reports published artifacts that have not re-entered, so a pipeline that is not a loop is measurable', async () => {
  const ctx = mk();
  await artifact(ctx, 'a', { state: 'published' });
  await artifact(ctx, 'held', { state: 'deposited' });                   // deposited but not published: not counted
  assert.equal((await sig.status(ctx)).deposited_not_reentered, 1);
  await sig.reenter(ctx);
  assert.equal((await sig.status(ctx)).deposited_not_reentered, 0);
});

test('US-12-R19: when an auditor is configured a caller-supplied open-question list may not claim a shrink the auditor does not see', async () => {
  const stillOpen = new Set([Q[0]]);                                      // the auditor finds question 0 open in any revision
  const ctx = mk({ auditor: async (a, q) => !stillOpen.has(q) });
  await artifact(ctx, 'a', { open: Q, state: null });
  const lie = await sig.revise(ctx, 'a', { content: 'Body. Revised.', open_questions: Q.slice(1, 10) });   // omits question 0
  assert.deepEqual([lie.accepted, lie.reason, lie.after], [false, 'audit_disagrees', 9]);
  const row = await one(ctx, `SELECT open_questions FROM signals_artifacts WHERE id = 'a'`);
  assert.equal(JSON.parse(row.open_questions).length, 15);               // the artifact is unchanged
  assert.match((await one(ctx, `SELECT detail FROM signals_revisions WHERE reason = 'audit_disagrees'`)).detail, /auditor still finds 1 question/);
  const honest = await sig.revise(ctx, 'a', { content: 'Body. Revised.', open_questions: [Q[0], ...Q.slice(5)] });
  assert.deepEqual([honest.accepted, honest.after], [true, 11]);         // the same list that includes what the auditor sees
  const noAuditor = mk();                                                // without an auditor port the supplied list stands (unchanged behaviour)
  await artifact(noAuditor, 'b', { open: Q, state: null });
  assert.equal((await sig.revise(noAuditor, 'b', { content: 'x', open_questions: Q.slice(1) })).accepted, true);
});

test('US-12-R20: assertion presence is judged on word stems, so inflection is not read as removal and a changed number still is', async () => {
  assert.deepEqual(['results', 'increased', 'increases', 'measurement', 'studies', 'class'].map(sig.stem), ['result', 'increas', 'increas', 'measur', 'study', 'class']);
  assert.equal(sig.stem('q3'), 'q3');                                    // a token with a digit is never altered
  assert.equal(sig.assertionPresent('The result increases by 4 units.', 'Results increased by 4'), true);
  assert.equal(sig.assertionPresent('Results increased by 40 units.', 'Results increased by 4'), false);   // numbers must match exactly
  assert.equal(sig.assertionPresent('Results increased by 5.', 'Results increased by 4'), false);
  assert.equal(sig.assertionPresent('Findings increased by 4.', 'Results increased by 4'), false);          // a different noun is a different statement
  assert.equal(sig.assertionPresent('The results are measured by 4 labs.', 'measured 4'), false);          // the run must be contiguous
  const ctx = mk();
  const body = 'Method.\n\nResults increased by 4 units.';
  await artifact(ctx, 'a', { open: Q, state: null, content: body, assertions: ['Results increased by 4 units.'] });
  const reworded = await sig.revise(ctx, 'a', { content: 'Method.\n\nThe result increases by 4 units.', open_questions: Q.slice(3), assertions: ['Results increased by 4 units.'] });
  assert.deepEqual([reworded.accepted, reworded.reason], [true, 'strict_shrink']);   // inflection is not narrowing
  const changed = await sig.revise(ctx, 'a', { content: 'Method.\n\nThe result increases by 5 units.', open_questions: Q.slice(6) });
  assert.deepEqual([changed.accepted, changed.reason], [false, 'narrowing']);        // the number changed: the assertion is gone
  const synth = mk({ synthesize: async () => ({ title: 'T', content: 'Result increases by 4.', assertions: ['Results increased by 4'] }) });
  await sig.permit(synth, { worker: 'w', source: 'feed', domain: 'research' });
  await sig.intake(synth, { id: 's1', source: 'feed', content: 'x', weight: 1, domain: 'research' });
  await synth.db.prepare(`UPDATE signals_signals SET status = 'triaged', decision = 'ACCEPT' WHERE id = 's1'`).run();
  assert.equal((await sig.synthesize(synth, { worker: 'w', signal_ids: ['s1'], id: 'ok' })).artifact_id, 'ok');
});

test('US-12-R21: triage records what each signal was expected to close; realize reads what its artifacts closed; the experiment is computed from those rows', async () => {
  const fit = s => ({ expected_reduction: Number(s.content), effort: 1 });
  const ctx = mk({ scorers: [async () => 1, async () => 1], fitness: fit });
  await sig.intake(ctx, { id: 'one', source: 'feed', content: '6', weight: 1, domain: 'research' });
  await sig.triage(ctx);                                                  // threshold is null: the scorecard decides, the expectation is still recorded
  assert.deepEqual({ ...await one(ctx, `SELECT expected_reduction, effort, realized_reduction FROM signals_effort WHERE signal_id = 'one'`) }, { expected_reduction: 6, effort: 1, realized_reduction: null });
  await ctx.db.prepare(`INSERT INTO signals_artifacts (id, type, title, content, assertions, source_signals, open_questions, state, created_at) VALUES ('art','note','T','c','[]',?,?, 'audited','2026-03-01 00:00:00')`).bind(JSON.stringify(['one']), JSON.stringify(Q)).run();
  assert.equal((await sig.realize(ctx)).updated, 0);                      // the artifact has not been revised: nothing realized yet
  await sig.revise(ctx, 'art', { content: 'c2', open_questions: Q.slice(3) });
  assert.equal((await sig.realize(ctx)).updated, 1);
  assert.equal((await one(ctx, `SELECT realized_reduction FROM signals_effort WHERE signal_id = 'one'`)).realized_reduction, 3);
  assert.equal((await sig.realize(ctx)).updated, 0);                      // idempotent
  assert.deepEqual(await sig.runFitnessExperiment(mk()), { skipped: 'no_realized_signals' });
});

test('US-12-R21: fitness-scored picks that out-yield the newest picks are adopted as the threshold; a loss or a small sample is recorded and not adopted', async () => {
  const seed = async (ctx, n, realize) => {
    for (let i = 0; i < n; i++) await ctx.db.prepare(`INSERT INTO signals_effort (signal_id, expected_reduction, effort, realized_reduction, recorded_at) VALUES (?,?,?,?,?)`)
      .bind(`s${i}`, ...realize(i), '2026-03-02 12:00:00').run();   // rows are inserted oldest first; the newest are the highest rowids
  };
  // the oldest 20 signals were expected to close a lot and did; the newest 20 were expected to close little and did
  const win = mk(); await seed(win, 40, i => (i < 20 ? [10, 2, 8] : [1, 2, 0]));
  const w = await sig.runFitnessExperiment(win);
  assert.deepEqual([w.adopted, w.n, w.k, w.proposed_threshold], [true, 40, 20, 5]);
  assert.ok(w.fitness_yield > w.recency_yield);
  assert.equal(await sig.fitnessThreshold(win), 5);
  await sig.intake(win, { id: 'big', source: 'feed', content: 'x', weight: 1 });
  const wf = mk({ ...win, db: win.db, scorers: [async () => 0.1, async () => 0.1], fitness: s => ({ expected_reduction: 12, effort: 2 }) });
  assert.equal((await sig.triage(wf)).method, 'fitness');                 // 12/2 = 6 > 5: accepted under the measured threshold
  // the experiment lost: expectation did not predict what was closed
  const lose = mk(); await seed(lose, 40, i => (i < 20 ? [10, 2, 0] : [1, 2, 3]));
  const l = await sig.runFitnessExperiment(lose);
  assert.deepEqual([l.adopted, l.reason], [false, 'fitness_did_not_beat_recency']);
  assert.equal(await sig.fitnessThreshold(lose), null);
  // too few outcomes
  const small = mk(); await seed(small, 6, i => (i < 3 ? [10, 2, 8] : [1, 2, 0]));
  assert.equal((await sig.runFitnessExperiment(small)).reason, 'sample_too_small');
  assert.equal((await one(small, `SELECT COUNT(*) AS n FROM signals_experiments`)).n, 1);   // every experiment is on record
});

// ---- round 2 additions: findings of the verification of US-SPEC-12 --------------------------------

test('US-12-R20: a number matches exactly with its sign, its percent sign and a comparison operator before it', () => {
  const p = sig.assertionPresent;
  assert.equal(p('growth was -5 percent', 'growth was 5 percent'), false);        // an inverted sign is a different statement
  assert.equal(p('growth was 5 percent', 'growth was -5 percent'), false);
  assert.equal(p('growth was -5 percent today', 'growth was -5 percent'), true);
  assert.equal(p('the error rate < 5 today', 'error rate > 5'), false);
  assert.equal(p('the error rate > 5 today', 'error rate > 5'), true);
  assert.equal(p('the error rate >5 today', 'error rate > 5'), true);              // spacing is not meaning
  assert.equal(p('error rate >= 5', 'error rate > 5'), false);
  assert.equal(p('rate is 5 users', 'rate is 5%'), false);                          // a unit is part of the number
  assert.equal(p('the rate is 5% now', 'rate is 5%'), true);
  assert.equal(p('the rate is 5 % now', 'rate is 5%'), true);
  assert.equal(p('x ≥ 3 holds', 'x >= 3'), true);                              // the one-character comparison signs are their spelled forms
  assert.equal(p('x ≤ 3 holds', 'x >= 3'), false);
  assert.equal(p('rates 5-10 ok', 'rates 5-10'), true);                             // a hyphen between digits is a range, not a sign
  assert.equal(p('growth was −5 now', 'growth was -5'), true);                 // the typographic minus is the minus sign
  assert.equal(p('growth was \u20135%', 'growth was 5%'), false);                 // an en dash before a number is a minus, as typeset text writes it
  assert.equal(p('growth was \u20135%', 'growth was -5%'), true);
  assert.equal(p('growth was \u20125%', 'growth was 5%'), false);                 // so is a figure dash
  assert.equal(p('pages 5\u201310 read', 'pages 5-10'), true);                    // between two digits it is a range, not a sign
  assert.equal(p('word\u20135 joins', 'word -5 joins'), false);                   // after a letter it is punctuation
});

test('US-12-R20: the stem rule covers -ation forms, not a bare -ion form', () => {
  assert.equal(sig.assertionPresent('the registrations were made', 'registration were made'), true);
  assert.equal(sig.stem('selection'), 'selection');
  // -ation is stripped to the bare stem: the noun meets its stem verb, and singular and plural meet there
  assert.equal(sig.stem('information'), sig.stem('inform'));
  assert.deepEqual([sig.stem('registrations'), sig.stem('registration')], ['registr', 'registr']);
  assert.equal(sig.assertionPresent('we inform every member', 'information every member'), true);
  // the stem is bare, so an -ate verb keeps its t and does not meet its -ation noun
  assert.notEqual(sig.stem('creation'), sig.stem('create'));
});

test('US-12-R07: a revision listing an assertion that is not in its content is rejected as an incident and stores nothing', async () => {
  const ctx = mk();
  const body = 'Method.\n\nThe sky is blue.';
  await artifact(ctx, 'a', { open: Q, state: null, content: body, assertions: ['The sky is blue.'] });
  const phantom = await sig.revise(ctx, 'a', { content: 'Method.\n\nThe sky is blue. Answers three.', open_questions: Q.slice(3), assertions: ['The sky is blue.', 'Mars has water.'] });
  assert.deepEqual([phantom.accepted, phantom.reason, phantom.before, phantom.after], [false, 'assertion_not_in_content', 15, 15]);
  assert.equal((await one(ctx, `SELECT COUNT(*) AS n FROM signals_incidents WHERE kind = 'phantom_assertion' AND ref = 'a'`)).n, 1);
  assert.deepEqual(JSON.parse((await one(ctx, `SELECT assertions FROM signals_artifacts WHERE id = 'a'`)).assertions), ['The sky is blue.']);  // nothing stored
  // the honest revision is not blocked afterwards: no phantom assertion sits in the store to read as narrowing
  const ok = await sig.revise(ctx, 'a', { content: 'Method.\n\nThe sky is blue. Answers three.', open_questions: Q.slice(3), assertions: ['The sky is blue.'] });
  assert.deepEqual([ok.accepted, ok.reason], [true, 'strict_shrink']);
});
