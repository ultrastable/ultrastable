// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-33, rulings made when the specification was brought level with the code: the blocked state of the zero-minutes merge (R03), what each route reads
// of a hold (R13), the evidence row (R19), the secret patterns of the diff gate (R30), the executor's deny list by file name (R61) and the signed webhook
// entry (R100). R06 and R103 are PLANNED: their tests are marked todo and are their closing probes. GitHub is an injected fake; nothing touches a network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { runLane } from '../src/lane.js';
import { mergeNow } from '../src/mergenow.js';
import { mergeForLane } from '../src/lanemerge.js';
import { sweepOpenLoops } from '../src/sweeper.js';
import { evaluate, SECRET_RES } from '../src/worker-gate.js';
import { safePath, DENY_NAMES, DENY_PREFIXES } from '../src/pr-executor.js';
import { verifySignature } from '../src/events.js';
import { githubHookSecrets, verifyAny, hookSecret } from '../src/hosts.js';

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
const GREEN = [200, { total_count: 1, check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }];

test('US-33-R03: the zero-minutes merge accepts a blocked pull request as well as an unstable one, and every state it holds is named at the end of the held reason', async () => {
  const world = (state, { status = true } = {}) => github(
    (m, p) => m === 'GET' && p.startsWith('/repos/a/b/pulls?') ? [200, [{ number: 1, labels: [] }]] : null,
    (m, p) => m === 'GET' && p === '/repos/a/b/pulls/1' ? [200, { draft: false, mergeable_state: state, head: { sha: 'abc1234' } }] : null,
    (m, p) => m === 'GET' && p.endsWith('/issues/1/comments?per_page=30') ? [200, []] : null,
    (m, p) => m === 'GET' && p === '/repos/a/b/commits/abc1234/status' ? [200, { statuses: status ? [{ context: 'worker-gate', state: 'success' }] : [] }] : null,
    (m, p) => m === 'GET' && p.startsWith('/repos/a/b/actions/runs?head_sha=abc1234') ? [200, { workflow_runs: [] }] : null,
    (m, p) => m === 'PUT' && p === '/repos/a/b/pulls/1/merge' ? [200, { sha: 'm1' }] : null);
  for (const state of ['unstable', 'blocked']) {
    const w = world(state); const r = await runLane({ token: 't', repos: ['a/b'], fetch: w.f, issueWorkflow: null, zeroActions: true });
    assert.deepEqual(r.merged, ['a/b#1'], state + ' with a successful worker-gate status merges when no run failed or runs');
    const noZero = world(state); const rz = await runLane({ token: 't', repos: ['a/b'], fetch: noZero.f, issueWorkflow: null });
    assert.deepEqual(rz.held, ['a/b#1 ' + state], state + ' without zeroActions is held and the reason ends with the state');
    assert.ok(!has(noZero.calls, 'PUT', /merge$/));
    const noStatus = world(state, { status: false }); const rs = await runLane({ token: 't', repos: ['a/b'], fetch: noStatus.f, issueWorkflow: null, zeroActions: true });
    assert.deepEqual(rs.held, ['a/b#1 ' + state], state + ' without the worker-gate status is held, ending with the state');
  }
  const dirty = world('dirty'); const rd = await runLane({ token: 't', repos: ['a/b'], fetch: dirty.f, issueWorkflow: null, zeroActions: true });
  assert.deepEqual(rd.held, ['a/b#1 dirty'], 'any other state is held and named too');
});

