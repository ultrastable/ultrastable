// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-09 ladder fixes: the floor guard finds a banned model written as plain text (R11); an exemption names the whole model id
// and an exempt-only run is not clean (R24); the exact cache and the exemplar bank are exact, and a stored
// answer is never served for a different number or a different input (L1, L5, R26).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as L from './index.js';
import { scan, enclosingToken, floorGuardRun, EXIT } from './floorguard.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { cacheKey, cachePut, cacheGet } from './cache.js';
import { recordExemplar, serve } from './exemplars.js';

const MIG = fileURLToPath(L.MIGRATIONS_DIR);
const NOW = Date.UTC(2026, 10, 26, 10, 0, 0);
const worker = (text, role) => ({ name: 'w', role, source: [{ path: 'a.js', text }], bundle: null });

test('US-09-R11: a banned model written as a plain string is a finding; only the list between the markers and a marked line are skipped', () => {
  const banned = [{ pattern: 'tiny-quantized-8b', reason: 'quantized' }];
  assert.equal(scan({ workers: [worker("const model = 'tiny-quantized-8b';")], banned }).findings.length, 1, 'the literal pattern in code is what the guard exists to find');
  const listed = "// floor-list:begin\nconst BANNED = ['tiny-quantized-8b'];\n// floor-list:end\nconst ok = 'vendor-large';";
  assert.equal(scan({ workers: [worker(listed)], banned }).findings.length, 0, 'the declaration between the markers is skipped');
  assert.equal(scan({ workers: [worker("const m = 'tiny-quantized-8b'; // floor-ok: kept for the audit trail")], banned }).findings.length, 0, 'a marked line is skipped');
  assert.equal(scan({ workers: [worker("const BANNED = [{ pattern: 'tiny-quantized-8b' }];")], banned }).findings.length, 1, 'a declaration outside the markers is not special');
});

test('US-09-R24: an exemption row naming the whole model id covers the finding for its role and never for a reader-facing role', () => {
  const banned = [{ pattern: '-(mini|nano|fast)\\b', reason: 'small or quantized fast variant' }];
  const ex = [{ kind: 'floor', model: 'vendor-mini', role: 'doer', evidence: 'passes the deterministic checks and an independent review', expires_at: null }];
  const r = scan({ workers: [worker("const m = 'vendor-mini';", 'doer')], banned, exemptions: ex, nowIso: '2026-11-26 10:00:00' });
  assert.deepEqual([r.findings.length, r.exempt.length, r.exempt[0].model, r.exempt[0].match], [0, 1, 'vendor-mini', '-mini']);
  assert.equal(scan({ workers: [worker("const m = 'vendor-mini';", 'reader-facing')], banned, exemptions: [{ ...ex[0], role: '*' }], nowIso: '2026-11-26 10:00:00' }).findings.length, 1, 'a reader-facing role is never exempt');
  assert.equal(scan({ workers: [worker("const m = 'other-mini';", 'doer')], banned, exemptions: ex, nowIso: '2026-11-26 10:00:00' }).findings.length, 1, 'an exemption for one model does not cover another');
  assert.equal(scan({ workers: [worker("const m = 'vendor-mini';", 'doer')], banned, exemptions: [{ ...ex[0], expires_at: '2026-11-01 00:00:00' }], nowIso: '2026-11-26 10:00:00' }).findings.length, 1, 'an expired exemption covers nothing');
  assert.equal(enclosingToken("x = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';", 38, 5), '@cf/meta/llama-3.3-70b-instruct-fp8-fast');
});

test('US-09 L1: two different prompts of equal length and equal 32-bit hash do not share an exact entry', async () => {
  const db = makeDb([MIG]), ctx = { db, now: () => NOW };
  const a = 'x00000wl8', b = 'x0000xqd6'; // equal length and equal FNV-1a 32-bit hash: the old key
  await cachePut(ctx, { task_class: 'faq', input: a, value: 'ANSWER-FOR-A' });
  assert.notEqual(await cacheKey(a), await cacheKey(b));
  assert.equal((await cacheGet(ctx, { task_class: 'faq', input: b })).hit, null, 'a different prompt is a miss');
  assert.equal((await cacheGet(ctx, { task_class: 'faq', input: a })).value, 'ANSWER-FOR-A');
  assert.match(await cacheKey(a), /^[0-9a-f]{64}$/);
});

