// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-33, the diff gate and the sweep: the Worker gate that judges a pull request without Actions, and the sweeper that owns every pull request, claim and
// zombie a client leaves behind. GitHub is an injected fake. Each test names the requirement it proves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { sweepOpenLoops, alarmStalls, recordSweep, lastSweep, PR_STALL_MIN } from '../src/sweeper.js';
import { prTier, portItemId, SLA } from '../src/sla.js';
import { latency } from '../src/mergenow.js';
import { evaluate, jsShapeCheck, checkModelEdits, stubLines, runGate, gateCard, MAX_PR_FILES, MAX_ADDED_BYTES, MAX_MODEL_EDIT_BYTES, MODEL_BRANCH_RE, STATUS_PERMISSION } from '../src/worker-gate.js';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const ago = (min) => new Date(NOW - min * 60e3).toISOString();
const R = (status, json) => ({ ok: status < 300, status, headers: new Headers(), text: async () => (json === undefined || json === null ? '' : JSON.stringify(json)) });
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
const pr = (number, ref, extra = {}) => ({ number, head: { ref, sha: 'sha' + number }, created_at: ago(10), updated_at: ago(5), ...extra });
const sweepWorld = (prs, detail, extra = {}) => github(
  (m, p) => m === 'GET' && p.startsWith('/repos/o/r/pulls?state=open') ? [200, prs] : null,
  (m, p) => { const x = /\/pulls\/(\d+)$/.exec(p); return m === 'GET' && x ? [200, { state: 'open', ...prs.find(q => q.number === +x[1]), ...(detail[x[1]] || detail.all || {}) }] : null; },
  (m, p) => m === 'GET' && p.includes('/files') ? [200, []] : null, (m, p) => m === 'POST' && p.endsWith('/merges') ? [extra.mergesStatus || 409, null] : null,
  (m, p) => m === 'GET' && /\/commits\/sha6\/check-runs/.test(p) ? [200, { total_count: 1, check_runs: [{ name: 'ci', status: 'in_progress' }] }] : null,
  (m, p) => m === 'GET' && p.includes('/check-runs') ? [200, { total_count: extra.runs ?? 1, check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }] : null,
  (m, p) => m === 'GET' && p.includes('/check-suites') ? [200, { check_suites: [] }] : null, (m, p) => m === 'GET' && /\/commits\/sha\d+$/.test(p) ? [200, { commit: { committer: { date: ago(600) } } }] : null,
  (m, p) => m === 'GET' && p.includes('labels=open-loop') ? [200, extra.filed || []] : null, (m, p) => m === 'GET' && p.includes('labels=claimed') ? [200, extra.claimed || []] : null,
  (m, p) => m === 'POST' && p.endsWith('/issues') ? [201, { number: 99 }] : null, (m, p) => m === 'PUT' && p.endsWith('/merge') ? [200, { sha: 'm' }] : null,
  (m, p) => { const x = /\/pulls\/(\d+)\/update-branch$/.exec(p); return m === 'PUT' && x ? ((detail[x[1]] || detail.all || {}).mergeable_state === 'dirty' ? [422, { message: 'merge conflict' }] : [202, {}]) : null; },  // PR-NEVER-LOSE-1: GitHub refuses a real conflict
  (m, p) => m === 'GET' && p.includes('/compare/') ? [200, { ahead_by: 2 }] : null, (m, p) => m === 'POST' && p.endsWith('/git/refs') ? [201, {}] : null,
  (m, p) => { const x = /\/git\/ref\/archive\/pr-(\d+)-/.exec(p); return m === 'GET' && x ? [200, { object: { sha: 'sha' + x[1] } }] : null; }, (m, p) => m === 'POST' && p.endsWith('/ready_for_review') ? [200, {}] : null,
  (m, p) => m === 'PATCH' && /\/pulls\/\d+$/.test(p) ? [200, {}] : null, (m, p) => m === 'POST' && p.endsWith('/comments') ? [201, {}] : null, (m) => m === 'DELETE' ? [204, null] : null);

