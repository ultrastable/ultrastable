// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-33, the merge half of the server-side change lane: the SOP a client follows, the Worker lane, the green guard, the event-driven merge, the
// workflow-PR merge, the GitHub call budget and retry, conflict reconciliation. Every GitHub call goes through an injected fake; nothing touches a network.
// Each test names the requirement it proves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SOP_STEPS, SOP_MD, SERVER_OWNS } from '../../../site/sop.js';
import { runLane, realRed, githubBudget, gh as laneGh, GITHUB_CALLS_PER_TICK, EVIDENCE_PATH } from '../src/lane.js';
import { notGreen, REQUIRED, FRESH_MS } from '../src/greenguard.js';
import { mergeNow, prsForEvent, reconcile, adoptClaims, makeGh } from '../src/mergenow.js';
import { mergeForLane } from '../src/lanemerge.js';
import { ghFetch, mergedAnyway, RETRY_STATUSES } from '../src/ghfetch.js';
import { GENERATED } from '../src/generated.js';
import { halted } from '../src/budget.js';
import { verifyOidc, _resetJwks, OIDC_AUDIENCE } from '../src/maincommit.js';
import { verifyGithubOidc, _resetJwks as _resetSite, OIDC_AUDIENCE as DEPLOY_AUDIENCE } from '../../../site/deployer.js';

const R = (status, json, headers) => ({ ok: status < 300, status, headers: new Headers(headers || {}), text: async () => (json === undefined || json === null ? '' : JSON.stringify(json)) });
// A fake GitHub: handlers answer [status, json] or return undefined to pass; calls are logged with their parsed body.
function github(...handlers) {
  const calls = [];
  const f = async (url, o = {}) => {
    const m = o.method || 'GET', path = url.replace('https://api.github.com', ''), body = o.body ? JSON.parse(o.body) : null;
    calls.push({ m, path, body });
    for (const h of handlers) { const r = h(m, path, body); if (r) return R(...r); }
    return R(404, { message: 'unexpected ' + m + ' ' + path });
  };
  return { f, calls };
}
const has = (calls, m, re) => calls.some(c => c.m === m && re.test(c.path));
const GREEN = [200, { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }];

test('US-33-R01: a client ends at an open pull request with a Handoff block and never merges, deploys, rebases later, polls or probes', () => {
  assert.deepEqual(SOP_STEPS.map(s => s.id), ['take', 'build', 'verify', 'handoff', 'stop']);
  const hand = SOP_STEPS.find(s => s.id === 'handoff'), stop = SOP_STEPS.find(s => s.id === 'stop');
  for (const key of ['## Handoff', 'item:', 'agent:', 'verify:', 'deploy:']) assert.ok(hand.do.includes(key), 'the handoff step names ' + key);
  assert.match(hand.title, /label `handoff`/);
  assert.match(stop.do, /Your work ends at the open PR/);
  for (const never of ['merge', 'deploy', 'rebase later', 'poll CI', 'probe production']) assert.ok(stop.do.includes(never), 'the stop step forbids: ' + never);
});

test('US-33-R02: the server duties are named once, and the one canonical SOP text is built from the steps', () => {
  const owns = SERVER_OWNS.join('\n');
  for (const duty of [/merge/, /conflict/, /deploy of the named workers/, /live probe/, /item closed on a green probe/, /rollback and item reopened/, /handoff_events/, /branch refresh/]) assert.match(owns, duty);
  for (const s of SOP_STEPS) assert.ok(SOP_MD.includes(s.title) && SOP_MD.includes(s.do), 'the text carries step ' + s.id);
  assert.ok(SOP_MD.includes('## What the server does after you stop'));
  for (const d of SERVER_OWNS) assert.ok(SOP_MD.includes('- ' + d));
});

