// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-01-R04 in the Python migration applier (tools/apply_migrations.py): the same classification as core/export, an export read back before a
// destructive file runs, and a refusal that names the file. python3 is spawned; no network, no wrangler (a shim stands in for npx).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync, chmodSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { classify, splitStatements } from './index.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TOOL = path.join(ROOT, 'tools/apply_migrations.py');
const py = (args, opts = {}) => spawnSync('python3', [TOOL, ...args], { encoding: 'utf8', ...opts });
const scratch = () => mkdtempSync(path.join(tmpdir(), 'us-apply-mig-'));
const migDir = (root, files) => { const d = path.join(root, 'migrations'); mkdirSync(d, { recursive: true }); for (const [n, sql] of Object.entries(files)) writeFileSync(path.join(d, n), sql); return d; };
// The probes of the round-3 finding (US-01-R04), the same as in export.test.js.
const HIDDEN = {
  backtick_comment: 'CREATE TABLE IF NOT EXISTS `a/*b` (x); DROP TABLE org; CREATE TABLE IF NOT EXISTS `c*/` (y);',
  backtick_quote: "CREATE TABLE `it's` (a); DELETE FROM org;",
  bracket_dashes: 'CREATE TABLE [a--b] (x); DELETE FROM org;',
};
const CTE_UPSERT = v => `WITH x AS (SELECT 1) INSERT OR ${v} INTO org (key, value) SELECT 'name','lost' WHERE true ON CONFLICT(key) DO UPDATE SET value = excluded.value;`;
const FIRED = 'CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END; INSERT INTO t VALUES (1);';
const FILES = {
  '0001_org.sql': `CREATE TABLE IF NOT EXISTS org (key TEXT PRIMARY KEY, value TEXT); INSERT OR IGNORE INTO org (key, value) VALUES ('name', 'Example'), ('slug', 'a;b');`,
  '0002_drop.sql': `DROP TABLE org;`,
};

