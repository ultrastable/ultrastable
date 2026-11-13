// REPO-ACCESS-1: an installation that does not cover every repo is detected by code, raises one machine-readable gate card with the exact consent page,
// /connect/repos sends the owner there, and the setup callback re-probes and closes the card. No manual token step anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { newKey } from '../src/auth/seal.js';
import * as store from '../src/auth/store.js';
import { checkRepoAccess, readRepoAccess } from '../src/auth/access.js';
import { handleAuth, makeState } from '../src/auth/routes.js';

const toPem = (der, label) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----`;
async function pem() {
  const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  return toPem(new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey)), 'PRIVATE KEY');
}
const REPOS = ['o/a', 'o/b'];
function gh(state) {
  return async (url, init = {}) => {
    const R = (j, status = 200) => ({ ok: status < 400, status, json: async () => j });
    if (/\/app\/installations\/9$/.test(url)) return R({ repository_selection: 'selected', html_url: 'https://github.com/organizations/o/settings/installations/9' });
    if (/access_tokens$/.test(url)) return R({ token: 'tok', expires_at: '2026-11-13T20:00:00Z' }, 201);
    if (/installation\/repositories/.test(url)) return R({ repositories: state.repos.map(full_name => ({ full_name })) });
    return R({}, 404);
  };
}
async function setup() {
  const db = makeDb(), env = { CREDENTIAL_KEY: newKey() }; env.DB = db;
  await store.put(db, env, 't', 'github-app', { secret: { pem: await pem() }, meta: { app_id: 7, installation_id: 9 }, status: 'ok' });
  return { db, env };
}

test('a partial installation raises one open gate card and exposes the consent page', async () => {
  const { db, env } = await setup();
  const a = await checkRepoAccess(db, env, 't', REPOS, { token: 'x', fetch: gh({ repos: ['o/a'] }), origin: 'https://w.example' });
  assert.equal(a.ok, false); assert.deepEqual(a.missing, ['o/b']); assert.match(a.settings_url, /settings\/installations\/9/);
  await checkRepoAccess(db, env, 't', REPOS, { token: 'x', fetch: gh({ repos: ['o/a'] }) });  // idempotent: still one card
  const cards = db.raw.prepare("SELECT status FROM gate_cards WHERE id='GATE-REPO-ACCESS'").all();
  assert.equal(cards.length, 1); assert.equal(cards[0].status, 'open');
  const r = await handleAuth(new Request('https://w.example/connect/repos'), env, { tenant: 't', fetch: gh({}) });
  assert.equal(r.status, 302); assert.match(r.headers.get('location'), /settings\/installations\/9/);
});

test('the setup callback re-probes with a fresh token and closes the card when every repo is covered', async () => {
  const { db, env } = await setup();
  await checkRepoAccess(db, env, 't', REPOS, { token: 'x', fetch: gh({ repos: ['o/a'] }) });
  const state = await makeState(env, 't');
  const r = await handleAuth(new Request(`https://w.example/auth/github/installed?installation_id=9&state=${encodeURIComponent(state)}`), env, { tenant: 't', repos: REPOS, fetch: gh({ repos: REPOS }) });
  assert.equal(r.status, 200);
  assert.equal((await readRepoAccess(db)).ok, true);
  assert.equal(db.raw.prepare("SELECT status FROM gate_cards WHERE id='GATE-REPO-ACCESS'").get().status, 'closed');
});