test('US-33-R50: the sweeper owns every pull request on a client branch: it readies a draft, refreshes a branch that is behind, merges a green one, holds one still running, files a tracked item for a loop left open a day, and leaves other branches alone', async () => {
  const prs = [pr(1, 'claude/a'), pr(2, 'feature/b'), pr(3, 'agent/c', { head: { ref: 'agent/c', sha: 'sha3' } }), pr(4, 'worker/d'), pr(5, 'parked/e'), pr(6, 'dependabot/f', { updated_at: ago(30 * 60), created_at: ago(30 * 60) })];
  const detail = { 1: { mergeable_state: 'clean' }, 2: { mergeable_state: 'clean' }, 3: { mergeable_state: 'behind' }, 4: { draft: true, mergeable_state: 'clean' }, 5: { mergeable_state: 'clean' }, 6: { mergeable_state: 'unstable' } };
  const w = sweepWorld(prs, detail); const r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: NOW });
  assert.deepEqual(r.merged.sort(), ['o/r#1', 'o/r#4', 'o/r#5'].filter(t => t !== 'o/r#4' || true).sort(), 'clean client pull requests merge, a draft first marked ready');
  assert.ok(has(w.calls, 'POST', /\/pulls\/4\/ready_for_review$/)); assert.deepEqual(r.refreshed, ['o/r#3']); assert.ok(has(w.calls, 'PUT', /\/pulls\/3\/update-branch$/));
  assert.ok(!w.calls.some(c => /\/pulls\/2($|\/)/.test(c.path)), 'a branch outside the five client prefixes is never touched');
  assert.deepEqual(r.filed, ['o/r#6']); assert.equal(r.open_loop_age_hours, 30);
  const issue = w.calls.find(c => c.m === 'POST' && c.path === '/repos/o/r/issues').body;
  assert.equal(issue.title, 'Q-OPENLOOP-o-r-6: close the open client loop on #6'); assert.deepEqual(issue.labels, ['open-loop']); assert.match(issue.body, /Owner: ultrastable-tick sweeper\. Trigger: every tick\./); assert.match(issue.body, /SERVER-OWNS-LOOPS-1/);
  const held = sweepWorld([pr(6, 'claude/h')], { all: { mergeable_state: 'clean' } }); const hr = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: held.f, now: NOW });
  assert.deepEqual(hr.merged, []); assert.match(hr.held[0], /^o\/r#6 ci still running$/); assert.ok(!has(held.calls, 'PUT', /merge$/), 'GREEN-GUARD-1 applies to the sweeper too');
  const twice = sweepWorld([prs[5]], { all: { mergeable_state: 'unstable' } }, { filed: [{ title: 'Q-OPENLOOP-o-r-6: close the open client loop on #6' }] }); assert.deepEqual((await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: twice.f, now: NOW })).filed, [], 'one tracked item per stuck loop');
  const off = sweepWorld([prs[5]], { all: { mergeable_state: 'unstable' } }); const offF = off.f; const noIssues = async (u, o) => (/\/issues/.test(u) && !/labels=claimed/.test(u) ? R(410, { message: 'Issues has been disabled' }) : offF(u, o));
  const lo = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: noIssues, now: NOW }); assert.deepEqual(lo.lane_owned, ['o/r#6']); assert.equal(lo.status, 'ok', 'a repository with issues off is not an error: the lane files its own item');
  assert.equal((await sweepOpenLoops({ repos: ['o/r'] })).status, 'no-token');
  const lane = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: sweepWorld([prs[5]], { all: { mergeable_state: 'unstable' } }).f, now: NOW, laneOwned: ['o/r'] }); assert.deepEqual(lane.lane_owned, ['o/r#6'], 'a lane-owned repository keeps its item in docs/issues, never a second one on GitHub');
});

