// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { makeDb } from '../_shared/testdb.js';
import { createExporter, classify, splitStatements, memoryStore, lintMigrations, oneStatement } from './index.js';

const MIG = fileURLToPath(new URL('./migrations/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const NOW = Date.UTC(2026, 10, 15, 12, 0, 0);
const setup = (store = memoryStore()) => { const db = makeDb([MIG]); return { db, store, ex: createExporter({ db, store, now: () => NOW }) }; };
const count = (db, sql) => db.raw.prepare(sql).get().n;

test('US-01-R04: classify finds drops and rewrites, and leaves additive statements, views, indexes and trigger bodies alone', () => {
  assert.deepEqual(classify(`CREATE TABLE IF NOT EXISTS a (id INTEGER); CREATE INDEX IF NOT EXISTS i ON a(id); DROP VIEW IF EXISTS v; INSERT OR IGNORE INTO a VALUES (1);`).destructive, false);
  const c = classify(`DROP TABLE IF EXISTS items; ALTER TABLE roles DROP COLUMN model; -- DELETE FROM org\nDELETE FROM claims WHERE 1; UPDATE "outcomes" SET result='x'; ALTER TABLE org RENAME TO org2;`);
  assert.deepEqual(c.tables, ['items', 'roles', 'claims', 'outcomes', 'org']);
  assert.deepEqual(c.findings.map(f => f.kind), ['drop table', 'drop column', 'delete rows', 'rewrite rows', 'rename']);
  const trig = `CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET id = CASE WHEN id > 1 THEN 1 ELSE 0 END; DELETE FROM b; END; CREATE TABLE c (x TEXT DEFAULT ';--');`;
  assert.equal(splitStatements(trig).length, 2);
  assert.equal(classify(trig).destructive, false);
});

test('US-01-R04: every migration shipped in this repository is additive', () => {
  const files = [];
  const dirs = [path.join(ROOT, 'core/migrations'), path.join(ROOT, 'adapters/shared/migrations')];
  for (const m of readdirSync(path.join(ROOT, 'core'))) dirs.push(path.join(ROOT, 'core', m, 'migrations'));
  for (const d of dirs.filter(existsSync)) for (const f of readdirSync(d).filter(n => n.endsWith('.sql'))) files.push({ name: path.relative(ROOT, path.join(d, f)), sql: readFileSync(path.join(d, f), 'utf8') });
  assert.ok(files.length > 20);
  assert.deepEqual(lintMigrations(files), []);
});

test('US-01-R04: an additive migration is applied with no export', async () => {
  const { db, store, ex } = setup();
  const r = await ex.applyMigration('0009_add', `CREATE TABLE IF NOT EXISTS extra_notes (id INTEGER PRIMARY KEY, body TEXT); INSERT OR IGNORE INTO extra_notes (id, body) VALUES (1, 'a;b');`);
  assert.equal(r.applied, true); assert.equal(r.destructive, false);
  assert.equal(store.m.size, 0);
  assert.equal(db.raw.prepare(`SELECT body FROM extra_notes`).get().body, 'a;b');
});

test('US-01-R04: a destructive migration is preceded by an export that is verified readable, then applied', async () => {
  const { db, store, ex } = setup();
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example'), ('slug', 'example')`);
  const r = await ex.applyMigration('0010_drop_org', `DROP TABLE org;`);
  assert.equal(r.applied, true);
  assert.equal(r.exports.length, 1); assert.equal(r.exports[0].verified, true); assert.equal(r.exports[0].rows, 2);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE name='org'`), 0);
  const led = await ex.ledger();
  assert.equal(led[0].verified, 1); assert.equal(led[0].at, '2026-11-15 12:00:00'); assert.match(led[0].sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(await ex.readExport(led[0].object_key), [{ key: 'name', value: 'Example' }, { key: 'slug', value: 'example' }]);
  assert.equal(db.raw.prepare(`SELECT outcome FROM export_migrations WHERE name='0010_drop_org'`).get().outcome, 'applied');
});

test('US-01-R04: no object store, an unreadable export or a corrupted export refuses the migration and leaves the data', async () => {
  const cases = [
    null,
    { async put() {}, async get() { return null; } },
    { async put() {}, async get() { return { text: async () => '{"key":"other","value":"x"}' }; } },
    { async put() { throw new Error('bucket offline'); }, async get() { return null; } },
  ];
  for (const store of cases) {
    const db = makeDb([MIG]);
    db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example')`);
    const ex = createExporter({ db, store, now: () => NOW });
    const r = await ex.applyMigration('0011_rewrite', `UPDATE org SET value = 'gone';`);
    assert.equal(r.applied, false); assert.equal(r.refusal, 'export_not_verified');
    assert.equal(db.raw.prepare(`SELECT value FROM org`).get().value, 'Example');
    assert.equal(db.raw.prepare(`SELECT outcome FROM export_migrations WHERE name='0011_rewrite'`).get().outcome, 'refused');
  }
});

