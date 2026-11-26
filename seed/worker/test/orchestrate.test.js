// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ORCHESTRATE-1: an item the single-shot executor failed is planned, worked in parallel steps across ticks, reviewed by another model, fixed and
// integrated as one PR, with no session and no person in the path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { advance, validatePlan, ready, overlay, relevant, reviewers, orchestrateProvider, TRIGGER, MAX_STEPS } from '../src/orchestrate.js';
import { ADAPTERS } from '../src/codeagent.js';
import { runDbQueue } from '../src/nativeexec.js';

const b64 = s => Buffer.from(s).toString('base64');
const REPO = { 'seed/worker/src/sum.js': 'export function sum(a, b) {\n  return a - b;\n}\n', 'seed/worker/src/util.js': 'export const id = x => x;\n', 'seed/worker/test/other.test.js': 'x\n' };
function fakeGh() {
  const log = [], written = {};
  const f = async (url, o = {}) => {
    const path = url.replace('https://api.github.com', '').split('?')[0], m = o.method || 'GET'; log.push(`${m} ${path}`);
    const R = (status, json) => ({ status, ok: status < 300, text: async () => (json === undefined ? '' : JSON.stringify(json)) });
    if (path === '/repos/o/r/git/ref/heads/main') return R(200, { object: { sha: 'm1' } });
    if (path === '/repos/o/r/git/trees/m1') return R(200, { tree: Object.keys(REPO).map(p => ({ type: 'blob', path: p })) });
    if (path === '/repos/o/r/git/refs') return R(201, {});
    if (path === '/repos/o/r/pulls' && m === 'GET') return R(200, []);
    if (path === '/repos/o/r/pulls') return R(201, { number: 9, html_url: 'https://github.com/o/r/pull/9', body: JSON.parse(o.body).body });
    if (path.startsWith('/repos/o/r/contents/')) {
      const p = path.slice('/repos/o/r/contents/'.length);
      if (m === 'PUT') { written[p] = Buffer.from(JSON.parse(o.body).content, 'base64').toString(); return R(201, {}); }
      return p in REPO ? R(200, { sha: 's', content: b64(REPO[p]) }) : R(404, {});
    }
    return R(404, {});
  };
  return { f, log, written };
}
const PLAN = { steps: [
  { title: 'fix sum', paths: ['seed/worker/src/sum.js'], instructions: 'sum must add' },
  { title: 'add a product helper', paths: ['seed/worker/src/product.js'], instructions: 'export product' },
  { title: 'test both', paths: ['seed/worker/test/sum.test.js'], instructions: 'assert sum and product', after: [1, 2] },
] };
const ANSWERS = {
  1: { files: [{ path: 'seed/worker/src/sum.js', edits: [{ find: '  return a - b;', replace: '  return a + b;' }] }] },
  2: { files: [{ path: 'seed/worker/src/product.js', content: 'export const product = (a, b) => a * b;\n' }] },
  3: { files: [{ path: 'seed/worker/test/sum.test.js', content: "import { sum } from '../src/sum.js';\nif (sum(1, 2) !== 3) throw new Error('sum');\n" }] },
};
// A scripted team: the planner, one author per step and a reviewer, told apart by the prompt each role is given.
function team({ review = [{ ok: true, findings: [] }], advert = null, answers = ANSWERS, plan = PLAN } = {}) {
  const calls = [], inFlight = { now: 0, max: 0 }; let last = null;
  const agent = async (env, prompt, adapters) => {
    inFlight.max = Math.max(inFlight.max, ++inFlight.now); await new Promise(r => setTimeout(r, 2)); inFlight.now--;
    if (prompt.startsWith('You are the planning manager')) { calls.push('plan'); return { ...plan, adapter: 'a-plan' }; }
    if (prompt.startsWith('You are the independent reviewer')) { calls.push('review'); const adv = prompt.includes('ADVERSARIAL reviewer'); const v = adv ? (advert ? (advert.length > 1 ? advert.shift() : advert[0]) : last) : (last = review.length > 1 ? review.shift() : review[0]); if (v instanceof Error) throw v; return { ...v, adapter: (adapters || [{ id: 'r' }])[0].id, prompt }; }
    const n = Number(/YOUR STEP (\d+)/.exec(prompt)[1]); calls.push('step ' + n);
    const a = typeof answers[n] === 'function' ? answers[n](prompt) : answers[n];
    return { ...a, adapter: ADAPTERS[0].id };
  };
  return { agent, calls, inFlight };
}
function setup(blocker = TRIGGER + ' (too many files (5 > 3)); retried after the other candidates') {
  const db = makeDb();
  db.raw.prepare("INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status,blocker,created_at) VALUES ('BIG-1','BIG-1: sum adds and has a product helper in seed/worker/src/sum.js','staff','node --test seed/worker/test/sum.test.js','same',10,'blocked',?,'2026-11-20 00:00:00')").run(blocker);
  return { db, env: { DB: db, AI: {}, GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r' } };
}
const item = db => db.raw.prepare("SELECT blocker FROM items WHERE id='BIG-1'").get().blocker;
const T0 = Date.parse('2026-11-26T10:00:00Z');
async function drive(env, opts, max = 12) { const out = []; for (let i = 0; i < max; i++) { const r = await advance(env, { ...opts, now: T0 + i * 600000 }); out.push(r); if (r.idle || r.pr || /run failed/.test(r.detail)) break; } return out; }

test('a plan is refused when it could stall or overwrite: no files, a protected path, a forward dependency, too many steps', () => {
  assert.throws(() => validatePlan({ steps: [] }), /1\.\.6 steps/);
  assert.throws(() => validatePlan({ steps: Array.from({ length: MAX_STEPS + 1 }, () => PLAN.steps[0]) }), /steps/);
  assert.throws(() => validatePlan({ steps: [{ title: 't', instructions: 'i', paths: [] }] }), /names 0 files/);
  assert.throws(() => validatePlan({ steps: [{ title: 't', instructions: 'i', paths: ['.github/workflows/x.yml'] }] }), /protected/);
  assert.throws(() => validatePlan({ steps: [{ title: 't', instructions: 'i', paths: ['a/b.js'], after: [2] }, PLAN.steps[1]] }), /earlier step/);
});
test('two steps that write one file are put in order even when the planner called them independent', () => {
  const p = validatePlan({ steps: [{ title: 'a', instructions: 'i', paths: ['a/x.js'] }, { title: 'b', instructions: 'i', paths: ['a/x.js'] }] });
  assert.deepEqual(p[1].after, [1]);
});
test('only steps whose predecessors are done and whose files do not overlap are worked together', () => {
  const ss = validatePlan(PLAN).map(s => ({ ...s, status: 'pending' }));
  assert.deepEqual(ready(ss).map(s => s.n), [1, 2]);
  ss[0].status = ss[1].status = 'done';
  assert.deepEqual(ready(ss).map(s => s.n), [3]);
});
test('the planner is shown the named file, its neighbours and paths that share words with the item', () => {
  const got = relevant(Object.keys(REPO).concat('site/unrelated.css').join('\n'), 'fix seed/worker/src/sum.js');
  assert.equal(got[0], 'seed/worker/src/sum.js'); assert.ok(got.includes('seed/worker/src/util.js')); assert.ok(!got.includes('site/unrelated.css'));
});
test('the reviewer is never a model that wrote a step while another exists', () => {
  assert.ok(!reviewers([ADAPTERS[0].id]).some(a => a.id === ADAPTERS[0].id));
  assert.equal(reviewers(ADAPTERS.map(a => a.id)).length, ADAPTERS.length);
});

test('a failed single-shot item is planned, worked in parallel, reviewed and opened as one PR', async () => {
  const { db, env } = setup(), gh = fakeGh(), t = team();
  const out = await drive(env, { fetchImpl: gh.f, agent: t.agent });
  assert.deepEqual(t.calls, ['plan', 'step 1', 'step 2', 'step 3', 'review', 'review']);
  assert.equal(t.inFlight.max, 2, 'steps 1 and 2 ran together');
  assert.match(out[1].detail, /worked 2 step\(s\) together/);
  assert.equal(out.at(-1).pr, 'https://github.com/o/r/pull/9');
  assert.equal(gh.written['seed/worker/src/sum.js'], 'export function sum(a, b) {\n  return a + b;\n}\n');
  assert.deepEqual(Object.keys(gh.written).sort(), ['seed/worker/src/product.js', 'seed/worker/src/sum.js', 'seed/worker/test/sum.test.js']);
  assert.equal(gh.log.filter(l => l === 'POST /repos/o/r/pulls').length, 1);
  assert.match(item(db), /^in-pr: https:\/\/github.com\/o\/r\/pull\/9 \| agent: worker-orchestrator/);
  const run = db.raw.prepare('SELECT phase, review FROM orch_runs').get();
  assert.equal(run.phase, 'done'); assert.match(run.review, /passed/);
  assert.equal((await advance(env, { fetchImpl: gh.f, agent: t.agent, now: T0 + 9e6 })).idle, true);
});
test('each accepted plan is a logged decision, settled 1 when the run opens its PR and 0 when it fails', async () => {
  const good = setup(), gh = fakeGh();
  await drive(good.env, { fetchImpl: gh.f, agent: team().agent });
  const row = good.db.raw.prepare("SELECT predicted, measured, hit, settled_at FROM decision_log WHERE point='orchestrator-plan'").get();
  assert.equal(row.predicted, 0.5); assert.equal(row.measured, 1); assert.equal(row.hit, 1); assert.ok(row.settled_at);
  const bad = setup();
  await drive(bad.env, { fetchImpl: fakeGh().f, agent: team({ answers: { ...ANSWERS, 1: { files: [{ path: 'seed/worker/src/sum.js', content: 'x\n' }] } } }).agent });
  assert.equal(bad.db.raw.prepare("SELECT measured FROM decision_log WHERE point='orchestrator-plan'").get().measured, 0);
});
test('while a run holds an item the single-shot lane leaves it alone', async () => {
  const { db, env } = setup(), gh = fakeGh(), t = team();
  await advance(env, { fetchImpl: gh.f, agent: t.agent, now: T0 });
  assert.match(item(db), /^in-orch: /);
  const r = await runDbQueue(env, { fetchImpl: gh.f, agent: async () => { throw new Error('must not be called'); } });
  assert.equal(r.idle, true);
});
test('a reviewer finding sends only the named step back, with the finding, and the fixed file is what ships', async () => {
  const { env } = setup(), gh = fakeGh();
  const answers = { ...ANSWERS, 2: p => ({ files: [{ path: 'seed/worker/src/product.js', ...(p.includes('A REVIEWER REFUSED') ? { edits: [{ find: 'a + b', replace: 'a * b' }] } : { content: 'export const product = (a, b) => a + b;\n' }) }] }) };
  const t = team({ answers, review: [{ ok: false, findings: [{ step: 2, problem: 'product adds instead of multiplying' }] }, { ok: true }] });
  const out = await drive(env, { fetchImpl: gh.f, agent: t.agent });
  assert.deepEqual(t.calls, ['plan', 'step 1', 'step 2', 'step 3', 'review', 'review', 'step 2', 'review', 'review']);
  assert.equal(gh.written['seed/worker/src/product.js'], 'export const product = (a, b) => a * b;\n');
  assert.match(out.at(-1).detail, /1 fix round/);
});
test('findings that survive the fix rounds end the run and return the item to the queue with the reason; no PR is opened', async () => {
  const { db, env } = setup(), gh = fakeGh();
  let k = 0;
  const answers = { ...ANSWERS, 1: () => ({ files: [{ path: 'seed/worker/src/sum.js', content: `export function sum(a, b) {\n  return a - b - ${++k};\n}\n` }] }) };
  const t = team({ answers, review: [{ ok: false, findings: [{ step: 1, problem: 'still subtracts' }] }] });
  const out = await drive(env, { fetchImpl: gh.f, agent: t.agent });
  assert.match(out.at(-1).detail, /survived 2 fix rounds/);
  assert.match(item(db), /^needs-code: orchestrated run .* failed \(review findings survived/);
  assert.ok(!gh.log.includes('POST /repos/o/r/pulls'));
});
test('a step may ask once to read a file it was not shown, and is then shown it', async () => {
  const { env } = setup(), gh = fakeGh();
  let asked = 0;
  const answers = { ...ANSWERS, 1: p => (p.includes('READ-ONLY CONTEXT') ? (assert.match(p, /export const id = x => x;/), ANSWERS[1]) : (asked++, { need: ['seed/worker/src/util.js'] })) };
  const t = team({ answers });
  const out = await drive(env, { fetchImpl: gh.f, agent: t.agent });
  assert.equal(asked, 1); assert.ok(out.at(-1).pr);
});
test('a step that writes outside its own files, shrinks a file or leaves a stub is refused twice and ends the run', async () => {
  for (const bad of [{ path: 'seed/worker/src/util.js', content: 'export const id = 1;\n' }, { path: 'seed/worker/src/sum.js', content: 'x\n' }]) {
    const { db, env } = setup(), gh = fakeGh();
    const t = team({ answers: { ...ANSWERS, 1: { files: [bad] } } });
    const out = await drive(env, { fetchImpl: gh.f, agent: t.agent });
    assert.match(out.at(-1).detail, /run failed \(step 1/);
    assert.equal(t.calls.filter(c => c === 'step 1').length, 2);
    assert.match(item(db), /^needs-code: orchestrated run/);
    assert.ok(!gh.log.includes('POST /repos/o/r/pulls'));
  }
});
test('when no reviewer answers the PR says the review did not run; it is never recorded as passed', async () => {
  const { db, env } = setup(), gh = fakeGh();
  const t = team({ review: [new Error('no code agent produced a change')] });
  const out = await drive(env, { fetchImpl: gh.f, agent: t.agent });
  assert.ok(out.at(-1).pr);
  assert.match(db.raw.prepare('SELECT review FROM orch_runs').get().review, /^not run:/);
});
test('an item gets at most two planned runs, and an item the single-shot lane has not failed gets none', async () => {
  const { db, env } = setup(), gh = fakeGh();
  const t = team({ plan: { steps: [] } });
  for (let round = 0; round < 3; round++) {
    await drive(env, { fetchImpl: gh.f, agent: t.agent });
    db.raw.prepare("UPDATE items SET blocker = ? WHERE id='BIG-1'").run(TRIGGER + ' (again)');
  }
  assert.equal(db.raw.prepare('SELECT COUNT(*) c FROM orch_runs').get().c, 2);
  const fresh = setup('needs-code: a change to the worker');
  assert.equal((await advance(fresh.env, { fetchImpl: gh.f, agent: t.agent, now: T0 })).idle, true);
});
test('a run in which no phase finishes for six hours is ended with the reason', async () => {
  const { db, env } = setup(), gh = fakeGh(), t = team();
  await advance(env, { fetchImpl: gh.f, agent: t.agent, now: T0 });
  db.raw.prepare("UPDATE items SET blocker = 'in-orch: x' WHERE id='BIG-1'").run();
  await advance(env, { fetchImpl: gh.f, agent: t.agent, now: T0 + 7 * 3600000 });
  assert.match(db.raw.prepare('SELECT detail FROM orch_runs ORDER BY created_at LIMIT 1').get().detail, /no phase finished in 6 h/);
});
test('the provider needs the model, the repository token and the database, and is idle without work', async () => {
  assert.equal(orchestrateProvider.available({ AI: {}, GITHUB_DISPATCH_TOKEN: 't' }), false);
  const db = makeDb();
  assert.equal(orchestrateProvider.available({ AI: {}, GITHUB_DISPATCH_TOKEN: 't', DB: db }), true);
  assert.equal((await advance({ DB: db, AI: {}, GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r' }, { fetchImpl: fakeGh().f })).idle, true);
});

test('PHASED-WORK-1: a finding from the adversarial reviewer alone sends the step back, and both reviewers run again after the fix', async () => {
  const { env } = setup(), gh = fakeGh();
  const answers = { ...ANSWERS, 2: p => ({ files: [{ path: 'seed/worker/src/product.js', ...(p.includes('A REVIEWER REFUSED') ? { edits: [{ find: 'a + b', replace: 'a * b' }] } : { content: 'export const product = (a, b) => a + b;\n' }) }] }) };
  const t = team({ answers, review: [{ ok: true, findings: [] }], advert: [{ ok: false, findings: [{ step: 2, problem: 'product adds' }] }, { ok: true, findings: [] }] });
  const out = await drive(env, { fetchImpl: gh.f, agent: t.agent });
  assert.deepEqual(t.calls, ['plan', 'step 1', 'step 2', 'step 3', 'review', 'review', 'step 2', 'review', 'review']);
  assert.equal(gh.written['seed/worker/src/product.js'], 'export const product = (a, b) => a * b;\n');
  assert.match(out.at(-1).detail, /1 fix round/);
});