test('US-33-R51: a pull request open past the stall limit is a stall, each stall is one queue item with the pull request as its probe, and every pass leaves its merge latency behind', async () => {
  assert.equal(PR_STALL_MIN, 15);
  const w = sweepWorld([pr(7, 'dependabot/g', { created_at: ago(40), updated_at: ago(2) }), pr(8, 'dependabot/h', { created_at: ago(5), updated_at: ago(1) })], { all: { mergeable_state: 'unstable' } });
  const out = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: NOW });
  assert.deepEqual(out.stalled, [{ tag: 'o/r#7', repo: 'o/r', number: 7, state: 'unstable', minutes: 40 }]);
  const items = []; const ensure = async (db, it) => { items.push(it); return true; };
  const filed = await alarmStalls({}, { ...out, stalled: [...out.stalled, ...[1, 2, 3, 4].map(n => ({ tag: `o/r#${n}`, repo: 'o/r', number: n, state: 'dirty', minutes: 50 }))], sla_ported: [{ repo: 'o/r', number: 9, branch: 'claude/x y' }] }, ensure);
  assert.deepEqual(filed.slice(0, 3), ['Q-PR-STALL-o-r-7', 'Q-PR-STALL-o-r-1', 'Q-PR-STALL-o-r-2'], 'at most three stall items a pass'); assert.equal(filed[3], 'PORT-BRANCH-claude-x-y');
  const first = items[0]; assert.deepEqual([first.kind, first.owner_role, first.priority], ['fix', 'operations', 1]); assert.equal(first.closing_probe, 'GET /repos/o/r/pulls/7 state != open'); assert.match(first.title, /open 40 min \(unstable\)/);
  assert.match(items[3].closing_probe, /^python3 -m foundation branchsweep --carried claude\/x y$/);
  assert.deepEqual(await alarmStalls({}, { stalled: [{ tag: 'o/r#7', repo: 'o/r', number: 7, state: 'x', minutes: 1 }] }, async () => false), [], 'an item that already exists is not filed again');
  const db = makeDb(); await recordSweep(db, { ...out, pr_latency: { repo: 'o/r', merge_p50_min: 4.5, merge_p95_min: 12, oldest_open_pr_min: 40 } }, '2026-11-26 12:00:00');
  const row = await lastSweep(db); assert.deepEqual([row.status, row.merged, row.stalled_prs, row.merge_p50_min, row.merge_p95_min, row.oldest_open_pr_min], ['ok', 0, 1, 4.5, 12, 40]);
  for (let i = 0; i < 502; i++) await recordSweep(db, out, '2026-11-26 12:00:00'); assert.equal(db.raw.prepare('SELECT COUNT(*) AS n FROM sweeper_runs').get().n, 500, 'the ledger keeps the newest 500 passes');
  const closed = [{ merged_at: ago(60 * 24 + 60), created_at: ago(60 * 24 + 120) }, { merged_at: ago(30), created_at: ago(90) }, { merged_at: null, created_at: ago(500) }];
  const L = latency(closed, [{ created_at: ago(45) }], NOW); assert.deepEqual([L.merged_sample, L.merge_p50_min, L.oldest_open_pr_min, L.open_prs], [2, 60, 45, 1]);
  assert.equal(latency([], [], NOW).merge_p50_min, null, 'no merged pull request: unmeasured, not zero');
});