test('US-33-R13: each route holds on the hold it reads: the event-driven pass on the label, the tick lane on a comment that starts with HOLD:', async () => {
  const mk = (labels, comment) => github(
    (m, p) => m === 'GET' && p.startsWith('/repos/o/r/pulls?') ? [200, [{ number: 4, labels }]] : null,
    (m, p) => m === 'GET' && /\/pulls\/4$/.test(p) ? [200, { number: 4, state: 'open', draft: false, base: { ref: 'main' }, labels, mergeable: true, mergeable_state: 'clean', head: { ref: 'claude/x', sha: 'b'.repeat(40) } }] : null,
    (m, p) => m === 'GET' && p.includes('/comments') ? [200, comment ? [{ body: comment }] : []] : null, (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null,
    (m, p) => m === 'GET' && p.includes('status=action_required') ? [200, { workflow_runs: [] }] : null, (m, p) => m === 'PUT' && p.endsWith('/merge') ? [200, {}] : null);
  let g = mk([{ name: 'hold' }]); const r = await mergeNow({ token: 't', repo: 'o/r', numbers: [4], fetch: g.f, wait: async () => {} });
  assert.deepEqual(r.held, ['o/r#4 hold']); assert.ok(!has(g.calls, 'PUT', /merge$/));
  assert.ok(!g.calls.some(c => c.path.includes('/comments')), 'the event-driven pass reads the label and no comment');
  g = mk([], 'HOLD: not yet'); const l = await runLane({ token: 't', repos: ['o/r'], fetch: g.f, issueWorkflow: null });
  assert.deepEqual(l.held, ['o/r#4 HOLD']); assert.ok(!has(g.calls, 'PUT', /merge$/));
  g = mk([], 'I would HOLD: this'); const m = await runLane({ token: 't', repos: ['o/r'], fetch: g.f, issueWorkflow: null });
  assert.deepEqual(m.merged, ['o/r#4'], 'a comment that merely contains HOLD: after other words does not hold');
});

test('US-33-R30: the secret patterns are a private-key header, gh[pousr]_ with 36 or more characters, AKIA with 16 and sk-ant- with 20 or more', () => {
  const bad = (line) => evaluate([{ filename: 'a.js', patch: '+' + line, status: 'modified' }]).bad;
  assert.equal(SECRET_RES.length, 4);
  for (const kind of ['p', 'o', 'u', 's', 'r']) assert.deepEqual(bad(`gh${kind}_` + 'a'.repeat(36)), ['a.js: secret-like content'], `gh${kind}_ and 36 characters`);
  assert.deepEqual(bad('ghp_' + 'a'.repeat(40)), ['a.js: secret-like content'], 'a longer token is still a secret');
  assert.deepEqual(bad('ghp_' + 'a'.repeat(35)), [], '35 characters is not a token');
  assert.deepEqual(bad('ghx_' + 'a'.repeat(36)), [], 'the class is p, o, u, s and r only');
  assert.deepEqual(bad('sk-ant-' + 'b'.repeat(20)), ['a.js: secret-like content'], 'sk-ant- and 20 characters');
  assert.deepEqual(bad('sk-ant-' + 'b_-'.repeat(10)), ['a.js: secret-like content'], 'letters, digits, hyphen and underscore count');
  assert.deepEqual(bad('sk-ant-' + 'b'.repeat(19)), [], '19 characters is not a key');
  assert.deepEqual(bad('AKIA' + 'A'.repeat(16)), ['a.js: secret-like content']);
  assert.deepEqual(bad('AKIA' + 'A'.repeat(15)), []);
});

test('US-33-R61: the deny list compares a file name for equality in any directory and refuses a prefix; a name that only ends like one is allowed', () => {
  assert.deepEqual(DENY_NAMES, ['.env', 'id_rsa', 'credentials']);
  assert.ok(DENY_PREFIXES.includes('ops/executor-log') && DENY_PREFIXES.includes('.github/') && DENY_PREFIXES.includes('autonomy/') && DENY_PREFIXES.includes('.git/'));
  for (const p of ['.env', 'config/.env', 'a/b/id_rsa', 'x/credentials', 'ops/executor-log.jsonl', 'ops/executor-log-2.jsonl']) assert.ok(safePath(p), p + ' is refused');
  for (const p of ['prod.env', 'config/prod.env', 'my_id_rsa', 'id_rsa.pub', 'credentials.md', 'docs/credentials/readme.md', 'ops/deploys.jsonl']) assert.equal(safePath(p), null, p + ' is allowed');
});

// ---- R100: the signed webhook entry ----
const sign = (secret, body) => 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
test('US-33-R100: verifySignature accepts only sha256= and the exact HMAC of the raw body, and verifyAny accepts a match under any secret', async () => {
  const body = '{"zen":"x"}', good = sign('s3', body);
  assert.equal(await verifySignature('s3', body, good), true);
  assert.equal(await verifySignature('s3', body, good + '0'), false, 'a digest of another length');
  assert.equal(await verifySignature('s3', body, good.slice(0, -1)), false);
  assert.equal(await verifySignature('s3', body, 'sha1=' + good.slice(7)), false, 'no sha256= prefix');
  assert.equal(await verifySignature('s3', body, good.slice(7)), false, 'no prefix at all');
  assert.equal(await verifySignature('s3', body, null), false, 'no header');
  assert.equal(await verifySignature('', body, good), false, 'no secret');
  assert.equal(await verifySignature('other', body, good), false, 'a wrong digest');
  assert.equal(await verifySignature('s3', body + ' ', good), false, 'the raw body is what is signed');
  assert.equal(await verifyAny(verifySignature, ['a', 's3'], body, good), true);
  assert.equal(await verifyAny(verifySignature, ['a', 'b'], body, good), false);
  assert.equal(await verifyAny(verifySignature, [], body, good), false, 'no secret at all refuses every delivery');
});

test('US-33-R100: the secrets a delivery may be signed with are the bound one, the App webhook secret and the derived one, with no duplicate, and an unreadable App secret leaves the others', async () => {
  const derived = await hookSecret({ CREDENTIAL_KEY: 'k' }, 'github');
  assert.match(derived, /^[0-9a-f]{64}$/);
  assert.deepEqual(await githubHookSecrets({ GITHUB_WEBHOOK_SECRET: 'bound', CREDENTIAL_KEY: 'k' }, async () => ({ secret: { webhook_secret: 'app' } })), ['bound', 'app', derived]);
  assert.deepEqual(await githubHookSecrets({ GITHUB_WEBHOOK_SECRET: 'bound' }, async () => ({ secret: { webhook_secret: 'bound' } })), ['bound'], 'no duplicate');
  const quiet = console.error; console.error = () => {};
  try { assert.deepEqual(await githubHookSecrets({ GITHUB_WEBHOOK_SECRET: 'bound', CREDENTIAL_KEY: 'k' }, async () => { throw new Error('sealed store down'); }), ['bound', derived]); } finally { console.error = quiet; }
  assert.deepEqual(await githubHookSecrets({}, null), [], 'a deployment with no secret has none');
});

test('US-33-R100: a delivery with a bad or missing signature answers 401 and starts nothing; a signed one starts the merge pass; the halt answers first', async () => {
  const cfg = new URL('../src/config.js', import.meta.url), made = !existsSync(cfg);
  if (made) writeFileSync(cfg, 'export default ' + JSON.stringify({ org_slug: 'test' }) + ';\n');
  const realFetch = globalThis.fetch, quiet = console.log, quietErr = console.error; const net = [];
  try {
    globalThis.fetch = async (url) => { net.push(String(url)); return R(404, { message: 'no network in a test' }); };
    console.log = () => {}; console.error = () => {};
    const mod = await import('../src/index.js');
    const sqls = [], DB = { prepare(sql) { sqls.push(sql); const o = { bind() { return o; }, first: async () => null, all: async () => ({ results: [] }), run: async () => ({ meta: {} }) }; return o; } };
    const waits = [], ctx = { waitUntil(p) { waits.push(p); } };
    const env = { DB, AI: { run: async () => ({ response: 'x' }) }, GITHUB_WEBHOOK_SECRET: 'whsec', GITHUB_TOKEN: 'tok' };
    const body = JSON.stringify({ action: 'unlabeled', repository: { full_name: 'o/r' }, pull_request: { number: 4, base: { ref: 'main' } } });
    const post = (headers, e = env, b = body) => mod.default.fetch(new Request('https://x/hook/github', { method: 'POST', body: b, headers: { 'x-github-event': 'pull_request', ...headers } }), e, ctx);
    for (const [why, headers] of [['no header', {}], ['no prefix', { 'x-hub-signature-256': sign('whsec', body).slice(7) }], ['sha1', { 'x-hub-signature-256': 'sha1=' + sign('whsec', body).slice(7) }],
      ['wrong length', { 'x-hub-signature-256': 'sha256=abc' }], ['wrong digest', { 'x-hub-signature-256': sign('not-the-secret', body) }]]) {
      const r = await post(headers); assert.equal(r.status, 401, why); assert.deepEqual(await r.json(), { error: 'bad signature' }, why);
    }
    const unbound = await post({ 'x-hub-signature-256': sign('whsec', body) }, { DB, AI: env.AI }); assert.equal(unbound.status, 401, 'no secret bound: every delivery is refused');
    await Promise.allSettled(waits);
    assert.deepEqual(net, [], 'a refused delivery makes no GitHub call: no merge pass, no host event');
    assert.equal(waits.length, 0, 'and starts no background work');
    const ok = await post({ 'x-hub-signature-256': sign('whsec', body) }); assert.notEqual(ok.status, 401, 'a signed delivery is accepted');
    await Promise.allSettled(waits);
    assert.ok(net.some(u => u.includes('/repos/o/r/pulls/4')), 'a signed pull request event starts a merge pass on that pull request: ' + net.join(' '));
    net.length = 0;
    const halted = await post({}, { ...env, HALT: '1' }); assert.equal(halted.status, 202); assert.deepEqual(await halted.json(), { halted: true }, 'the halt answers before the signature is read');
    assert.deepEqual(net, []);
  } finally { globalThis.fetch = realFetch; console.log = quiet; console.error = quietErr; if (made) rmSync(cfg); }
});

// ---- R13 and R103: holds ----
// One open pull request #7 on a client branch, clean and green. `label` puts the label hold on it; `comments` are its comments, served one page at a time.
const holdWorld = ({ label = false, comments = [] } = {}) => {
  const labels = label ? [{ name: 'hold' }] : [];
  const pr = { number: 7, labels, head: { ref: 'claude/h', sha: 'a'.repeat(40) }, created_at: new Date(Date.now() - 10 * 60e3).toISOString(), updated_at: new Date(Date.now() - 5 * 60e3).toISOString() };
  const detail = { ...pr, draft: false, state: 'open', base: { ref: 'main' }, mergeable: true, mergeable_state: 'clean', head: { ...pr.head, repo: { full_name: 'o/r' } } };
  const page = (p) => { const q = new URLSearchParams(p.split('?')[1] || ''); const per = Number(q.get('per_page') || 30), n = Number(q.get('page') || 1); return comments.slice((n - 1) * per, n * per).map(body => ({ body })); };
  return github(
    (m, p) => m === 'GET' && p.startsWith('/repos/o/r/pulls?state=open') ? [200, [pr]] : null,
    (m, p) => m === 'GET' && /\/pulls\/7$/.test(p) ? [200, detail] : null,
    (m, p) => m === 'GET' && p.includes('/files') ? [200, []] : null,
    (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null, (m, p) => m === 'GET' && p.includes('/check-suites') ? [200, { check_suites: [] }] : null,
    (m, p) => m === 'GET' && p.includes('/status') ? [200, { statuses: [] }] : null, (m, p) => m === 'GET' && /\/issues\/7\/comments/.test(p) ? [200, page(p)] : null,
    (m, p) => m === 'GET' && p.includes('status=action_required') ? [200, { workflow_runs: [] }] : null,
    (m, p) => m === 'GET' && p.includes('labels=') ? [200, []] : null, (m, p) => m === 'POST' && p.endsWith('/issues') ? [201, { number: 99 }] : null,
    (m, p) => m === 'PUT' && p.endsWith('/merge') ? [200, { sha: 'm' }] : null);
};
const SHA7 = 'a'.repeat(40);

test('US-33-R13: the label hold holds on every Worker merge route: the event-driven pass, the tick lane, the sweeper (R50) and mergeForLane (R20)', async () => {
  let w = holdWorld({ label: true }); const n = await mergeNow({ token: 't', repo: 'o/r', numbers: [7], fetch: w.f, wait: async () => {} });
  assert.deepEqual(n.held, ['o/r#7 hold']); assert.ok(!has(w.calls, 'PUT', /merge$/), 'the event-driven pass');
  w = holdWorld({ label: true }); const l = await runLane({ token: 't', repos: ['o/r'], fetch: w.f, issueWorkflow: null });
  assert.deepEqual(l.held, ['o/r#7 hold']); assert.ok(!has(w.calls, 'PUT', /merge$/), 'the tick lane');
  assert.ok(!w.calls.some(c => c.path.includes('/comments')), 'the tick lane reads the label from what it already holds, before it reads any comment');
  w = holdWorld({ label: true }); const s = await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: Date.now() });
  assert.deepEqual(s.held, ['o/r#7 hold']); assert.ok(!has(w.calls, 'PUT', /merge$/), 'the sweeper');
  assert.ok(!w.calls.some(c => c.path.includes('/check-runs')), 'a held pull request is not judged green or red: the hold comes first');
  w = holdWorld({ label: true }); const f = await mergeForLane({ token: 't', repo: 'o/r', pr: 7, sha: SHA7, fetch: w.f });
  assert.deepEqual(f, { ok: false, status: 409, error: 'hold' }); assert.ok(!has(w.calls, 'PUT', /merge$/), 'mergeForLane');
  w = holdWorld(); assert.deepEqual((await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: Date.now() })).merged, ['o/r#7'], 'without the label the same pull request merges');
  w = holdWorld(); assert.equal((await mergeForLane({ token: 't', repo: 'o/r', pr: 7, sha: SHA7, fetch: w.f })).ok, true);
});

