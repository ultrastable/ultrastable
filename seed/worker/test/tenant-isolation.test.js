// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// Q-TENANT-row-isolation (TENANT-1): rows of another tenant (tenant_id = 'other-tenant') in items, claims, gate_cards and trust_ledger are never selected,
// claimed, advanced, closed, released or counted by a tick of org 'ultrastable'; rows with tenant_id NULL (own) are, and so are rows carrying the org's own slug.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { runTick, METRICS, ensureItem } from '../src/tick.js';
import { pickForRole } from '../src/critloop.js';
import { migrateStep } from '../src/migrate.js';
import { runHandoffs } from '../src/handoff.js';
import { runDbQueue } from '../src/nativeexec.js';
import { tenantOf, OWN_SQL } from '../src/tenant.js';
import { openDb } from '../../../platform/adapters/sqlite/d1-sqlite.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const policy = JSON.parse(readFileSync(new URL('../../autonomy/policy.json', import.meta.url), 'utf8'));
const config = { org_slug: 'ultrastable', claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, policy };
const T0 = Date.parse('2026-11-10T00:00:00Z');
const FOREIGN = 'other-tenant';
const get = (db, sql, ...a) => db.raw.prepare(sql).get(...a);
const rows = (db, sql, ...a) => db.raw.prepare(sql).all(...a);

test('migration 0026 adds tenant_id to items, claims, gate_cards and trust_ledger and every existing row stays own (NULL)', () => {
  const db = makeDb();
  for (const t of ['items', 'claims', 'gate_cards', 'trust_ledger']) assert.ok(rows(db, `PRAGMA table_info(${t})`).some(c => c.name === 'tenant_id'), `${t}.tenant_id`);
  db.raw.exec("INSERT INTO items (id,title,owner_role,done_check) VALUES ('X','x','staff','x')");
  assert.equal(get(db, "SELECT tenant_id FROM items WHERE id='X'").tenant_id, null);
  const idx = JSON.parse(readFileSync(new URL('../migrations/index.json', import.meta.url), 'utf8'));
  assert.ok(idx.includes('0026_tenant_core.sql'));
});

test('the migration runner tolerates a column that is already there and still fails any other error', async () => {
  const db = makeDb();  // makeDb already ran every file, so 0026 meets existing columns
  const sql = readFileSync(new URL('../migrations/0026_tenant_core.sql', import.meta.url), 'utf8');
  const ctx = { notes: [] };
  const r = await migrateStep(db, ctx, [{ file: '0026_tenant_core.sql', sql }], ensureItem);
  assert.deepEqual(r.failed, [], ctx.notes.join('; '));
  assert.deepEqual(r.applied, ['0026_tenant_core.sql']);
  const bad = await migrateStep(db, { notes: [] }, [{ file: '9999_bad.sql', sql: 'ALTER TABLE items ADD COLUMN' }], ensureItem);
  assert.deepEqual(bad.failed, ['9999_bad.sql']);
});

test('tenantOf and OWN_SQL: ctx, env and slug forms; never undefined', () => {
  assert.equal(tenantOf({ config: { org_slug: 'ultrastable' } }), 'ultrastable');
  assert.equal(tenantOf({ TENANT: 't1' }), 't1');
  assert.equal(tenantOf('s'), 's');
  assert.equal(tenantOf(undefined), '');
  assert.equal(OWN_SQL('i.tenant_id'), '(i.tenant_id IS NULL OR i.tenant_id = ?)');
});