test('an empty table exports and verifies; a table that does not exist needs no export; a bad table name is refused', async () => {
  const { ex } = setup();
  const e = await ex.exportTable('claims');
  assert.equal(e.verified, true); assert.equal(e.rows, 0);
  const r = await ex.applyMigration('0012_none', `DROP TABLE IF EXISTS never_there;`);
  assert.equal(r.applied, true); assert.equal(r.exports.length, 0);
  await assert.rejects(() => ex.exportTable('org; DROP TABLE org'), /not a table name/);
});

test('US-01-R04: statements handed in with a migration (a caller ledger row) land with it in one batch when the store has batch(), in order when it has not, and never when the export is refused', async () => {
  const batched = (db) => Object.assign(db, { batches: 0, async batch(list) { this.batches++; db.raw.exec('BEGIN'); try { for (const s of list) await s.run(); db.raw.exec('COMMIT'); } catch (e) { db.raw.exec('ROLLBACK'); throw e; } } });
  const ledgerRow = (db, name) => { db.raw.exec(`CREATE TABLE IF NOT EXISTS mig_ledger (name TEXT PRIMARY KEY)`); return [db.prepare(`INSERT INTO mig_ledger (name) VALUES (?)`).bind(name)]; };
  const rows = (db) => count(db, `SELECT COUNT(*) AS n FROM mig_ledger`), hasOrg = (db) => count(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE name='org'`);
  const a = setup(); batched(a.db);
  assert.equal((await a.ex.applyMigration('0013_drop', `DROP TABLE org;`, { also: ledgerRow(a.db, '0013_drop') })).applied, true);
  assert.equal(a.db.batches, 1, 'the migration and its ledger row were one call'); assert.equal(rows(a.db), 1); assert.equal(hasOrg(a.db), 0);
  const half = setup(); batched(half.db);
  await assert.rejects(() => half.ex.applyMigration('0014_half', `DROP TABLE org; INSERT INTO table_that_is_not_there (x) VALUES (1);`, { also: ledgerRow(half.db, '0014_half') }));
  assert.equal(rows(half.db), 0, 'the ledger row did not land without the migration'); assert.equal(hasOrg(half.db), 1, 'the drop was rolled back with the failing statement');
  const plain = setup();
  assert.equal((await plain.ex.applyMigration('0015_plain', `CREATE TABLE IF NOT EXISTS extra_two (x);`, { also: ledgerRow(plain.db, '0015_plain') })).applied, true);
  assert.equal(rows(plain.db), 1, 'without batch() the statements run in order');
  const refused = setup(null); refused.db.raw.exec(`INSERT INTO org (key, value) VALUES ('a','b')`);
  assert.equal((await refused.ex.applyMigration('0016_refused', `DROP TABLE org;`, { also: ledgerRow(refused.db, '0016_refused') })).applied, false);
  assert.equal(rows(refused.db), 0, 'a refused migration records nothing'); assert.equal(hasOrg(refused.db), 1);
});

test('US-01-R04: a schema-qualified table, a quoted schema, a CTE delete and an upsert are classified by their table, and the export runs before the drop', async () => {
  assert.deepEqual(classify('DROP TABLE main.items;').tables, ['items']);
  assert.deepEqual(classify('DELETE FROM "main"."items" WHERE 1;').tables, ['items']);
  assert.deepEqual(classify('ALTER TABLE temp.items RENAME TO old;').tables, ['items']);
  assert.deepEqual(classify('WITH gone AS (SELECT id FROM items WHERE 0) DELETE FROM items WHERE id IN (SELECT id FROM gone);').tables, ['items']);
  assert.deepEqual(classify("INSERT INTO org (key, value) VALUES ('a', 'b') ON CONFLICT(key) DO UPDATE SET value = excluded.value;").tables, ['org']);
  assert.equal(classify("INSERT INTO org (key, value) VALUES ('a', 'b') ON CONFLICT(key) DO NOTHING;").destructive, false, 'an insert that leaves existing rows alone is additive');
  const { db, store, ex } = setup();
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example')`);
  const r = await ex.applyMigration('0011_qualified', `DROP TABLE main.org;`);
  assert.equal(r.applied, true);
  assert.equal(r.exports.length, 1, 'the table behind the schema prefix was exported, not read as "nothing to lose"');
  assert.deepEqual(await ex.readExport((await ex.ledger())[0].object_key), [{ key: 'name', value: 'Example' }]);
  assert.equal(store.m.size, 1);
});