test('US-09 L5: a stored answer is never served for a different number, and lexical similarity alone serves nothing', async () => {
  const db = makeDb([MIG]), ctx = { db, now: () => NOW };
  await recordExemplar(ctx, { task_class: 'refund', input: 'Approve the refund for order 42 today', output: 'APPROVED-42', verified: true });
  assert.equal((await serve(ctx, { task_id: 'S0', task_class: 'refund', input: 'Approve the refund for order 43 today' })).reason, 'lexical_needs_validate', 'no embedder and no validate: lexical similarity is few-shot material only');
  const yes = () => true;
  assert.equal((await serve(ctx, { task_id: 'S1', task_class: 'refund', input: 'Approve the refund for order 43 today', validate: yes })).served, false, 'order 43 is not order 42');
  assert.equal((await serve(ctx, { task_id: 'S2', task_class: 'refund', input: 'Approve the refund for order 9 today', validate: yes })).reason, 'below_threshold', 'every token counts, the short ones included');
  const same = await serve(ctx, { task_id: 'S3', task_class: 'refund', input: 'Approve the refund for order 42 today', validate: yes });
  assert.deepEqual([same.served, same.output], [true, 'APPROVED-42']);
  const embed = async texts => texts.map(() => [1, 0]); // an embedder that cannot tell the two apart
  const e = { ...ctx, embed };
  await recordExemplar(e, { task_class: 'refund2', input: 'refund order 42', output: 'A42', verified: true });
  assert.equal((await serve(e, { task_id: 'S4', task_class: 'refund2', input: 'refund order 43' })).reason, 'numbers_differ', 'the number guard holds with an embedder too');
});

