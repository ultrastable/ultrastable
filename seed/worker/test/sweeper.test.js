import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sweepOpenLoops } from '../src/sweeper.js';
const NOW = Date.parse('2026-11-13T12:00:00Z');
function fake(state) {
  const calls = [];
  const f = async (url, o = {}) => {
    const m = o.method || 'GET', path = url.replace('https://api.github.com', ''); calls.push(m + ' ' + path);
    const R = (j, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(j) });
    if (m === 'GET' && path.startsWith('/repos/o/r/pulls?')) return R(state.prs);
    if (m === 'GET' && /pulls\/\d+$/.test(path)) return R(state.detail);
    if (m === 'PUT' && path.endsWith('/merge')) return R({}, state.mergeOk !== false, state.mergeOk === false ? 405 : 200);
    if (state.issuesOff && path.includes('/issues')) return R({ message: 'Issues has been disabled in this repository.' }, false, 410);
    if (m === 'GET' && path.includes('labels=open-loop')) return R(state.filed || []);
    if (m === 'POST' && path.endsWith('/issues')) return R({ number: 9 });
    if (m === 'GET' && path.includes('labels=claimed')) return R(state.claimed || []);
    if (m === 'GET' && path.includes('/check-runs')) return R({ total_count: state.runs ?? 1 });
    if (m === 'DELETE') return R({});
    return R({});
  };
  return { f, calls };
}
const pr = { number: 5, head: { ref: 'claude/x' }, updated_at: '2026-11-10T00:00:00Z' };
test('a green client PR is merged by the server', async () => {
  const { f, calls } = fake({ prs: [pr], detail: { ...pr, mergeable_state: 'clean' } });
  const r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: f, now: NOW });
  assert.deepEqual(r.merged, ['o/r#5']); assert.ok(calls.includes('PUT /repos/o/r/pulls/5/merge'));
});
test('a stuck old client PR gets one tracked item and a probe age; a non-client branch is left alone', async () => {
  const { f, calls } = fake({ prs: [pr, { number: 6, head: { ref: 'feature/y' }, updated_at: '2020-01-01T00:00:00Z' }], detail: { ...pr, mergeable_state: 'dirty' } });
  const r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: f, now: NOW });
  assert.deepEqual(r.filed, ['o/r#5']); assert.ok(r.open_loop_age_hours > 70); assert.ok(!calls.some(c => c.includes('/pulls/6')));
});
test('an already-filed item is not filed twice; stale claims are released; no token reports no-token', async () => {
  const { f } = fake({ prs: [pr], detail: { ...pr, mergeable_state: 'dirty' }, filed: [{ title: 'Q-OPENLOOP-o-r-5: x' }], claimed: [{ number: 3, updated_at: '2026-11-01T00:00:00Z' }] });
  const r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: f, now: NOW });
  assert.deepEqual(r.filed, []); assert.deepEqual(r.released, ['o/r#3']);
  assert.equal((await sweepOpenLoops({ repos: ['o/r'] })).status, 'no-token');
});
test('with issues off the sweep does not abort: the stuck PR is left to the lane item and the next PR is still handled', async () => {
  const two = [pr, { number: 7, head: { ref: 'agent/z' }, updated_at: '2026-11-10T00:00:00Z' }];
  const { f, calls } = fake({ prs: two, detail: { ...pr, mergeable_state: 'dirty' }, issuesOff: true });
  const r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: f, now: NOW });
  assert.equal(r.status, 'ok'); assert.deepEqual(r.errors, []); assert.deepEqual(r.filed, []);
  assert.deepEqual(r.lane_owned, ['o/r#5', 'o/r#7']); assert.ok(calls.includes('GET /repos/o/r/pulls/7'));
});

test('BRANCH-ROOT-CAUSE-1: a blocked PR with no check run is closed and reopened once; a worker/ branch is swept; one with runs is not touched', async () => {
  const w = { number: 8, head: { ref: 'worker/roadmap-x' }, updated_at: '2026-11-13T00:00:00Z' };
  const a = fake({ prs: [w], detail: { ...w, head: { ref: 'worker/roadmap-x', sha: 'abc' }, mergeable_state: 'blocked' }, runs: 0 });
  const r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: a.f, now: NOW });
  assert.deepEqual(r.retriggered, ['o/r#8']); assert.equal(a.calls.filter(c => c === 'PATCH /repos/o/r/pulls/8').length, 2);
  const b = fake({ prs: [w], detail: { ...w, head: { ref: 'worker/roadmap-x', sha: 'abc' }, mergeable_state: 'blocked' }, runs: 2 });
  const r2 = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: b.f, now: NOW });
  assert.equal(r2.retriggered, undefined);
});