test('US-01-R04: a table in an attached schema cannot be exported here, so the migration is refused and the store is untouched', async () => {
  const { db, ex } = setup();
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example')`);
  const r = await ex.applyMigration('0012_attached', `DELETE FROM other.org;`);
  assert.equal(r.applied, false); assert.equal(r.refusal, 'table_unresolved');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM org`), 1);
  assert.equal(db.raw.prepare(`SELECT outcome FROM export_migrations WHERE name='0012_attached'`).get().outcome, 'refused');
});

test('US-01-R04: a quoted table name is read whole, and a destructive statement whose table is not a plain name is refused before anything runs', async () => {
  assert.deepEqual(classify('DROP TABLE "my items";').tables, ['my items'], 'the whole quoted name, not its first word');
  assert.deepEqual(classify('DELETE FROM [my items] WHERE 1;').tables, ['my items']);
  assert.deepEqual(classify('UPDATE `odd``name` SET x = 1;').tables, ['odd`name'], 'a doubled quote inside the name is one quote');
  assert.deepEqual(classify('DROP TABLE "items";').unresolved, [], 'a quoted plain name resolves');
  for (const sql of ['DROP TABLE "my items";', 'DROP TABLE "1x";', 'DROP TABLE ítems;', 'ALTER TABLE "a.b" DROP COLUMN c;']) {
    const c = classify(sql);
    assert.equal(c.destructive, true, `${sql} is destructive`);
    assert.equal(c.unresolved.length, 1, `${sql} names a table that cannot be exported`);
    assert.equal(lintMigrations([{ name: 'x.sql', sql }]).length, 1, `${sql} is caught by the lint`);
  }
  assert.equal(classify('ALTER TABLE "my items" ADD COLUMN note TEXT;').destructive, false, 'an added column loses nothing');
  assert.equal(classify(`ALTER TABLE x ADD COLUMN note TEXT DEFAULT 'drop';`).destructive, false, 'a word inside a default is not an action');
  for (const name of ['my items', '1x']) {
    const { db, store, ex } = setup();
    db.raw.exec(`CREATE TABLE "${name}" (x); INSERT INTO "${name}" VALUES (1);`);
    const r = await ex.applyMigration(`0020_${name.replace(/\W/g, '')}`, `DROP TABLE "${name}";`);
    assert.equal(r.applied, false); assert.equal(r.refusal, 'table_unresolved');
    assert.equal(count(db, `SELECT COUNT(*) AS n FROM "${name}"`), 1, 'the table and its row are still there');
    assert.equal(store.m.size, 0);
  }
});

