// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-19-R11: the cards a person closes by keeping the preview carry a machine probe once the address is known, so the organization notices
// the claim itself. A fake Cloudflare and an in-memory database stand in for the account; nothing reaches the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { provision } from '../src/provision.js';
import { buildSeedSql, claimProbeSql, cleanIdea } from '../src/seed.js';
import { makeDb } from '../../../core/_shared/testdb.js';
import { watchOwnerSteps } from '../../../core/runner/ownerwatch.js';
import { fileURLToPath as f2p } from 'node:url';

const MIG = fileURLToPath(new URL('../../../core/migrations/', import.meta.url));
const MIGRATIONS = readdirSync(MIG).filter(n => n.endsWith('.sql')).sort().map(n => readFileSync(MIG + n, 'utf8')).join('\n');
const RUNNER_MIG = f2p(new URL('../../../core/runner/migrations/', import.meta.url));
const CLAIM = 'claim-token-SECRET', TOKEN = 'account-token-SECRET';
const PROOF = { challengeToken: 'ct', solution: { checkpoints: 'AAAA' } };
const ANSWERS = { idea: 'A neighbourhood tool library where people borrow tools instead of buying them', outcomes: ['Book a drill'], limit: 0, orgName: 'Tool Library' };
const RELEASE = { bundle: 'export default {}', bundleSha256: 'abc', migrationsSql: MIGRATIONS, compatibilityDate: '2026-10-01' };

function fake({ failQueryNo = 0 } = {}) {
  const calls = []; let queries = 0;
  const f = async (url, init = {}) => {
    const u = String(url), method = init.method || 'GET';
    calls.push({ u, method, body: typeof init.body === 'string' ? init.body : '' });
    const ok = r => new Response(JSON.stringify({ success: true, result: r }), { status: 200 });
    if (u.includes('/query') && ++queries === failQueryNo) return new Response(JSON.stringify({ success: false, errors: [{ message: `denied ${TOKEN}` }] }), { status: 403 });
    if (u.endsWith('/provisioning/previews')) return ok({ account: { id: 'a', apiToken: TOKEN, expiresAt: 'x' }, claim: { token: CLAIM, url: `https://dash.example/claim?claimToken=${CLAIM}`, expiresAt: 'x' } });
    if (u.endsWith('/d1/database')) return ok({ uuid: 'd' });
    if (u.endsWith('/workers/subdomain')) return ok({ subdomain: 'sub' });
    return ok({});
  };
  return { f, calls };
}

test('US-19-R11 once the address is known one more statement gives the CLAIM and HEARTBEAT cards an http probe on /health, and no secret is in it', async () => {
  const { f, calls } = fake();
  const r = await provision({ fetch: f, proof: PROOF, answers: ANSWERS, acceptedCloudflareTerms: true, release: RELEASE });
  assert.deepEqual(r.claimProbes, { status: 'set' });
  const last = calls[calls.length - 1];
  assert.match(last.u, /\/d1\/database\/d\/query$/);
  const sql = JSON.parse(last.body).sql;
  assert.equal(sql, claimProbeSql(r.url));
  assert.match(sql, /closing_probe = 'http:https:\/\/tool-library\.sub\.workers\.dev\/health'/);
  assert.ok(!last.body.includes(CLAIM) && !last.body.includes(TOKEN));
  assert.ok(calls.length <= 12, 'inside the 12 outside calls a Worker invocation may make');
});

test('US-19-R11 the cards say in plain words what is already done and what staying means, and a database that runs the statement ends with both probes', () => {
  const sql = buildSeedSql(cleanIdea(ANSWERS), { orgName: 'Tool Library', slug: 'tool-library', now: '2026-11-26T00:00:00Z' });
  const db = makeDb();
  db.raw.exec(sql);
  const before = db.raw.prepare("SELECT id, closing_probe FROM gate_cards ORDER BY id").all().map(r => ({ ...r }));
  assert.deepEqual(before, [{ id: 'CLAIM', closing_probe: 'manual' }, { id: 'HEARTBEAT', closing_probe: 'manual' }]);
  const card = db.raw.prepare("SELECT what, default_in_effect, prepared_by_fleet FROM gate_cards WHERE id = 'HEARTBEAT'").get();
  assert.match(card.what, /every 5 minutes/);
  assert.match(card.prepared_by_fleet, /key is set/);
  assert.match(card.default_in_effect, /stops when the preview is deleted/);
  db.raw.exec(claimProbeSql('https://x.sub.workers.dev'));
  const after = db.raw.prepare("SELECT closing_probe FROM gate_cards").all().map(r => r.closing_probe);
  assert.deepEqual(after, ['http:https://x.sub.workers.dev/health', 'http:https://x.sub.workers.dev/health']);
});

test('US-19-R11 an unclaimed (challenged) preview keeps the cards open and a claimed one closes them, through the owner-step watcher', async () => {
  const db = makeDb([RUNNER_MIG]);
  db.raw.exec(buildSeedSql(cleanIdea(ANSWERS), { orgName: 'Tool Library', slug: 'tool-library', now: '2026-11-26T00:00:00Z' }));
  db.raw.exec(claimProbeSql('https://x.sub.workers.dev'));
  let status = 403; // Cloudflare's safety page answers automated clients until the account is claimed
  const ctx = { db, now: () => Date.parse('2026-11-26T10:00:00Z'), config: { probe_every_minutes: 1 }, env: {}, fetch: async u => { assert.equal(u, 'https://x.sub.workers.dev/health'); return { status }; } };
  const open = () => db.raw.prepare("SELECT COUNT(*) AS n FROM gate_cards WHERE status = 'open'").get().n;
  assert.equal(open(), 2);
  await watchOwnerSteps(ctx);
  assert.equal(open(), 2, 'a challenged preview closes nothing');
  status = 200;
  ctx.now = () => Date.parse('2026-11-26T10:05:00Z');
  const r = await watchOwnerSteps(ctx);
  assert.equal(r.closed, 2);
  assert.equal(open(), 0);
});

test('US-19-R11 if the probe statement is refused the preview is kept, the cards stay manual, and the result says why without a secret', async () => {
  const { f } = fake({ failQueryNo: 2 }); // the first query is the schema and records, the second is the probe statement
  const r = await provision({ fetch: f, proof: PROOF, answers: ANSWERS, acceptedCloudflareTerms: true, release: RELEASE });
  assert.match(r.url, /^https:\/\/tool-library\.sub\.workers\.dev$/);
  assert.equal(r.claimProbes.status, 'manual');
  assert.match(r.claimProbes.reason, /Cloudflare refused/);
  assert.ok(!r.claimProbes.reason.includes(TOKEN));
});