test('reconcile: another tenant\'s items are not made ready and its silent drops are not reopened or counted; own rows are', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status,tenant_id) VALUES
      ('F-open','f','nobody','x','open','${FOREIGN}'), ('F-drop','f','nobody','x','done','${FOREIGN}'),
      ('O-open','o','nobody','x','open',NULL), ('O-drop','o','nobody','x','done',NULL), ('S-open','s','nobody','x','open','ultrastable');`);
  await runTick(db, { config, now: T0 });
  assert.equal(get(db, "SELECT status FROM items WHERE id='F-open'").status, 'open', 'foreign open item not advanced');
  assert.equal(get(db, "SELECT status FROM items WHERE id='F-drop'").status, 'done', 'foreign silent drop not reopened');
  assert.notEqual(get(db, "SELECT status FROM items WHERE id='O-open'").status, 'open', 'own item advanced');
  assert.notEqual(get(db, "SELECT status FROM items WHERE id='O-drop'").status, 'done', 'own silent drop reopened');
  assert.notEqual(get(db, "SELECT status FROM items WHERE id='S-open'").status, 'open', 'a row carrying the org slug is own');
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM outcomes WHERE result='silent_drop'").n, 1, 'only the own drop is counted');
});

test('reap_claims: a stale claim of another tenant is neither released nor deleted; an own one is', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status,tenant_id) VALUES ('F','f','zz','x','claimed','${FOREIGN}'), ('O','o','zz','x','claimed',NULL);
    INSERT INTO claims (item_id,agent,claimed_at,heartbeat_at,tenant_id) VALUES ('F','zz-1','2026-11-01 00:00:00','2026-11-01 00:00:00','${FOREIGN}'), ('O','zz-1','2026-11-01 00:00:00','2026-11-01 00:00:00',NULL);`);
  await runTick(db, { config, now: T0 });
  assert.ok(get(db, "SELECT item_id FROM claims WHERE item_id='F'"), 'foreign claim kept');
  assert.equal(get(db, "SELECT status FROM items WHERE id='F'").status, 'claimed', 'foreign item stays claimed');
  assert.equal(get(db, "SELECT item_id FROM claims WHERE item_id='O'"), undefined, 'own claim released');
});

test('probe_gates: a card of another tenant is not closed by this runtime\'s probe and is not counted open; an own card is closed', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe,tenant_id) VALUES
    ('G-F','f','w','d','env:KEY','${FOREIGN}'), ('G-O','o','w','d','env:KEY',NULL), ('G-F2','f','w','d','manual','${FOREIGN}');`);
  const r = await runTick(db, { config, now: T0, env: { KEY: true } });
  assert.equal(get(db, "SELECT status FROM gate_cards WHERE id='G-F'").status, 'open', 'foreign card not closed');
  assert.equal(get(db, "SELECT status FROM gate_cards WHERE id='G-O'").status, 'closed', 'own card closed');
  assert.match(r.report, /Open: \d+ active item\(s\), 0 gate card\(s\)/, 'foreign open cards are not this runtime\'s');
  assert.equal(await METRICS.open_gate_cards(db, T0, 'ultrastable'), 0);
  assert.equal(await METRICS.open_gate_cards(db, T0, FOREIGN), 2);
});

test('dispatch: a foreign ready item is never picked or claimed, and foreign claims do not use up this role\'s WIP; own work is dispatched', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO roles (id, role, tick_every, model) VALUES ('op-1','operations',1,'m');
    INSERT INTO items (id,title,owner_role,done_check,priority,status,tenant_id) VALUES
      ('F-1','f','operations','x',0,'ready','${FOREIGN}'), ('F-2','f','operations','x',0,'claimed','${FOREIGN}'), ('F-3','f','operations','x',0,'claimed','${FOREIGN}'),
      ('F-4','f','operations','x',0,'claimed','${FOREIGN}'), ('O-1','o','operations','x',50,'ready',NULL);
    INSERT INTO claims (item_id,agent,tenant_id) VALUES ('F-2','op-1','${FOREIGN}'), ('F-3','op-1','${FOREIGN}'), ('F-4','op-1','${FOREIGN}');`);
  await runTick(db, { config, now: T0 });
  assert.equal(get(db, "SELECT item_id FROM claims WHERE item_id='F-1'"), undefined, 'foreign ready item not claimed');
  assert.equal(get(db, "SELECT status FROM items WHERE id='F-1'").status, 'ready');
  assert.ok(get(db, "SELECT item_id FROM claims WHERE item_id='O-1'"), 'own item claimed although three foreign claims name the same agent');
  assert.equal(get(db, "SELECT tenant_id FROM claims WHERE item_id='O-1'").tenant_id, null, 'a claim this runtime writes carries no tenant');
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM dispatches WHERE item_id LIKE 'F-%'").n, 0);
});