test('US-33-R13: the tick lane holds on a HOLD: comment among the first 30 comments it reads, one page', async () => {
  const w = holdWorld({ comments: [...Array(29).fill('looks fine'), 'HOLD: the migration first'] });
  const r = await runLane({ token: 't', repos: ['o/r'], fetch: w.f, issueWorkflow: null });
  assert.deepEqual(r.held, ['o/r#7 HOLD']); assert.ok(!has(w.calls, 'PUT', /merge$/));
  assert.ok(w.calls.some(c => c.m === 'GET' && c.path.endsWith('/issues/7/comments?per_page=30')), 'one page of 30');
});

// R103 is PLANNED: each test below is marked todo and is part of its closing probe; the todo comes off when the route reads a HOLD: comment.
const R103 = { todo: 'R103 (US-SPEC-33 section 7): this route does not read a HOLD: comment yet' };
test('US-33-R103: the event-driven pass holds a pull request whose comment starts with HOLD:', R103, async () => {
  const w = holdWorld({ comments: ['HOLD: not yet'] }); const r = await mergeNow({ token: 't', repo: 'o/r', numbers: [7], fetch: w.f, wait: async () => {} });
  assert.ok(!has(w.calls, 'PUT', /merge$/), 'mergeNow does not merge a pull request held by a HOLD: comment'); assert.deepEqual(r.merged, []);
});
test('US-33-R103: the sweeper holds a pull request whose comment starts with HOLD:', R103, async () => {
  const w = holdWorld({ comments: ['HOLD: not yet'] }); await sweepOpenLoops({ token: 't', repos: ['o/r'], fetch: w.f, now: Date.now() });
  assert.ok(!has(w.calls, 'PUT', /merge$/), 'the sweeper does not merge a pull request held by a HOLD: comment');
});
test('US-33-R103: mergeForLane refuses a pull request whose comment starts with HOLD:', R103, async () => {
  const w = holdWorld({ comments: ['HOLD: not yet'] }); const r = await mergeForLane({ token: 't', repo: 'o/r', pr: 7, sha: SHA7, fetch: w.f });
  assert.equal(r.ok, false, 'mergeForLane does not merge a pull request held by a HOLD: comment'); assert.ok(!has(w.calls, 'PUT', /merge$/));
});
test('US-33-R103: the tick lane holds on a HOLD: comment after the thirtieth, on a later page', { todo: 'R103 (US-SPEC-33 section 7): runLane reads one page of 30 comments' }, async () => {
  const w = holdWorld({ comments: [...Array(30).fill('looks fine'), 'HOLD: the migration first'] });
  await runLane({ token: 't', repos: ['o/r'], fetch: w.f, issueWorkflow: null });
  assert.ok(!has(w.calls, 'PUT', /merge$/), 'a HOLD: comment on the second page holds as one on the first does');
});

