// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-10-R12: a published statement about the organization is an assertion whose probe is re-checked every period; a failing or stale one is
// withdrawn from what is served and files an item like any failure mode. The mechanism is core/describe (US-SPEC-22); this file proves the
// requirement US-SPEC-10 states, so the conformance manifest attaches the evidence to R12. Fake fetch and readFile; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { makeDb } from '../_shared/testdb.js';
import { addClaims, runProbes, describeOnce, handle, publishableClaims, assertReadOnlySql, extractClaimIds } from '../describe/index.js';

const MIG = fileURLToPath(new URL('../describe/migrations/', import.meta.url));
const T0 = Date.parse('2026-11-26T10:00:00Z');
const H = 3600e3;
const SPEC = { BUILT: 12, RUNNING_ONLY: 2, PLANNED: 3, 'NOT COVERED': 1, total: 18, planned_names: ['a planned thing'] };
const row = (db, sql, ...a) => db.raw.prepare(sql).get(...a);

async function world(files = { 'SCOPE.md': '# Scope\nWhat it does not do by default\n' }) {
  const db = makeDb([MIG]);
  db.raw.exec(`INSERT INTO tick_runs (started_at, finished_at, steps_completed, steps_total) VALUES ('2026-11-26 09:00:00','2026-11-26 09:00:05',8,8)`);
  await addClaims(db, [
    { id: 'scope.file', text: 'The scope file states what the organization does not do.', probe: 'file:SCOPE.md', expect: 'contains:does not do', max_age_hours: 24 },
    { id: 'operation.tick', text: 'The heartbeat completed a tick this morning.', probe: "sql:SELECT COUNT(*) AS value FROM tick_runs WHERE steps_completed = steps_total", expect: '>=1', max_age_hours: 2 },
  ]);
  const ports = (o = {}) => ({ db, now: T0, readFile: async p => { if (p in files) return files[p]; throw new Error('ENOENT ' + p); }, specStatus: SPEC, fetch: async () => new Response('ok'), ...o });
  return { db, ports };
}

test('US-10-R12: a probe reads and never writes: only one SELECT is accepted as a sql probe', async () => {
  for (const bad of ['DELETE FROM items', 'SELECT 1; DROP TABLE items', 'UPDATE items SET status = 1', 'PRAGMA table_info(items)'])
    assert.throws(() => assertReadOnlySql(bad), undefined, bad);
  const { db, ports } = await world();
  await addClaims(db, [{ id: 'bad.write', text: 'x', probe: 'sql:DELETE FROM tick_runs', expect: '>=0' }]);
  await runProbes(ports());
  assert.equal(row(db, `SELECT last_result FROM describe_claims WHERE id='bad.write'`).last_result, 'unknown');
  assert.equal(row(db, `SELECT COUNT(*) AS n FROM tick_runs`).n, 1, 'the probe deleted nothing');
});

test('US-10-R12: a claim that stops being true is withdrawn from the next served output and files an item with an owner and a closing probe', async () => {
  const { db, ports } = await world();
  await describeOnce(ports());
  const served = async now => extractClaimIds(await (await handle(new Request('https://x.example/describe'), { db, now: now ?? T0 + 1000, specStatus: SPEC })).text());
  assert.ok((await served()).includes('scope.file'));
  const r = await describeOnce(ports({ now: T0 + H, readFile: async () => 'nothing relevant' }));
  assert.ok(r.probes.withdrawn.includes('scope.file'));
  assert.ok(!(await served(T0 + H + 1000)).includes('scope.file'), 'the failing claim is absent from the page served next');
  const item = row(db, `SELECT * FROM items WHERE id = 'DESCRIBE-scope.file'`);
  assert.equal(item.status, 'ready');
  assert.equal(item.owner_role, 'operations');
  assert.ok(item.done_check && item.closing_probe);
});

test('US-10-R12: a claim not re-checked within its freshness limit is not published, and viewing re-renders without it', async () => {
  const { db, ports } = await world();
  await describeOnce(ports());
  const view = now => handle(new Request('https://x.example/describe.json'), { db, now, specStatus: SPEC });
  assert.ok(JSON.parse(await (await view(T0 + 1000)).text()).claim_ids.includes('operation.tick'));
  assert.ok((await publishableClaims(db, T0 + 1000)).some(c => c.id === 'operation.tick'));
  const stale = T0 + 3 * H; // max_age_hours is 2 and nothing re-checked it
  assert.ok(!(await publishableClaims(db, stale)).some(c => c.id === 'operation.tick'));
  const ids = JSON.parse(await (await view(stale)).text()).claim_ids;
  assert.ok(!ids.includes('operation.tick'));
});

test('US-10-R12: a later pass in which the probe passes again reinstates the claim', async () => {
  const { db, ports } = await world();
  await describeOnce(ports());
  await runProbes(ports({ now: T0 + H, readFile: async () => 'gone' }));
  assert.equal(row(db, `SELECT withdrawn FROM describe_claims WHERE id='scope.file'`).withdrawn, 1);
  await runProbes(ports({ now: T0 + 2 * H }));
  assert.equal(row(db, `SELECT withdrawn FROM describe_claims WHERE id='scope.file'`).withdrawn, 0);
});