test('US-01-R04: a statement that starts like a drop or a rewrite but names no table the classifier can read is destructive and unresolved, never additive', async () => {
  const c = classify('ALTER TABLE ; DROP TABLE');
  assert.equal(c.destructive, true);
  assert.ok(c.unresolved.length >= 1);
  assert.equal(classify('INSERT OR ROLLBACK INTO org (key, value) VALUES (1, 2) ON CONFLICT(key) DO UPDATE SET value = 3;').tables[0], 'org', 'an upsert with a conflict clause on the verb is an upsert');
  const { db, ex } = setup();
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example')`);
  const r = await ex.applyMigration('0021_mixed', `DELETE FROM org; DROP TABLE "my items";`);
  assert.equal(r.applied, false); assert.equal(r.refusal, 'table_unresolved');
  assert.equal(r.exports.length, 0, 'the refusal comes before any export');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM org`), 1);
});

// Three rounds of residuals in one deny-list: a name quoted with backticks or brackets hid the statements after it, a CTE in front of an upsert
// read as additive, and a trigger created and fired in one file emptied a table with nothing exported. The split now follows SQLite's own lexical
// rules and its statement-completion state machine, and the verdict is default-deny.
const HIDDEN = {
  backtick_comment: 'CREATE TABLE IF NOT EXISTS `a/*b` (x); DROP TABLE org; CREATE TABLE IF NOT EXISTS `c*/` (y);',
  backtick_quote: "CREATE TABLE `it's` (a); DELETE FROM org;",
  bracket_dashes: 'CREATE TABLE [a--b] (x); DELETE FROM org;',
};
const CTE_UPSERT = v => `WITH x AS (SELECT 1) INSERT OR ${v} INTO org (key, value) SELECT 'name','lost' WHERE true ON CONFLICT(key) DO UPDATE SET value = excluded.value;`;
const FIRED = 'CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END; INSERT INTO t VALUES (1);';
const withTables = (db) => db.raw.exec(`CREATE TABLE t (a); CREATE TABLE kept (x); INSERT INTO kept VALUES (1), (2);`);

test('US-01-R04: a backtick or bracket name that holds a quote, a comment marker or dashes hides no statement: the split follows all four SQLite quoting forms', async () => {
  assert.deepEqual(splitStatements(HIDDEN.backtick_comment), ['CREATE TABLE IF NOT EXISTS `a/*b` (x)', 'DROP TABLE org', 'CREATE TABLE IF NOT EXISTS `c*/` (y)']);
  for (const [name, sql] of Object.entries(HIDDEN)) {
    const c = classify(sql);
    assert.equal(c.destructive, true, `${name} is destructive`);
    assert.deepEqual(c.tables, ['org'], `${name} names the table it drops or empties`);
    assert.equal(lintMigrations([{ name: `${name}.sql`, sql }]).length, 1, `${name} is caught by the lint`);
  }
  const { db, ex } = setup();
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example'), ('slug', 'example')`);
  const r = await ex.applyMigration('0040_hidden_drop', HIDDEN.backtick_comment);
  assert.equal(r.applied, true); assert.equal(r.exports.length, 1); assert.equal(r.exports[0].rows, 2);
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE name='org'`), 0, 'the drop ran');
  assert.equal(count(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('a/*b', 'c*/')"), 2, 'every statement of the file ran, none was swallowed into another');
  assert.deepEqual(await ex.readExport((await ex.ledger())[0].object_key), [{ key: 'name', value: 'Example' }, { key: 'slug', value: 'example' }]);
  const b = setup();
  b.db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example')`);
  assert.equal((await b.ex.applyMigration('0041_dashes', HIDDEN.bracket_dashes)).exports.length, 1);
  assert.equal(count(b.db, `SELECT COUNT(*) AS n FROM org`), 0);
  assert.deepEqual(await b.ex.readExport((await b.ex.ledger())[0].object_key), [{ key: 'name', value: 'Example' }]);
});

