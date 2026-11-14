import test from 'node:test';
import assert from 'node:assert/strict';
import { runExecutor, noteExecutor } from '../src/executor.js';

test('no binding: reported as not configured, never thrown', async () => {
  const r = await runExecutor({});
  assert.equal(r[0].provider, 'worker-native'); assert.equal(r[0].ok, false); assert.match(r[0].detail, /not configured/);
});
test('dispatches through GitHub when bound', async () => {
  let seen;
  const r = await runExecutor({ GITHUB_DISPATCH_TOKEN: 't', GITHUB_REPO: 'o/r' }, { fetchImpl: async (u, o) => { seen = { u, o }; return { status: 204 }; } });
  const g = r.find(x => x.provider === 'github-actions');
  assert.equal(g.ok, true); assert.match(seen.u, /repos\/o\/r\/dispatches/);
  assert.equal(JSON.parse(seen.o.body).event_type, 'ultrastable-tick');
});
test('falls through to the next provider', async () => {
  const bad = { id: 'a', available: () => true, dispatch: async () => { throw new Error('down'); } };
  const good = { id: 'b', available: () => true, dispatch: async () => ({ ok: true, detail: 'ok' }) };
  const r = await runExecutor({}, { providers: [bad, good] });
  assert.deepEqual(r.map(x => x.ok), [false, true]);
});

test('EXEC-SPARK-2: an unreachable executor is filed once, with its refusal text, and a working one files nothing', async () => {
  const { makeDb } = await import('./d1shim.js');
  const db = makeDb();
  const down = [{ provider: 'github-actions', ok: false, detail: 'not configured (binding missing)' }, { provider: 'workers-ai-agent', ok: false, detail: 'not configured (binding missing)' }];
  const a = await noteExecutor(db, down); const b = await noteExecutor(db, down);
  assert.equal(a.filed, true); assert.equal(b.filed, false);
  const row = db.raw.prepare("SELECT title, owner_role, status FROM items WHERE id='EXEC-SPARK-UNREACHABLE'").get();
  assert.match(row.title, /github-actions: not configured/); assert.equal(row.owner_role, 'operations'); assert.equal(row.status, 'ready');
  const db2 = makeDb();
  assert.equal((await noteExecutor(db2, [{ provider: 'github-actions', ok: true, detail: 'github dispatch HTTP 204' }])).filed, false);
  assert.equal(db2.raw.prepare('SELECT COUNT(*) n FROM items').get().n, 0);
});
