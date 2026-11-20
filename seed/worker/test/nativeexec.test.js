import test from 'node:test';
import assert from 'node:assert/strict';
import { guard, runNative, nativeProvider, shrinkGuard, doneOnMain } from '../src/nativeexec.js';

const b64 = s => Buffer.from(s).toString('base64');
function fakeGh({ branches = [] } = {}) {
  const log = [];
  const f = async (url, o = {}) => {
    const path = url.replace('https://api.github.com', ''); const m = o.method || 'GET'; log.push(`${m} ${path.split('?')[0]}`);
    const R = (status, json) => ({ status, ok: status < 300, text: async () => (json === undefined ? '' : JSON.stringify(json)) });
    if (path.startsWith('/repos/o/r/contents/ops/priority-queue.json')) return R(200, { sha: 's', content: b64(JSON.stringify([{ id: 'A-1' }, { id: 'B-2' }])) });
    if (path.startsWith('/repos/o/r/contents/docs/issues/')) return R(200, { sha: 's', content: b64(JSON.stringify({ title: 'A-1: do x', body: '**Status:** open\ncode-task: repo=r path=src/x.js' })) });
    if (path.startsWith('/repos/o/r/contents/src/x.js') && m === 'GET') return R(200, { sha: 'x', content: b64('old') });
    if (path.startsWith('/repos/o/r/git/ref/heads/main')) return R(200, { object: { sha: 'm1' } });
    if (path.startsWith('/repos/o/r/git/ref/heads/worker/')) return R(branches.some(b => path.endsWith(b)) ? 200 : 404, {});
    if (path === '/repos/o/r/git/refs') return R(201, {});
    if (path.startsWith('/repos/o/r/contents/') && m === 'PUT') return R(201, {});
    if (path === '/repos/o/r/pulls') return R(201, { number: 7 });
    return R(404, {});
  };
  return { f, log };
}
const env = { GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r', AI: {} };
const agent = async () => ({ summary: 'did x', adapter: 'fake', files: [{ path: 'src/x.js', content: 'new' }] });

test('guard refuses protected, traversal, oversized and too many files', () => {
  assert.throws(() => guard([{ path: '.github/workflows/a.yml', content: '' }]), /protected/);
  assert.throws(() => guard([{ path: '../x', content: '' }]), /unsafe/);
  assert.throws(() => guard([{ path: 'a', content: 'x'.repeat(70000) }]), /oversized/);
  assert.throws(() => guard([1, 2, 3, 4].map(i => ({ path: 'f' + i, content: '' }))), /too many/);
    assert.equal(guard([{ path: 'src/a.js', content: 'ok' }]).length, 1);
});
test('opens a branch, writes the file and opens a PR for the top item', async () => {
  const { f, log } = fakeGh();
  const r = await runNative(env, { fetchImpl: f, agent });
  assert.equal(r.ok, true); assert.match(r.detail, /o\/r#7 for A-1/);
  assert.ok(log.includes('POST /repos/o/r/git/refs') && log.includes('PUT /repos/o/r/contents/src/x.js') && log.includes('POST /repos/o/r/pulls'));
});
test('skips an item that already has a worker branch', async () => {
  const { f } = fakeGh({ branches: ['worker/a-1'] });
  const r = await runNative(env, { fetchImpl: f, agent });
  assert.match(r.detail, /for B-2/);
});
test('a protected-path answer opens nothing and says why', async () => {
  const { f, log } = fakeGh();
  const r = await runNative(env, { fetchImpl: f, agent: async () => ({ summary: 's', files: [{ path: '.github/x.yml', content: 'a' }] }) });
  assert.equal(r.ok, false); assert.match(r.detail, /protected path/); assert.ok(!log.includes('POST /repos/o/r/pulls'));
});
test('provider needs a token and the AI binding', () => {
  assert.equal(nativeProvider.available({}), false);
  assert.equal(nativeProvider.available(env), true);
});

test('shrink guard refuses gutted files, dropped JSON keys and dropped exports', () => {
  const big = JSON.stringify({ a: 1, b: 2, features: [1, 2, 3], gaps: 'x'.repeat(200) });
  assert.throws(() => shrinkGuard('doctrine/market.json', big, JSON.stringify({ a: 1 })), /shrink/);
  assert.throws(() => shrinkGuard('x.json', '{"a":1,"b":2}', '{"a":1,"c":3}'), /drops keys b/);
  assert.throws(() => shrinkGuard('src/c.js', 'export const ADAPTERS = [];\nexport function parseJson() {}\n', 'export async function runExecutor() {}\nexport const ADAPTERS = [];\n'), /drops exports parseJson/);
  assert.doesNotThrow(() => shrinkGuard('new.js', null, 'x'));
  assert.doesNotThrow(() => shrinkGuard('a.json', '{"a":1}', '{"a":1,"b":2}'));
});

test('an item whose file: done check already passes is not re-worked', () => {
  assert.equal(doneOnMain('**Done check:** file:ops/x.json', p => p === 'ops/x.json'), true);
  assert.equal(doneOnMain('**Done check:** grep:a::b', () => true), false);
});

// CODE-QUEUE-1: items the doer parked as needs-code are worked by the executor; the PR carries a Handoff block that closes the item.
import { makeDb } from './d1shim.js';
import { runDbQueue, pathsIn, deployFor, reopenClosedUnmerged } from '../src/nativeexec.js';
function codeDb() {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,closing_probe,priority,status,blocker) VALUES
    ('RM-1','RM-1: serve agent card','operations','site/agentic.js serves it','GET /x','20','blocked','needs-code: edit site/agentic.js'),
    ('OW-1','OW-1: sign','operations','x',NULL,90,'blocked','owner-only: sign')`);
  return db;
}
test('the D1 lane opens a PR for a needs-code item and marks it in-pr with the model', async () => {
  const db = codeDb(), { f, log } = fakeGh();
  const bodies = [];
  const f2 = async (url, o = {}) => { if (o.method === 'POST' && url.endsWith('/pulls')) bodies.push(JSON.parse(o.body).body); return f(url, o); };
  const ag = async () => ({ summary: 'card', adapter: 'workers-ai-glm', model: '@cf/zai-org/glm-4.7-flash', files: [{ path: 'site/agentic.js', content: 'new' }] });
  const r = await runDbQueue({ ...env, DB: db }, { fetchImpl: f2, agent: ag, now: T });
  assert.equal(r.ok, true, r.detail);
  assert.ok(log.some(l => l.startsWith('POST /repos/o/r/git/refs')));
  assert.match(bodies[0], /## Handoff\nitem: RM-1\nagent: worker-native \(workers-ai-glm\)\ndeploy: ultrastable-site/);
  const it = db.raw.prepare("SELECT status, blocker FROM items WHERE id='RM-1'").get();
  assert.equal(it.status, 'blocked'); assert.match(it.blocker, /^in-pr: https:\/\/github.com\/o\/r\/pull\/7 \| agent: worker-native \| model: @cf\/zai-org\/glm-4.7-flash/);
  assert.match(db.raw.prepare("SELECT blocker FROM items WHERE id='OW-1'").get().blocker, /^owner-only/, 'owner-only items are never taken');
  const again = await runDbQueue({ ...env, DB: db }, { fetchImpl: f, agent: ag, now: T });
  assert.equal(again.idle, true, 'an in-pr item is not taken twice');
});
const T = Date.parse('2026-11-15T20:00:00Z');
test('a failed model attempt keeps the item needs-code with the reason', async () => {
  const db = codeDb(), { f } = fakeGh();
  const r = await runDbQueue({ ...env, DB: db }, { fetchImpl: f, agent: async () => ({ summary: 's', adapter: 'a', files: [{ path: '.github/x.yml', content: '' }] }), now: T });
  assert.equal(r.ok, false);
  assert.match(db.raw.prepare("SELECT blocker FROM items WHERE id='RM-1'").get().blocker, /^needs-code: worker-native attempt failed \(protected path/);
});
test('a PR closed without merge returns its item to needs-code', async () => {
  const db = codeDb();
  db.raw.exec(`UPDATE items SET blocker='in-pr: u' WHERE id='RM-1'`);
  db.raw.exec(`INSERT INTO handoffs (id, repo, pr, item, state) VALUES ('o/r#7','o/r',7,'RM-1','closed_unmerged')`);
  assert.equal(await reopenClosedUnmerged(db), 1);
  assert.match(db.raw.prepare("SELECT blocker FROM items WHERE id='RM-1'").get().blocker, /^needs-code: previous PR closed/);
});
test('paths and deploy targets are read from the item text and the change', () => {
  assert.deepEqual(pathsIn('edit site/agentic.js and seed/worker/src/tick.js, not x.js'), ['site/agentic.js', 'seed/worker/src/tick.js']);
  assert.equal(deployFor(['site/a.js', 'seed/worker/src/b.js', 'docs/c.md']), 'ultrastable-site, ultrastable-tick');
});

test('NATIVE-SUBSTANCE-1: a change that only adds documents or subtask records is refused', async () => {
  const { substanceGuard } = await import('../src/nativeexec.js');
  const fresh = () => true, old = () => false;
  assert.throws(() => substanceGuard([{ path: 'specs/example-narration.md' }], fresh), /narration/);
  assert.throws(() => substanceGuard([{ path: 'backlog/subtasks/X.subtask.json' }, { path: 'docs/x.md' }], fresh), /narration/);
  assert.doesNotThrow(() => substanceGuard([{ path: 'docs/x.md' }], old));                                   // editing a consumed document is a change
  assert.doesNotThrow(() => substanceGuard([{ path: 'docs/x.md' }, { path: 'site/worker.js' }], fresh));     // a document beside code is fine
});

test('NATIVE-STUB-1: a new file of placeholder bodies, or outside the directories the repository runs, is refused', async () => {
  const { stubGuard } = await import('../src/nativeexec.js');
  const fresh = () => true, old = () => false;
  const stub = 'class ConnectorHealth:\n    def silent_refresh(self):\n        # Implement silent refresh logic here\n        pass\n';
  assert.throws(() => stubGuard([{ path: 'connector_health.py', content: 'x = 1\n' }], fresh), /outside the directories/);
  assert.throws(() => stubGuard([{ path: 'foundation/connector_health.py', content: stub }], fresh), /placeholder/);
  assert.doesNotThrow(() => stubGuard([{ path: 'foundation/connector_health.py', content: 'def expired(now, at):\n    return now > at\n' }], fresh));
  assert.doesNotThrow(() => stubGuard([{ path: 'connector_health.py', content: stub }], old));   // an existing file is judged by the shrink guard and the checks
});

test('NATIVE-ONE-PR-1: an item with an open worker PR is not worked again', async () => {
  const { runDbQueue: run, slugOf } = await import('../src/nativeexec.js');
  const db = { prepare: () => ({ bind: () => ({ run: async () => ({ meta: { changes: 0 } }), all: async () => ({ results: [{ id: 'ROADMAP-X', title: 't', blocker: 'needs-code: x' }] }) }) }) };
  let asked = 0;
  const f = async url => ({ status: 200, ok: true, text: async () => JSON.stringify(url.includes('/pulls?state=open') ? [{ head: { ref: `worker/${slugOf('ROADMAP-X')}-202611200040` } }] : {}) });
  const r = await run({ ...env, DB: db }, { fetchImpl: f, agent: async () => { asked++; return {}; }, now: 0 });
  assert.equal(r.idle, true); assert.equal(asked, 0);
});