test('US-33-R03: with Actions minutes gone the Worker gate decides, a run that really failed or really runs still holds, a job that never started does not', async () => {
  const pr = (extra = {}) => github(
    (m, p) => m === 'GET' && p.startsWith('/repos/a/b/pulls?') ? [200, [{ number: 1, labels: [] }]] : null,
    (m, p) => m === 'GET' && p === '/repos/a/b/pulls/1' ? [200, { draft: false, mergeable_state: 'unstable', head: { sha: 'abc1234' } }] : null,
    (m, p) => m === 'GET' && p.endsWith('/issues/1/comments?per_page=30') ? [200, []] : null,
    (m, p) => m === 'GET' && p === '/repos/a/b/commits/abc1234/status' ? [200, { statuses: extra.noStatus ? [] : [{ context: 'worker-gate', state: 'success' }] }] : null,
    (m, p) => m === 'GET' && p.startsWith('/repos/a/b/actions/runs?head_sha=abc1234') ? [200, { workflow_runs: extra.runs || [] }] : null,
    (m, p) => m === 'GET' && p.startsWith('/repos/a/b/actions/runs/9/jobs') ? [200, { jobs: extra.jobs || [] }] : null,
    (m, p) => m === 'GET' && p.startsWith('/repos/a/b/commits/abc1234/check-runs') ? [200, { total_count: 0, check_runs: [] }] : null,  // US-33-R06: read on the zero-minutes path
    (m, p) => m === 'PUT' && p === '/repos/a/b/pulls/1/merge' ? [200, { sha: 'm1' }] : null);
  const lane = (g, zero = true) => runLane({ token: 't', repos: ['a/b'], fetch: g.f, issueWorkflow: null, zeroActions: zero });
  let g = pr(); let r = await lane(g);
  assert.deepEqual(r.merged, ['a/b#1'], 'unstable, worker-gate success and no real run: merged');
  g = pr(); r = await lane(g, false);
  assert.deepEqual(r.merged, []); assert.ok(r.held[0].endsWith('unstable'), 'without zeroActions the Worker never merges an unstable PR');
  g = pr({ noStatus: true }); r = await lane(g);
  assert.deepEqual(r.merged, []); assert.ok(r.held[0].endsWith('unstable'), 'no successful worker-gate status: held');
  const failed = { id: 9, name: 'checks', conclusion: 'failure', status: 'completed' };
  g = pr({ runs: [failed], jobs: [{ name: 'test', conclusion: 'failure', steps: [{ conclusion: 'failure' }] }] }); r = await lane(g);
  assert.deepEqual(r.merged, []); assert.match(r.held[0], /red: checks\/test failed/, 'a job whose step failed really ran (LANE-RED-1)');
  g = pr({ runs: [failed], jobs: [{ name: 'test', conclusion: 'failure', steps: [] }] }); r = await lane(g);
  assert.deepEqual(r.merged, ['a/b#1'], 'a failed job with no steps never started (minutes exhausted): the gate decides');
  const started = new Date().toISOString();
  g = pr({ runs: [{ id: 10, name: 'checks', status: 'in_progress', run_started_at: started }] }); r = await lane(g);
  assert.match(r.held[0], /red: checks still running/, 'a run started within the hour is waited for (MERGE-RUNNING-1)');
  const stuck = new Date(Date.now() - 3 * 3600e3).toISOString();
  assert.equal(await realRed(pr({ runs: [{ id: 11, name: 'checks', status: 'queued', run_started_at: stuck }] }).f, 't', 'a/b', 'abc1234'), null, 'a run stuck in a queue for hours is not waited for');
  assert.equal(await realRed(pr({ runs: [{ id: 12, name: 'lane', status: 'in_progress', run_started_at: started }] }).f, 't', 'a/b', 'abc1234'), null, 'the lane run itself is never waited for');
});

