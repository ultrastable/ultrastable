import test from 'node:test';
import assert from 'node:assert/strict';
import { runLane, githubBudget } from '../src/lane.js';

function fake(routes) {
  const calls = [];
  const f = async (url, o) => {
    const k = (o.method || 'GET') + ' ' + url.replace('https://api.github.com', '');
    calls.push(k);
    const hit = Object.entries(routes).find(([p]) => k.startsWith(p));
    const [status, body] = hit ? hit[1] : [404, {}];
    return { ok: status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { f, calls };
}

test('no token: reports it and touches nothing', async () => {
  const { f, calls } = fake({});
  const r = await runLane({ repos: ['a/b'], fetch: f });
  assert.equal(r.status, 'no-token'); assert.equal(calls.length, 0);
});

test('records merge evidence on main when evidenceRepo matches', async () => {
  const { f, calls } = fake({
    'GET /repos/a/b/pulls?': [200, [{ number: 1, labels: [] }]],
    'GET /repos/a/b/pulls/1': [200, { draft: false, mergeable_state: 'clean', head: { sha: 'abc1234' } }],
    'GET /repos/a/b/commits/abc1234/check-runs': [200, { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }],
    'GET /repos/a/b/issues/1/comments': [200, []],
    'PUT /repos/a/b/pulls/1/merge': [200, { sha: 'abc' }],
    'PUT /repos/a/b/contents/ops/worker-merge-evidence.jsonl': [201, {}],
  });
  const r = await runLane({ token: 't', repos: ['a/b'], fetch: f, issueWorkflow: null, evidenceRepo: 'a/b' });
  assert.deepEqual(r.merged, ['a/b#1']);
  assert.ok(calls.some(c => c.startsWith('PUT /repos/a/b/contents/ops/worker-merge-evidence.jsonl')));
});

test('merges a clean PR, holds a HOLD one, dispatches an unclaimed issue', async () => {
  const { f, calls } = fake({
    'GET /repos/a/b/pulls?': [200, [{ number: 1, labels: [] }, { number: 2, labels: [] }]],
    'GET /repos/a/b/pulls/1': [200, { draft: false, mergeable_state: 'clean', head: { sha: 'abc1234' } }],
    'GET /repos/a/b/pulls/2': [200, { draft: false, mergeable_state: 'clean', head: { sha: 'abc1234' } }],
    'GET /repos/a/b/commits/abc1234/check-runs': [200, { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }],
    'GET /repos/a/b/issues/1/comments': [200, []],
    'GET /repos/a/b/issues/2/comments': [200, [{ body: 'HOLD: fix x' }]],
    'PUT /repos/a/b/pulls/1/merge': [200, {}],
    'GET /repos/a/b/issues?': [200, [{ number: 7, labels: [] }, { number: 8, labels: [{ name: 'claimed' }] }, { number: 1, pull_request: {} }]],
    'POST /repos/a/b/actions/workflows/issues.yml/dispatches': [204, null],
    'POST /repos/a/b/issues/7/labels': [200, {}],
  });
  const r = await runLane({ token: 't', repos: ['a/b'], fetch: f });
  assert.deepEqual(r.merged, ['a/b#1']);
  assert.deepEqual(r.dispatched, ['a/b#7']);
  assert.ok(r.held.some(h => h.includes('#2 HOLD')));
  assert.ok(!calls.some(c => c.includes('pulls/2/merge')));
});

// GITHUB-BUDGET-1: count GitHub calls per tick, stop at the cap, and honour Retry-After / x-ratelimit-reset on 403 and 429.
test('a mocked 429 with Retry-After stops the lane for the tick and records why', async () => {
  const calls = [];
  const f = async (url, o) => { calls.push((o.method || 'GET') + ' ' + url); return { ok: false, status: 429, headers: new Headers({ 'Retry-After': '120' }), text: async () => '{"message":"secondary rate limit"}' }; };
  const budget = githubBudget();
  const r = await runLane({ token: 't', repos: ['a/b', 'a/c'], fetch: f, issueWorkflow: 'issues.yml', budget });
  assert.equal(calls.length, 1, 'the second repo is never called'); assert.equal(r.github.stopped, true);
  assert.equal(r.github.retry_after_s, 120); assert.match(r.github.why, /429 on GET \/repos\/a\/b\/pulls.*Retry-After 120s; stopped for this tick/);
  assert.equal(budget.take(), false, 'the budget stays stopped for the rest of the tick (handoffs share it)');
});

test('a 403 with an exhausted x-ratelimit window stops; a plain 403 does not', async () => {
  const b = githubBudget(150, () => 1_000_000_000);
  b.observe({ status: 403, headers: new Headers({ 'x-ratelimit-remaining': '7' }) }, 'GET /x'); assert.equal(b.stopped, false, 'a permission 403 is not a quota');
  b.observe({ status: 403, headers: new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(1_000_000 + 300) }) }, 'GET /y');
  assert.equal(b.stopped, true); assert.equal(b.retry_after_s, 300);
});

test('the lane stops at the per-tick call cap (default 40)', async () => {
  assert.equal(githubBudget().cap, 40);
  const { f, calls } = fake({ 'GET /repos/a/b/pulls?': [200, [{ number: 1, labels: [] }, { number: 2, labels: [] }]], 'GET /repos/a/b/pulls/': [200, { draft: false, mergeable_state: 'dirty' }], 'GET /repos/a/b/issues/': [200, []] });
  const r = await runLane({ token: 't', repos: ['a/b'], fetch: f, issueWorkflow: null, budget: githubBudget(3) });
  assert.equal(calls.length, 3); assert.equal(r.status, 'stopped'); assert.match(r.github.why, /cap 3 GitHub calls per tick/);
});
