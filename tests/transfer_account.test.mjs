import test from 'node:test';
import assert from 'node:assert/strict';
import { plan, ASSETS } from '../scripts/transfer_account.mjs';

test('plan selects only ultrastable-* assets, never QNFO ones', async () => {
  const data = {
    '/workers/scripts': [{ id: 'ultrastable-tick' }, { id: 'qnfo-ops' }],
    '/d1/database': [{ name: 'ultrastable-org', uuid: 'u1' }, { name: 'qnfo-audit', uuid: 'q1' }],
    '/storage/kv/namespaces': [{ title: 'ultrastable-private', id: 'k1' }, { title: 'qnfo-fleet-config', id: 'k2' }],
  };
  const f = async url => ({ json: async () => ({ success: true, result: data[Object.keys(data).find(k => url.endsWith(k))] }) });
  const p = await plan(f, 't', 'acct');
  assert.deepEqual(p.workers, ['ultrastable-tick']);
  assert.deepEqual(p.d1.map(d => d.name), ['ultrastable-org']);
  assert.deepEqual(p.kv.map(k => k.title), ['ultrastable-private']);
  assert.ok(!ASSETS.test('qnfo-ops'));
});
