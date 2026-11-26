// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-07-R23 (the recognition scan over declared sources) and US-07-R24 (the daily goal cycle that gathers signals).
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import * as G from './index.js';
import * as Trust from '../trust/index.js';

const MIG = fileURLToPath(G.MIGRATIONS_DIR);
const TRUST_MIG = fileURLToPath(Trust.MIGRATIONS_DIR);
const NOW = Date.UTC(2026, 10, 11, 10, 0, 0);
const DAY = 86400e3;
async function mk() { const db = makeDb([MIG, TRUST_MIG]); await G.seedRegister(db, { now: NOW - 30 * DAY }); return db; }
const one = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const T01 = "The timeout is fixed. Let me know if you'd like me to open the pull request?";
const CLEAN = 'The timeout is fixed and the pull request PR-42 is open.';

test('US-07-R23: a draft from a declared source is scanned once across two passes, and a clean draft is scanned too', async () => {
  const db = await mk();
  let reads = 0;
  const comments = { name: 'item-comments', read: async () => { reads++; return [{ ref: 'c1', draft: T01 }, { ref: 'c2', draft: CLEAN }]; } };
  const first1 = await G.scanSources(db, { sources: [comments], now: NOW });
  assert.equal(first1.scanned, 2);
  assert.ok(first1.hits >= 1, 'the conditional offer is recognized with no model');
  const second = await G.scanSources(db, { sources: [comments], now: NOW + 3600e3 });
  assert.equal(second.scanned, 0);
  assert.equal(second.skipped, 2, 'the same (source, ref) is not scanned again');
  assert.equal(reads, 2);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM governance_scans`).n, 2);
  assert.equal(one(db, `SELECT COUNT(*) AS n FROM governance_scan_cursor`).n, 2);
});

test('US-07-R23: a source that throws is reported and the other sources still run; the same ref in two sources is scanned once each', async () => {
  const db = await mk();
  const bad = { name: 'console', read: async () => { throw new Error('console down'); } };
  const a = { name: 'pr-bodies', read: async () => [{ ref: 'pr-1', draft: T01 }] };
  const b = { name: 'runner-summaries', read: async () => [{ ref: 'pr-1', draft: T01 }, { ref: 'x', text: 'no draft field' }] };
  const r = await G.scanSources(db, { sources: [bad, a, b], now: NOW });
  assert.equal(r.scanned, 2);
  assert.deepEqual(r.errors.map(e => e.source), ['console', 'runner-summaries']);
  assert.match(r.errors[0].error, /console down/);
  assert.match(r.errors[1].error, /ref and a draft text/);
});

test('US-07-R23: the limit truncates openly: a draft past the limit is listed, not marked scanned, and the next pass takes it', async () => {
  const db = await mk();
  const src = { name: 's', read: async () => [{ ref: 'a', draft: CLEAN }, { ref: 'b', draft: CLEAN }, { ref: 'c', draft: CLEAN }] };
  const r1 = await G.scanSources(db, { sources: [src], now: NOW, limit: 2 });
  assert.equal(r1.scanned, 2);
  assert.deepEqual(r1.truncated, ['s:c']);
  const r2 = await G.scanSources(db, { sources: [src], now: NOW + 1000, limit: 2 });
  assert.equal(r2.scanned, 1);
  assert.equal(r2.skipped, 2);
});

test('US-07-R23: step() runs the scan when sources are declared and reports it', async () => {
  const db = await mk();
  const out = await G.step({ db, now: NOW, sources: [{ name: 'item-comments', read: async () => [{ ref: 'c1', draft: T01 }] }] });
  assert.equal(out.scan.scanned, 1);
  const none = await G.step({ db, now: NOW + 1000 });
  assert.equal(none.scan, undefined, 'no declared source, no scan');
});

test('US-07-R24: a metric in breach becomes a candidate with a definition of done and goes through the existing score and similarity rules', async () => {
  const db = await mk();
  await G.ratifyObjective(db, { id: 'O1', text: 'Keep the checkout service reliable and fast', by: 'principal' }, { now: NOW });
  const signals = [{ name: 'metrics', read: async () => [
    { key: 'checkout-error-rate', text: 'Bring the checkout service error rate back under one percent', probe: 'SELECT 1', severity: 0.9, alignment: 'Fewer errors serve the reliable checkout objective.' },
    { key: 'vague', text: 'Something feels off', severity: 0.1 },
  ] }];
  const r = await G.goalCycle(db, { now: NOW, signals });
  assert.equal(r.signals, 2);
  assert.equal(r.candidates, 2);
  const adopted = r.adopted.find(a => a.id.startsWith('SIG-checkout-error-rate-'));
  assert.ok(adopted, 'the probe-backed, high-severity signal is adopted');
  assert.equal(one(db, `SELECT definition_of_done AS d, done_probe AS p FROM governance_goals WHERE id = ?`, adopted.id).p, 'SELECT 1');
  const vague = r.rejected.find(x => x.id.startsWith('SIG-vague-'));
  assert.ok(vague && /below/.test(vague.reason), 'a low-severity signal with no probe scores under the threshold (falsifiability 0.5, leverage 0.1)');
});

test('US-07-R24: a reworded duplicate of a goal adopted in the last 30 days is rejected by containment, and a signal is idempotent within the day', async () => {
  const db = await mk();
  await G.ratifyObjective(db, { id: 'O1', text: 'Keep the checkout service reliable and fast', by: 'principal' }, { now: NOW });
  const sig = { key: 'latency', text: 'Cut checkout service p95 latency below 300 ms', probe: 'SELECT 1', severity: 0.9, alignment: 'Speed serves the reliable and fast objective.' };
  const src = [{ name: 'metrics', read: async () => [sig] }];
  const r1 = await G.goalCycle(db, { now: NOW, signals: src });
  assert.equal(r1.adopted.length, 1);
  const again = await G.goalCycle(db, { now: NOW + 3600e3, signals: src });
  assert.equal(again.candidates, 0, 'same key, same day: no second candidate');
  const reworded = [{ name: 'probes', read: async () => [{ ...sig, key: 'latency-b', text: 'Cut p95 latency of the checkout service below 300 ms soon' }] }];
  const r3 = await G.goalCycle(db, { now: NOW + DAY, signals: reworded });
  assert.equal(r3.adopted.length, 0);
  assert.match(r3.rejected[0].reason, /near-duplicate of SIG-latency-/);
});

test('US-07-R24: a failing signal source or synthesizer is reported and the rest still run; the optional synthesizer adds candidates', async () => {
  const db = await mk();
  const signals = [{ name: 'broken', read: async () => { throw new Error('probe failed'); } }, { name: 'ok', read: async () => [{ key: 'k', text: 'Reduce the tick error count to zero', probe: 'SELECT 1', severity: 0.9 }] }];
  const r = await G.goalCycle(db, { now: NOW, signals, synthesize: async ({ signals: s }) => { assert.equal(s.length, 1); return [{ id: 'SYN-1', text: 'Publish a weekly digest of closed items', definition_of_done: 'digest exists', falsifiability: 0.9, leverage: 0.8, novelty: 0.9 }]; } });
  assert.deepEqual(r.errors.map(e => e.source), ['broken']);
  assert.equal(r.candidates, 2);
  assert.ok(r.adopted.some(a => a.id === 'SYN-1'));
  const r2 = await G.goalCycle(db, { now: NOW + DAY, signals: [], synthesize: async () => { throw new Error('model down'); } });
  assert.deepEqual(r2.errors.map(e => e.source), ['synthesize']);
});