test('US-33-R52: past the written limit and idle, a pull request that is not merge-ready is superseded with its branch kept and one item carrying it onto main', async () => {
  assert.deepEqual(SLA.pr, { green_merge_min: 3, act_min: 15, hard_min: 60, idle_min: 30 });
  const tier = (o) => prTier({ ageMin: 10, idleMin: 5, state: 'dirty', branch: 'claude/x', ...o });
  assert.equal(tier({}), 'ok'); assert.equal(tier({ ageMin: 20 }), 'act'); assert.equal(tier({ ageMin: 61, idleMin: 31 }), 'supersede');
  assert.equal(tier({ ageMin: 61, idleMin: 29 }), 'act', 'a branch someone just pushed to is not superseded'); assert.equal(tier({ ageMin: 600, idleMin: 600, state: 'clean' }), 'ok', 'a merge-ready pull request is merged, never superseded');
  assert.equal(tier({ ageMin: 600, idleMin: 600, branch: 'feature/y' }), 'ok', 'only automation branches are on the ladder'); for (const b of ['agent/', 'worker/', 'parked/']) assert.equal(tier({ ageMin: 600, idleMin: 600, branch: b + 'z' }), 'supersede');
  assert.equal(portItemId('claude/Fix: thing!'), 'PORT-BRANCH-claude-Fix-thing'); assert.equal(portItemId('a/' + 'b'.repeat(200)).length, 'PORT-BRANCH-'.length + 80);
  const w = sweepWorld([pr(5, 'claude/x', { created_at: ago(180), updated_at: ago(180) })], { all: { mergeable_state: 'dirty' } });
  const r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: NOW });
  assert.deepEqual(r.superseded, ['o/r#5']); assert.deepEqual(r.sla_ported, [{ repo: 'o/r', number: 5, branch: 'claude/x' }]);
  assert.match(w.calls.find(c => c.path.endsWith('/issues/5/comments')).body.body, /^PR-NEVER-LOSE-1: closing after SLA-1: open past the written limit .* PORT-BRANCH-claude-x carries it onto current main\. Head sha5 is pinned/);
  assert.deepEqual(w.calls.find(c => c.m === 'PATCH' && c.path.endsWith('/pulls/5')).body, { state: 'closed' }); assert.ok(!w.calls.some(c => c.m === 'DELETE' && c.path.includes('/git/refs')), 'the branch is kept: nothing is lost');
  const young = sweepWorld([pr(5, 'claude/x', { created_at: ago(30), updated_at: ago(30) })], { all: { mergeable_state: 'dirty' } }); assert.equal((await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: young.f, now: NOW })).superseded, undefined);
});

test('US-33-R53: a blocked pull request that has no check run at all is closed and reopened once to start its checks, and one that has a run is never looped', async () => {
  const blocked = (runs) => sweepWorld([pr(5, 'claude/x', { created_at: ago(40), updated_at: ago(20) })], { all: { mergeable_state: 'blocked' } }, { runs });
  let w = blocked(0); let r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: NOW });
  assert.deepEqual(r.retriggered, ['o/r#5']); assert.deepEqual(w.calls.filter(c => c.m === 'PATCH').map(c => c.body.state), ['closed', 'open']);
  w = blocked(1); r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: NOW }); assert.equal(r.retriggered, undefined); assert.ok(!w.calls.some(c => c.m === 'PATCH'), 'a real failure is not looped');
  w = sweepWorld([pr(5, 'claude/x', { created_at: ago(40), updated_at: ago(2) })], { all: { mergeable_state: 'blocked' } }, { runs: 0 }); r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: NOW }); assert.equal(r.retriggered, undefined, 'a pull request touched in the last six minutes is given time to start its own checks');
});

test('US-33-R54: an issue still labelled claimed after the age limit has its claim released so the executor takes it again', async () => {
  const w = sweepWorld([], {}, { claimed: [{ number: 3, updated_at: ago(30 * 60) }, { number: 4, updated_at: ago(60) }, { number: 5, updated_at: ago(30 * 60), pull_request: {} }] });
  const r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: NOW });
  assert.deepEqual(r.released, ['o/r#3']); assert.ok(has(w.calls, 'DELETE', /\/issues\/3\/labels\/claimed$/)); assert.ok(!has(w.calls, 'DELETE', /\/issues\/[45]\//));
  const w2 = sweepWorld([], {}, { claimed: [{ number: 3, updated_at: ago(90 * 60) }] }); assert.deepEqual((await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w2.f, now: NOW, maxAgeH: 100 })).released, [], 'the age limit is a parameter');
});