test('US-33-R04: one halt stops every recurring and self-triggering path of the Worker, and the Worker variable wins over the committed file', () => {
  assert.equal(halted({}, { HALT: '1' }), true);
  assert.equal(halted({}, { HALT: 'true' }), true); assert.equal(halted({}, { HALT: 'on' }), true);
  assert.equal(halted({ halt: { halted: true } }, {}), true, 'the committed file halts when the variable is unset');
  assert.equal(halted({ halt: { halted: true } }, { HALT: '0' }), false, 'HALT=0 resumes without a deploy');
  assert.equal(halted({ halt: { halted: true } }, { HALT: 'off' }), false);
  assert.equal(halted(null, {}), false);
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  assert.match(src, /if \(halted\(config, env\)\) \{ ctx\.waitUntil\(beat\(env\.DB, 'halted'/, 'the cron stops at the top of the scheduled handler');
  assert.match(src, /if \(halted\(config, env\) && \(url\.pathname === '\/hook\/github' \|\| url\.pathname === '\/hook\/host' \|\| url\.pathname === '\/hook\/cloudflare' \|\| url\.pathname === '\/pulse\/watch'\)\) return Response\.json\(\{ halted: true \}, \{ status: 202 \}\)/, 'the webhooks and the watch route answer 202 and do nothing');
  for (const route of ['/api/ops/backup', '/api/uptime/repair', '/api/lane/merge', '/api/main/commit']) {
    const at = src.indexOf(`url.pathname === '${route}'`);
    assert.ok(at > 0 && /halted\(config, env\)\) return Response\.json\(\{ halted: true \}/.test(src.slice(at, at + 400)), route + ' honours the halt');
  }
});

test('US-33-R10: a merge asks the green guard first: an unreadable answer, a run still going, a red run and a missing required run all hold', async () => {
  const guard = (repo, runs, status = 200) => notGreen(null, 't', repo, '1234567890abcdef1234567890abcdef12345678', async () => ({ ok: status < 300, status, json: { check_runs: runs } }));
  const ok = { name: 'ci', status: 'completed', conclusion: 'success' };
  assert.equal(await guard('o/r', [ok]), null);
  assert.equal(await guard('o/r', [], 500), 'check-runs 500', 'unknown is not green');
  assert.equal(await guard('o/r', [ok, { name: 'unit', status: 'in_progress' }]), 'unit still running');
  assert.equal(await guard('o/r', [ok, { name: 'unit', status: 'completed', conclusion: 'failure' }]), 'unit failure');
  assert.equal(await guard('o/r', [ok, { name: 'unit', status: 'completed', conclusion: 'cancelled' }]), 'unit cancelled');
  assert.equal(await guard('o/r', [ok, { name: 'a', status: 'completed', conclusion: 'neutral' }, { name: 'b', status: 'completed', conclusion: 'skipped' }]), null, 'neutral and skipped are not red');
  assert.equal(await guard('o/r', [ok, { name: 'lane', status: 'in_progress' }]), null, 'the lane run never blocks the lane');
  assert.deepEqual(REQUIRED['ultrastable/ultrastable'], ['checks']);
  assert.match(await guard('ultrastable/ultrastable', [ok]), /^checks has not passed on 1234567$/, 'the full suite must itself have passed in the core repository');
  assert.equal(await guard('ultrastable/ultrastable', [ok, { name: 'checks', status: 'completed', conclusion: 'success' }]), null);
});

test('US-33-R11: an empty check list is not green: a queued suite or a head too new to have reported holds', async () => {
  const sha = 'abcdef1234567890abcdef1234567890abcdef12';
  const fresh = new Date(Date.now() - 60e3).toISOString(), old = new Date(Date.now() - FRESH_MS - 3600e3).toISOString();
  const world = ({ suites, date, suitesStatus = 200 }) => async (f, t, m, path) => {
    if (path.includes('/check-runs')) return { ok: true, status: 200, json: { check_runs: [] } };
    if (path.includes('/check-suites')) return { ok: suitesStatus < 300, status: suitesStatus, json: { check_suites: suites } };
    return { ok: true, status: 200, json: { commit: { committer: { date } } } };
  };
  const hold = (w) => notGreen(null, 't', 'o/r', sha, world(w));
  assert.equal(FRESH_MS, 15 * 60000);
  assert.match(await hold({ suites: [{ status: 'queued', app: { slug: 'github-actions' } }], date: old }), /^checks queued \(github-actions queued\)$/);
  assert.match(await hold({ suites: [], date: fresh }), /^no checks reported yet on abcdef1$/);
  assert.match(await hold({ suites: [{ status: 'queued', app: { slug: 'lane' } }], date: fresh }), /no checks reported yet/, 'the lane suite is not a check');
  assert.equal(await hold({ suites: [], date: old }), null, 'a head older than the freshness window with nothing queued is judged on what ran');
  assert.equal(await hold({ suites: [{ status: 'completed', app: { slug: 'github-actions' } }], date: fresh }), null);
  assert.equal(await hold({ suites: [], date: old, suitesStatus: 502 }), 'check-suites 502');
});

test('US-33-R12: every merge is a squash, and the event-driven and workflow-PR merges name the head they judged', async () => {
  const sha = 'a'.repeat(40);
  const pr = { number: 7, state: 'open', draft: false, base: { ref: 'main' }, head: { ref: 'claude/x', sha, repo: { full_name: 'o/r' } }, labels: [], mergeable: true, mergeable_state: 'clean' };
  const world = () => github((m, p) => m === 'GET' && /\/pulls\/7$/.test(p) ? [200, pr] : null, (m, p) => m === 'GET' && p.includes('/pulls?state=open') ? [200, [pr]] : null,
    (m, p) => m === 'GET' && p.includes('status=action_required') ? [200, { workflow_runs: [] }] : null, (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null,
    (m, p) => m === 'GET' && p.includes('/comments') ? [200, []] : null, (m, p) => m === 'PUT' && p.endsWith('/merge') ? [200, { sha: 'm' }] : null);
  let g = world(); await mergeNow({ token: 't', repo: 'o/r', numbers: [7], fetch: g.f, wait: async () => {} });
  assert.deepEqual(g.calls.find(c => c.m === 'PUT' && c.path.endsWith('/merge')).body, { merge_method: 'squash', sha });
  g = world(); const r = await mergeForLane({ token: 't', repo: 'o/r', pr: 7, sha, fetch: g.f });
  assert.equal(r.ok, true); assert.deepEqual(g.calls.find(c => c.m === 'PUT').body, { merge_method: 'squash', sha });
  g = world();
  await runLane({ token: 't', repos: ['o/r'], fetch: (u, o) => g.f(u, o), issueWorkflow: null });
  assert.deepEqual(g.calls.find(c => c.m === 'PUT' && c.path.endsWith('/merge')).body, { merge_method: 'squash' }, 'the tick lane squashes too');
});

test('US-33-R13: the event-driven pass holds a pull request labelled hold, and the tick lane holds one whose comment starts with HOLD:', async () => {
  const mk = (labels, comment) => github(
    (m, p) => m === 'GET' && p.startsWith('/repos/o/r/pulls?') ? [200, [{ number: 4, labels }]] : null,
    (m, p) => m === 'GET' && /\/pulls\/4$/.test(p) ? [200, { number: 4, state: 'open', draft: false, base: { ref: 'main' }, labels, mergeable: true, mergeable_state: 'clean', head: { ref: 'claude/x', sha: 'b'.repeat(40) } }] : null,
    (m, p) => m === 'GET' && p.includes('/comments') ? [200, comment ? [{ body: comment }] : []] : null, (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null,
    (m, p) => m === 'GET' && p.includes('status=action_required') ? [200, { workflow_runs: [] }] : null, (m, p) => m === 'PUT' && p.endsWith('/merge') ? [200, {}] : null);
  let g = mk([{ name: 'hold' }]); let r = await mergeNow({ token: 't', repo: 'o/r', numbers: [4], fetch: g.f, wait: async () => {} });
  assert.deepEqual(r.held, ['o/r#4 hold']); assert.ok(!has(g.calls, 'PUT', /merge$/));
  g = mk([], 'HOLD: waiting for the migration'); r = await runLane({ token: 't', repos: ['o/r'], fetch: g.f, issueWorkflow: null });
  assert.deepEqual(r.held, ['o/r#4 HOLD']); assert.ok(!has(g.calls, 'PUT', /merge$/));
  g = mk([], 'please do not HOLD: this'); r = await runLane({ token: 't', repos: ['o/r'], fetch: g.f, issueWorkflow: null });
  assert.deepEqual(r.merged, ['o/r#4'], 'only a comment that starts with HOLD: holds');
});

test('US-33-R14: a draft whose work is finished is marked ready by the server, and the Worker lane leaves a draft labelled handoff alone', async () => {
  let ready = false;
  const draft = (labels) => github(
    (m, p) => m === 'GET' && p.startsWith('/repos/o/r/pulls?') ? [200, [{ number: 5, labels }]] : null,
    (m, p) => m === 'GET' && /\/pulls\/5$/.test(p) ? [200, { number: 5, state: 'open', draft: !ready, base: { ref: 'main' }, labels, mergeable: true, mergeable_state: 'clean', head: { ref: 'claude/x', sha: 'c'.repeat(40) } }] : null,
    (m, p) => m === 'POST' && p.endsWith('/ready_for_review') ? (ready = true, [200, {}]) : null, (m, p) => m === 'GET' && p.includes('/comments') ? [200, []] : null,
    (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null, (m, p) => m === 'PUT' && p.endsWith('/merge') ? [200, {}] : null);
  let g = draft([]); let r = await runLane({ token: 't', repos: ['o/r'], fetch: g.f, issueWorkflow: null });
  assert.ok(has(g.calls, 'POST', /\/pulls\/5\/ready_for_review$/)); assert.deepEqual(r.merged, ['o/r#5']);
  ready = false; g = draft([{ name: 'handoff' }]); r = await runLane({ token: 't', repos: ['o/r'], fetch: g.f, issueWorkflow: null });
  assert.ok(!has(g.calls, 'POST', /ready_for_review/), 'a handoff draft is still the agent\'s'); assert.deepEqual(r.merged, []);
  ready = false; g = draft([]); r = await mergeNow({ token: 't', repo: 'o/r', numbers: [5], fetch: g.f, wait: async () => {} });
  assert.deepEqual(r.readied, ['o/r#5']); assert.deepEqual(r.merged, ['o/r#5']);
});

test('US-33-R15: a pull request event, a finished check suite, a finished run or a move of main starts a merge pass, and nothing else does', () => {
  const repository = { full_name: 'o/r' };
  assert.deepEqual(prsForEvent('pull_request', { repository, action: 'opened', pull_request: { number: 3, base: { ref: 'main' } } }), { repo: 'o/r', numbers: [3] });
  for (const action of ['reopened', 'synchronize', 'ready_for_review', 'labeled', 'unlabeled']) assert.ok(prsForEvent('pull_request', { repository, action, pull_request: { number: 3, base: { ref: 'main' } } }), action);
  assert.equal(prsForEvent('pull_request', { repository, action: 'closed', pull_request: { number: 3, base: { ref: 'main' } } }), null);
  assert.equal(prsForEvent('pull_request', { repository, action: 'opened', pull_request: { number: 3, base: { ref: 'dev' } } }), null, 'only pull requests into main');
  assert.deepEqual(prsForEvent('check_suite', { repository, action: 'completed', check_suite: { pull_requests: [{ number: 8 }, { number: 9 }] } }), { repo: 'o/r', numbers: [8, 9] });
  assert.deepEqual(prsForEvent('check_run', { repository, action: 'completed', check_run: { check_suite: { pull_requests: [{ number: 2 }] } } }), { repo: 'o/r', numbers: [2] });
  assert.deepEqual(prsForEvent('workflow_run', { repository, action: 'completed', workflow_run: { pull_requests: [{ number: 6 }] } }), { repo: 'o/r', numbers: [6] });
  assert.equal(prsForEvent('check_suite', { repository, action: 'completed', check_suite: { pull_requests: [] } }), null);
  assert.equal(prsForEvent('check_suite', { repository, action: 'requested', check_suite: { pull_requests: [{ number: 8 }] } }), null);
  assert.deepEqual(prsForEvent('push', { repository, ref: 'refs/heads/main' }), { repo: 'o/r', numbers: null }, 'main moved: every open PR may now conflict or be behind');
  assert.equal(prsForEvent('push', { repository, ref: 'refs/heads/feature' }), null);
  assert.equal(prsForEvent('issues', { repository, action: 'opened' }), null);
  assert.equal(prsForEvent('pull_request', { action: 'opened' }), null, 'no repository, no pass');
});

test('US-33-R16: a merge pass updates a branch that is behind, approves a run waiting for approval, waits once for a lazy mergeability, holds the rest and reconciles at most one conflict', async () => {
  const sha = 'd'.repeat(40);
  const base = { number: 7, state: 'open', draft: false, base: { ref: 'main' }, head: { ref: 'claude/x', sha }, labels: [], mergeable: true };
  const mk = (pr, extra = {}) => github(
    (m, p) => m === 'GET' && /\/pulls\/7$/.test(p) ? [200, typeof pr === 'function' ? pr() : pr] : null,
    (m, p) => m === 'GET' && p.includes('status=action_required') ? [200, { workflow_runs: extra.waiting || [] }] : null,
    (m, p) => m === 'POST' && p.endsWith('/approve') ? [201, {}] : null, (m, p) => m === 'PUT' && p.endsWith('/update-branch') ? [202, {}] : null,
    (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null, (m, p) => m === 'PUT' && p.endsWith('/merge') ? [200, { sha: 'm' }] : null,
    (m, p) => m === 'GET' && p.includes('/files') ? [200, []] : null, (m, p) => m === 'POST' && p.endsWith('/merges') ? [409, null] : null);
  const pass = (g, o = {}) => mergeNow({ token: 't', repo: 'o/r', numbers: [7], fetch: g.f, wait: async () => {}, ...o });
  let g = mk({ ...base, mergeable_state: 'behind' }); let r = await pass(g);
  assert.deepEqual(r.refreshed, ['o/r#7']); assert.deepEqual(g.calls.find(c => c.path.endsWith('/update-branch')).body, { expected_head_sha: sha });
  g = mk({ ...base, mergeable_state: 'clean' }, { waiting: [{ id: 91 }] }); r = await pass(g);
  assert.deepEqual(r.approved, ['o/r#7']); assert.ok(has(g.calls, 'POST', /actions\/runs\/91\/approve$/)); assert.deepEqual(r.merged, [], 'the approved run reports first; the check_suite event merges');
  let n = 0, waited = 0;
  g = mk(() => (n++ === 0 ? { ...base, mergeable: null, mergeable_state: 'unknown' } : { ...base, mergeable_state: 'clean' })); r = await pass(g, { wait: async () => { waited++; } });
  assert.equal(waited, 1, 'GitHub computes mergeability lazily: read again once'); assert.deepEqual(r.merged, ['o/r#7']);
  g = mk({ ...base, mergeable_state: 'has_hooks' }); r = await pass(g); assert.deepEqual(r.held, ['o/r#7 has_hooks']); assert.ok(!has(g.calls, 'PUT', /merge$/));
  g = mk({ ...base, mergeable_state: 'dirty' }); r = await pass(g);
  assert.deepEqual(r.conflicts, ['o/r#7'], 'a conflict in hand-written code is reported, never forced');
  g = mk({ ...base, mergeable_state: 'dirty' }); r = await pass(g, { maxReconcile: 0 }); assert.deepEqual(r.held, ['o/r#7 dirty (next event)']);
  g = mk({ ...base, mergeable_state: 'clean' }); r = await pass(g, { cap: 2 });
  assert.equal(r.merged.length, 0, 'the pass stops at its call cap'); assert.ok(r.calls <= 2);
  assert.equal((await mergeNow({ repo: 'o/r', numbers: [7], fetch: g.f })).status, 'no-token');
});

test('US-33-R17: one GitHub call budget bounds a tick, and a rate-limit answer stops every later call without touching the network', async () => {
  assert.equal(GITHUB_CALLS_PER_TICK, 40);
  assert.equal(githubBudget().cap, 40); assert.equal(githubBudget(0).cap, 40); assert.equal(githubBudget(7).cap, 7);
  const b = githubBudget(2); assert.equal(b.take(), true); assert.equal(b.take(), true); assert.equal(b.take(), false);
  assert.deepEqual(b.report(), { calls: 2, cap: 2, stopped: true, why: 'cap 2 GitHub calls per tick reached', retry_after_s: null });
  const b2 = githubBudget(10), headers = (h) => ({ get: (k) => h[k] ?? h[k.toLowerCase()] ?? null });
  b2.observe({ status: 403, headers: headers({ 'x-ratelimit-remaining': '4' }) }, 'GET /x'); assert.equal(b2.stopped, false, 'a plain permission refusal is not a quota');
  b2.observe({ status: 429, headers: headers({ 'Retry-After': '120' }) }, 'GET /x'); assert.equal(b2.stopped, true); assert.equal(b2.retry_after_s, 120); assert.match(b2.why, /rate limited, Retry-After 120s/);
  const t0 = Date.parse('2026-11-26T10:00:00Z'), b3 = githubBudget(10, () => t0);
  b3.observe({ status: 403, headers: headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(t0 / 1000 + 90) }) }, 'GET /y'); assert.equal(b3.retry_after_s, 90);
  let net = 0; const f = async () => { net++; return R(429, {}, { 'Retry-After': '30' }); };
  const b4 = githubBudget(10);
  const first = await laneGh(f, 't', 'GET', '/a', undefined, b4); assert.equal(first.status, 429); assert.equal(b4.stopped, true);
  const after = await laneGh(f, 't', 'GET', '/b', undefined, b4);
  assert.deepEqual(after, { ok: false, status: 0, json: null, stopped: true }); assert.equal(net, 1, 'a stopped budget never calls the network');
  const limited = await runLane({ token: 't', repos: ['a/b', 'c/d'], fetch: f, budget: githubBudget(10), issueWorkflow: null });
  assert.equal(limited.github.stopped, true); assert.match(limited.github.why, /rate limited/); assert.equal(net, 2, 'the second repository is never asked after the stop: one more call than before, none after');
  const capped = github((m, p) => m === 'GET' && p.startsWith('/repos/a/b/pulls?') ? [200, [{ number: 1, labels: [] }]] : null);
  const lane = await runLane({ token: 't', repos: ['a/b'], fetch: capped.f, budget: githubBudget(1), issueWorkflow: null });
  assert.equal(lane.status, 'stopped'); assert.match(lane.github.why, /cap 1 GitHub calls per tick reached/); assert.equal(capped.calls.length, 1);
});

test('US-33-R18: a GitHub 5xx or a network error is retried with backoff, and a merge that answered 5xx is read back and counted when GitHub merged it', async () => {
  assert.deepEqual([...RETRY_STATUSES].sort(), [500, 502, 503, 504]);
  const waits = []; const wait = async (ms) => { waits.push(ms); };
  let n = 0; const flaky = async () => (++n < 3 ? { status: 503 } : { status: 200, ok: true });
  assert.equal((await ghFetch(flaky, 'u', {}, { wait })).status, 200); assert.deepEqual(waits, [800, 1600], 'backoff 800 ms, doubling');
  n = 0; waits.length = 0; assert.equal((await ghFetch(async () => (n++, { status: 404 }), 'u', {}, { wait })).status, 404); assert.equal(n, 1, 'a 404 is not retried');
  n = 0; assert.equal((await ghFetch(async () => (n++, { status: 502 }), 'u', {}, { wait })).status, 502); assert.equal(n, 3, 'three tries, then the last answer');
  n = 0; assert.equal((await ghFetch(async () => { if (++n === 1) throw new Error('reset'); return { status: 200 }; }, 'u', {}, { wait })).status, 200);
  await assert.rejects(ghFetch(async () => { throw new Error('down'); }, 'u', {}, { wait }), /down/);
  const read = (merged) => async () => ({ ok: true, json: { merged } });
  for (const s of [500, 502, 503, 504, 405, 409]) assert.equal(await mergedAnyway(read(true), 'o/r', 1, s), true, 'status ' + s);
  assert.equal(await mergedAnyway(read(false), 'o/r', 1, 502), false);
  assert.equal(await mergedAnyway(read(true), 'o/r', 1, 404), false, 'only the answers a landed merge can produce are read back');
  // the lane counts a merge GitHub finished although its answer was a 5xx
  let merged = false;
  const g = github((m, p) => m === 'GET' && p.startsWith('/repos/o/r/pulls?') ? [200, [{ number: 4, labels: [] }]] : null,
    (m, p) => m === 'GET' && /\/pulls\/4$/.test(p) ? [200, { number: 4, draft: false, merged, mergeable_state: 'clean', head: { sha: 'e'.repeat(40) } }] : null,
    (m, p) => m === 'GET' && p.includes('/comments') ? [200, []] : null, (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null,
    (m, p) => m === 'PUT' && p.endsWith('/merge') ? (merged = true, [405, {}]) : null);
  const r = await runLane({ token: 't', repos: ['o/r'], fetch: g.f, issueWorkflow: null });
  assert.deepEqual(r.merged, ['o/r#4']);
});

test('US-33-R19: a merge the Worker made with no Actions run leaves one evidence row on main, appended to what is there', async () => {
  assert.equal(EVIDENCE_PATH, 'ops/worker-merge-evidence.jsonl');
  let put = null; const old = '{"pr":1}\n';
  const g = github((m, p) => m === 'GET' && p.startsWith('/repos/a/b/pulls?') ? [200, [{ number: 3, labels: [] }]] : null,
    (m, p) => m === 'GET' && /\/pulls\/3$/.test(p) ? [200, { draft: false, mergeable_state: 'clean', head: { sha: 'f'.repeat(40) } }] : null,
    (m, p) => m === 'GET' && p.includes('/comments') ? [200, []] : null, (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null, (m, p) => m === 'PUT' && p.endsWith('/merge') ? [200, { sha: 'mergedsha' }] : null,
    (m, p) => m === 'GET' && p.includes('/contents/ops/worker-merge-evidence.jsonl') ? [200, { content: Buffer.from(old).toString('base64'), sha: 'blob1' }] : null,
    (m, p, b) => m === 'PUT' && p.includes('/contents/ops/worker-merge-evidence.jsonl') ? (put = b, [200, {}]) : null);
  const r = await runLane({ token: 't', repos: ['a/b'], fetch: g.f, issueWorkflow: null, evidenceRepo: 'a/b' });
  assert.deepEqual(r.merged, ['a/b#3']); assert.equal(put.branch, 'main'); assert.equal(put.sha, 'blob1', 'the file is updated on the blob that was read');
  const lines = Buffer.from(put.content, 'base64').toString().trimEnd().split('\n');
  assert.equal(lines[0], '{"pr":1}'); const row = JSON.parse(lines[1]);
  assert.deepEqual([row.pr, row.sha, row.host, row.via], [3, 'mergedsha', 'cloudflare-worker', 'clean']); assert.ok(Date.parse(row.at) > 0);
  const none = github((m, p) => m === 'GET' && p.startsWith('/repos/a/b/pulls?') ? [200, [{ number: 3, labels: [] }]] : null, (m, p) => m === 'GET' && /\/pulls\/3$/.test(p) ? [200, { draft: false, mergeable_state: 'clean', head: { sha: 'f'.repeat(40) } }] : null,
    (m, p) => m === 'GET' && p.includes('/comments') ? [200, []] : null, (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null, (m, p) => m === 'PUT' && p.endsWith('/merge') ? [200, {}] : null);
  await runLane({ token: 't', repos: ['a/b'], fetch: none.f, issueWorkflow: null, evidenceRepo: 'other/repo' });
  assert.ok(!none.calls.some(c => c.path.includes('/contents/')), 'evidence is written only for the evidence repository');
});

test('US-33-R20: a pull request the Actions token cannot merge is merged by the Worker only on the exact head, open, not a fork, clean and green', async () => {
  const sha = '1'.repeat(40);
  const open = (over = {}) => ({ number: 7, state: 'open', draft: false, mergeable_state: 'clean', head: { sha, repo: { full_name: 'o/r' } }, ...over });
  const world = (pr, checks = GREEN, put = [200, { sha: 'mm' }]) => github((m, p) => m === 'GET' && /\/pulls\/7$/.test(p) ? [200, pr] : null, (m, p) => m === 'GET' && p.includes('/check-runs') ? checks : null, (m, p) => m === 'PUT' && p.endsWith('/merge') ? put : null);
  const go = (g, args = {}) => mergeForLane({ token: 't', repo: 'o/r', pr: 7, sha, fetch: g.f, ...args });
  assert.deepEqual(await go(world(open())), { ok: true, status: 200, sha: 'mm' });
  assert.deepEqual(await mergeForLane({ repo: 'o/r', pr: 7, sha }), { ok: false, status: 503, error: 'no app token' });
  assert.equal((await go(world(open()), { sha: 'short' })).status, 400); assert.equal((await go(world(open()), { pr: '7' })).status, 400);
  for (const [over, why] of [[{ state: 'closed' }, 'not an open ready PR'], [{ draft: true }, 'not an open ready PR'], [{ head: { sha: '2'.repeat(40), repo: { full_name: 'o/r' } } }, 'head moved'],
    [{ head: { sha, repo: { full_name: 'x/fork' } } }, 'fork PR'], [{ mergeable_state: 'dirty' }, 'mergeable_state dirty']]) {
    const r = await go(world(open(over))); assert.deepEqual([r.ok, r.status, r.error], [false, 409, why]);
  }
  const red = await go(world(open(), [200, { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] }])); assert.deepEqual([red.status, red.error], [409, 'ci failure']);
  const merged = await go(world(open(), GREEN, [502, {}]).constructor === Object ? github((m, p) => m === 'GET' && /\/pulls\/7$/.test(p) ? [200, open({ merged: true })] : null, (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null, (m, p) => m === 'PUT' && p.endsWith('/merge') ? [502, {}] : null) : null);
  assert.equal(merged.ok, true); assert.equal(merged.confirmed_after, 502, 'a merge GitHub finished despite a 5xx counts');
  const refused = await go(world(open(), GREEN, [405, { message: 'Required status check is expected' }])); assert.deepEqual([refused.ok, refused.status], [false, 502]); assert.match(refused.error, /^merge 405 Required status check/);
});

async function keypair() { return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']); }
const b64u = (buf) => Buffer.from(buf).toString('base64url');
async function jwt(kp, claims, header = { alg: 'RS256', kid: 'k1' }) {
  const head = b64u(JSON.stringify(header)), body = b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', kp.privateKey, new TextEncoder().encode(head + '.' + body));
  return head + '.' + body + '.' + b64u(sig);
}
test('US-33-R21: the routes that write with the App token accept only a GitHub Actions identity token for the main branch of this repository and the audience of that route', async () => {
  const kp = await keypair(), jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1' };
  const now = Date.now(), t = Math.floor(now / 1000);
  const claims = (o = {}) => ({ iss: 'https://token.actions.githubusercontent.com', aud: 'ultrastable-main', repository: 'ultrastable/ultrastable', ref: 'refs/heads/main', exp: t + 300, run_id: '42', sha: 'abc', ...o });
  let fetched = 0; const fetchJwks = async () => { fetched++; return { json: async () => ({ keys: [jwk] }) }; };
  assert.equal(OIDC_AUDIENCE, 'ultrastable-main'); assert.equal(DEPLOY_AUDIENCE, 'ultrastable-deploy');
  _resetJwks(); const good = await verifyOidc(await jwt(kp, claims()), { repo: 'ultrastable/ultrastable', fetch: fetchJwks, now });
  assert.deepEqual([good.ok, good.run], [true, '42']);
  const bad = async (o, header) => (await verifyOidc(await jwt(kp, claims(o), header), { repo: 'ultrastable/ultrastable', fetch: fetchJwks, now }));
  assert.match((await bad({ aud: 'ultrastable-deploy' })).why, /claims do not name/, 'the deploy audience does not open the main writer');
  assert.match((await bad({ repository: 'evil/fork' })).why, /claims do not name/); assert.match((await bad({ ref: 'refs/heads/feature' })).why, /claims do not name/);
  assert.match((await bad({ iss: 'https://evil.example' })).why, /claims do not name/); assert.equal((await bad({ exp: t - 5 })).why, 'expired or not yet valid');
  assert.equal((await bad({}, { alg: 'HS256', kid: 'k1' })).why, 'alg HS256'); assert.equal((await verifyOidc('not-a-jwt', {})).why, 'not a JWT');
  const other = await keypair(); assert.equal((await verifyOidc(await jwt(other, claims()), { repo: 'ultrastable/ultrastable', fetch: fetchJwks, now })).why, 'bad signature');
  assert.equal((await verifyOidc(await jwt(kp, claims(), { alg: 'RS256', kid: 'zzz' }), { repo: 'ultrastable/ultrastable', fetch: fetchJwks, now })).why, 'unknown key');
  // the deploy route has its own audience and the same discipline
  _resetSite(); const env = { OIDC_REPO: 'ultrastable/ultrastable' };
  assert.equal((await verifyGithubOidc(await jwt(kp, claims({ aud: 'ultrastable-deploy' })), env, fetchJwks, now)).ok, true);
  assert.match((await verifyGithubOidc(await jwt(kp, claims()), env, fetchJwks, now)).why, /claims do not name/, 'the main-writer audience does not open the deploy route');
  const src = readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
  for (const route of ['/api/lane/merge', '/api/main/commit']) { const at = src.indexOf(`url.pathname === '${route}'`); assert.match(src.slice(at, at + 900), /if \(!who\.ok\) return new Response\('Not found', \{ status: 404 \}\)/, route + ' answers a stranger with 404'); }
});

test('US-33-R22: a conflict on generated files and claim values is reconciled to main and main is merged in; an unchanged tree commits nothing; a code conflict is reported', async () => {
  const enc = (t) => Buffer.from(t).toString('base64');
  const pr = { number: 7, head: { sha: 'h1', ref: 'agent/x' } };
  const world = ({ files, mainText = 'main', mergeStatus = 201, newTree = 'T1', headTree = 'T0' }) => {
    const calls = [];
    const gh = async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === 'GET' && path.includes('/pulls/7/files')) return { ok: true, status: 200, json: files };
      if (method === 'GET' && path.includes('/contents/')) { const ref = decodeURIComponent(path.split('ref=')[1]); return ref === 'main' ? { ok: true, status: 200, json: { encoding: 'base64', content: enc(mainText), sha: 'mainblob' } } : { ok: true, status: 200, json: { encoding: 'base64', content: enc('<!-- claim:n -->3<!-- /claim --> text'), sha: 'prblob' } }; }
      if (method === 'GET' && path.includes('/git/commits/')) return { ok: true, status: 200, json: { tree: { sha: headTree } } };
      if (method === 'POST' && path.endsWith('/git/trees')) return { ok: true, status: 201, json: { sha: newTree } };
      if (method === 'POST' && path.endsWith('/git/commits')) return { ok: true, status: 201, json: { sha: 'C1' } };
      if (method === 'PATCH') return { ok: true, status: 200, json: {} };
      if (method === 'POST' && path.endsWith('/merges')) return { ok: mergeStatus < 300, status: mergeStatus, json: null };
      return { ok: false, status: 404, json: null };
    };
    return { gh, calls };
  };
  let w = world({ files: [{ filename: 'site/claims-data.js' }, { filename: 'foundation/x.py' }] });
  assert.deepEqual(await reconcile(w.gh, 'o/r', pr), { result: 'resolved', stripped: 1 });
  const tree = w.calls.find(c => c.path.endsWith('/git/trees')).body.tree; assert.deepEqual(tree, [{ path: 'site/claims-data.js', mode: '100644', type: 'blob', sha: 'mainblob' }], 'the generated file takes main\'s blob and hand-written code is untouched');
  assert.ok(w.calls.find(c => c.path.endsWith('/merges')), 'then main is merged into the branch'); assert.deepEqual(w.calls.find(c => c.path.endsWith('/merges')).body.head, 'main');
  assert.equal(w.calls.find(c => c.method === 'PATCH').body.force, false, 'the branch is moved without force');
  w = world({ files: [{ filename: 'docs/a.md', status: 'modified', patch: '+<!-- claim:n -->3<!-- /claim -->' }], mainText: 'x <!-- claim:n -->9<!-- /claim -->' });
  await reconcile(w.gh, 'o/r', pr); assert.match(w.calls.find(c => c.path.endsWith('/git/trees')).body.tree[0].content, /<!-- claim:n -->9<!-- \/claim --> text/, 'a claim value is computed from code: main\'s value wins');
  assert.equal(adoptClaims('a <!-- claim:z -->1<!-- /claim -->', 'none'), 'a <!-- claim:z -->1<!-- /claim -->', 'a claim main does not hold is left alone');
  w = world({ files: [{ filename: 'site/claims-data.js' }], newTree: 'T0' }); await reconcile(w.gh, 'o/r', pr);
  assert.ok(!w.calls.some(c => c.path.endsWith('/git/commits')) && !w.calls.some(c => c.method === 'PATCH'), 'MERGENOW-NOOP-1: a tree equal to the head\'s tree commits nothing');
  assert.equal((await reconcile(world({ files: [], mergeStatus: 409 }).gh, 'o/r', pr)).result, 'code-conflict');
  assert.deepEqual(await reconcile(world({ files: [], mergeStatus: 500 }).gh, 'o/r', pr), { result: 'error', why: 'merges 500' });
  assert.deepEqual(await reconcile(async () => ({ ok: false, status: 502, json: null }), 'o/r', pr), { result: 'error', why: 'files 502' });
  assert.equal(typeof makeGh, 'function');
});

test('US-33-R23: the generated list the Worker reconciles to main equals the files the post-merge generators write', () => {
  const py = readFileSync(new URL('../../../scripts/regen_generated.py', import.meta.url), 'utf8');
  const outs = JSON.parse(py.match(/^OUTPUTS = (\[[\s\S]*?\])$/m)[1]).filter(p => !/README\.md$/.test(p) && p !== 'social/calendar.json');
  assert.deepEqual([...GENERATED].sort(), outs.sort());
  assert.ok(GENERATED.length > 10 && GENERATED.every(p => !p.startsWith('/') && !p.includes('..')));
});