test('US-01-R04: a common table expression in front of an upsert is an upsert, whatever conflict verb the insert carries', async () => {
  for (const v of ['IGNORE', 'ABORT', 'FAIL', 'ROLLBACK']) {
    const c = classify(CTE_UPSERT(v));
    assert.equal(c.destructive, true, `WITH ... INSERT OR ${v} ... DO UPDATE is destructive`);
    assert.deepEqual(c.tables, ['org']); assert.equal(c.findings[0].kind, 'upsert rows');
  }
  assert.equal(classify(`WITH x AS (SELECT 1) INSERT OR IGNORE INTO org (key, value) SELECT 'a', 'b' ON CONFLICT DO NOTHING;`).destructive, false);
  assert.equal(classify(`WITH RECURSIVE x(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM x WHERE n < 3) SELECT n FROM x;`).destructive, false);
  assert.equal(classify(`INSERT INTO org (key, value) VALUES ('k', 'on conflict do update');`).destructive, false, 'words inside a string are not a clause');
  assert.deepEqual(classify(`WITH "delete" AS (SELECT 1) DELETE FROM org;`).tables, ['org'], 'a quoted CTE name is not the verb');
  const { db, ex } = setup();
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'precious')`);
  const r = await ex.applyMigration('0042_cte_upsert', CTE_UPSERT('IGNORE'));
  assert.equal(r.applied, true); assert.equal(r.destructive, true); assert.equal(r.exports.length, 1);
  assert.equal(db.raw.prepare(`SELECT value FROM org WHERE key = 'name'`).get().value, 'lost');
  assert.deepEqual(await ex.readExport((await ex.ledger())[0].object_key), [{ key: 'name', value: 'precious' }], 'the row it overwrote was exported first');
});

test('US-01-R04: a trigger created and fired in the same file, or already in the store, counts its body: the tables it empties are exported first', async () => {
  const c = classify(FIRED);
  assert.equal(c.destructive, true); assert.deepEqual(c.tables, ['kept']);
  assert.equal(c.findings[0].kind, 'delete rows'); assert.equal(c.findings[0].via, 'tr');
  assert.equal(classify('CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END;').destructive, false, 'a trigger nothing fires is schema');
  assert.equal(classify('CREATE TRIGGER tr AFTER DELETE ON t BEGIN DELETE FROM kept; END; INSERT INTO t VALUES (1);').destructive, false, 'an insert does not fire a delete trigger');
  assert.deepEqual(classify('CREATE TRIGGER a1 AFTER INSERT ON t BEGIN INSERT INTO u VALUES (NEW.a); END; CREATE TRIGGER b1 AFTER INSERT ON u BEGIN DELETE FROM kept; END; INSERT INTO t VALUES (1);').tables, ['kept'], 'a trigger that fires another is followed');
  assert.equal(classify('CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END; DROP TRIGGER tr; INSERT INTO t VALUES (1);').destructive, false, 'a dropped trigger no longer fires');
  assert.deepEqual(classify('INSERT INTO t VALUES (1);', { schema: ['CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END'] }).tables, ['kept'], 'a trigger already in the store fires too');
  const { db, ex } = setup(); withTables(db);
  const r = await ex.applyMigration('0043_fired', FIRED);
  assert.equal(r.applied, true); assert.equal(r.exports.length, 1); assert.equal(r.exports[0].table, 'kept');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM kept`), 0);
  assert.deepEqual(await ex.readExport((await ex.ledger())[0].object_key), [{ x: 1 }, { x: 2 }]);
  const old = setup(); withTables(old.db);
  old.db.raw.exec(`CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END;`);
  const r2 = await old.ex.applyMigration('0044_insert', 'INSERT INTO t VALUES (2);');
  assert.equal(r2.destructive, true, 'the applier reads the triggers the store already holds');
  assert.equal(r2.exports.length, 1); assert.equal(r2.exports[0].table, 'kept');
});