test('US-33-R26: the sweeper tries to reconcile up to four conflicting pull requests a pass, a resolved one is reported, and an agent pull request that cannot be reconciled past the stall limit is closed so its item is redone from main', async () => {
  const prs = [1, 2, 3, 4, 5, 6].map(n => pr(n, 'agent/q-' + n, { created_at: ago(20), updated_at: ago(20) }));
  let w = sweepWorld(prs, { all: { mergeable_state: 'dirty' } }); let r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: NOW });
  const tried = w.calls.filter(c => c.m === 'GET' && /\/pulls\/\d+\/files/.test(c.path)).map(c => +/pulls\/(\d+)/.exec(c.path)[1]);
  assert.deepEqual(tried, [1, 2, 3, 4], 'one failing pull request does not starve the next, and no pass tries more than four');
  assert.deepEqual(r.superseded, ['o/r#1', 'o/r#2', 'o/r#3', 'o/r#4']); assert.match(r.errors[0], /^o\/r#1 code-conflict$/);
  assert.match(w.calls.find(c => c.path.endsWith('/issues/1/comments')).body.body, /^PR-NEVER-LOSE-1: closing after STALL-ACT-1: conflicts with main that the server cannot reconcile after the stall limit\. Head sha1 is pinned/);
  w = sweepWorld([pr(1, 'agent/q-1', { created_at: ago(20), updated_at: ago(20) })], { all: { mergeable_state: 'dirty' } }, { mergesStatus: 201 }); r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: NOW });
  assert.deepEqual(r.reconciled, ['o/r#1']); assert.equal(r.superseded, undefined); assert.ok(!w.calls.some(c => c.m === 'PATCH'));
  w = sweepWorld([pr(1, 'claude/q-1', { created_at: ago(20), updated_at: ago(20) })], { all: { mergeable_state: 'dirty' } }); r = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: NOW });
  assert.equal(r.superseded, undefined, 'a session pull request keeps its work: it is not closed at the stall limit, only at the written SLA');
});

// ---- the diff gate ----
const file = (filename, patch = '+x', status = 'modified') => ({ filename, patch, status });
test('US-33-R30: the gate judges a pull request on its diff alone: file count, size, secret-like added lines, the path guard on automation branches and the Protected-change line on workflows', () => {
  assert.deepEqual([MAX_PR_FILES, MAX_ADDED_BYTES], [60, 400000]);
  assert.deepEqual(evaluate([file('a.js')]), { ok: true, bad: [] });
  assert.match(evaluate(Array.from({ length: 61 }, (_, i) => file(`f${i}.js`))).bad[0], /^61 files exceeds 60$/);
  assert.match(evaluate([file('a.js', 'x'.repeat(MAX_ADDED_BYTES + 1))]).bad.at(-1), /diff larger than the gate limit/);
  for (const secret of ['-----BEGIN ' + 'RSA PRIVATE KEY-----', 'ghp_' + 'a'.repeat(36), 'AKIA' + 'A'.repeat(16), 'sk-ant-' + 'b'.repeat(24)]) assert.deepEqual(evaluate([file('a.js', '+' + secret)]).bad, ['a.js: secret-like content']);
  assert.equal(evaluate([file('a.js', ' context line ' + 'AKIA' + 'A'.repeat(16))]).ok, true, 'only an added line counts');
  const wf = file('.github/workflows/x.yml');
  assert.match(evaluate([wf]).bad[0], /^\.github\/workflows\/x\.yml: protected path without a Protected-change: line$/); assert.equal(evaluate([wf], { body: 'Protected-change: new job' }).ok, true);
  assert.equal(evaluate([wf], { body: 'Protected-change:' }).ok, false, 'the line must give a reason');
  const ag = evaluate([wf], { agentBranch: true, body: 'Protected-change: x' }); assert.match(ag.bad[0], /path is on the deny list/, 'an automation branch can never change a workflow, whatever it says');
  assert.equal(evaluate([file('../x.js')], { agentBranch: true }).ok, false); assert.equal(evaluate([file('.github/old.yml', '', 'removed')], { agentBranch: true }).ok, true, 'removing a path is not writing it');
  assert.ok(MODEL_BRANCH_RE.test('agent/x') && MODEL_BRANCH_RE.test('claude/x') && MODEL_BRANCH_RE.test('worker/x') && !MODEL_BRANCH_RE.test('feature/x'));
});

