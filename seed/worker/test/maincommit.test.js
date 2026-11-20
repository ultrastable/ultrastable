// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkBody, isProtected, commitToMain, verifyOidc } from '../src/maincommit.js';

const b64 = s => btoa(s);
test('MAIN-WRITER-1: protected paths, unsafe paths and oversized commits are refused', () => {
  assert.match(checkBody({ message: 'm', files: [{ path: '.github/workflows/x.yml', content: 'a' }] }), /protected/);
  assert.match(checkBody({ message: 'm', files: [{ path: 'agents/AGENTS.md', content: 'a' }] }), /protected/);
  assert.match(checkBody({ message: 'm', files: [{ path: 'github/org-settings.json', content: 'a' }] }), /protected/);
  assert.match(checkBody({ message: 'm', files: [{ path: '../x', content: 'a' }] }), /bad path/);
  assert.match(checkBody({ message: 'm', files: Array.from({ length: 21 }, (_, i) => ({ path: 'ops/' + i, content: 'a' })) }), /at most/);
  assert.equal(checkBody({ message: 'm', files: [{ path: 'ops/deploys.jsonl', append: b64('x\n') }] }), null);
  assert.equal(isProtected('ops/deploys.jsonl'), false);
});

test('MAIN-WRITER-1: one commit on the newest main, appends reapply to it, and a moved main answers 409', async () => {
  const calls = [];
  const f = async (url, o = {}) => {
    const u = String(url), m = o.method || 'GET'; calls.push(m + ' ' + u.replace(/^.*repos\/r\/r/, ''));
    const J = (j, status = 200) => ({ ok: status < 300, status, json: async () => j, arrayBuffer: async () => new TextEncoder().encode('old\n').buffer });
    if (u.includes('/contents/')) return J({});
    if (u.endsWith('/git/ref/heads/main')) return J({ object: { sha: 'P' } });
    if (u.endsWith('/git/commits/P')) return J({ tree: { sha: 'T0' } });
    if (u.endsWith('/git/blobs')) return J({ sha: 'B' + calls.length });
    if (u.endsWith('/git/trees')) { assert.deepEqual(JSON.parse(o.body).tree.map(x => x.path), ['ops/a.jsonl']); return J({ sha: 'T1' }); }
    if (u.endsWith('/git/commits')) return J({ sha: 'C1' });
    if (m === 'PATCH') return J(calls.moved ? { message: 'Update is not a fast forward' } : {}, calls.moved ? 422 : 200);
    return J({}, 500);
  };
  const body = { message: 'ledger', files: [{ path: 'ops/a.jsonl', append: b64('new\n') }] };
  const r = await commitToMain({ token: 't', repo: 'r/r', body, fetch: f });
  assert.deepEqual([r.ok, r.sha], [true, 'C1']);
  calls.moved = true;
  assert.equal((await commitToMain({ token: 't', repo: 'r/r', body, fetch: f })).status, 409);
});

test('MAIN-WRITER-1: a token for another audience or repository is refused before any key lookup', async () => {
  const enc = o => btoa(JSON.stringify(o)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const jwt = c => enc({ alg: 'RS256', kid: 'k' }) + '.' + enc(c) + '.sig';
  const f = async () => { throw new Error('must not fetch keys'); };
  const base = { iss: 'https://token.actions.githubusercontent.com', aud: 'ultrastable-main', repository: 'o/r', ref: 'refs/heads/main', exp: 9999999999 };
  assert.equal((await verifyOidc(jwt({ ...base, aud: 'ultrastable-deploy' }), { repo: 'o/r', fetch: f })).ok, false);
  assert.equal((await verifyOidc(jwt({ ...base, repository: 'o/x' }), { repo: 'o/r', fetch: f })).ok, false);
  assert.equal((await verifyOidc(jwt({ ...base, ref: 'refs/heads/x' }), { repo: 'o/r', fetch: f })).ok, false);
});

test('MAIN-WRITER-PR-1: a ruleset refusal (422 that is not a moved main) lands the commit as an App pull request', async () => {
  const seen = [];
  const f = async (url, o = {}) => {
    const u = String(url), m = o.method || 'GET'; seen.push(m + ' ' + u.replace(/^.*repos\/r\/r/, ''));
    const J = (j, status = 200) => ({ ok: status < 300, status, json: async () => j, arrayBuffer: async () => new ArrayBuffer(0) });
    if (u.endsWith('/git/ref/heads/main')) return J({ object: { sha: 'P' } });
    if (u.endsWith('/git/commits/P')) return J({ tree: { sha: 'T0' } });
    if (u.endsWith('/git/blobs')) return J({ sha: 'B' });
    if (u.endsWith('/git/trees')) return J({ sha: 'T1' });
    if (u.endsWith('/git/commits')) return J({ sha: 'C1234567890' });
    if (m === 'PATCH') return J({ message: 'Changes must be made through a pull request.' }, 422);
    if (u.includes('/pulls?state=open')) return J(f.open || []);
    if (u.endsWith('/git/refs')) return J({}, 201);
    if (u.endsWith('/pulls')) return J({ number: 7 }, 201);
    return J({}, 500);
  };
  const r = await commitToMain({ token: 't', repo: 'r/r', body: { message: 'ledger', files: [{ path: 'ops/a.json', content: b64('x') }] }, fetch: f });
  assert.deepEqual([r.ok, r.mode, r.pr, r.branch], [true, 'pull_request', 7, 'agent/data-C123456789']);
  f.open = [1, 2, 3].map(i => ({ head: { ref: 'agent/data-' + i } }));
  const capped = await commitToMain({ token: 't', repo: 'r/r', body: { message: 'ledger', files: [{ path: 'ops/a.json', content: b64('x') }] }, fetch: f });
  assert.deepEqual([capped.ok, capped.status], [false, 503]); assert.match(capped.error, /3 data pull requests are already open/);
  f.open = [];
  const g = async (url, o = {}) => (String(url).endsWith('/git/refs') || String(url).endsWith('/pulls')) ? { ok: false, status: 500, json: async () => ({}) } : f(url, o);
  assert.equal((await commitToMain({ token: 't', repo: 'r/r', body: { message: 'x', files: [{ path: 'ops/a.json', content: b64('x') }] }, fetch: g })).ok, false);
});