// ---- R06: the zero-minutes merge and check runs from other apps ----
// A head with a successful worker-gate status and an Actions run that failed without starting (exhausted minutes: a failed job with no steps).
const zeroWorld = (state, checkRuns) => github(
  (m, p) => m === 'GET' && p.startsWith('/repos/a/b/pulls?') ? [200, [{ number: 1, labels: [] }]] : null,
  (m, p) => m === 'GET' && p === '/repos/a/b/pulls/1' ? [200, { draft: false, mergeable_state: state, head: { sha: 'abc1234' } }] : null,
  (m, p) => m === 'GET' && p.endsWith('/issues/1/comments?per_page=30') ? [200, []] : null,
  (m, p) => m === 'GET' && p === '/repos/a/b/commits/abc1234/status' ? [200, { statuses: [{ context: 'worker-gate', state: 'success' }] }] : null,
  (m, p) => m === 'GET' && p.startsWith('/repos/a/b/actions/runs?head_sha=abc1234') ? [200, { workflow_runs: [{ id: 9, name: 'checks', status: 'completed', conclusion: 'failure' }] }] : null,
  (m, p) => m === 'GET' && p.startsWith('/repos/a/b/actions/runs/9/jobs') ? [200, { jobs: [{ name: 'checks', conclusion: 'failure', steps: [] }] }] : null,
  (m, p) => m === 'GET' && p.includes('/commits/abc1234/check-runs') ? checkRuns : null,
  (m, p) => m === 'PUT' && p === '/repos/a/b/pulls/1/merge' ? [200, { sha: 'm1' }] : null);
