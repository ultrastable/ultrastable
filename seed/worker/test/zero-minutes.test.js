import test from 'node:test';
import assert from 'node:assert/strict';
import { prExecutor, pick, checkEdits, safePath } from '../src/pr-executor.js';
import { evaluate, runGate } from '../src/worker-gate.js';
import { runLane } from '../src/lane.js';

function fake(routes) {
  const calls = [];
  const f = async (url, o = {}) => {
    const k = (o.method || 'GET') + ' ' + url.replace('https://api.github.com', '');
    calls.push({ k, body: o.body });
    const hit = Object.entries(routes).find(([p]) => k.startsWith(p));
    const [status, body] = hit ? hit[1] : [404, {}];
    return { ok: status < 300, status, text: async () => JSON.stringify(body) };
  };
  return { f, calls };
}

test('path guard matches foundation/executor.py', () => {
  assert.ok(safePath('.github/workflows/x.yml')); assert.ok(safePath('../x')); assert.ok(safePath('/etc/x')); assert.ok(safePath('a/.env'));
  assert.equal(safePath('docs/a.md'), null);
  assert.throws(() => checkEdits([{ path: '.github/x', content: 'a' }]));
  assert.throws(() => checkEdits([]));
});

test('pick: driver order, skips PRs and claimed or held issues', () => {
  const i = (number, ...labels) => ({ number, title: 't' + number, labels: labels.map(name => ({ name })) });
  assert.equal(pick([i(1, 'hold'), i(2, 'in-progress'), { ...i(3), pull_request: {} }, i(5), i(4, 'p1')]).number, 4);
  assert.equal(pick([i(1, 'blocked')]), null);
});

test('worker executor opens a PR with no Actions call', async () => {
  const { f, calls } = fake({
    'GET /repos/o/r/issues?': [200, [{ number: 7, title: 'Add a thing', body: 'b', labels: [] }]],
    'POST /repos/o/r/issues/7/labels': [200, []],
    'GET /repos/o/r/git/ref/heads/main': [200, { object: { sha: 'abc' } }],
    'GET /repos/o/r/git/trees/': [200, { tree: [{ type: 'blob', path: 'README.md' }] }],
    'GET /repos/o/r/contents/': [404, {}],
    'GET /repos/o/r': [200, { default_branch: 'main' }],
    'POST /repos/o/r/git/refs': [201, {}],
    'PUT /repos/o/r/contents/docs/a.md': [201, {}],
    'POST /repos/o/r/pulls': [201, { html_url: 'https://github.com/o/r/pull/9' }],
  });
  const env = { AI: {}, GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r' };
  assert.ok(prExecutor.available(env));
  const r = await prExecutor.dispatch(env, f, { agent: async () => ({ summary: 'add', adapter: 'x', files: [{ path: 'docs/a.md', content: 'hi é' }] }) });
  assert.equal(r.ok, true); assert.match(r.pr, /pull\/9/);
  assert.ok(!calls.some(c => /actions|dispatches/.test(c.k)));
});

test('worker executor: a path-guard violation fails the item, labels it, never opens a PR', async () => {
  const { f, calls } = fake({
    'GET /repos/o/r/issues?': [200, [{ number: 7, title: 'x', labels: [] }]],
    'POST /repos/o/r/issues/': [200, []], 'DELETE /repos/o/r/issues/': [200, []],
    'GET /repos/o/r/git/ref/': [200, { object: { sha: 'abc' } }], 'GET /repos/o/r/git/trees/': [200, { tree: [] }], 'GET /repos/o/r': [200, { default_branch: 'main' }],
  });
  const r = await prExecutor.dispatch({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r' }, f, { agent: async () => ({ files: [{ path: '.github/workflows/x.yml', content: 'a' }] }) });
  assert.equal(r.ok, false); assert.ok(!calls.some(c => c.k.startsWith('POST /repos/o/r/pulls')));
  assert.ok(calls.some(c => /executor-failed/.test(c.body || '')));
});

test('gate: secrets, guard paths and unmarked workflow edits fail; a clean diff passes', () => {
  const key = 'ghp_' + 'a'.repeat(36);
  assert.equal(evaluate([{ filename: 'a.md', patch: '+' + key }]).ok, false);
  assert.equal(evaluate([{ filename: '.github/workflows/a.yml', patch: '+x' }], { agentBranch: true }).ok, false);
  assert.equal(evaluate([{ filename: '.github/workflows/a.yml', patch: '+x' }], { body: 'Protected-change: yes' }).ok, true);
  assert.equal(evaluate([{ filename: 'docs/a.md', patch: '+hello' }], { agentBranch: true }).ok, true);
});

test('gate posts a status once per commit; lane merges on green worker-gate only when ZERO_ACTIONS', async () => {
  const g = fake({
    'GET /repos/o/r/pulls?': [200, [{ number: 1, head: { sha: 's1', ref: 'agent/1' }, body: '' }]],
    'GET /repos/o/r/commits/s1/statuses': [200, []],
    'GET /repos/o/r/pulls/1/files': [200, [{ filename: 'docs/a.md', status: 'added', patch: '+x' }]],
    'GET /repos/o/r/contents/docs/a.md?ref=s1': [200, { size: 1, encoding: 'base64', content: 'eA==' }],
    'POST /repos/o/r/statuses/s1': [201, {}],
  });
  const out = await runGate({ token: 't', repos: ['o/r'], fetch: g.f });
  assert.deepEqual(out.checked, ['o/r#1 success']);
  const routes = {
    'GET /repos/o/r/pulls?': [200, [{ number: 1, labels: [] }]],
    'GET /repos/o/r/pulls/1': [200, { draft: false, mergeable_state: 'unstable', head: { sha: 's1' } }],
    'GET /repos/o/r/issues/1/comments': [200, []],
    'GET /repos/o/r/commits/s1/status': [200, { statuses: [{ context: 'worker-gate', state: 'success' }] }],
    'PUT /repos/o/r/pulls/1/merge': [200, {}],
  };
  let l = fake(routes);
  assert.deepEqual((await runLane({ token: 't', repos: ['o/r'], fetch: l.f, issueWorkflow: null })).merged, []);
  l = fake(routes);
  assert.deepEqual((await runLane({ token: 't', repos: ['o/r'], fetch: l.f, issueWorkflow: null, zeroActions: true })).merged, []); // runs unreadable (404): unknown is not green
  const ran = { ...routes, 'GET /repos/o/r/actions/runs?head_sha=s1': [200, { workflow_runs: [{ id: 7, name: 'checks', conclusion: 'failure' }] }] };
  l = fake({ ...ran, 'GET /repos/o/r/actions/runs/7/jobs': [200, { jobs: [{ name: 'checks', conclusion: 'failure', steps: [] }] }] });
  assert.deepEqual((await runLane({ token: 't', repos: ['o/r'], fetch: l.f, issueWorkflow: null, zeroActions: true })).merged, ['o/r#1']); // never started: the diff gate decides
  l = fake({ ...ran, 'GET /repos/o/r/actions/runs/7/jobs': [200, { jobs: [{ name: 'checks', conclusion: 'failure', steps: [{ conclusion: 'success' }, { conclusion: 'failure' }] }] }] });
  const red = await runLane({ token: 't', repos: ['o/r'], fetch: l.f, issueWorkflow: null, zeroActions: true });
  assert.deepEqual(red.merged, []); assert.match(red.held[0], /red: checks\/checks failed/); // LANE-RED-1: checks that ran and failed hold the PR
});