test('US-01-R04: the Python classifier reaches the same verdict as core/export on every migration shipped here and on the hard cases', () => {
  const samples = [
    `CREATE TABLE IF NOT EXISTS a (id INTEGER); CREATE INDEX IF NOT EXISTS i ON a(id); DROP VIEW IF EXISTS v; INSERT OR IGNORE INTO a VALUES (1);`,
    `DROP TABLE IF EXISTS items; ALTER TABLE roles DROP COLUMN model; -- DELETE FROM org\nDELETE FROM claims WHERE 1; UPDATE "outcomes" SET result='x'; ALTER TABLE org RENAME TO org2;`,
    `CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE a SET id = CASE WHEN id > 1 THEN 1 ELSE 0 END; DELETE FROM b; END; CREATE TABLE c (x TEXT DEFAULT ';--');`,
    `/* DROP TABLE x; */ REPLACE INTO t VALUES (1); INSERT OR REPLACE INTO u VALUES (2); TRUNCATE TABLE v; UPDATE OR IGNORE w SET a = 'it''s;';`,
    `DROP TABLE main.a; DELETE FROM "main"."b"; DELETE FROM other.c; WITH g AS (SELECT 1) DELETE FROM d WHERE id IN (SELECT * FROM g); INSERT INTO e VALUES (1) ON CONFLICT(x) DO UPDATE SET x = 2; INSERT INTO f VALUES (1) ON CONFLICT DO NOTHING;`,
    'DROP TABLE "my items"; DROP TABLE "1x"; DELETE FROM [my items]; UPDATE `odd``name` SET x = 1; DROP TABLE \u00edtems; ALTER TABLE "a.b" DROP COLUMN c; DROP TABLE "items";',
    `ALTER TABLE "my items" ADD COLUMN note TEXT DEFAULT 'drop'; ALTER TABLE ; DROP TABLE; INSERT OR ROLLBACK INTO org (key) VALUES (1) ON CONFLICT(key) DO UPDATE SET key = 2;`,
    // round 3: the four quoting forms, a CTE in front of an upsert, triggers fired in the file, default-deny, comments as whitespace
    ...Object.values(HIDDEN), ...['IGNORE', 'ABORT', 'FAIL', 'ROLLBACK'].map(CTE_UPSERT), FIRED,
    'CREATE TRIGGER tr AFTER DELETE ON t BEGIN DELETE FROM kept; END; INSERT INTO t VALUES (1);',
    'CREATE TRIGGER a1 AFTER INSERT ON t BEGIN INSERT INTO u VALUES (NEW.a); END; CREATE TRIGGER b1 AFTER INSERT ON u BEGIN DELETE FROM kept; END; INSERT INTO t VALUES (1);',
    'CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END; DROP TRIGGER tr; INSERT INTO t VALUES (1);',
    "CREATE TEMP TRIGGER IF NOT EXISTS \"t r\" BEFORE UPDATE OF a, \"b c\" ON t WHEN NEW.a > (SELECT CASE WHEN 1 THEN 2 END) BEGIN UPDATE kept SET x = CASE WHEN x > 1 THEN 1 ELSE 0 END; SELECT RAISE(ABORT, 'no; end'); END; UPDATE t SET a = 1;",
    'CREATE TRIGGER tr AFTER INSERT ON t BEGIN UPDATE t SET begin = 1; END; INSERT INTO t VALUES (1);',
    'CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; DELETE FROM org', 'EXPLAIN CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1; END; SELECT 2;',
    'PRAGMA writable_schema = 1; VACUUM; REINDEX; BEGIN; COMMIT; SAVEPOINT s; RELEASE s; INSERT OR SOMETHING INTO org VALUES (1, 2);',
    "DROP/**/TABLE org; DELETE -- note\nFROM org; DROP TABLE 'org'; DROP TABLE \"unterminated",
    "CREATE VIRTUAL TABLE f USING fts5(body); CREATE TEMP VIEW v AS SELECT 1; DROP INDEX IF EXISTS i; WITH \"delete\" AS (SELECT 1) DELETE FROM org; INSERT INTO org (key) VALUES ('on conflict do update');",
    'UPDATE OR REPLACE org SET key = 1; REPLACE INTO t VALUES (1); TRUNCATE kept; DROP TABLE trıgger; CREATE TRİGGER x AFTER INSERT ON t BEGIN SELECT 1; END;',
    "\u00ednames; `a` ; [b] ; 'c' ; \"d\" ; -- trailing\n/* open",
  ];
  const dirs = [path.join(ROOT, 'core/migrations'), path.join(ROOT, 'adapters/shared/migrations')];
  for (const m of readdirSync(path.join(ROOT, 'core'))) dirs.push(path.join(ROOT, 'core', m, 'migrations'));
  for (const d of dirs.filter(existsSync)) for (const f of readdirSync(d).filter(n => n.endsWith('.sql'))) samples.push(readFileSync(path.join(d, f), 'utf8'));
  assert.ok(samples.length > 40);
  const cases = samples.map(sql => ({ sql, schema: [] }));
  cases.push({ sql: 'INSERT INTO t VALUES (1);', schema: ['CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END'] });
  cases.push({ sql: 'INSERT INTO t VALUES (1);', schema: ['-- kept\nCREATE TRIGGER tr AFTER DELETE ON t BEGIN DELETE FROM kept; END'] });
  // what SQLite does past the statement text: REPLACE clauses, foreign key actions, renames and drops of tables that hold triggers
  const parent = 'CREATE TABLE parent (id INTEGER PRIMARY KEY)', child = 'CREATE TABLE child (pid INTEGER REFERENCES parent(id) ON DELETE CASCADE, note TEXT)';
  for (const [sql, schema] of [
    [`INSERT INTO org (key, value) VALUES ('name', 'lost'); INSERT OR IGNORE INTO org VALUES ('a', 'b'); UPDATE org SET value = 1;`, ['CREATE TABLE org (key TEXT PRIMARY KEY ON CONFLICT REPLACE, value TEXT)']],
    ['CREATE TABLE r (k PRIMARY KEY ON CONFLICT REPLACE, v); INSERT INTO r VALUES (1, 2); CREATE TABLE IF NOT EXISTS org (key TEXT); INSERT INTO org VALUES (1);', ['CREATE TABLE "org" (key TEXT UNIQUE ON CONFLICT REPLACE)']],
    ['DELETE FROM parent WHERE id = 1; UPDATE parent SET id = 2; DROP TABLE parent; INSERT OR REPLACE INTO parent VALUES (1);', [parent, child]],
    ['DELETE FROM parent;', [parent, 'CREATE TABLE child (pid INTEGER REFERENCES parent ON DELETE SET NULL ON UPDATE SET DEFAULT)', 'CREATE TABLE c2 (pid INTEGER, FOREIGN KEY (pid) REFERENCES parent (id) ON UPDATE CASCADE ON DELETE RESTRICT)']],
    ['ALTER TABLE child ADD COLUMN gid INTEGER REFERENCES parent(id) ON DELETE CASCADE; DELETE FROM parent;', [parent, 'CREATE TABLE child (x)']],
    ['DELETE FROM parent;', [parent, child, 'CREATE TABLE grand (cid INTEGER REFERENCES child(pid) ON DELETE CASCADE)', 'CREATE TRIGGER tc AFTER DELETE ON grand BEGIN DELETE FROM kept; END', 'CREATE TABLE selfref (id INTEGER PRIMARY KEY, up INTEGER REFERENCES selfref(id) ON DELETE CASCADE)']],
    ['DELETE FROM selfref;', ['CREATE TABLE selfref (id INTEGER PRIMARY KEY, up INTEGER REFERENCES selfref(id) ON DELETE CASCADE)']],
    ['ALTER TABLE t RENAME TO t2; INSERT INTO t2 VALUES (1); ALTER TABLE parent RENAME TO "p 2"; DELETE FROM "p 2";', ['CREATE TABLE t (a)', 'CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END', parent, child]],
    ['DROP TABLE t; CREATE TABLE t (a); INSERT INTO t VALUES (1); ALTER TABLE child RENAME TO kid; DELETE FROM parent;', ['CREATE TABLE t (a)', 'CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END', parent, child]],
  ]) cases.push({ sql, schema });
  const code = `import json, sys; sys.path.insert(0, ${JSON.stringify(path.dirname(TOOL))}); import apply_migrations as m
print(json.dumps([[m.classify(c["sql"], c["schema"]), m.split_statements(c["sql"])] for c in json.load(sys.stdin)]))`;
  const r = spawnSync('python3', ['-c', code], { input: JSON.stringify(cases), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  cases.forEach((c, i) => {
    assert.deepEqual(got[i][1], splitStatements(c.sql), `split ${i}: ${c.sql.slice(0, 60)}`);
    assert.deepEqual(got[i][0], classify(c.sql, { schema: c.schema }), `sample ${i}: ${c.sql.slice(0, 60)}`);
  });
});

test('US-01-R04: apply_migrations.py with a destructive file and no --export-dir exits non-zero and names the file, and the data is untouched', () => {
  const root = scratch();
  try {
    const db = path.join(root, 'local.db');
    const r = py(['--sqlite', db, '--dir', migDir(root, FILES)]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /0002_drop\.sql: destructive migration/);
    assert.match(r.stderr, /needs --export-dir/);
    const con = new DatabaseSync(db);
    assert.equal(con.prepare(`SELECT COUNT(*) AS n FROM org`).get().n, 2, 'the table was not dropped');
    con.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('US-01-R04: with --export-dir the table is written, read back, matched and recorded before the file runs', () => {
  const root = scratch();
  try {
    const db = path.join(root, 'local.db'); const out = path.join(root, 'exports');
    const r = py(['--sqlite', db, '--dir', migDir(root, FILES), '--export-dir', out]);
    assert.equal(r.status, 0, r.stderr);
    const con = new DatabaseSync(db);
    assert.equal(con.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'org'`).get().n, 0, 'the migration ran');
    const proof = con.prepare(`SELECT * FROM export_ledger`).get();
    con.close();
    assert.equal(proof.verified, 1); assert.equal(proof.table_name, 'org'); assert.equal(proof.migration, '0002_drop.sql'); assert.equal(proof.row_count, 2);
    assert.match(proof.sha256, /^[0-9a-f]{64}$/);
    const lines = readFileSync(proof.object_key, 'utf8').split('\n').map(l => JSON.parse(l));
    assert.deepEqual(lines, [{ key: 'name', value: 'Example' }, { key: 'slug', value: 'a;b' }]);
    // applying again is idempotent: the table is gone, there is nothing to export, and the run succeeds
    assert.equal(py(['--sqlite', db, '--dir', migDir(root, FILES), '--export-dir', out]).status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('US-01-R04: an export directory that cannot be written refuses the migration and leaves the data (nothing is swallowed)', () => {
  const root = scratch();
  try {
    const db = path.join(root, 'local.db'); const blocked = path.join(root, 'blocked');
    writeFileSync(blocked, 'a file where the export directory should be');
    const r = py(['--sqlite', db, '--dir', migDir(root, FILES), '--export-dir', blocked]);
    assert.notEqual(r.status, 0);
    assert.ok(r.stderr.length > 0, 'the failure is printed');
    const con = new DatabaseSync(db);
    assert.equal(con.prepare(`SELECT COUNT(*) AS n FROM org`).get().n, 2);
    con.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('US-01-R04: --d1 prints the wrangler export before the destructive file, refuses without --export-dir, and with --run checks the dump is not empty', () => {
  const root = scratch();
  try {
    const dir = migDir(root, FILES); const out = path.join(root, 'exports');
    const refused = py(['--d1', 'my-db', '--dir', dir]);
    assert.equal(refused.status, 1); assert.match(refused.stderr, /0002_drop\.sql: destructive migration/);
    const dry = py(['--d1', 'my-db', '--dir', dir, '--export-dir', out]);
    assert.equal(dry.status, 0, dry.stderr);
    const lines = dry.stdout.trim().split('\n');
    const exp = lines.findIndex(l => /wrangler d1 export my-db --remote --table org --output /.test(l));
    const exec2 = lines.findIndex(l => /wrangler d1 execute my-db --remote --file .*0002_drop\.sql/.test(l));
    assert.ok(exp >= 0 && exec2 > exp, 'the export command comes before the file that drops the table');
    assert.ok(!lines.slice(0, exp).some(l => /0002_drop/.test(l)));
    // a shim for npx: `d1 export` writes the dump (or an empty file when EMPTY=1), anything else succeeds
    const bin = path.join(root, 'bin'); mkdirSync(bin);
    writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\nout=""; prev=""; for a in "$@"; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done\nif [ "$3" = "export" ] && [ -n "$out" ]; then if [ "$EMPTY" = "1" ]; then : > "$out"; else echo "CREATE TABLE org (key TEXT);" > "$out"; fi; fi\nif [ "$3" = "execute" ]; then case "$*" in *--json*) if [ "$MISSING" = "1" ]; then echo '[{"results":[]}]'; else echo '[{"results":[{"name":"org"}]}]'; fi;; esac; fi\nexit 0\n`);
    chmodSync(path.join(bin, 'npx'), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const ran = py(['--d1', 'my-db', '--run', '--dir', dir, '--export-dir', out], { env });
    assert.equal(ran.status, 0, ran.stderr);
    assert.ok(statSync(path.join(out, '0002_drop.sql', 'org.sql')).size > 0);
    const empty = py(['--d1', 'my-db', '--run', '--dir', dir, '--export-dir', path.join(root, 'exports2')], { env: { ...env, EMPTY: '1' } });
    assert.equal(empty.status, 1); assert.match(empty.stderr, /export of org before 0002_drop\.sql is missing or empty; migration refused/);
    // a table that is not on the remote database yet has nothing to lose: no export is attempted, and the file still runs
    const none = py(['--d1', 'my-db', '--run', '--dir', dir, '--export-dir', path.join(root, 'exports3')], { env: { ...env, MISSING: '1' } });
    assert.equal(none.status, 0, none.stderr);
    assert.ok(!existsSync(path.join(root, 'exports3', '0002_drop.sql', 'org.sql')), 'no export of a table that is not there');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('US-01-R04: apply_migrations.py reads a schema-qualified drop as the table it names and exports it first; a table in another schema is refused', () => {
  const root = scratch();
  try {
    const db = path.join(root, 'local.db'); const out = path.join(root, 'exports');
    const dir = migDir(root, { '0001_org.sql': FILES['0001_org.sql'], '0002_drop.sql': `DROP TABLE main.org;` });
    const bare = py(['--sqlite', db, '--dir', dir]);
    assert.notEqual(bare.status, 0, 'a qualified drop is destructive and needs --export-dir');
    assert.match(bare.stderr, /0002_drop\.sql: destructive migration/);
    const ok = py(['--sqlite', db, '--dir', dir, '--export-dir', out]);
    assert.equal(ok.status, 0, ok.stderr);
    assert.ok(readdirSync(path.join(out, '0002_drop.sql')).some(n => n.startsWith('org-')), 'the table was exported before it was dropped');
    const attached = migDir(path.join(root, 'b'), { '0001_x.sql': `DELETE FROM other.org;` });
    const refused = py(['--sqlite', path.join(root, 'b.db'), '--dir', attached, '--export-dir', path.join(root, 'exports-b')]);
    assert.notEqual(refused.status, 0); assert.match(refused.stderr, /other\.org is in another schema/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('US-01-R04: apply_migrations.py refuses a destructive file whose table is not a plain name, before it exports or runs anything', () => {
  const root = scratch();
  try {
    const db = path.join(root, 'local.db'); const out = path.join(root, 'exports');
    const dir = migDir(root, { '0001_odd.sql': `CREATE TABLE IF NOT EXISTS "my items" (x); INSERT INTO "my items" VALUES (1);`, '0002_drop.sql': `DROP TABLE "my items";` });
    const r = py(['--sqlite', db, '--dir', dir, '--export-dir', out]);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /0002_drop\.sql: my items cannot be resolved to a table name/);
    const con = new DatabaseSync(db);
    assert.equal(con.prepare(`SELECT COUNT(*) AS n FROM "my items"`).get().n, 1, 'the table and its row are still there');
    con.close();
    assert.ok(!existsSync(path.join(out, '0002_drop.sql')), 'nothing was exported for a name that cannot be resolved');
    const d1 = py(['--d1', 'my-db', '--dir', dir, '--export-dir', out]);
    assert.equal(d1.status, 1); assert.match(d1.stderr, /0002_drop\.sql: my items cannot be resolved to a table name/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

const rows = (db, sql) => { const con = new DatabaseSync(db); try { return con.prepare(sql).all(); } finally { con.close(); } };

test('US-01-R04: apply_migrations.py reads all four quoting forms: a drop or delete behind a backtick or bracket name is refused without --export-dir and exported first with it, and every statement of the file runs', () => {
  for (const [label, sql] of Object.entries(HIDDEN)) {
    const root = scratch();
    try {
      const db = path.join(root, 'local.db'); const out = path.join(root, 'exports');
      const dir = migDir(root, { '0001_org.sql': FILES['0001_org.sql'], '0002_hidden.sql': sql });
      const bare = py(['--sqlite', db, '--dir', dir]);
      assert.notEqual(bare.status, 0, `${label}: refused without --export-dir`);
      assert.match(bare.stderr, /0002_hidden\.sql: destructive migration/);
      assert.equal(rows(db, `SELECT COUNT(*) AS n FROM org`)[0].n, 2, `${label}: the data is untouched`);
      const ok = py(['--sqlite', db, '--dir', dir, '--export-dir', out]);
      assert.equal(ok.status, 0, ok.stderr);
      const proof = rows(db, `SELECT * FROM export_ledger`);
      assert.equal(proof.length, 1); assert.equal(proof[0].table_name, 'org'); assert.equal(proof[0].row_count, 2); assert.equal(proof[0].verified, 1);
      if (label === 'backtick_comment') assert.equal(rows(db, "SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('org', 'a/*b', 'c*/')")[0].n, 2, 'org dropped, both tables made');
      else assert.equal(rows(db, `SELECT COUNT(*) AS n FROM org`)[0].n, 0, `${label}: the delete ran after the export`);
      const plan = py(['--d1', 'my-db', '--dir', dir, '--export-dir', out]).stdout.trim().split('\n');
      const exp = plan.findIndex(l => /wrangler d1 export my-db --remote --table org /.test(l));
      const run2 = plan.findIndex(l => /wrangler d1 execute my-db --remote --file .*0002_hidden\.sql/.test(l));
      assert.ok(exp >= 0 && run2 > exp, `${label}: the D1 plan exports org before the file`);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});

test('US-01-R04: apply_migrations.py reads a CTE in front of an upsert, and a trigger fired by the file or by a later file, as the loss it is', () => {
  const root = scratch();
  try {
    const out = path.join(root, 'exports');
    for (const v of ['IGNORE', 'ROLLBACK']) {
      const db = path.join(root, `cte-${v}.db`);
      const dir = migDir(path.join(root, v), { '0001_org.sql': FILES['0001_org.sql'], '0002_cte.sql': CTE_UPSERT(v) });
      assert.notEqual(py(['--sqlite', db, '--dir', dir]).status, 0, `OR ${v}: refused without --export-dir`);
      assert.equal(rows(db, `SELECT value FROM org WHERE key = 'name'`)[0].value, 'Example');
      assert.equal(py(['--sqlite', db, '--dir', dir, '--export-dir', path.join(out, v)]).status, 0);
      assert.equal(rows(db, `SELECT value FROM org WHERE key = 'name'`)[0].value, 'lost');
      assert.equal(rows(db, `SELECT table_name FROM export_ledger`)[0].table_name, 'org', 'the row was exported before it was overwritten');
    }
    const base = `CREATE TABLE IF NOT EXISTS t (a); CREATE TABLE IF NOT EXISTS kept (x); INSERT INTO kept SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM kept);`;
    const same = migDir(path.join(root, 'same'), { '0001_base.sql': base, '0002_fired.sql': FIRED });
    const later = migDir(path.join(root, 'later'), { '0001_base.sql': base, '0002_trig.sql': 'CREATE TRIGGER IF NOT EXISTS tr AFTER INSERT ON t BEGIN DELETE FROM kept; END;', '0003_insert.sql': 'INSERT INTO t VALUES (1);' });
    for (const [label, dir, file] of [['same file', same, '0002_fired.sql'], ['later file', later, '0003_insert.sql']]) {
      const db = path.join(root, `${label.replace(' ', '-')}.db`);
      const bare = py(['--sqlite', db, '--dir', dir]);
      assert.notEqual(bare.status, 0, `${label}: refused without --export-dir`); assert.match(bare.stderr, new RegExp(`${file.replace('.', '\\.')}: destructive migration`));
      assert.equal(rows(db, `SELECT COUNT(*) AS n FROM kept`)[0].n, 1, `${label}: the table the trigger empties is untouched`);
      assert.equal(py(['--sqlite', db, '--dir', dir, '--export-dir', path.join(out, label)]).status, 0);
      assert.equal(rows(db, `SELECT table_name, row_count FROM export_ledger`).map(r => `${r.table_name}:${r.row_count}`).join(), 'kept:1');
      const plan = py(['--d1', 'my-db', '--dir', dir, '--export-dir', path.join(out, label)]).stdout;
      assert.match(plan, /wrangler d1 export my-db --remote --table kept /, `${label}: the D1 plan exports the table the trigger empties`);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('US-01-R04: the sqlite applier runs the statements it classified one at a time in one transaction, and SQLite itself reports what a file drops or rewrites', () => {
  const root = scratch();
  try {
    const db = path.join(root, 'local.db');
    const dir = migDir(root, { '0001_org.sql': FILES['0001_org.sql'], '0002_half.sql': `CREATE TABLE IF NOT EXISTS extra (x); INSERT INTO table_that_is_not_there (x) VALUES (1);` });
    const r = py(['--sqlite', db, '--dir', dir]);
    assert.notEqual(r.status, 0); assert.match(r.stderr, /0002_half\.sql: no such table: table_that_is_not_there/);
    assert.equal(rows(db, `SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'extra'`)[0].n, 0, 'the file landed whole or not at all');
    // the dry run: a savepoint that is always rolled back, with an authorizer recording every delete, update or drop SQLite compiles, trigger bodies included
    const code = `import json, sqlite3, sys; sys.path.insert(0, ${JSON.stringify(path.dirname(TOOL))}); import apply_migrations as m
con = sqlite3.connect(":memory:", isolation_level=None)
con.executescript("CREATE TABLE org (key TEXT PRIMARY KEY, value TEXT); INSERT INTO org VALUES ('name', 'x'); CREATE TABLE t (a); CREATE TABLE kept (x); INSERT INTO kept VALUES (1); CREATE TRIGGER tr AFTER INSERT ON t BEGIN DELETE FROM kept; END;")
con.executescript("CREATE VIEW v AS SELECT key FROM org; CREATE VIEW w AS SELECT 1 AS z; CREATE TRIGGER io INSTEAD OF DELETE ON w BEGIN SELECT 1; END;")
out = [m.touched(con, ["DELETE FROM org"]), m.touched(con, ["INSERT INTO t VALUES (1)"]),
       m.touched(con, ["CREATE TABLE IF NOT EXISTS z (a)", "INSERT INTO z VALUES (1)", "ALTER TABLE org ADD COLUMN n", "DROP VIEW IF EXISTS v", "CREATE VIEW v AS SELECT 1", "DROP VIEW v", "DELETE FROM w"])]
out.append([con.execute("SELECT COUNT(*) FROM org").fetchone()[0], con.execute("SELECT COUNT(*) FROM kept").fetchone()[0], con.execute("SELECT COUNT(*) FROM sqlite_master WHERE name = 'z'").fetchone()[0], con.in_transaction])
print(json.dumps(out))`;
    const t = spawnSync('python3', ['-c', code], { encoding: 'utf8' });
    assert.equal(t.status, 0, t.stderr);
    const [del, fired, additive, after] = JSON.parse(t.stdout);
    assert.deepEqual(del.map(f => [f.table, f.kind]), [['org', 'delete rows']]);
    assert.deepEqual(fired.map(f => [f.table, f.kind, f.via]), [['kept', 'delete rows', 'tr']], 'a trigger body is reported with the trigger that runs it');
    assert.deepEqual(additive, [], 'creating, inserting, adding a column, dropping a view and deleting through a view lose nothing');
    assert.deepEqual(after, [1, 1, 0, false], 'the dry run changed nothing and left no transaction open');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('US-01-R04: apply_migrations.py counts a REPLACE clause in the table and a foreign key action that earlier files declared', () => {
  const root = scratch();
  try {
    const db = path.join(root, 'local.db'); const out = path.join(root, 'exports');
    const dir = migDir(root, {
      '0001_org.sql': `CREATE TABLE IF NOT EXISTS r_org (key TEXT PRIMARY KEY ON CONFLICT REPLACE, value TEXT); INSERT OR IGNORE INTO r_org VALUES ('name', 'precious');`,
      '0002_insert.sql': `INSERT INTO r_org (key, value) VALUES ('name', 'lost');`,
    });
    const bare = py(['--sqlite', db, '--dir', dir]);
    assert.notEqual(bare.status, 0); assert.match(bare.stderr, /0002_insert\.sql: destructive migration \(replace rows on r_org\)/);
    assert.equal(rows(db, `SELECT value FROM r_org`)[0].value, 'precious');
    assert.equal(py(['--sqlite', db, '--dir', dir, '--export-dir', out]).status, 0);
    assert.equal(rows(db, `SELECT table_name FROM export_ledger`)[0].table_name, 'r_org');
    const fk = migDir(path.join(root, 'fk'), {
      '0001_tables.sql': 'CREATE TABLE IF NOT EXISTS parent (id INTEGER PRIMARY KEY); CREATE TABLE IF NOT EXISTS child (pid INTEGER REFERENCES parent(id) ON DELETE CASCADE);',
      '0002_delete.sql': 'DELETE FROM parent WHERE id = 1;',
    });
    const plan = py(['--d1', 'my-db', '--dir', fk, '--export-dir', out]);
    assert.equal(plan.status, 0, plan.stderr);
    const lines = plan.stdout.trim().split('\n');
    const ix = re => lines.findIndex(l => re.test(l));
    assert.ok(ix(/--table parent /) >= 0 && ix(/--table child /) > ix(/--table parent /) && ix(/--file .*0002_delete\.sql/) > ix(/--table child /),
      'D1 enforces foreign keys, so the child a cascade empties is exported before the file');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