const actionsRun = { name: 'checks', status: 'completed', conclusion: 'failure', app: { slug: 'github-actions' } };
test('US-33-R06: the zero-minutes merge holds on a check run of another app that failed, still runs, or cannot be read, and still merges past an Actions run that never started', { todo: 'R06 (US-SPEC-33 section 7): runLane judges the zero-minutes path by the worker-gate status and realRed, which read Actions runs only' }, async () => {
  for (const state of ['unstable', 'blocked']) {
    for (const [why, runs] of [
      ['a failed check run of another app', [200, { total_count: 2, check_runs: [actionsRun, { name: 'third-party-scanner', status: 'completed', conclusion: 'failure', app: { slug: 'scanner' } }] }]],
      ['a check run of another app still running', [200, { total_count: 2, check_runs: [actionsRun, { name: 'third-party-scanner', status: 'in_progress', conclusion: null, app: { slug: 'scanner' } }] }]],
      ['an unreadable check-runs answer', [500, { message: 'boom' }]]]) {
      const w = zeroWorld(state, runs); const r = await runLane({ token: 't', repos: ['a/b'], fetch: w.f, issueWorkflow: null, zeroActions: true });
      assert.deepEqual(r.merged, [], `${state}: ${why} holds the zero-minutes merge`);
    }
    const ok = zeroWorld(state, [200, { total_count: 1, check_runs: [actionsRun] }]);
    assert.deepEqual((await runLane({ token: 't', repos: ['a/b'], fetch: ok.f, issueWorkflow: null, zeroActions: true })).merged, ['a/b#1'], state + ': an Actions run that never started does not hold it');
  }
});