test('pickForRole: a foreign item is never returned, even as the only ready item', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,priority,status,tenant_id) VALUES ('F-1','f','operations','x',0,'ready','${FOREIGN}');`);
  assert.equal(await pickForRole(db, { role: 'operations', project: null }, null, [], 'ultrastable'), null);
  assert.equal(await pickForRole(db, { role: 'operations', project: null }, null), null, 'no tenant given: only NULL rows');
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('O-1','o','operations','x',90,'ready');`);
  assert.equal((await pickForRole(db, { role: 'operations', project: null }, null, [], 'ultrastable')).id, 'O-1');
});

test('execute: a claimed item of another tenant is not settled by the doer; the item and its claim are untouched', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,priority,status,tenant_id) VALUES ('TICKFAIL-migrate-2026-11-09T00','Tick step migrate failed','operations','x',0,'claimed','${FOREIGN}');
    INSERT INTO claims (item_id,agent,tenant_id) VALUES ('TICKFAIL-migrate-2026-11-09T00','op-1','${FOREIGN}');`);
  await runTick(db, { config, now: T0 });
  assert.equal(get(db, "SELECT status FROM items WHERE id LIKE 'TICKFAIL-migrate-2026-11-09T00'").status, 'claimed');
  assert.ok(get(db, "SELECT item_id FROM claims WHERE item_id LIKE 'TICKFAIL-migrate-2026-11-09T00'"));
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM outcomes WHERE item_id LIKE 'TICKFAIL-migrate-2026-11-09T00'").n, 0);
});

test('accrue_trust: a trust row of another tenant is neither read nor overwritten; an own row accrues and carries no tenant', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO trust_ledger (surface,action_class,rung,reliability,outcomes,tenant_id) VALUES ('work_tracker','create_update_close','observed',0.123,7,'${FOREIGN}');
    INSERT INTO outcomes (item_id,surface,action_class,result,evidence) VALUES ('I1','work_tracker','create_update_close','verified','e'), ('I2','selfaudit','probe','verified','e');`);
  await runTick(db, { config, now: T0 });
  const f = get(db, "SELECT reliability, outcomes, tenant_id FROM trust_ledger WHERE surface='work_tracker' AND action_class='create_update_close'");
  assert.deepEqual({ ...f }, { reliability: 0.123, outcomes: 7, tenant_id: FOREIGN }, 'the foreign row is untouched');
  const own = get(db, "SELECT outcomes, tenant_id FROM trust_ledger WHERE surface='selfaudit' AND action_class='probe'");
  assert.equal(own.outcomes, 1); assert.equal(own.tenant_id, null);
});

