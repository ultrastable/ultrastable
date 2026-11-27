// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { mergeNow, prsForEvent, adoptClaims, latency, reconcile, makeGh } from '../src/mergenow.js';
import { GENERATED, isGenerated } from '../src/generated.js';

const enc = (t) => Buffer.from(t).toString('base64');
function fake(st) {
  const calls = [];
  const f = async (url, o = {}) => {
    const m = o.method || 'GET', path = url.replace('https://api.github.com', ''); calls.push(m + ' ' + path + (o.body ? ' ' + o.body : ''));
    const R = (j, ok = true, status = 200) => ({ ok, status, text: async () => (j === null ? '' : JSON.stringify(j)) });
    if (m === 'GET' && /\/pulls\/\d+$/.test(path)) return R(st.pr);
    if (m === 'GET' && /\/pulls\?state=open/.test(path)) return R([st.pr]);
    if (m === 'GET' && path.includes('/files')) return R(st.files || []);
    if (m === 'GET' && path.includes('/contents/')) { const ref = decodeURIComponent(path.split('ref=')[1]); const p = decodeURI(path.split('/contents/')[1].split('?')[0]); const t = (st.contents[ref] || {})[p]; return t == null ? R({}, false, 404) : R({ encoding: 'base64', content: enc(t), sha: `${ref}:${p}` }); }
    if (m === 'GET' && path.includes('/git/commits/')) return R({ tree: { sha: 'T0' } });
    if (m === 'POST' && path.endsWith('/git/trees')) return R({ sha: st.treeSha || 'T1' });
    if (m === 'POST' && path.endsWith('/git/commits')) return R({ sha: 'C1' });
    if (m === 'PATCH' && path.includes('/git/refs/')) return R({});
    if (m === 'POST' && path.endsWith('/merges')) return R(null, st.mergesStatus !== 409, st.mergesStatus || 201);
    if (m === 'GET' && path.includes('status=action_required')) return R({ workflow_runs: st.waiting || [] });
    if (m === 'POST' && path.endsWith('/approve')) return R({}, true, 201);
    if (m === 'GET' && path.includes('/check-runs')) return R({ check_runs: st.runs || [{ name: 'checks', status: 'completed', conclusion: 'success' }] });
    if (m === 'PUT' && path.endsWith('/merge')) return R({ sha: 'M' });
    if (m === 'PUT' && path.endsWith('/update-branch')) return R({}, true, 202);
    return R({});
  };
  return { f, calls };
}
const base = { number: 7, state: 'open', base: { ref: 'main' }, head: { ref: 'claude/x', sha: 'abc1234' }, labels: [], mergeable: true };

