// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-14-T01, R11 and R14 against a live Postgres: the L1 tick over the shim ends in the same state as over SQLite, twenty-five concurrent
// claimers produce one claim, and a dropped connection is retried once. The server is TEST_DATABASE_URL when it is set (CI runs a postgres
// service container; the tests work in their own schema and never touch another), else a private cluster started from the server binaries
// on this machine (adapters/postgres/psql-client.js), else every test is skipped and says so on stderr. No driver is imported: the client is psql.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { translateMigration, createPgStore } from './index.js';
import { psqlClient, startThrowawayCluster } from './psql-client.js';
import { runTick, STEP_ORDER } from '../../core/src/tick.js';
import { makeDb } from '../../core/test/d1shim.js';

const MIG = fileURLToPath(new URL('../../core/migrations/', import.meta.url));
const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 't', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.UTC(2026, 10, 10);                       // the tick is given this instant; nothing here reads a window relative to the real clock

let cluster = null; let where = null; let reason = null;
try {
  if (process.env.TEST_DATABASE_URL) where = { url: process.env.TEST_DATABASE_URL };
  else { cluster = startThrowawayCluster(); if (cluster) where = { host: cluster.host, user: cluster.user, database: cluster.database }; else reason = 'no TEST_DATABASE_URL and no Postgres server binaries on this machine'; }
} catch (e) { reason = `a private Postgres cluster could not be started: ${e.message}`; }
after(() => { cluster?.stop(); });
if (reason) process.stderr.write(`SKIP adapters/postgres/live.test.js: ${reason}\n`);

let n = 0;
/** A client working in its own freshly created schema, with the core migrations applied through the shim. */
async function fresh() {
  const schema = `us_live_${process.pid}_${++n}`;
  const admin = psqlClient(where);
  await admin.script(`DROP SCHEMA IF EXISTS ${schema} CASCADE; CREATE SCHEMA ${schema};`);
  const env = { PGOPTIONS: `-c search_path=${schema}` };
  const client = psqlClient({ ...where, env });
  const second = psqlClient({ ...where, env });
  const serialTables = new Set(); const keys = new Map();
  const sql = readdirSync(MIG).filter(f => f.endsWith('.sql')).sort().flatMap(f => translateMigration(readFileSync(path.join(MIG, f), 'utf8'), { serialTables, keys }));
  await client.script(sql.join(';\n') + ';');
  return { client, second, serialTables, keys, drop: () => admin.script(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`) };
}
const seedSql = `INSERT INTO roles (id, role, tick_every, model) VALUES ('staff-1','staff',1,'m'), ('op-1','operations',1,'m');
  INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('A','a','staff','x',10,'open'), ('B','b','staff','x',20,'open');
  INSERT INTO items (id,title,owner_role,done_check,trigger_on,status) VALUES ('C','c','staff','x','A','open');`;
const STATE = [
  `SELECT id, status, disposition, blocker FROM items ORDER BY id`,
  `SELECT item_id, agent FROM claims ORDER BY item_id`,
  `SELECT role_id, item_id, status FROM dispatches ORDER BY id`,
  `SELECT steps_completed, steps_total FROM tick_runs ORDER BY id`,
  `SELECT surface, action_class, result FROM outcomes ORDER BY id`,
];
const read = async db => { const out = []; for (const q of STATE) out.push((await db.prepare(q).bind().all()).results); return JSON.parse(JSON.stringify(out)); };

test('US-14-T01: the L1 tick over a live Postgres ends in the same state as over SQLite', async t => {
  if (reason) return t.skip(reason);
  const pg = await fresh();
  try {
    const pgdb = createPgStore(pg.client, { serialTables: pg.serialTables, keys: pg.keys });
    const lite = makeDb();
    await pg.client.script(seedSql); lite.raw.exec(seedSql);
    for (const at of [T0, T0 + 3 * 3600e3, T0 + 3 * 3600e3 + 60e3]) {          // the second tick finds the first claim stale and releases it
      const a = await runTick(lite, { config, now: at });
      const b = await runTick(pgdb, { config, now: at });
      assert.deepEqual([b.completed, b.total, b.errors], [a.completed, a.total, a.errors], 'the same steps complete');
      assert.equal(b.completed, STEP_ORDER.length);
    }
    assert.deepEqual(await read(pgdb), await read(lite));
    const dispatches = (await read(pgdb))[2];
    assert.ok(dispatches.length >= 2, 'the stale claim was released and the item dispatched again');
  } finally { await pg.drop(); }
});

test('US-14-R11: twenty-five concurrent claimers over two connections produce exactly one claim', async t => {
  if (reason) return t.skip(reason);
  const pg = await fresh();
  try {
    await pg.client.script(seedSql);
    const stores = [createPgStore(pg.client, { serialTables: pg.serialTables, keys: pg.keys }), createPgStore(pg.second, { serialTables: pg.serialTables, keys: pg.keys })];
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => stores[i % 2]
      .prepare(`INSERT OR IGNORE INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES (?, ?, ?, ?)`).bind('A', `agent-${i}`, '2026-11-10 00:00:00', '2026-11-10 00:00:00').run()));
    assert.equal(results.filter(r => r.meta.changes === 1).length, 1, 'one winner');
    assert.equal(results.filter(r => r.meta.changes === 0).length, 24, 'every other claimer is refused without an error');
    const rows = (await stores[0].prepare(`SELECT agent FROM claims WHERE item_id=?`).bind('A').all()).results;
    assert.equal(rows.length, 1);
  } finally { await pg.drop(); }
});

test('US-14-R14: INSERT OR REPLACE with a primary key learned from the migration upserts on a live Postgres', async t => {
  if (reason) return t.skip(reason);
  const pg = await fresh();
  try {
    await pg.client.script(seedSql);
    const store = createPgStore(pg.client, { serialTables: pg.serialTables, keys: pg.keys });
    const put = (agent, at) => store.prepare(`INSERT OR REPLACE INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES (?,?,?,?)`).bind('A', agent, at, at).run();
    await put('one', '2026-11-10 00:00:00'); await put('two', '2026-11-10 01:00:00');
    const rows = (await store.prepare(`SELECT agent, heartbeat_at FROM claims WHERE item_id=?`).bind('A').all()).results;
    assert.deepEqual(rows, [{ agent: 'two', heartbeat_at: '2026-11-10 01:00:00' }]);
    assert.equal((await store.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind('claims').first())?.name, 'claims');
    assert.equal((await store.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).bind('no_such_table').first()), null);
  } finally { await pg.drop(); }
});

test('US-14-R14: a connection killed under a running query is retried once through the reconnect hook and the query still answers', async t => {
  if (reason) return t.skip(reason);
  const pg = await fresh();
  try {
    let reconnects = 0;
    const store = createPgStore(pg.client, { reconnect: async () => { reconnects++; } });
    const running = store.prepare(`SELECT pg_sleep(3), 7 AS n`).bind().first();
    await new Promise(r => setTimeout(r, 800));
    const killer = psqlClient(where);
    await killer.query(`SELECT pg_terminate_backend(pid) AS killed FROM pg_stat_activity WHERE query LIKE '%pg_sleep%' AND pid <> pg_backend_pid()`);
    const row = await running;
    assert.equal(row.n, 7); assert.equal(reconnects, 1);
  } finally { await pg.drop(); }
});