test('US-33-R31: a model branch is also judged on its content: a placeholder in an added line, a file over 60 KB, an unreadable file or a JavaScript file that does not close its brackets fails, and a human branch is not content-checked', async () => {
  assert.equal(MAX_MODEL_EDIT_BYTES, 60 * 1024);
  assert.equal(jsShapeCheck('export const a = `x ${1 + 2} y`; const r = /[/]x/; // ok\nfunction f() { return [1, { a: "}" }]; }'), null);
  assert.match(jsShapeCheck('function f() {\n  return 1;'), /^line 2: unclosed '\{'$/); assert.match(jsShapeCheck('const a = "x\n'), /unterminated string/); assert.match(jsShapeCheck('a(]'), /unbalanced '\]'/); assert.match(jsShapeCheck('/* never closed'), /unterminated comment/);
  const c = (head, headSize = head.length, baseSize = 0) => ({ head, headSize, baseSize });
  const ok = checkModelEdits([file('a.js'), file('gone.js', '', 'removed')], { 'a.js': c('export const a = 1;') }); assert.deepEqual(ok, { ok: true, bad: [] });
  assert.match(checkModelEdits([file('a.js')], { 'a.js': c('const a = {') }).bad[0], /^a\.js: syntax line 1: unclosed '\{'$/);
  assert.match(checkModelEdits([file('big.json')], { 'big.json': c('{}', 70000) }).bad[0], /70000 bytes is over the 61440-byte limit/); assert.match(checkModelEdits([file('big.md')], { 'big.md': c('x', 10, 70000) }).bad[0], /over the 61440-byte limit/, 'the size before the edit counts too');
  assert.match(checkModelEdits([file('a.js')], {}).bad[0], /content unreadable, cannot verify/, 'unknown is not green'); assert.match(checkModelEdits([file('a.js')], { 'a.js': c(null, 10) }).bad[0], /cannot syntax-check/);
  assert.deepEqual(checkModelEdits([file('a.js')], { 'a.js': c('a(', 2) }, { syntax: () => null }), { ok: true, bad: [] }, 'a host with Node passes a stronger syntax runner');
  assert.deepEqual(stubLines([file('src/a.js', '+// ... existing code ...\n+x')]).length, 1); assert.equal(stubLines([file('src/a.js', '+// TODO: implement the logic here')]).length, 1); assert.equal(stubLines([file('src/a.js', '+# your code here')]).length, 1);
  assert.equal(stubLines([file('README.md', '+// ... existing code ...'), file('tests/a.js', '+// ... rest of the file'), file('a.test.js', '+// ... unchanged')]).length, 0, 'documents and tests may quote a marker');
  // through the gate: the same broken file fails on a model branch and passes on a human one
  const run = async (ref) => { const posted = []; const g = github((m, p) => m === 'GET' && p.startsWith('/repos/o/r/pulls?') ? [200, [{ number: 1, head: { ref, sha: 'h1' }, base: { sha: 'b1' }, body: '' }]] : null, (m, p) => m === 'GET' && p.includes('/statuses?') ? [200, []] : null,
    (m, p) => m === 'GET' && p.includes('/pulls/1/files') ? [200, [file('src/a.js', '+const a = {')]] : null, (m, p) => m === 'GET' && p.includes('/contents/src/a.js?ref=h1') ? [200, { size: 12, encoding: 'base64', content: Buffer.from('const a = {').toString('base64') }] : null,
    (m, p) => m === 'GET' && p.includes('/contents/src/a.js?ref=b1') ? [200, { size: 5 }] : null, (m, p, b) => m === 'POST' && p.includes('/statuses/h1') ? (posted.push(b), [201, {}]) : null);
    await runGate({ token: 't', repos: ['o/r'], fetch: g.f }); return posted[0]; };
  const bad = await run('claude/x'); assert.equal(bad.state, 'failure'); assert.match(bad.description, /syntax/); assert.equal(bad.context, 'worker-gate'); assert.equal((await run('feature/x')).state, 'success');
});

