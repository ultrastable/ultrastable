// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-33, the producing half of the Worker: the executor chain, the Worker-native executor and its guards, the Worker pull-request executor, the Worker code
// agents, the main writer, the red-main revert, the roadmap intake and the in-tick doer. GitHub, Workers AI and D1 are injected fakes. Each test names the
// requirement it proves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runExecutor, noteExecutor, PROVIDERS } from '../src/executor.js';
import { guard, shrinkGuard, substanceGuard, stubGuard, runNative, runDbQueue, reopenClosedUnmerged, pathsIn, deployFor, slugOf, doneOnMain, buildPrompt, MAX_FILES, MAX_BYTES, PROTECTED, CODE_ROOTS, DB_CANDIDATES } from '../src/nativeexec.js';
import { pick, priority, safePath, checkEdits, prExecutor, SKIP_LABELS, MAX_FILES as PR_MAX_FILES, MAX_BYTES as PR_MAX_BYTES, namedFiles } from '../src/pr-executor.js';
import { ADAPTERS, runCodeAgent, probe, parseJson, applyEdit } from '../src/codeagent.js';
import { checkBody, isProtected, safePath as mainSafePath, commitToMain, MAX_FILES as MAIN_MAX_FILES, MAX_DATA_PRS } from '../src/maincommit.js';
import { revertRedMain } from '../src/redmain.js';
import { parseRoadmapIssue, syncIssues } from '../src/issuesync.js';
import { runTick } from '../src/tick.js';
import { OWNER_ONLY } from '../src/doer.js';

const b64 = s => Buffer.from(s).toString('base64');
const R = (status, json) => ({ ok: status < 300, status, headers: new Headers(), text: async () => (json === undefined || json === null ? '' : JSON.stringify(json)), json: async () => json, arrayBuffer: async () => new TextEncoder().encode('old\n').buffer });
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

