// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-10 R33 and US-SPEC-19 R24 (Door E): the host creates a system's repository itself from the seed, with the idea written into it and `hosted_by` set,
// so the person holds no credential for it. The fake code host and the world helper are the ones apprepos.test.js uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from './d1shim.js';
import { newKey } from '../src/auth/seal.js';
import * as store from '../src/auth/store.js';
import { ensureAppRepo } from '../src/apprepos.js';

const toPem = (der, label) => `-----BEGIN ${label}-----\n${Buffer.from(der).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END ${label}-----`;
async function pem() { const k = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']); return toPem(new Uint8Array(await crypto.subtle.exportKey('pkcs8', k.privateKey)), 'PRIVATE KEY'); }
const REPO = 'ultrastable/app-living-atlas-works-ab12cd34ef', T = 'ultrastable';
async function world({ admin = true, template = 201, covers = true } = {}) {
  const env = { CREDENTIAL_KEY: newKey(), INTERNAL_DEPLOY_KEY: 'k'.repeat(40) }, db = makeDb();
  await store.ensureSchema(db);
  const far = Date.now() + 3600e3;
  await store.put(db, env, T, 'github-app', { secret: { pem: await pem() }, meta: { app_id: 1, installation_id: 11 }, access: 'code-token', expiresAt: far });
  if (admin) await store.put(db, env, T, 'github-admin', { secret: { pem: await pem() }, meta: { app_id: 2, installation_id: 22 }, access: 'admin-token', expiresAt: far });
  const repos = new Map(), calls = [];
  const f = async (url, init = {}) => {
    const u = new URL(url), tok = (init.headers.authorization || '').slice(7), body = init.body ? JSON.parse(init.body) : null, m = init.method || 'GET';
    calls.push({ m, path: u.pathname, tok, body });
    const R = (status, json) => new Response(JSON.stringify(json || {}), { status });
    let x;
    if ((x = /^\/app\/installations\/11\/access_tokens$/.exec(u.pathname))) return R(201, { token: 'scoped:' + body.repositories.join(','), expires_at: new Date(far).toISOString() });
    if ((x = /^\/repos\/([^/]+\/[^/]+)\/generate$/.exec(u.pathname))) { if (tok !== 'admin-token' || template !== 201) return R(template === 201 ? 403 : template, { message: 'no' }); repos.set(body.owner + '/' + body.name, new Map([['README.md', 'seed']])); return R(201, {}); }
    if ((x = /^\/orgs\/([^/]+)\/repos$/.exec(u.pathname))) { if (tok !== 'admin-token') return R(403, { message: 'Resource not accessible by integration' }); repos.set(x[1] + '/' + body.name, new Map([['README.md', '']])); return R(201, {}); }
    if ((x = /^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(u.pathname))) {
      const r = repos.get(x[1]); if (!r || tok !== 'code-token' || !covers) return R(404, { message: 'Not Found' });
      if (m === 'GET') return r.has(x[2]) ? R(200, { sha: 's', content: Buffer.from(r.get(x[2])).toString('base64') }) : R(404);
      r.set(x[2], Buffer.from(body.content, 'base64').toString()); return R(201);
    }
    if ((x = /^\/repos\/([^/]+\/[^/]+)\/collaborators\/(.+)$/.exec(u.pathname))) return tok === 'admin-token' ? R(201) : R(403);
    if ((x = /^\/repos\/([^/]+\/[^/]+)$/.exec(u.pathname))) return repos.has(x[1]) ? R(200, {}) : R(404);
    return R(500, { message: 'unexpected ' + u.pathname });
  };
  return { env, db, f, repos, calls };
}

const IDEA = '---\norg_name: Living Atlas\nhosted_by: ultrastable\n---\n# Idea\n\nA living atlas of what works.\n';
const spec = (o = {}) => ({ repo: REPO, template: 'ultrastable/seed', description: 'atlas', files: [{ path: 'IDEA.md', content: IDEA, message: 'idea' }], ...o });

test('US-10-R33 / US-19-R24 the host creates the system\'s repository from the template with the idea written into it and hosted_by set, using its own credentials', async () => {
  const w = await world();
  const r = await ensureAppRepo(w.db, w.env, T, spec({ invite: 'ada-l' }), { fetch: w.f });
  assert.equal(r.ok, true);
  assert.equal(r.from_template, true);
  assert.equal(w.repos.get(REPO).get('IDEA.md'), IDEA);
  assert.match(w.repos.get(REPO).get('IDEA.md'), /hosted_by: ultrastable/);
  const made = w.calls.find(c => c.path.endsWith('/generate'));
  assert.equal(made.tok, 'admin-token', 'the host\'s administration credential creates the repository');
  assert.equal(made.body.owner, 'ultrastable');
  const writes = w.calls.filter(c => /\/contents\//.test(c.path) && c.m !== 'GET');
  assert.ok(writes.length > 0 && writes.every(c => c.tok === 'code-token'), 'the idea is written with the host\'s code credential');
  assert.equal(r.invited, 'ada-l', 'the person is invited last, as a collaborator of a repository that already exists');
});

test('US-10-R33 / US-19-R24 a repository outside the app naming rule is refused before any call, and a second pass writes nothing', async () => {
  const w = await world();
  const bad = await ensureAppRepo(w.db, w.env, T, spec({ repo: 'ultrastable/ultrastable' }), { fetch: w.f });
  assert.equal(bad.ok, false);
  assert.equal(w.calls.length, 0, 'no call reached the code host');
  await ensureAppRepo(w.db, w.env, T, spec(), { fetch: w.f });
  const again = await ensureAppRepo(w.db, w.env, T, spec(), { fetch: w.f });
  assert.deepEqual(again.files, [{ path: 'IDEA.md', unchanged: true }]);
});

test('US-19-R24 / US-19-R25 when the code host refuses a step the answer names what is waited on and the repository that exists stays', async () => {
  const w = await world({ admin: false });
  const r = await ensureAppRepo(w.db, w.env, T, spec(), { fetch: w.f });
  assert.equal(r.ok, false);
  assert.equal(r.waiting_on, 'admin-app');
  const c = await world({ covers: false });
  const r2 = await ensureAppRepo(c.db, c.env, T, spec(), { fetch: c.f });
  assert.deepEqual([r2.ok, r2.waiting_on, r2.created], [false, 'code-app-scope', true]);
});