test('a clean green PR merges in the same request, on its exact head', async () => {
  const { f, calls } = fake({ pr: { ...base, mergeable_state: 'clean' } });
  const r = await mergeNow({ token: 't', repo: 'o/r', numbers: [7], fetch: f, wait: async () => {} });
  assert.deepEqual(r.merged, ['o/r#7']); assert.ok(calls.some(c => c.startsWith('PUT /repos/o/r/pulls/7/merge') && c.includes('"sha":"abc1234"')));
});
test('a PR whose checks still run is held, not merged', async () => {
  const { f } = fake({ pr: { ...base, mergeable_state: 'blocked' }, runs: [{ name: 'checks', status: 'in_progress' }] });
  const r = await mergeNow({ token: 't', repo: 'o/r', numbers: [7], fetch: f, wait: async () => {} });
  assert.equal(r.merged.length, 0); assert.match(r.held[0], /still running/);
});
test('a run waiting for approval is approved instead of left pending', async () => {
  const { f, calls } = fake({ pr: { ...base, mergeable_state: 'blocked' }, waiting: [{ id: 99 }] });
  const r = await mergeNow({ token: 't', repo: 'o/r', numbers: [7], fetch: f, wait: async () => {} });
  assert.deepEqual(r.approved, ['o/r#7']); assert.ok(calls.some(c => c.startsWith('POST /repos/o/r/actions/runs/99/approve')));
});
test('US-07-R23: a conflict on generated files and claim values is reconciled, then main is merged into the branch', async () => {
  const gen = GENERATED[0];
  const pr = { ...base, mergeable_state: 'dirty' };
  const st = { pr, files: [{ filename: gen, status: 'modified' }, { filename: 'README.md', status: 'modified', patch: '-<!-- claim:n -->1<!-- /claim -->' }, { filename: 'src/a.js', status: 'modified' }],
    contents: { main: { [gen]: 'G-main', 'README.md': 'x <!-- claim:n -->9<!-- /claim --> y' }, abc1234: { [gen]: 'G-pr', 'README.md': 'x <!-- claim:n -->1<!-- /claim --> y plus prose' } } };
  const { f, calls } = fake(st);
  const r = await mergeNow({ token: 't', repo: 'o/r', numbers: [7], fetch: f, wait: async () => {} });
  assert.deepEqual(r.reconciled, ['o/r#7']);
  const tree = calls.find(c => c.startsWith('POST /repos/o/r/git/trees'));
  assert.ok(tree.includes(`"sha":"main:${gen}"`), 'generated file takes main');
  assert.ok(tree.includes('9<!-- /claim --> y plus prose'), 'claim takes main, prose stays');
  assert.ok(!tree.includes('src/a.js'), 'hand-written code is untouched');
  assert.ok(calls.some(c => c.startsWith('POST /repos/o/r/merges') && c.includes('"base":"claude/x"')));
});
test('US-07-R23: a real code conflict is reported, never forced', async () => {
  const { f } = fake({ pr: { ...base, mergeable_state: 'dirty' }, files: [{ filename: 'src/a.js' }], contents: {}, mergesStatus: 409 });
  const r = await reconcile(makeGh(f, 't'), 'o/r', { ...base });
  assert.equal(r.result, 'code-conflict');
});
test('a reconcile that changes nothing pushes no commit (MERGENOW-NOOP-1)', async () => {
  const gen = GENERATED[0];
  const { f, calls } = fake({ pr: { ...base, mergeable_state: 'dirty' }, files: [{ filename: gen, status: 'modified' }], contents: { main: { [gen]: 'G' } }, treeSha: 'T0', mergesStatus: 409 });
  const r = await reconcile(makeGh(f, 't'), 'o/r', { ...base });
  assert.equal(r.result, 'code-conflict'); assert.equal(r.stripped, 0);
  assert.ok(!calls.some(c => c.startsWith('POST /repos/o/r/git/commits')), 'no empty commit');
  assert.ok(!calls.some(c => c.startsWith('PATCH /repos/o/r/git/refs/')), 'branch not moved');
});
test('a behind PR is updated from main', async () => {
  const { f } = fake({ pr: { ...base, mergeable_state: 'behind' } });
  const r = await mergeNow({ token: 't', repo: 'o/r', numbers: [7], fetch: f, wait: async () => {} });
  assert.deepEqual(r.refreshed, ['o/r#7']);
});
test('events that name a PR, a finished suite or a move of main start a pass; others do not', () => {
  const repository = { full_name: 'o/r' };
  assert.deepEqual(prsForEvent('pull_request', { action: 'opened', repository, pull_request: { number: 3, base: { ref: 'main' } } }), { repo: 'o/r', numbers: [3] });
  assert.deepEqual(prsForEvent('check_suite', { action: 'completed', repository, check_suite: { pull_requests: [{ number: 4 }] } }), { repo: 'o/r', numbers: [4] });
  assert.deepEqual(prsForEvent('push', { ref: 'refs/heads/main', repository }), { repo: 'o/r', numbers: null });
  assert.equal(prsForEvent('push', { ref: 'refs/heads/feature', repository }), null);
  assert.equal(prsForEvent('issues', { action: 'opened', repository }), null);
});
test('claim values follow main and nothing else changes', () => {
  assert.equal(adoptClaims('a <!-- claim:x -->1<!-- /claim --> b <!-- claim:y -->2<!-- /claim -->', '<!-- claim:x -->5<!-- /claim -->'), 'a <!-- claim:x -->5<!-- /claim --> b <!-- claim:y -->2<!-- /claim -->');
});
test('time to merge and the oldest open PR are measured', () => {
  const now = Date.parse('2026-11-21T12:00:00Z');
  const L = latency([{ created_at: '2026-11-21T11:00:00Z', merged_at: '2026-11-21T11:02:00Z' }, { created_at: '2026-11-21T10:00:00Z', merged_at: '2026-11-21T11:00:00Z' }, { created_at: '2026-11-21T10:00:00Z', merged_at: null }], [{ created_at: '2026-11-21T11:30:00Z' }], now);
  assert.equal(L.merged_sample, 2); assert.equal(L.merge_p50_min, 60); assert.equal(L.oldest_open_pr_min, 30);
});
test('the generated list matches the files the post-merge generators write', { skip: !existsSync(new URL('../../../scripts/regen_generated.py', import.meta.url)) && 'platform-only: a generated system has no post-merge generators (SEED-ADMIT-1)' }, () => {
  const py = readFileSync(new URL('../../../scripts/regen_generated.py', import.meta.url), 'utf8');
  const outs = JSON.parse(py.match(/^OUTPUTS = (\[[\s\S]*?\])$/m)[1]).filter(p => !/README\.md$/.test(p) && p !== 'social/calendar.json');  // the calendar also holds hand-queued posts, so a PR's copy can matter
  assert.deepEqual([...GENERATED].sort(), outs.sort());
});

