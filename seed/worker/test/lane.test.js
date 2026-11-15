import test from 'node:test';
import assert from 'node:assert/strict';
import { runLane } from '../src/lane.js';

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
    'GET /repos/a/b/pulls/1': [200, { draft: false, mergeable_state: 'clean' }],
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
    'GET /repos/a/b/pulls/1': [200, { draft: false, mergeable_state: 'clean' }],
    'GET /repos/a/b/pulls/2': [200, { draft: false, mergeable_state: 'clean' }],
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
