import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, bind } from '../../../deploy/bind-worker-secrets.mjs';
test('no credential is a recorded gate, not a failure', async () => {
  assert.deepEqual(await bind({}), { status: 'no-credential', bound: [] });
});
test('a lane credential becomes the tick Worker secrets and is never echoed', async () => {
  const calls = [];
  const f = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200 }; };
  const r = await bind({ LANE_PAT: 'x', GITHUB_REPOS: 'a/b', CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 't' }, f);
  assert.deepEqual(r, { status: 'bound', bound: ['GITHUB_TOKEN', 'GITHUB_DISPATCH_TOKEN', 'GITHUB_REPOS'] });
  assert.match(calls[0].url, /accounts\/acc\/workers\/scripts\/ultrastable-tick\/secrets$/);
  assert.ok(!JSON.stringify(r).includes('"x"'));
});
test('an API refusal fails loudly', async () => {
  await assert.rejects(bind({ LANE_PAT: 'x', CLOUDFLARE_ACCOUNT_ID: 'a', CLOUDFLARE_API_TOKEN: 't' }, async () => ({ ok: false, status: 403 })), /HTTP 403/);
});
