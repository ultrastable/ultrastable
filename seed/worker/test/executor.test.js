import test from 'node:test';
import assert from 'node:assert/strict';
import { runExecutor } from '../src/executor.js';

test('no binding: reported as not configured, never thrown', async () => {
  const r = await runExecutor({});
  assert.equal(r[0].ok, false); assert.match(r[0].detail, /not configured/);
});
test('dispatches through GitHub when bound', async () => {
  let seen;
  const r = await runExecutor({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r' }, { fetchImpl: async (u, o) => { seen = { u, o }; return { status: 204 }; } });
  assert.equal(r[0].ok, true); assert.match(seen.u, /repos\/o\/r\/dispatches/);
  assert.equal(JSON.parse(seen.o.body).event_type, 'ultrastable-tick');
});
test('falls through to the next provider', async () => {
  const bad = { id: 'a', available: () => true, dispatch: async () => { throw new Error('down'); } };
  const good = { id: 'b', available: () => true, dispatch: async () => ({ ok: true, detail: 'ok' }) };
  const r = await runExecutor({}, { providers: [bad, good] });
  assert.deepEqual(r.map(x => x.ok), [false, true]);
});