test('migration 0027: the trust key carries the tenant, so an own row accrues at a key another tenant already holds (Q-TENANT-trust-pk-rebuild)', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO trust_ledger (surface,action_class,rung,reliability,outcomes,tenant_id) VALUES ('work_tracker','create_update_close','observed',0.123,7,'${FOREIGN}');
    INSERT INTO outcomes (item_id,surface,action_class,result,evidence) VALUES ('I1','work_tracker','create_update_close','verified','e'), ('I2','work_tracker','create_update_close','verified','e');`);
  await runTick(db, { config, now: T0 });
  const at = rows(db, "SELECT outcomes, tenant_id FROM trust_ledger WHERE surface='work_tracker' AND action_class='create_update_close' ORDER BY tenant_id IS NOT NULL");
  assert.equal(at.length, 2, 'own and foreign rows live side by side');
  assert.deepEqual({ ...at[0] }, { outcomes: 2, tenant_id: null }, 'own trust accrued (before 0027 the foreign row blocked it)');
  assert.deepEqual({ ...at[1] }, { outcomes: 7, tenant_id: FOREIGN }, 'the foreign row is untouched');
  await runTick(db, { config, now: T0 + 600000 });
  assert.equal(rows(db, "SELECT 1 FROM trust_ledger WHERE surface='work_tracker' AND action_class='create_update_close' AND tenant_id IS NULL").length, 1, 'the upsert updates the own row; it never duplicates it');
  assert.throws(() => db.raw.exec("INSERT INTO trust_ledger (surface,action_class,rung,reliability) VALUES ('work_tracker','create_update_close','observed',0.5)"), /UNIQUE/, 'two own rows at one key are refused');
});

test('migration 0027 rebuilds an old-shape ledger atomically: rows and tenants survive, a backup is kept, a failed rebuild leaves the old table', async () => {
  const sql = readFileSync(new URL('../migrations/0027_trust_ledger_tenant_pk.sql', import.meta.url), 'utf8');
  const old = () => { const db = makeDb(); db.raw.exec(`DROP TABLE trust_ledger; DROP TABLE trust_ledger_backup_0027;
    CREATE TABLE trust_ledger (surface TEXT NOT NULL, action_class TEXT NOT NULL, rung TEXT NOT NULL, reliability REAL NOT NULL, outcomes INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT (datetime('now')), tenant_id TEXT, PRIMARY KEY (surface, action_class));
    INSERT INTO trust_ledger (surface,action_class,rung,reliability,outcomes,tenant_id) VALUES ('repo','merge_pr_green','delegated',0.91,12,NULL), ('site','deploy','observed',0.5,3,'${FOREIGN}');
    CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, sha256 TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')));`); return db; };
  const db = old(); const ctx = { nowIso: '2026-11-20 00:00:00', notes: [] };
  const r = await migrateStep(db, ctx, [{ file: '0027_trust_ledger_tenant_pk.sql', sql }], ensureItem);
  assert.deepEqual(r.applied, ['0027_trust_ledger_tenant_pk.sql'], ctx.notes.join('; '));
  assert.deepEqual(rows(db, "SELECT surface, rung, outcomes, tenant_id FROM trust_ledger ORDER BY surface").map(x => ({ ...x })),
    [{ surface: 'repo', rung: 'delegated', outcomes: 12, tenant_id: null }, { surface: 'site', rung: 'observed', outcomes: 3, tenant_id: FOREIGN }]);
  assert.equal(get(db, "SELECT COUNT(*) AS n FROM trust_ledger_backup_0027").n, 2, 'the pre-rebuild rows are kept as the rollback copy');
  assert.ok(get(db, "SELECT name FROM sqlite_master WHERE type='index' AND name='trust_ledger_tenant_key'"));
  assert.equal(get(db, "SELECT name FROM sqlite_master WHERE name='trust_ledger_v2'"), undefined);
  // all or nothing: a rebuild that fails part-way (after the drop) rolls back to the old table with its rows
  const db2 = old(); const ctx2 = { nowIso: '2026-11-20 00:00:00', notes: [] };
  const broken = sql.replace('ALTER TABLE trust_ledger_v2 RENAME TO trust_ledger;', 'ALTER TABLE no_such_table RENAME TO trust_ledger;');
  const r2 = await migrateStep(db2, ctx2, [{ file: '0027_trust_ledger_tenant_pk.sql', sql: broken }], ensureItem);
  assert.deepEqual(r2.failed, ['0027_trust_ledger_tenant_pk.sql']);
  assert.equal(get(db2, "SELECT COUNT(*) AS n FROM trust_ledger").n, 2, 'the old ledger is intact after the failed rebuild');
  assert.equal(get(db2, "SELECT COUNT(*) AS n FROM _migrations WHERE file LIKE '0027%'").n, 0, 'a failed file is not ledgered, so the next tick retries it');
});