// ---- R19: what the evidence row says ----
test('US-33-R19: every Worker lane merge in the evidence repository leaves a row, and via is worker-gate when the lane runs with zeroActions and clean otherwise', async () => {
  const world = (state) => { let put = null; const g = github(
    (m, p) => m === 'GET' && p.startsWith('/repos/a/b/pulls?') ? [200, [{ number: 3, labels: [] }]] : null,
    (m, p) => m === 'GET' && /\/pulls\/3$/.test(p) ? [200, { draft: false, mergeable_state: state, head: { sha: 'f'.repeat(40) } }] : null,
    (m, p) => m === 'GET' && p.includes('/comments') ? [200, []] : null, (m, p) => m === 'GET' && p.includes('/check-runs') ? GREEN : null,
    (m, p) => m === 'GET' && p.endsWith('/status') ? [200, { statuses: [{ context: 'worker-gate', state: 'success' }] }] : null,
    (m, p) => m === 'GET' && p.includes('/actions/runs?head_sha=') ? [200, { workflow_runs: [] }] : null,
    (m, p) => m === 'PUT' && p.endsWith('/pulls/3/merge') ? [200, { sha: 'ms' }] : null,
    (m, p) => m === 'GET' && p.includes('/contents/ops/worker-merge-evidence.jsonl') ? [404, { message: 'Not Found' }] : null,
    (m, p, b) => m === 'PUT' && p.includes('/contents/ops/worker-merge-evidence.jsonl') ? (put = b, [201, {}]) : null);
    return { g, row: () => JSON.parse(Buffer.from(put.content, 'base64').toString().trim()) }; };
  for (const [state, zeroActions, via] of [['unstable', true, 'worker-gate'], ['clean', true, 'worker-gate'], ['clean', false, 'clean']]) {
    const w = world(state); const r = await runLane({ token: 't', repos: ['a/b'], fetch: w.g.f, issueWorkflow: null, zeroActions, evidenceRepo: 'a/b' });
    assert.deepEqual(r.merged, ['a/b#3'], state); assert.equal(w.row().via, via, `${state} with zeroActions ${zeroActions}`);
  }
});