test('US-09-R26 an entry whose source changed is a miss and is removed; with the same source an identical call is a hit with no model call', async () => {
  const db = makeDb([MIG]), ctx = { db, now: () => NOW };
  await cachePut(ctx, { task_class: 'faq', input: 'what is the limit', value: 'ten', source_hash: 'v1', cost: 0.02 });
  const hit = await cacheGet(ctx, { task_class: 'faq', input: 'what is the limit', source_hash: 'v1' });
  assert.deepEqual([hit.hit, hit.value, hit.saved_cost], ['exact', 'ten', 0.02]);
  assert.equal((await cacheGet(ctx, { task_class: 'faq', input: 'what is the limit', source_hash: 'v2' })).hit, null, 'the source it was computed from changed');
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM ladder_cache`).get().n, 0);
  assert.equal(db.raw.prepare(`SELECT COUNT(*) AS n FROM ladder_cache_events WHERE kind='invalidated'`).get().n, 1);
});

test('US-09-R24: an exempt-only run files nothing, closes nothing and exits 3, so it never passes as clean', async () => {
  const db = makeDb([MIG]); await L.setFloor(db, [{ pattern: '-fp8-fast\\b', reason: 'quantized fast variant' }]);
  const exec = { name: 'executor', role: 'doer', source: [{ path: 'ladder.js', text: "const AUTHOR = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';" }], bundle: null };
  const one = sql => db.raw.prepare(sql).get();
  const before = await floorGuardRun({ db, now: () => NOW, listWorkers: async () => [exec] });
  assert.deepEqual([before.exit_code, before.meets_floor, one(`SELECT status FROM items WHERE id='FLOOR-executor'`).status], [EXIT.findings, false, 'ready']);
  db.raw.prepare(`INSERT INTO ladder_exemptions (kind, model, role, evidence, expires_at, registered_at) VALUES ('floor', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'doer', 'checks and a disjoint-family review gate its output', '2026-12-26 00:00:00', '2026-11-26 10:00:00')`).run();
  const r = await floorGuardRun({ db, now: () => NOW + 60000, listWorkers: async () => [exec] });
  assert.deepEqual([r.exit_code, r.meets_floor, r.findings.length, r.exempt.length, r.exempt_workers], [EXIT.exempt_only, false, 0, 1, ['executor']]);
  assert.notEqual(r.exit_code, 0, 'a closing probe that waits for exit 0 cannot pass through an exemption');
  const it = one(`SELECT status, disposition FROM items WHERE id='FLOOR-executor'`);
  assert.equal(it.status, 'ready', 'the item is not closed: the exempt model is still below the floor');
  assert.notEqual(it.disposition, 'scan finds no banned model pattern');
  const fresh = makeDb([MIG]); await L.setFloor(fresh, [{ pattern: '-fp8-fast\\b', reason: 'quantized fast variant' }]);
  fresh.raw.prepare(`INSERT INTO ladder_exemptions (kind, model, role, evidence, expires_at, registered_at) VALUES ('floor', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 'doer', 'checks and a review', NULL, '2026-11-26 10:00:00')`).run();
  const f = await floorGuardRun({ db: fresh, now: () => NOW, listWorkers: async () => [exec] });
  assert.deepEqual([f.exit_code, f.filed, fresh.raw.prepare(`SELECT COUNT(*) AS n FROM items`).get().n], [EXIT.exempt_only, [], 0], 'reported as exempt, not filed');
  const expired = await floorGuardRun({ db, now: () => Date.UTC(2026, 11, 27), listWorkers: async () => [exec] });
  assert.deepEqual([expired.exit_code, expired.exempt.length, expired.findings.length], [EXIT.findings, 0, 1], 'past its expiry the exemption covers nothing');
  const dir = mkdtempSync(path.join(tmpdir(), 'floor-r24-')), file = path.join(dir, 'in.json'), cli = fileURLToPath(new URL('./cli-floor-guard.js', import.meta.url));
  writeFileSync(file, JSON.stringify({ banned: [{ pattern: '-fp8-fast\\b', reason: 'quantized' }], workers: [exec], exemptions: [{ kind: 'floor', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', role: 'doer', evidence: 'checks and a review', expires_at: null }] }));
  const out = spawnSync(process.execPath, [cli, file], { encoding: 'utf8' });
  assert.equal(out.status, 3, 'the command line says exempt only, not clean');
  assert.match(out.stdout, /exempt, below the floor/);
});

test('US-09 L5: two different inputs of equal length and equal 32-bit hash keep two exemplars, and each is served its own answer', async () => {
  const db = makeDb([MIG]), embed = async texts => texts.map(t => (t === 'x00000wl8' ? [1, 0] : [0, 1])), ctx = { db, now: () => NOW, embed };
  const a = 'x00000wl8', b = 'x0000xqd6'; // the collision pair of the old key (FNV-1a 32-bit plus length)
  await recordExemplar(ctx, { task_class: 'faq', input: a, output: 'ANSWER-FOR-A', verified: true });
  await recordExemplar(ctx, { task_class: 'faq', input: b, output: 'ANSWER-FOR-B', verified: true });
  const rows = db.raw.prepare(`SELECT input, output, input_hash FROM ladder_exemplars ORDER BY input`).all().map(r => [r.input, r.output]);
  assert.deepEqual(rows, [[a, 'ANSWER-FOR-A'], [b, 'ANSWER-FOR-B']], 'one row per input');
  assert.match(db.raw.prepare(`SELECT input_hash FROM ladder_exemplars LIMIT 1`).get().input_hash, /^[0-9a-f]{64}$/);
  const sa = await serve(ctx, { task_id: 'C1', task_class: 'faq', input: a }), sb = await serve(ctx, { task_id: 'C2', task_class: 'faq', input: b });
  assert.deepEqual([sa.served, sa.output, sb.served, sb.output], [true, 'ANSWER-FOR-A', true, 'ANSWER-FOR-B']);
  await recordExemplar(ctx, { task_class: 'faq', input: a, output: 'ANSWER-FOR-A-2', verified: true });
  assert.deepEqual(db.raw.prepare(`SELECT input, output FROM ladder_exemplars WHERE output LIKE 'ANSWER-FOR-A%'`).all().map(r => [r.input, r.output]), [[a, 'ANSWER-FOR-A-2']], 'the same input updates its own row');
});