test('US-01-R04: classification is default-deny: a statement on no allow-list is destructive and unresolved, and a comment between words hides no verb', async () => {
  for (const sql of ['PRAGMA writable_schema = 1;', 'VACUUM;', "ATTACH DATABASE 'x.db' AS x;", 'REINDEX;', 'EXPLAIN DELETE FROM org;', 'BEGIN; COMMIT;', 'SAVEPOINT s; ROLLBACK TO s;', 'INSERT OR SOMETHING INTO org VALUES (1, 2);']) {
    const c = classify(sql);
    assert.equal(c.destructive, true, `${sql} is not on the allow-list`);
    assert.ok(c.unresolved.length >= 1, `${sql} is unresolved`);
  }
  assert.deepEqual(classify('DROP/**/TABLE org;').tables, ['org'], 'a comment is whitespace, so the verb is read');
  assert.deepEqual(classify('DELETE -- note\nFROM org;').tables, ['org']);
  assert.deepEqual(classify(`DROP TABLE 'org';`).tables, ['org'], 'a single-quoted name SQLite accepts as a table is read as that table');
  assert.equal(classify('CREATE VIRTUAL TABLE f USING fts5(body); CREATE TEMP VIEW v AS SELECT 1; DROP INDEX IF EXISTS i; ALTER TABLE org ADD COLUMN note TEXT;').destructive, false);
  const { db, ex } = setup();
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example')`);
  const r = await ex.applyMigration('0045_pragma', 'PRAGMA writable_schema = 1;');
  assert.equal(r.applied, false); assert.equal(r.refusal, 'table_unresolved');
});

test('US-01-R04: a piece the applier runs is one statement: a trigger is one piece, an unfinished trigger is refused before anything runs', async () => {
  assert.equal(oneStatement('CREATE TABLE a (x)'), true);
  assert.equal(oneStatement(`CREATE TABLE a (x TEXT DEFAULT ';')`), true);
  assert.equal(oneStatement('CREATE TRIGGER tr AFTER INSERT ON t BEGIN UPDATE t SET a = CASE WHEN a > 1 THEN 1 END; DELETE FROM kept; END'), true);
  assert.equal(oneStatement('CREATE TABLE a (x); DROP TABLE org'), false);
  const unfinished = 'CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; DELETE FROM org';
  assert.equal(oneStatement(unfinished), false);
  assert.equal(classify(unfinished).destructive, true); assert.equal(classify(unfinished).unresolved.length, 1);
  const { db, ex } = setup(); withTables(db);
  db.raw.exec(`INSERT INTO org (key, value) VALUES ('name', 'Example')`);
  const r = await ex.applyMigration('0046_unfinished', unfinished);
  assert.equal(r.applied, false); assert.equal(r.refusal, 'table_unresolved');
  assert.equal(count(db, `SELECT COUNT(*) AS n FROM org`), 1); assert.equal(count(db, `SELECT COUNT(*) AS n FROM kept`), 2);
});

const REPLACE_ORG = 'CREATE TABLE org (key TEXT PRIMARY KEY ON CONFLICT REPLACE, value TEXT)';
const PARENT = 'CREATE TABLE parent (id INTEGER PRIMARY KEY)';
const CHILD = 'CREATE TABLE child (pid INTEGER REFERENCES parent(id) ON DELETE CASCADE, note TEXT)';

