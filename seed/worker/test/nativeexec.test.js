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