test('US-33-R32: a refusal to write commit statuses is one recorded condition with one gate card that closes itself on the first judged pull request, never one error per pull request', async () => {
  assert.equal(STATUS_PERMISSION, 'statuses');
  const world = (statusCode) => github((m, p) => m === 'GET' && p.startsWith('/repos/o/r/pulls?') ? [200, [1, 2].map(n => ({ number: n, head: { ref: 'feature/' + n, sha: 'h' + n }, base: { sha: 'b' }, body: '' }))] : null, (m, p) => m === 'GET' && p.includes('/statuses?') ? [200, []] : null,
    (m, p) => m === 'GET' && p.includes('/files') ? [200, [file('a.js')]] : null, (m, p) => m === 'POST' && p.includes('/statuses/') ? [statusCode, {}] : null);
  const db = makeDb(); let out = await runGate({ token: 't', repos: ['o/r'], fetch: world(403).f });
  assert.deepEqual([out.status, out.needs, out.forbidden, out.checked, out.errors], ['forbidden', 'statuses:write', ['o/r#1', 'o/r#2'], [], []]);
  assert.equal(await gateCard(db, out, { origin: 'https://ultrastable.io' }), 'open');
  const card = db.raw.prepare("SELECT * FROM gate_cards WHERE id = 'GATE-APP-PERMISSION'").get(); assert.equal(card.status, 'open'); assert.match(card.what, /permission statuses:write.*https:\/\/ultrastable\.io\/connect\/github/); assert.match(card.default_in_effect, /merges on local-checks evidence/); assert.equal(card.closing_probe, 'gate_status_writable');
  await gateCard(db, out, { origin: 'x' }); assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM gate_cards WHERE id = 'GATE-APP-PERMISSION'").get().n, 1, 'one card, however many passes');
  out = await runGate({ token: 't', repos: ['o/r'], fetch: world(201).f }); assert.equal(out.status, 'ok'); assert.equal(await gateCard(db, out), 'closed'); assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id = 'GATE-APP-PERMISSION'").get().status, 'closed');
  assert.equal((await runGate({ token: 't', repos: ['o/r'], fetch: world(500).f })).status, 'errors', 'any other refusal is an error, not the permission condition');
  assert.equal(await gateCard(null, out), null); assert.equal((await runGate({ repos: ['o/r'] })).status, 'no-token');
});

test('US-33-R33: the gate spends a bounded number of GitHub calls a run, defers the pull requests it did not reach, and never judges the same head twice', async () => {
  const prs = [1, 2, 3].map(n => ({ number: n, head: { ref: 'feature/' + n, sha: 'h' + n }, base: { sha: 'b' }, body: '' })); const judged = new Set();
  const g = github((m, p) => m === 'GET' && p.startsWith('/repos/o/r/pulls?') ? [200, prs] : null, (m, p) => { const x = /\/commits\/(h\d)\/statuses/.exec(p); return m === 'GET' && x ? [200, judged.has(x[1]) ? [{ context: 'worker-gate' }] : []] : null; },
    (m, p) => m === 'GET' && p.includes('/files') ? [200, [file('a.js')]] : null, (m, p) => { const x = /\/statuses\/(h\d)$/.exec(p); return m === 'POST' && x ? (judged.add(x[1]), [201, {}]) : null; });
  const r1 = await runGate({ token: 't', repos: ['o/r'], fetch: g.f, maxCalls: 4 });
  assert.deepEqual(r1.checked, ['o/r#1 success']); assert.deepEqual(r1.deferred, ['o/r#2', 'o/r#3'], 'a pull request not reached is judged next run');
  const r2 = await runGate({ token: 't', repos: ['o/r'], fetch: g.f, maxCalls: 5 }); assert.deepEqual(r2.checked, ['o/r#2 success'], 'a judged commit is skipped, so the work resumes by itself');
  const r3 = await runGate({ token: 't', repos: ['o/r'], fetch: g.f }); assert.deepEqual(r3.checked, ['o/r#3 success']); assert.deepEqual(r3.deferred, []);
  assert.equal(g.calls.filter(c => c.m === 'POST').length, 3, 'one status per head commit');
});
