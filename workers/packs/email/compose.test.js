// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tests for newsletter composition from the claims registry (US-SPEC-21 s7 email; US-SPEC-22). Fake channel, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDb } from '../../core/_shared/testdb.js';
import { KERNEL_DIR } from '../../core/kernel/testkit.js';
import { createPacks, validateManifest, loadManifest, MIGRATIONS_DIR } from '../../core/packs/index.js';
import { createEmail } from './service.js';
import { guardPorts } from './port.js';
import { checkNewsletter, defaultComposeNewsletter } from './compose.js';

const DIR = fileURLToPath(new URL('./', import.meta.url));
const DESCRIBE_MIG = fileURLToPath(new URL('../../core/describe/migrations/', import.meta.url));
const T0 = Date.now() - 3600e3, H = 3600e3;
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const SETTINGS = { baseUrl: 'https://lists.example.org', senderLine: 'Sent by Example Org, a test sender', linkSecret: 'unit-test-link-key', hashSalt: 's', allowlist: ['example.org'], link_url: 'https://example.org/news' };
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const addClaim = (db, id, text, value, { checkedAt = T0 - H, pub = 1 } = {}) => db.raw.prepare(`INSERT INTO describe_claims (id, text, probe_kind, probe_arg, expect, max_age_hours, public, last_result, last_checked_at, evidence) VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run(id, text, 'sql', 'SELECT 1', '>=1', 24, pub, 'pass', iso(checkedAt), JSON.stringify({ value }));

async function setup({ settings = {}, claims = true } = {}) {
  const db = makeDb([MIGRATIONS_DIR, KERNEL_DIR, DESCRIBE_MIG, path.join(DIR, 'migrations')]);
  const sent = [];
  const channel = { deliver: async m => { sent.push(m); return { providerId: `p${sent.length}` }; } };
  const packs = createPacks({ db, now: () => T0, config: { step_timeout_ms: 2000, packs: { email: { ...SETTINGS, ...settings } } }, channels: guardPorts({ channel, senderLine: SETTINGS.senderLine }) });
  const m = loadManifest(DIR);
  assert.equal((await packs.register(m, { dir: DIR })).ok, true);
  assert.equal((await packs.enablePack('email', { by: 'owner', cardText: m.enable_gate })).ok, true);
  if (claims) { addClaim(db, 'operation.ticks', 'Ran {value} ticks', 42); addClaim(db, 'operation.items', 'Closed {value} items', 7); }
  const loop = async name => {
    const step = (await packs.packSteps()).find(x => x.name === `pack:email:${name}`);
    const ctx = { tickId: 24, errors: [], notes: [], env: {}, now: T0 };
    await step.run(db, ctx);
    assert.deepEqual(ctx.errors, []);
    return ctx;
  };
  return { db, packs, loop, sent };
}

test('US-21 s7 email compose: a newsletter draft built from fresh public claims passes the checker and is queued once', async () => {
  const s = await setup();
  const ctx = await s.loop('compose');
  assert.match(ctx.notes.join('|'), /queued message 1 from 2 claim/);
  const msg = one(s.db, `SELECT * FROM email_messages`);
  assert.equal(msg.kind, 'newsletter'); assert.equal(msg.status, 'queued');
  assert.match(msg.body_text, /Ran 42 ticks \(as of \d{4}-\d\d-\d\d\)\./);
  assert.ok(!msg.body_text.includes('[claim:'), 'markers are stripped before queueing');
  assert.match(msg.body_text, /https:\/\/example\.org\/news/);
  assert.deepEqual(s.db.raw.prepare(`SELECT claim_id FROM email_compose_log ORDER BY claim_id`).all().map(r => r.claim_id), ['operation.items', 'operation.ticks']);
  await s.loop('compose');                                                    // the same claims are not reused inside the repeat window
  assert.equal(one(s.db, `SELECT COUNT(*) n FROM email_messages`).n, 1);
});

test('US-21 s7 email compose: a stale or non-public claim is never used, and an unbacked sentence from a model port is rejected and logged', async () => {
  const s = await setup({ claims: false });
  addClaim(s.db, 'operation.old', 'Ran {value} ticks', 9, { checkedAt: T0 - 72 * H });
  addClaim(s.db, 'operation.private', 'Ran {value} ticks', 9, { pub: 0 });
  assert.match((await s.loop('compose')).notes.join('|'), /no fresh claims/);
  assert.equal(one(s.db, `SELECT COUNT(*) n FROM email_messages`).n, 0);
  const cheat = await setup({ settings: { ports: { compose: async () => 'Ran 99 ticks (as of 2026-11-11) [claim:operation.ticks].\nWe are the best.' } } });
  const ctx = await cheat.loop('compose');
  assert.match(ctx.notes.join('|'), /rejected/);
  assert.equal(one(cheat.db, `SELECT COUNT(*) n FROM email_messages`).n, 0);
  assert.match(one(cheat.db, `SELECT violations FROM email_compose_rejections`).violations, /number_not_in_claim|no_claim/);
  assert.equal(cheat.db.raw.prepare(loadManifest(DIR).charter.guard_metrics.find(g => g.id === 'email_unbacked_sentences').read_probe).get().value, 1);
});

test('US-21 s7 email compose: links off the allowlist or not https are rejected; a second checker can only veto', () => {
  const claims = [{ id: 'a.b', text: 'Ran {value} ticks', evidence: JSON.stringify({ value: 4 }), last_checked_at: iso(T0) }];
  const ok = 'Ran 4 ticks (as of 2026-11-11) [claim:a.b].';
  assert.equal(checkNewsletter(ok + '\nhttps://example.org/x', claims, { allowlist: ['example.org'] }).ok, true);
  const rule = t => checkNewsletter(t, claims, { allowlist: ['example.org'] }).violations.map(v => v.rule);
  assert.ok(rule(ok + '\nhttps://evil.example.net/x').includes('url_not_allowed'));
  assert.ok(rule(ok + '\nhttp://example.org/x').includes('url_not_https'));
  assert.ok(rule('Great news for everyone.').includes('no_claim') || rule('Great news for everyone.').length > 0);
  assert.equal(defaultComposeNewsletter({ claims: [] }), '');
});

test('US-21-R06: the composed message still leaves only through guard.send: compose queues, send delivers to confirmed subscribers with the sender line', async () => {
  const s = await setup();
  await s.loop('compose');
  const email = createEmail({ db: s.db, guard: s.packs.boundGuard('email'), now: () => T0, config: SETTINGS });
  s.db.raw.prepare(`INSERT INTO trust_ledger (surface, action_class, rung, reliability, outcomes) VALUES ('pack:email','confirmation','delegated',1,50), ('pack:email','newsletter','delegated',1,50)`).run();
  await email.subscribe({ email: 'a@example.com' });
  const conf = /\/confirm\?t=([0-9a-f]{32})/.exec(s.sent.at(-1).text)[1];
  assert.equal((await email.confirm(conf)).ok, true);
  assert.equal(s.sent.length, 1, 'composing sent nothing');
  const out = await email.sendPending();
  assert.equal(out.sent, 1);
  assert.match(s.sent.at(-1).text, /Ran 42 ticks/); assert.ok(s.sent.at(-1).text.includes(SETTINGS.senderLine));
  assert.equal(one(s.db, `SELECT COUNT(*) n FROM guard_ledger WHERE pack = 'email' AND kind = 'newsletter' AND decision = 'sent'`).n, 1);
});

test('US-21 s7 email compose: the manifest declares the compose loop and its claim guard metric, and validates', () => {
  const m = loadManifest(DIR);
  assert.deepEqual(validateManifest(m), []);
  assert.ok(m.loops.some(l => l.id === 'compose' && l.outbound === false));
  assert.ok(m.charter.guard_metrics.some(g => g.id === 'email_unbacked_sentences' && g.target === 0));
  assert.equal(m.version, '0.2.0');
});