test('US-01-R04: what SQLite does past the statement text counts: a REPLACE conflict clause in the table and a foreign key action lose rows the export must hold', async () => {
  const ins = `INSERT INTO org (key, value) VALUES ('name', 'lost');`;
  const c = classify(ins, { schema: [REPLACE_ORG] });
  assert.deepEqual(c.tables, ['org']); assert.equal(c.findings[0].kind, 'replace rows');
  assert.equal(classify(`INSERT OR IGNORE INTO org (key, value) VALUES ('name', 'kept');`, { schema: [REPLACE_ORG] }).destructive, false, 'the statement\'s own conflict verb wins over the table\'s');
  assert.deepEqual(classify('CREATE TABLE r (k PRIMARY KEY ON CONFLICT REPLACE, v); INSERT INTO r VALUES (1, 2);').tables, ['r'], 'a table made in the same file counts');
  assert.equal(classify('CREATE TABLE IF NOT EXISTS org (key TEXT PRIMARY KEY, value TEXT); ' + ins, { schema: [REPLACE_ORG] }).destructive, true, 'IF NOT EXISTS keeps the definition the store holds');
  const fk = classify('DELETE FROM parent WHERE id = 1;', { schema: [PARENT, CHILD] });
  assert.deepEqual(fk.tables, ['parent', 'child']);
  assert.deepEqual(fk.findings.map(f => [f.table, f.kind, f.via]), [['parent', 'delete rows', undefined], ['child', 'delete rows', 'foreign key of child']]);
  const cases = [
    ['CREATE TABLE child (pid INTEGER REFERENCES parent ON DELETE SET NULL)', 'DELETE FROM parent;', ['parent', 'child'], 'rewrite rows'],
    ['CREATE TABLE child (pid INTEGER, note TEXT, FOREIGN KEY (pid) REFERENCES parent (id) ON UPDATE CASCADE)', 'UPDATE parent SET id = 2;', ['parent', 'child'], 'rewrite rows'],
    ['CREATE TABLE child (pid INTEGER REFERENCES parent(id) ON DELETE RESTRICT ON UPDATE NO ACTION)', 'DELETE FROM parent;', ['parent'], null],
    [CHILD, 'DROP TABLE parent;', ['parent', 'child'], 'delete rows'],
    [CHILD, `INSERT OR REPLACE INTO parent VALUES (1);`, ['parent', 'child'], 'delete rows'],
  ];
  for (const [child, sql, tables, kind] of cases) {
    const r = classify(sql, { schema: [PARENT, child] });
    assert.deepEqual(r.tables, tables, `${sql} with ${child}`);
    if (kind) assert.equal(r.findings.find(f => f.table === 'child').kind, kind);
  }
  assert.deepEqual(classify('ALTER TABLE child ADD COLUMN gid INTEGER REFERENCES parent(id) ON DELETE CASCADE; DELETE FROM parent;', { schema: [PARENT, 'CREATE TABLE child (x)'] }).tables, ['parent', 'child'], 'a column added with a foreign key counts');
  assert.deepEqual(classify('DELETE FROM parent;', { schema: [PARENT, CHILD, 'CREATE TABLE grand (cid INTEGER REFERENCES child(pid) ON DELETE CASCADE)'] }).tables, ['parent', 'child', 'grand'], 'a cascade is followed down');
  assert.deepEqual(classify('DELETE FROM parent;', { schema: [PARENT, CHILD, 'CREATE TRIGGER tc AFTER DELETE ON child BEGIN DELETE FROM kept; END'] }).tables, ['parent', 'child', 'kept'], 'a cascaded delete fires the child table\'s triggers');
  const trig = 'CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END';
  assert.deepEqual(classify('ALTER TABLE t RENAME TO t2; INSERT INTO t2 VALUES (1);', { schema: ['CREATE TABLE t (a)', trig] }).tables, ['t', 'kept'], 'a renamed table keeps its triggers');
  assert.deepEqual(classify('DROP TABLE t; CREATE TABLE t (a); INSERT INTO t VALUES (1);', { schema: ['CREATE TABLE t (a)', trig] }).tables, ['t'], 'a dropped table takes its triggers with it');
  // through the applier, with the schema read from the store (node:sqlite, like D1, enforces foreign keys)
  const r1 = setup(); r1.db.raw.exec(`CREATE TABLE r_org (key TEXT PRIMARY KEY ON CONFLICT REPLACE, value TEXT); INSERT INTO r_org VALUES ('name', 'precious');`);
  const a1 = await r1.ex.applyMigration('0047_replace', `INSERT INTO r_org (key, value) VALUES ('name', 'lost');`);
  assert.equal(a1.destructive, true); assert.equal(a1.exports.length, 1);
  assert.deepEqual(await r1.ex.readExport((await r1.ex.ledger())[0].object_key), [{ key: 'name', value: 'precious' }]);
  const r2 = setup(); r2.db.raw.exec(`${PARENT}; ${CHILD}; INSERT INTO parent VALUES (1); INSERT INTO child VALUES (1, 'kept');`);
  const a2 = await r2.ex.applyMigration('0048_cascade', 'DELETE FROM parent WHERE id = 1;');
  assert.deepEqual(a2.exports.map(e => [e.table, e.rows]), [['parent', 1], ['child', 1]]);
  assert.equal(count(r2.db, `SELECT COUNT(*) AS n FROM child`), 0, 'the cascade ran after both exports');
});