test('GENERATED-BY-PATTERN-1: a class of generator-owned files is reconciled, a file a person or agent writes is not', async () => {
  // the conflicts that shut #2664 and #2615: a paper newer than the list, and a ledger a generator appends to
  for (const p of ['research/papers/second-loop-2026.md', 'research/papers/perez-lopez-1974.md', 'ops/improvements.jsonl', 'ops/research/x/ledger.jsonl', 'site/research-data.js', 'site/yearsim-data.js', 'ops/trajectory.json', 'seed/SYSTEM.md']) assert.equal(isGenerated(p), true, p);
  // hand-written, or a switch a change must be able to set: never taken from main silently
  for (const p of ['ops/halt.json', 'actions-budget.json', 'site/research.js', 'site/worker.js', 'research/studies/perez-lopez-1974.json', 'foundation/research.py', 'docs/research/knowledge-graph.md', 'README.md', 'seed/worker/src/mergenow.js']) assert.equal(isGenerated(p), false, p);
  const seen = [];
  const gh = async (method, path, body) => {
    seen.push(`${method} ${path}`);
    if (path.includes('/files')) return { ok: true, status: 200, json: [{ filename: 'research/papers/second-loop-2026.md', status: 'modified' }, { filename: 'foundation/x.py', status: 'modified' }] };
    if (path.includes('/contents/')) return { ok: true, status: 200, json: { encoding: 'base64', content: btoa('main copy'), sha: 'mainsha' } };
    if (path.includes('/git/commits/')) return { ok: true, status: 200, json: { tree: { sha: 'headtree' } } };
    if (path.endsWith('/git/trees')) { assert.deepEqual(body.tree, [{ path: 'research/papers/second-loop-2026.md', mode: '100644', type: 'blob', sha: 'mainsha' }]); return { ok: true, status: 201, json: { sha: 'newtree' } }; }
    if (path.endsWith('/git/commits')) return { ok: true, status: 201, json: { sha: 'c1' } };
    return { ok: true, status: 200, json: {} };
  };
  const { reconcile } = await import('../src/mergenow.js');
  const r = await reconcile(gh, 'o/r', { number: 7, head: { sha: 'h', ref: 'b' } });
  assert.deepEqual(r, { result: 'resolved', stripped: 1 });
  assert.ok(seen.some(x => x === 'POST /repos/o/r/merges'), 'main is merged into the branch after the paper takes main\'s copy');
});
