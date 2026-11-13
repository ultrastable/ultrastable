import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bind } from '../../../deploy/bind-worker-secrets.mjs';
const env = { CLOUDFLARE_ACCOUNT_ID: 'acc', CLOUDFLARE_API_TOKEN: 't', GITHUB_REPOS: 'a/b' };
test('the sealing key is generated once and never rotated; no GitHub token is ever bound', async () => {
  const puts = [];
  const f = existing => async (u, o = {}) => o.method === 'PUT' ? (puts.push(JSON.parse(o.body)), { ok: true }) : { ok: true, json: async () => ({ result: existing.map(name => ({ name })) }) };
  assert.deepEqual(await bind(env, f([])), { status: 'bound', bound: ['CREDENTIAL_KEY', 'CF_ANALYTICS_TOKEN', 'GITHUB_REPOS'] });
  assert.equal(Buffer.from(puts[0].text, 'base64').length, 32);
  puts.length = 0;
  assert.deepEqual((await bind({ ...env, GITHUB_REPOS: '' }, f(['CREDENTIAL_KEY', 'CF_ANALYTICS_TOKEN']))).status, 'unchanged');
  assert.ok(![...puts].some(p => /GITHUB_TOKEN|DISPATCH|PAT/.test(p.name)));
});
test('an API refusal fails loudly', async () => {
  await assert.rejects(bind(env, async () => ({ ok: false, status: 403 })), /HTTP 403/);
});