test('US-33-R63: the executor chain tries worker-native, then the Actions dispatch, then the in-Worker code-agent probe, records every answer, never throws, and files one item when nothing can wake the executor', async () => {
  assert.deepEqual(PROVIDERS.map(p => p.id), ['worker-native', 'worker-orchestrator', 'github-actions', 'workers-ai-agent']); assert.equal(PROVIDERS.find(p => p.id === 'workers-ai-agent').observer, true);
  const none = await runExecutor({}); assert.deepEqual(none.map(r => [r.provider, r.ok, r.detail]), PROVIDERS.map(p => [p.id, false, 'not configured (binding missing)']));
  const mk = (id, behave, observer) => ({ id, observer, available: () => true, async dispatch() { return behave(); } });
  const r = await runExecutor({}, { providers: [mk('a', () => { throw new Error('down'); }), mk('b', () => ({ ok: true, detail: 'ok' })), mk('c', () => ({ ok: true, detail: 'never' }))] });
  assert.deepEqual(r.map(x => [x.provider, x.ok]), [['a', false], ['b', true]], 'a thrown error is recorded as that provider\'s answer; the first dispatcher that answers ok ends the chain'); assert.equal(r[0].detail, 'down');
  const withObserver = await runExecutor({}, { providers: [mk('a', () => ({ ok: true, detail: 'x' })), mk('o', () => ({ ok: true, detail: 'seen' }), true)] });
  assert.deepEqual(withObserver.map(x => x.provider), ['a', 'o'], 'an observer after the chain always runs');
  let seen; const gh = await runExecutor({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r' }, { fetchImpl: async (u, o) => { seen = { u, body: JSON.parse(o.body) }; return { status: 204 }; } });
  assert.equal(gh.find(x => x.provider === 'github-actions').ok, true); assert.equal(seen.u, 'https://api.github.com/repos/o/r/dispatches'); assert.deepEqual(seen.body, { event_type: 'ultrastable-tick', client_payload: { host: 'cloudflare-worker' } });
  const db = makeDb(); const down = [{ provider: 'github-actions', ok: false, detail: 'HTTP 403' }, { provider: 'workers-ai-agent', ok: true, detail: 'agents answering' }];
  assert.equal((await noteExecutor(db, down)).filed, true); assert.equal((await noteExecutor(db, down)).filed, false, 'filed once');
  const item = db.raw.prepare("SELECT title, owner_role, status, closing_probe FROM items WHERE id = 'EXEC-SPARK-UNREACHABLE'").get(); assert.match(item.title, /github-actions: HTTP 403/); assert.doesNotMatch(item.title, /workers-ai-agent/, 'an observer is not a dispatcher'); assert.deepEqual([item.owner_role, item.status], ['operations', 'ready']);
  assert.equal((await noteExecutor(makeDb(), [{ provider: 'worker-native', ok: true, detail: 'x' }])).filed, false, 'a working dispatcher files nothing');
});

test('the shipped provider list stops after the first dispatcher that answers ok (the closing probe of the executor-chain deviation in US-SPEC-33 section 7)', { todo: 'runExecutor keeps dispatching later non-observer providers while an observer follows in the list, so a worker-native success also dispatches the Actions executor' }, async () => {
  const dispatched = [];
  const stub = (p, ok) => ({ ...p, available: () => true, async dispatch() { dispatched.push(p.id); return { ok, detail: p.id }; } });
  await runExecutor({}, { providers: [stub(PROVIDERS[0], true), stub(PROVIDERS[1], true), stub(PROVIDERS[2], true)] });
  assert.deepEqual(dispatched, ['worker-native', 'workers-ai-agent'], 'the Actions dispatch is the fallback, not a second route taken every tick');
});

test('US-33-R60: the Worker pull-request executor takes the open issue with the lowest p-label and then the lowest number, and never a pull request or an issue labelled for a person, a gate or a failure', () => {
  assert.deepEqual(SKIP_LABELS.sort(), ['blocked', 'claimed', 'dispatched', 'executor-failed', 'gate', 'hold', 'identity-bound', 'in-progress', 'owner', 'wontfix'].sort());
  const issue = (number, ...labels) => ({ number, title: 't' + number, labels: labels.map(name => ({ name })) });
  assert.deepEqual(priority(issue(9)), [5, 9]); assert.deepEqual(priority(issue(9, 'p1', 'priority: 3')), [1, 9]); assert.deepEqual(priority(issue(9, 'priority/2')), [2, 9]);
  assert.equal(pick([issue(5), issue(7, 'p1'), issue(3, 'p2')]).number, 7); assert.equal(pick([issue(5), issue(4)]).number, 4, 'older number first among equals');
  assert.equal(pick([{ ...issue(1, 'p0'), pull_request: {} }, issue(2, 'hold', 'p0'), issue(3, 'owner'), issue(4, 'executor-failed'), issue(5, 'claimed'), issue(6, 'gate'), issue(8, 'p4')]).number, 8);
  assert.equal(pick([issue(1, 'blocked')]), null); assert.equal(pick([]), null);
});

test('US-33-R61: no executor writes a workflow, the policy, git, a secret or the executor log, a path may not leave the repository, and a change is bounded in files and bytes', () => {
  assert.deepEqual(PROTECTED, ['.github/', 'autonomy/', 'doctrine/server-side.json']); assert.deepEqual([MAX_FILES, MAX_BYTES, PR_MAX_FILES, PR_MAX_BYTES], [3, 60000, 8, 200000]);
  for (const p of ['.github/workflows/a.yml', 'autonomy/policy.json', 'doctrine/server-side.json']) assert.throws(() => guard([{ path: p, content: 'x' }]), /protected path/);
  for (const p of ['/etc/x', '../x', 'a/../b', 'a\\b', 'C:/x', '']) assert.throws(() => guard([{ path: p, content: 'x' }]), /unsafe path/, p);
  assert.throws(() => guard([]), /no files in the change/); assert.throws(() => guard([{ path: 'a', content: 'x'.repeat(60001) }]), /oversized/); assert.throws(() => guard([{ path: 'a', content: 5 }]), /bad or oversized/);
  assert.equal(guard([{ path: 'seed/a.js', content: 'ok' }]).length, 1);
  for (const p of ['.git/config', '.github/workflows/x.yml', 'autonomy/policy.json', 'ops/executor-log.jsonl', 'a/.env', 'x/id_rsa', 'y/credentials', '/abs', 'a/../b', 'a\\b']) assert.ok(safePath(p), p);
  for (const p of ['docs/a.md', 'seed/worker/src/a.js', 'ops/deploys.jsonl']) assert.equal(safePath(p), null, p);
  assert.throws(() => checkEdits([]), /need 1\.\.8 files/); assert.throws(() => checkEdits(Array.from({ length: 9 }, (_, i) => ({ path: 'a' + i, content: 'x' }))), /need 1\.\.8 files/); assert.throws(() => checkEdits([{ path: 'a.js', content: 'x'.repeat(200001) }]), /larger than the executor limit/);
  assert.throws(() => checkEdits([{ path: '.github/x.yml', content: 'x' }]), /deny list/); assert.throws(() => checkEdits([{ path: 'a.js' }]), /content or edits required/);
  assert.doesNotThrow(() => checkEdits([{ path: 'a.js', edits: [{ find: 'a', replace: 'b' }] }]));
  assert.deepEqual(namedFiles({ title: 'fix seed/worker/src/lane.js and docs/issues/X.json', body: 'also ops/a.json and .github/workflows/x.yml and nope/missing.js' }, 'seed/worker/src/lane.js\ndocs/issues/X.json\nops/a.json\n.github/workflows/x.yml'), ['seed/worker/src/lane.js'], 'the model is shown only files it may change');
});

test('US-33-R62: a change that deletes what it was not asked to delete, adds only narration, adds a placeholder, writes outside the code roots or touches only bookkeeping is refused before a pull request exists', () => {
  const big = 'x'.repeat(100), exp = 'export function a() {}\nexport const b = 1;\n';
  assert.throws(() => shrinkGuard('a.md', big, 'x'.repeat(40)), /shrink: a\.md would lose 60 of 100 bytes/); assert.doesNotThrow(() => shrinkGuard('a.md', big, 'x'.repeat(60))); assert.doesNotThrow(() => shrinkGuard('a.md', null, ''), 'a new file has nothing to lose');
  assert.throws(() => shrinkGuard('m.json', '{"a":1,"b":2,"c":3}', '{"a":1,"b":2}'), /drops keys c/); assert.throws(() => shrinkGuard('m.json', '{"a":1,"b":2}', '{"a":1,'), /not valid JSON after the change/); assert.doesNotThrow(() => shrinkGuard('l.json', '[1,2,3,4]', '[1,2,3]'), 'only an object loses keys');
  assert.throws(() => shrinkGuard('x.js', exp + '//' + big, 'export function a() {}\n//' + big), /drops exports b/); assert.doesNotThrow(() => shrinkGuard('x.js', exp, exp + 'export const c = 2;\n'));
  const isNew = () => true;
  assert.throws(() => substanceGuard([{ path: 'docs/a.md' }, { path: 'backlog/subtasks/x.json' }, { path: 'specs/x.json' }], isNew), /narration: the change only adds documents or subtask records/); assert.doesNotThrow(() => substanceGuard([{ path: 'docs/a.md' }, { path: 'seed/a.js' }], isNew)); assert.doesNotThrow(() => substanceGuard([{ path: 'docs/a.md' }], () => false), 'editing an existing document is not narration');
  assert.throws(() => stubGuard([{ path: 'src/agents/a.js', content: 'export const a = 1;' }], isNew), /stub: new file outside the directories the repository runs/); assert.doesNotThrow(() => stubGuard([{ path: 'src/agents/a.js', content: 'x' }], () => false), 'an existing file is not a new stray');
  for (const body of ['def f():\n    pass\n', 'x = 1  # TODO\n', 'raise NotImplementedError', '// add your logic here\n', '// ...\n', '# implement the code here']) assert.throws(() => stubGuard([{ path: 'seed/a' + (body.startsWith('def') || body.startsWith('x') || body.startsWith('raise') || body.startsWith('# i') ? '.py' : '.js'), content: body }], isNew), /placeholder bodies/, body);
  assert.ok(CODE_ROOTS.includes('seed/') && CODE_ROOTS.includes('foundation/') && !CODE_ROOTS.includes('src/'));
  assert.throws(() => checkEdits([{ path: 'docs/issues/Q-1.json', content: '{}' }, { path: 'ops/x.jsonl', content: '' }, { path: 'doctrine/writeback/w.json', content: '' }]), /SAY-DO-1: the change touches only its item file and ledgers/); assert.doesNotThrow(() => checkEdits([{ path: 'docs/issues/Q-1.json', content: '{}' }, { path: 'seed/a.js', content: 'x' }]));
  assert.equal(doneOnMain('x\n**Done check:** file:docs/a.md;', p => p === 'docs/a.md'), true); assert.equal(doneOnMain('**Done check:** cmd:x', () => true), false); assert.equal(doneOnMain('**Done check:** file:docs/a.md', () => false), false);
  assert.match(buildPrompt({ id: 'A-1', title: 'do it', body: 'b' }, { path: 'x.js', content: 'old' }), /a change that only adds documents, specs or subtask records is refused/);
});

// ---- the Worker-native executor ----
const T_EVEN = 600000 * 2000, T_ODD = 600000 * 2001;  // the slot parity decides which queue goes first
function codeDb(extra = []) {
  const db = makeDb();
  const ins = db.raw.prepare("INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status,blocker,updated_at) VALUES (?,?,?,?,?,?,?,?,?)");
  ins.run('RM-1', 'RM-1: add card to seed/worker/src/a.js', 'staff', 'file:seed/worker/src/a.js', 'x', 5, 'blocked', 'needs-code: triage says edit seed/worker/src/a.js', '2026-11-20 00:00:00');
  ins.run('RM-2', 'RM-2: second', 'staff', 'x', 'x', 9, 'blocked', 'needs-code: edit site/x.js', '2026-11-20 00:00:00');
  ins.run('OW-1', 'OW-1: owner step', 'staff', 'x', 'x', 99, 'blocked', 'owner-only: signature', '2026-11-20 00:00:00');
  for (const e of extra) ins.run(...e);
  return db;
}
function nativeGh({ openHeads = [] } = {}) {
  return github((m, p) => m === 'GET' && p.startsWith('/repos/o/r/pulls?state=open') ? [200, openHeads.map(h => ({ head: { ref: h } }))] : null,
    (m, p) => m === 'GET' && p.startsWith('/repos/o/r/contents/ops/priority-queue.json') ? [404, {}] : null,
    (m, p) => m === 'GET' && p.startsWith('/repos/o/r/contents/seed/worker/src/a.js?ref=main') ? [200, { sha: 's', content: b64('export const a = 1;\n') }] : null,
    (m, p) => m === 'GET' && p.startsWith('/repos/o/r/git/ref/heads/main') ? [200, { object: { sha: 'm1' } }] : null, (m, p) => m === 'POST' && p === '/repos/o/r/git/refs' ? [201, {}] : null,
    (m, p) => m === 'GET' && p.startsWith('/repos/o/r/contents/') ? [404, {}] : null, (m, p) => m === 'PUT' && p.startsWith('/repos/o/r/contents/') ? [201, {}] : null, (m, p) => m === 'POST' && p === '/repos/o/r/pulls' ? [201, { number: 7, html_url: 'https://github.com/o/r/pull/7' }] : null);
}
const nenv = (db) => ({ DB: db, GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r', AI: {} });
const agent = async () => ({ summary: 'card', adapter: 'workers-ai-glm', model: '@cf/zai-org/glm-4.7-flash', files: [{ path: 'seed/worker/src/a.js', content: 'export const a = 1;\nexport const b = 2;\n' }] });

test('US-33-R64: the Worker-native executor alternates its two queues by ten-minute slot, takes an item once, hands the pull request to the server with a Handoff block, and returns an item to the queue when its attempt or its pull request fails', async () => {
  assert.equal(DB_CANDIDATES, 6); assert.equal(slugOf('Q-GROW second_tenant/deploying'), 'q-grow-second-tenant-deploying'); assert.equal(slugOf('A'.repeat(100)).length, 60);
  assert.deepEqual(pathsIn('see seed/worker/src/a.js and site/x.js, docs/a.md and e/f.sql plus noext/file'), ['seed/worker/src/a.js', 'site/x.js', 'docs/a.md', 'e/f.sql']);
  assert.equal(deployFor(['seed/worker/src/a.js', 'seed/worker/test/b.js', 'site/x.js', 'dashboard/d.js', 'docs/a.md']), 'ultrastable-tick, ultrastable-site, ultrastable-dashboard'); assert.equal(deployFor(['docs/a.md']), '');
  const db = codeDb(); const g = nativeGh(); const bodies = []; const f = async (u, o = {}) => { if (o.method === 'POST' && u.endsWith('/pulls')) bodies.push(JSON.parse(o.body)); return g.f(u, o); };
  const r = await runNative(nenv(db), { fetchImpl: f, agent, now: T_EVEN });
  assert.equal(r.ok, true); assert.match(r.url, /pull\/7$/); const branch = g.calls.find(c => c.path === '/repos/o/r/git/refs').body.ref; assert.match(branch, /^refs\/heads\/worker\/rm-2-\d{12}$/, 'the highest priority value is taken first (RM-2 is 9, RM-1 is 5)');
  assert.match(bodies[0].body, /## Handoff\nitem: RM-2\nagent: worker-native \(workers-ai-glm\)\ndeploy: ultrastable-tick\n$/); assert.equal(bodies[0].base, 'main'); assert.match(bodies[0].title, /^RM-2: /);
  const it = db.raw.prepare("SELECT status, blocker FROM items WHERE id = 'RM-2'").get(); assert.equal(it.status, 'blocked'); assert.match(it.blocker, /^in-pr: https:\/\/github\.com\/o\/r\/pull\/7 \| agent: worker-native \| model: @cf\/zai-org\/glm-4\.7-flash$/);
  assert.match(db.raw.prepare("SELECT blocker FROM items WHERE id = 'OW-1'").get().blocker, /^owner-only/, 'an owner-only item is never taken');
  const again = await runDbQueue(nenv(db), { fetchImpl: g.f, agent, now: T_EVEN }); assert.equal(again.ok, true, 'the other needs-code item is next');
  const open = await runDbQueue(nenv(codeDb()), { fetchImpl: nativeGh({ openHeads: ['worker/rm-1-202611200000', 'worker/rm-2-202611200000'] }).f, agent, now: T_EVEN }); assert.equal(open.idle, true); assert.match(open.note, /every needs-code candidate has an open worker PR/);
  const odd = await runNative(nenv(codeDb()), { fetchImpl: nativeGh().f, agent, now: T_ODD }); assert.equal(odd.ok, false); assert.match(odd.detail, /ops\/priority-queue\.json not readable/, 'an odd slot asks the repository queue first, and its answer ends the pass');
  const failed = codeDb(); const bad = await runDbQueue(nenv(failed), { fetchImpl: nativeGh().f, agent: async () => ({ summary: 's', adapter: 'a', files: [{ path: '.github/x.yml', content: 'x' }] }), now: T_EVEN });
  assert.equal(bad.ok, false); assert.match(failed.raw.prepare("SELECT blocker FROM items WHERE id = 'RM-2'").get().blocker, /^needs-code: worker-native attempt failed \(protected path: \.github\/x\.yml\); retried after the other candidates$/);
  const closed = codeDb(); closed.raw.exec("UPDATE items SET blocker = 'in-pr: u' WHERE id = 'RM-1'; INSERT INTO handoffs (id, repo, pr, item, state) VALUES ('o/r#7','o/r',7,'RM-1','closed_unmerged')");
  assert.equal(await reopenClosedUnmerged(closed), 1); assert.match(closed.raw.prepare("SELECT blocker FROM items WHERE id = 'RM-1'").get().blocker, /^needs-code: previous PR closed without merge; retried by worker-native$/);
  assert.equal((await runDbQueue({ GITHUB_DISPATCH_TOKEN: 't' }, { fetchImpl: nativeGh().f })).idle, true); assert.equal(runNative.length, 1);
});

test('US-33-R65: the Worker pull-request executor needs a model binding, a token, a repository and no Actions-only mode, and it ends every issue it takes in a pull request or in an executor-failed label with the reason', async () => {
  const env = { AI: {}, GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r' };
  assert.equal(prExecutor.available(env), true); assert.equal(prExecutor.available({ ...env, AI: undefined }), false); assert.equal(prExecutor.available({ ...env, GITHUB_REPO: '' }), false); assert.equal(prExecutor.available({ ...env, EXECUTOR_MODE: 'actions' }), false);
  const world = (stored = 'old line\nkeep\n') => github((m, p) => m === 'GET' && p.startsWith('/repos/o/r/issues?') ? [200, [{ number: 7, title: 'Add a thing in foundation/x.py', body: 'b', labels: [] }, { number: 8, title: 'other', body: '', labels: [{ name: 'hold' }] }]] : null,
    (m, p) => m === 'POST' && /\/issues\/7\/labels$/.test(p) ? [200, []] : null, (m, p) => m === 'DELETE' && /\/issues\/7\/labels\//.test(p) ? [200, []] : null, (m, p) => m === 'POST' && /\/issues\/7\/comments$/.test(p) ? [201, {}] : null,
    (m, p) => m === 'GET' && p === '/repos/o/r' ? [200, { default_branch: 'main' }] : null, (m, p) => m === 'GET' && p.startsWith('/repos/o/r/git/ref/heads/main') ? [200, { object: { sha: 'abc' } }] : null,
    (m, p) => m === 'GET' && p.startsWith('/repos/o/r/git/trees/') ? [200, { tree: [{ type: 'blob', path: 'foundation/x.py' }] }] : null, (m, p) => m === 'POST' && p === '/repos/o/r/git/refs' ? [201, {}] : null,
    (m, p) => m === 'GET' && p.startsWith('/repos/o/r/contents/foundation/x.py') ? [200, { sha: 'fs', content: b64(stored) }] : null, (m, p) => m === 'PUT' && p.startsWith('/repos/o/r/contents/') ? [201, {}] : null,
    (m, p) => m === 'POST' && p === '/repos/o/r/pulls' ? [201, { html_url: 'https://github.com/o/r/pull/9' }] : null);
  let g = world(); const ok = await prExecutor.dispatch(env, g.f, { agent: async () => ({ summary: 'add it', adapter: 'x', files: [{ path: 'foundation/x.py', edits: [{ find: 'old line', replace: 'new line' }] }] }) });
  assert.deepEqual([ok.ok, ok.pr], [true, 'https://github.com/o/r/pull/9']); const put = g.calls.find(c => c.m === 'PUT'); assert.match(put.path, /contents\/foundation\/x\.py$/); assert.equal(Buffer.from(put.body.content, 'base64').toString(), 'new line\nkeep\n', 'an EDIT is applied to the file as it stands on the branch');
  assert.equal(put.body.branch, 'agent/7-add-a-thing-in-foundation-x-py'); assert.equal(g.calls.find(c => c.m === 'POST' && c.path === '/repos/o/r/pulls').body.body.startsWith('Closes #7'), true); assert.ok(g.calls.some(c => c.m === 'POST' && /issues\/7\/labels/.test(c.path) && c.body.labels[0] === 'in-progress'), 'the issue is claimed before work');
  assert.ok(!g.calls.some(c => /actions|dispatches/.test(c.path)), 'no Actions call');
  g = world(); const bad = await prExecutor.dispatch(env, g.f, { agent: async () => ({ summary: 's', adapter: 'x', files: [{ path: '.github/workflows/x.yml', content: 'x' }] }) });
  assert.equal(bad.ok, false); assert.match(bad.detail, /^#7: \.github\/workflows\/x\.yml: path is on the deny list/); assert.ok(!g.calls.some(c => c.path === '/repos/o/r/pulls'));
  assert.ok(g.calls.some(c => c.m === 'POST' && /issues\/7\/labels/.test(c.path) && c.body.labels[0] === 'executor-failed')); assert.ok(g.calls.some(c => c.m === 'DELETE' && /labels\/in-progress$/.test(c.path)));
  assert.match(g.calls.find(c => /issues\/7\/comments/.test(c.path)).body.body, /^executor \(worker\) failed: .*\n\nRemove `executor-failed` to retry\.$/);
  const idle = await prExecutor.dispatch(env, github((m, p) => p.startsWith('/repos/o/r/issues?') ? [200, [{ number: 1, labels: [{ name: 'owner' }] }]] : null).f); assert.deepEqual(idle, { ok: true, detail: 'idle: no open issue the executor may take' });
  g = world('other text\n'); const miss = await prExecutor.dispatch(env, g.f, { agent: async () => ({ summary: 's', adapter: 'x', files: [{ path: 'foundation/x.py', edits: [{ find: 'old line', replace: 'new' }] }] }) });
  assert.equal(miss.ok, false); assert.match(miss.detail, /the FIND text is not in the file/, 'a missed place fails the item rather than guessing');
});

const fakeAi = (fail = []) => ({ calls: [], async run(model) { this.calls.push(model); if (fail.some(x => model.includes(x))) throw new Error('model down'); return { response: '```json\n{"summary":"ok","files":[{"path":"a.txt","content":"x"}]}\n```' }; } });
test('US-33-R74: the Worker code agents are the Workers AI rows of the registry, tried cheapest first, a failure moves to the next and is recorded, and a reply is JSON or FILE and EDIT blocks that are applied exactly or loosely and never ambiguously', async () => {
  const reg = JSON.parse(readFileSync(new URL('../../../doctrine/code-agents.json', import.meta.url), 'utf8')).adapters.filter(a => a.route === 'workers-ai');
  assert.deepEqual(ADAPTERS.map(a => [a.id, a.model, a.family]).sort(), reg.map(a => [a.id, a.model, a.family]).sort()); assert.deepEqual([...ADAPTERS].sort((a, b) => a.price - b.price).map(a => a.family), ['glm', 'llama', 'qwen']);
  let env = { AI: fakeAi() }; let r = await runCodeAgent(env, 'p'); assert.equal(r.adapter, 'workers-ai-glm'); assert.equal(env.AI.calls.length, 1);
  env = { AI: fakeAi(['glm']) }; r = await runCodeAgent(env, 'p'); assert.equal(r.adapter, 'workers-ai-llama'); assert.equal(r.tried[0].adapter, 'workers-ai-glm'); assert.match(r.tried[0].error, /model down/);
  await assert.rejects(runCodeAgent({ AI: fakeAi(['@cf']) }, 'p'), /no code agent produced a change: \[\{"adapter":"workers-ai-glm"/);
  assert.equal((await probe({})).ok, false); const pr = await probe({ AI: fakeAi(['llama']) }); assert.equal(pr.ok, true); assert.deepEqual(pr.adapters.map(a => a.ok), [true, false, true], 'every adapter is asked, so a dead one is named');
  assert.deepEqual(parseJson('x {"summary":"s","files":[{"path":"a","content":"c"}]} y').files[0], { path: 'a', content: 'c' });
  const blocks = parseJson('SUMMARY: do it\n<<<EDIT a/b.js>>>\n<<<FIND>>>\nold\n<<<REPLACE>>>\nnew\n<<<END>>>\n<<<FILE c.txt>>>\nhello\n<<<END>>>');
  assert.equal(blocks.summary, 'do it'); assert.deepEqual(blocks.files, [{ path: 'c.txt', content: 'hello\n' }, { path: 'a/b.js', edits: [{ find: 'old', replace: 'new' }] }]); assert.throws(() => parseJson('just prose'), /no JSON or FILE\/EDIT blocks/);
  assert.equal(applyEdit('a\nb\nc\n', 'b', 'B'), 'a\nB\nc\n'); assert.equal(applyEdit('  if (x) {\n    y();\n  }\n', 'if (x) {\n  y();\n}', 'if (z) {\n  w();\n}'), '  if (z) {\n    w();\n  }\n', 'a model that drops indentation is placed and re-indented');
  assert.throws(() => applyEdit('a\na\n', 'a', 'b', 'f.js'), /f\.js: the FIND text occurs 2 times/); assert.throws(() => applyEdit('a\n', 'zzz', 'b', 'f.js'), /f\.js: the FIND text is not in the file/); assert.throws(() => applyEdit('exists\n', '', 'b', 'f.js'), /FIND is empty but the file exists/);
  assert.equal(applyEdit('', '', 'new'), 'new\n', 'an empty FIND creates a new file');
});

test('US-33-R80: the main writer writes one commit to the newest main with the App token for a run that proved itself, refuses a protected path, applies appends to the newest file, and lands a commit the ruleset refuses as a bounded number of App pull requests', async () => {
  assert.deepEqual([MAIN_MAX_FILES, MAX_DATA_PRS], [20, 3]);
  const m = (files, message = 'ledger') => checkBody({ message, files });
  for (const p of ['.github/workflows/x.yml', 'autonomy/policy.json', 'agents/AGENTS.md', 'github/org-settings.json', 'docs/CLAUDE.md', 'CONTRIBUTING.md', 'LICENSE', 'SCOPE.md', 'doctrine/directive.json', 'doctrine/standing-order.json', 'doctrine/closed-loop.json', 'doctrine/server-side.json']) assert.match(m([{ path: p, content: 'x' }]), /protected path/, p);
  assert.equal(isProtected('ops/deploys.jsonl'), false); assert.equal(isProtected('doctrine/claims.json'), false);
  for (const p of ['/abs', 'a/../b', 'a//b', '.git/x', '']) assert.match(m([{ path: p, content: 'x' }]), /bad path/, p); assert.equal(mainSafePath('ops/a.jsonl'), true);
  assert.equal(checkBody(null), 'message is required'); assert.equal(m([]), 'files is required'); assert.match(m([{ path: 'a', content: 'x' }], ''), /message is required/); assert.match(m([{ path: 'a/b' }]), /no content for a\/b/); assert.equal(m([{ path: 'a/b', delete: true }]), null);
  const world = ({ patch = [200, {}], open = [] } = {}) => { const seen = [];
    const f = async (url, o = {}) => { const u = String(url), mm = o.method || 'GET', body = o.body ? JSON.parse(o.body) : null; seen.push({ m: mm, u: u.replace(/^.*repos\/r\/r/, ''), body });
      const J = (j, status = 200) => ({ ok: status < 300, status, json: async () => j, arrayBuffer: async () => new TextEncoder().encode('old\n').buffer });
      if (u.includes('/contents/')) return J({}); if (u.endsWith('/git/ref/heads/main')) return J({ object: { sha: 'P' } }); if (u.endsWith('/git/commits/P')) return J({ tree: { sha: 'T0' } });
      if (u.endsWith('/git/blobs')) return J({ sha: 'B' + seen.length }); if (u.endsWith('/git/trees')) return J({ sha: 'T1' }); if (u.endsWith('/git/commits')) return J({ sha: 'C1234567890abc' });
      if (mm === 'PATCH') return J(patch[1], patch[0]); if (u.includes('/pulls?state=open')) return J(open); if (u.endsWith('/git/refs')) return J({}, 201); if (u.endsWith('/pulls')) return J({ number: 12 }, 201); return J({}, 500); };
    return { f, seen }; };
  let w = world(); const body = { message: 'x'.repeat(300), files: [{ path: 'ops/a.jsonl', append: b64('new\n') }, { path: 'ops/b.json', content: b64('{}') }, { path: 'ops/c.json', delete: true }] };
  let r = await commitToMain({ token: 't', repo: 'r/r', body, fetch: w.f }); assert.deepEqual([r.ok, r.status, r.sha], [true, 200, 'C1234567890abc']);
  const blobs = w.seen.filter(c => c.u.endsWith('/git/blobs')); assert.equal(Buffer.from(blobs[0].body.content, 'base64').toString(), 'old\nnew\n', 'an append is applied to the newest file on main, so concurrent ledger writers never overwrite each other');
  const tree = w.seen.find(c => c.u.endsWith('/git/trees')).body; assert.equal(tree.base_tree, 'T0'); assert.deepEqual(tree.tree.find(t => t.path === 'ops/c.json'), { path: 'ops/c.json', mode: '100644', type: 'blob', sha: null });
  assert.equal(w.seen.find(c => c.u.endsWith('/git/commits') && c.m === 'POST').body.message.length, 200); assert.deepEqual(w.seen.find(c => c.m === 'PATCH').body, { sha: 'C1234567890abc', force: false });
  r = await commitToMain({ token: 't', repo: 'r/r', body: { message: 'm', files: [{ path: 'ops/a', content: b64('x') }] }, fetch: world({ patch: [422, { message: 'Update is not a fast forward' }] }).f }); assert.deepEqual([r.ok, r.status], [false, 409]);
  w = world({ patch: [422, { message: 'Changes must be made through a pull request.' }] }); r = await commitToMain({ token: 't', repo: 'r/r', body: { message: 'm', files: [{ path: 'ops/a', content: b64('x') }] }, fetch: w.f });
  assert.deepEqual([r.ok, r.mode, r.branch, r.pr], [true, 'pull_request', 'agent/data-C123456789', 12], 'a ruleset refusal lands as an App pull request, which starts checks');
  r = await commitToMain({ token: 't', repo: 'r/r', body: { message: 'm', files: [{ path: 'ops/a', content: b64('x') }] }, fetch: world({ patch: [422, { message: 'Changes must be made through a pull request.' }], open: [1, 2, 3].map(i => ({ head: { ref: 'agent/data-' + i } })) }).f });
  assert.deepEqual([r.ok, r.status], [false, 503]); assert.match(r.error, /3 data pull requests are already open/); assert.equal((await commitToMain({ token: 't', repo: 'r/r', body: { message: 'm', files: [{ path: '.github/x', content: 'x' }] }, fetch: world().f })).status, 400);
  const py = readFileSync(new URL('../../../tools/push_main.py', import.meta.url), 'utf8'); assert.match(py, /MAX_FILES = 20 /, 'the client batches at the Worker\'s limit');
});

test('US-33-R82: a main whose newest commit failed the required gate for longer than the limit gets one revert pull request that restores the parent tree and carries a Handoff block, and nothing else does', async () => {
  const NOW = Date.parse('2026-11-21T12:00:00Z');
  const world = (s = {}) => { const calls = [];
    const f = async (url, o = {}) => { const m = o.method || 'GET', path = url.replace('https://api.github.com', ''), body = o.body ? JSON.parse(o.body) : null; calls.push({ m, path, body });
      const RR = (j, ok = true, status = 200) => ({ ok, status, text: async () => JSON.stringify(j) });
      if (path.endsWith('/commits/main')) return RR({ sha: 'abc1234567', parents: s.parents || [{ sha: 'par0000' }], commit: { message: s.message || 'Add x (#1)', committer: { date: s.date || '2026-11-21T11:00:00Z' } } });
      if (path.includes('/check-runs')) return s.runsStatus ? RR({}, false, s.runsStatus) : RR({ check_runs: s.runs ?? [{ name: 'checks', status: 'completed', conclusion: 'failure' }] }); if (path.includes('/pulls?state=open')) return RR(s.open || []);
      if (path.endsWith('/git/commits/par0000')) return RR({ tree: { sha: 'tree0' } }); if (m === 'POST' && path.endsWith('/git/commits')) return RR({ sha: 'new1' }); if (m === 'POST' && path.endsWith('/git/refs')) return RR({}); if (m === 'POST' && path.endsWith('/pulls')) return RR({ number: 77 });
      return RR({}, false, 404); };
    return { f, calls }; };
  const run = (s, o = {}) => revertRedMain({ token: 't', repo: 'o/r', fetch: world(s).f, now: NOW, ...o });
  const w = world(); const r = await revertRedMain({ token: 't', repo: 'o/r', fetch: w.f, now: NOW });
  assert.deepEqual([r.status, r.sha, r.branch, r.pr], ['reverted', 'abc1234567', 'agent/revert-abc1234', 77]);
  assert.deepEqual(w.calls.find(c => c.path.endsWith('/git/commits') && c.m === 'POST').body, { message: 'Revert abc1234: main was red for 60 minutes (REDMAIN-LANE-1)', tree: 'tree0', parents: ['abc1234567'] }, 'a new commit on top, with the parent\'s tree');
  assert.match(w.calls.find(c => c.path === '/repos/o/r/pulls').body.body, /## Handoff\nitem: Q-REDMAIN-revert-lane\nagent: tick-worker\nverify: GET https:\/\/ultrastable\.io\/api\/freshness expect "ok"\ndeploy: site/);
  assert.equal((await run({ runs: [{ name: 'checks', status: 'completed', conclusion: 'success' }] })).status, 'green'); assert.equal((await run({ runs: [{ name: 'checks', status: 'in_progress' }] })).status, 'pending'); assert.equal((await run({ runs: [{ name: 'other', status: 'completed', conclusion: 'failure' }] })).status, 'no-gate');
  assert.deepEqual(await run({ date: '2026-11-21T11:50:00Z' }), { status: 'waiting', age_min: 10 }); assert.equal((await run({ message: 'Revert abc: x' })).status, 'skip'); assert.equal((await run({ parents: [{ sha: 'a' }, { sha: 'b' }] })).status, 'skip', 'a merge commit is not reverted');
  assert.deepEqual(await run({ open: [{ number: 5 }] }), { status: 'open', pr: 5 }); assert.equal((await run({ runsStatus: 502 })).why, 'check-runs 502'); assert.equal((await revertRedMain({ repo: 'o/r' })).status, 'no-token');
  assert.equal((await run({}, { redMin: 90 })).status, 'waiting', 'the limit is a parameter'); assert.equal((await run({ runs: [{ name: 'ci', status: 'completed', conclusion: 'failure' }] }, { gate: 'ci' })).status, 'reverted');
});

test('US-33-R95: a roadmap item filed as a file reaches the queue on the server: only an open item with a done check, a bounded number a tick, once, and a file judged not to be an item is not read again until it changes', async () => {
  const body = (o = {}) => JSON.stringify({ id: 'ROADMAP-1', title: 'Do the thing', labels: ['roadmap'], milestone: 'Now', body: '**Status:** open\n**Done check:** file:docs/a.md\n**Owner:** staff\n**Program:** P-1\n**Metric it should move:** m', ...o });
  const ok = parseRoadmapIssue('ROADMAP-1.json', body()); assert.deepEqual(ok.item, { id: 'ROADMAP-1', title: 'Do the thing', kind: 'roadmap', owner_role: 'staff', done_check: 'file:docs/a.md', closing_probe: 'file:docs/a.md', priority: 70, surface: 'docs/issues P-1 metric:m' });
  assert.equal(parseRoadmapIssue('R.json', body({ milestone: 'Next' })).item.priority, 55); assert.equal(parseRoadmapIssue('R.json', body({ milestone: 'Later' })).item.priority, 40);
  for (const [o, why] of [[{ labels: [] }, 'no roadmap label'], [{ body: '**Status:** closed\n**Done check:** x' }, 'not open'], [{ body: '**Status:** open' }, 'no done check'], [{ id: 'bad id!' }, 'bad id']]) assert.equal(parseRoadmapIssue('R.json', body(o)).skip, why);
  assert.equal(parseRoadmapIssue('R.json', 'not json').skip, 'not json');
  const db = makeDb(); const names = ['ROADMAP-1', 'ROADMAP-2', 'ROADMAP-3', 'ROADMAP-4', 'ROADMAP-5', 'ROADMAP-6', 'ROADMAP-7', 'ROADMAP-BAD'], reads = [];
  const f = async (url) => { const path = url.replace('https://api.github.com', ''); if (path.startsWith('/repos/o/r/contents/docs/issues?')) return R(200, [...names.map(n => ({ name: n + '.json', sha: 'sha-' + n })), { name: 'Q-OTHER.json', sha: 'q' }]); const n = /issues\/([^?]+)\.json/.exec(path)[1]; reads.push(n); return R(200, { content: b64(n === 'ROADMAP-BAD' ? '{"labels":[]}' : body({ id: n, title: n })) }); };
  let r = await syncIssues({ db, token: 't', repo: 'o/r', fetch: f }); assert.equal(r.inserted.length, 5, 'at most five new items a tick'); assert.deepEqual(r.inserted, names.slice(0, 5));
  assert.deepEqual({ ...db.raw.prepare("SELECT status, kind FROM items WHERE id = 'ROADMAP-1'").get() }, { status: 'open', kind: 'roadmap' }); assert.ok(!reads.includes('Q-OTHER'), 'only ROADMAP-*.json files are read');
  reads.length = 0; r = await syncIssues({ db, token: 't', repo: 'o/r', fetch: f }); assert.deepEqual(r.inserted, ['ROADMAP-6', 'ROADMAP-7'], 'idempotent: what is in the queue is not inserted again'); assert.deepEqual(r.skipped, ['ROADMAP-BAD.json: no roadmap label']);
  reads.length = 0; await syncIssues({ db, token: 't', repo: 'o/r', fetch: f }); assert.deepEqual(reads, [], 'a file judged not to be an item is remembered by its blob sha and not fetched again, so a growing backlog does not spend the subrequest limit');
  assert.equal((await syncIssues({ db, repo: 'o/r' })).status, 'no-token'); const lf = await syncIssues({ db, token: 't', repo: 'o/r', fetch: async () => R(502, {}) }); assert.deepEqual([lf.status, lf.errors], ['errors', ['list 502']]);
});

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-14T00:00:00Z');
function seedTick(db, items) {
  db.raw.exec("INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m'), ('op-1','operations',1,'m'), ('pm-1','portfolio-manager',1,'m')");
  const ins = db.raw.prepare("INSERT INTO items (id,title,owner_role,done_check,priority,status,created_at) VALUES (?,?,?,?,?,'ready','2026-11-13 00:00:00')");
  for (const i of items) ins.run(i.id, i.title, i.owner_role || 'staff', i.done_check || 'x', i.priority ?? 10);
}
test('US-33-R99: every item the tick claims ends the same tick done, parked behind one gate with a named reason, or waiting with its claim kept, and the reaper never releases a claim nobody worked', async () => {
  const db = makeDb(); seedTick(db, [{ id: 'FN-2', title: 'FN-2: Google for Startups Cloud Program application', done_check: 'Submission confirmation' }, { id: 'TICKFAIL-measure-2026-11-13T08', title: 'Tick step measure failed', owner_role: 'operations', done_check: 'next tick completes step measure', priority: 0 }, { id: 'PR-1', title: 'PR-1: Positioning', owner_role: 'portfolio-manager', done_check: 'see roadmap', priority: 0 }]);
  db.raw.exec("INSERT INTO tick_runs (started_at, finished_at, steps_total, steps_completed) VALUES ('2026-11-13 09:00:00','2026-11-13 09:00:05',10,10)");
  await runTick(db, { config, now: T0 });
  const st = (id) => db.raw.prepare('SELECT status, blocker, disposition FROM items WHERE id = ?').get(id);
  assert.equal(st('FN-2').status, 'blocked'); assert.match(st('FN-2').blocker, /^owner-only:/); assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id = 'GATE-OWNER-ITEMS'").get().status, 'open'); assert.equal(db.raw.prepare("SELECT result FROM outcomes WHERE item_id = 'FN-2'").get().result, 'parked');
  assert.equal(st('TICKFAIL-measure-2026-11-13T08').status, 'done'); assert.match(st('TICKFAIL-measure-2026-11-13T08').disposition, /completed step measure/); assert.equal(db.raw.prepare("SELECT result FROM outcomes WHERE item_id = 'TICKFAIL-measure-2026-11-13T08'").get().result, 'verified');
  assert.equal(st('PR-1').status, 'claimed', 'with no model binding a generic item waits with its claim kept'); assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM claims WHERE item_id = 'PR-1'").get().n, 1); assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM claims WHERE item_id = 'FN-2'").get().n, 0);
  assert.equal(db.raw.prepare("SELECT model FROM dispatches WHERE item_id = 'TICKFAIL-measure-2026-11-13T08'").get().model, 'rules (no model)', 'a dispatch row says what ran: no model for a rule');
  await runTick(db, { config, now: T0 + 600e3 }); assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM dispatches WHERE item_id = 'FN-2'").get().n, 1, 'a parked item is not dispatched again');
  assert.ok(OWNER_ONLY.test('FUND-3: OC-3 owner card: form entity and assign IP')); assert.ok(!OWNER_ONLY.test('SG-1: stop depending on github'));
});