test('counts: done items, the open-item total and the plus-share window ignore another tenant\'s rows', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status,disposition,tenant_id,updated_at) VALUES
    ('F-d','f','x','x','done','fixed','${FOREIGN}','2026-11-09 00:00:00'), ('O-d','o','x','x','done','fixed',NULL,'2026-11-09 00:00:00'),
    ('F-o','f','x','x','blocked',NULL,'${FOREIGN}','2026-11-09 00:00:00');`);
  assert.equal(await METRICS.items_done(db, T0, 'ultrastable'), 1);
  assert.equal(await METRICS.items_done_7d(db, T0, 'ultrastable'), 1);
  assert.equal(await METRICS.items_done(db, T0, FOREIGN), 2, 'a foreign runtime sees its own row plus the shared NULL rows');
});

test('handoff: a PR naming another tenant\'s item neither closes it nor releases its claim; an own item is closed', async () => {
  const BODY = 'Fix\n\n## Handoff\nitem: SG-2\nagent: codex\nverify: GET https://ultrastable.io/x expect "ok"\ndeploy: ultrastable-tick\n';
  async function run(tenantOfItem) {
    const db = makeDb();
    db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status,tenant_id) VALUES ('SG-2','x','staff','x','claimed',${tenantOfItem ? `'${tenantOfItem}'` : 'NULL'});
      INSERT INTO claims (item_id,agent,tenant_id) VALUES ('SG-2','staff-1',${tenantOfItem ? `'${tenantOfItem}'` : 'NULL'});`);
    const st = { prs: [{ number: 7, title: 'Fix', body: BODY, head: { sha: 'aaa' }, labels: [] }], detail: { merged: false, state: 'open', mergeable_state: 'clean' } };
    const f = async (url, o = {}) => {
      const m = o.method || 'GET', path = url.replace('https://api.github.com', '');
      const R = (j, status = 200) => ({ ok: status < 300, status, text: async () => JSON.stringify(j) });
      if (m === 'GET' && path.startsWith('/repos/o/r/pulls?state=closed')) return R([]);
      if (m === 'GET' && path.startsWith('/repos/o/r/pulls?')) return R(st.prs);
      if (m === 'GET' && /\/pulls\/7$/.test(path)) return R(st.detail);
      if (m === 'POST' && path.endsWith('/comments')) return R({ id: 1 }, 201);
      if (m === 'GET' && path === '/repos/o/r') return R({ default_branch: 'main' });
      if (m === 'GET' && path === '/repos/o/r/commits/main') return R({ sha: 'head1' });
      return R({ message: 'unexpected ' + m + ' ' + path }, 404);
    };
    const opts = { db, token: 't', repos: ['o/r'], fetch: f, deployer: async () => ({ ok: true, version: 'v9' }), probe: async () => ({ ok: true, detail: 'ok' }), tenant: 'ultrastable' };
    await runHandoffs(opts);
    st.detail = { merged: true, merge_commit_sha: 'mmm', state: 'closed' }; st.prs = [];
    await runHandoffs(opts);
    return db;
  }
  const foreign = await run(FOREIGN);
  assert.equal(get(foreign, "SELECT status FROM items WHERE id='SG-2'").status, 'claimed', 'foreign item not closed');
  assert.ok(get(foreign, "SELECT item_id FROM claims WHERE item_id='SG-2'"), 'foreign claim kept');
  const own = await run(null);
  assert.equal(get(own, "SELECT status FROM items WHERE id='SG-2'").status, 'done');
  assert.equal(get(own, "SELECT item_id FROM claims WHERE item_id='SG-2'"), undefined);
});

test('native executor: a needs-code item of another tenant is never taken', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,priority,status,blocker,tenant_id) VALUES ('F-1','f','operations','x',90,'blocked','needs-code: edit site/x.js','${FOREIGN}');`);
  let called = false;
  const r = await runDbQueue({ DB: db, TENANT: 'ultrastable' }, { fetchImpl: async () => { called = true; throw new Error('no network'); }, agent: async () => { called = true; throw new Error('no agent'); } });
  assert.equal(r.idle, true); assert.equal(called, false);
  assert.match(get(db, "SELECT blocker FROM items WHERE id='F-1'").blocker, /^needs-code: edit/, 'untouched');
});

test('the sqlite adapter (GCP and self-host) re-runs every migration on each open: opening a database twice succeeds with the tenant columns present', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tenant-iso-'));
  try {
    const mig = new URL('../migrations', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const a = openDb(join(dir, 'u.db'), decodeURIComponent(mig)); a.close();
    const b = openDb(join(dir, 'u.db'), decodeURIComponent(mig));
    assert.ok(b.raw.prepare('PRAGMA table_info(items)').all().some(c => c.name === 'tenant_id'));
    b.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
