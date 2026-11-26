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
import { classify } from './index.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const TOOL = path.join(ROOT, 'tools/apply_migrations.py');
const py = (args, opts = {}) => spawnSync('python3', [TOOL, ...args], { encoding: 'utf8', ...opts });
const scratch = () => mkdtempSync(path.join(tmpdir(), 'us-apply-mig-'));
const migDir = (root, files) => { const d = path.join(root, 'migrations'); mkdirSync(d, { recursive: true }); for (const [n, sql] of Object.entries(files)) writeFileSync(path.join(d, n), sql); return d; };
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
  ];
  const dirs = [path.join(ROOT, 'core/migrations'), path.join(ROOT, 'adapters/shared/migrations')];
  for (const m of readdirSync(path.join(ROOT, 'core'))) dirs.push(path.join(ROOT, 'core', m, 'migrations'));
  for (const d of dirs.filter(existsSync)) for (const f of readdirSync(d).filter(n => n.endsWith('.sql'))) samples.push(readFileSync(path.join(d, f), 'utf8'));
  assert.ok(samples.length > 40);
  const code = `import json, sys; sys.path.insert(0, ${JSON.stringify(path.dirname(TOOL))}); import apply_migrations as m
print(json.dumps([m.classify(s) for s in json.load(sys.stdin)]))`;
  const r = spawnSync('python3', ['-c', code], { input: JSON.stringify(samples), encoding: 'utf8', maxBuffer: 1 << 26 });
  assert.equal(r.status, 0, r.stderr);
  const got = JSON.parse(r.stdout);
  samples.forEach((sql, i) => assert.deepEqual(got[i], classify(sql), `sample ${i}: ${sql.slice(0, 60)}`));
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
    writeFileSync(path.join(bin, 'npx'), `#!/bin/sh\nout=""; prev=""; for a in "$@"; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done\nif [ "$3" = "export" ] && [ -n "$out" ]; then if [ "$EMPTY" = "1" ]; then : > "$out"; else echo "CREATE TABLE org (key TEXT);" > "$out"; fi; fi\nexit 0\n`);
    chmodSync(path.join(bin, 'npx'), 0o755);
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    const ran = py(['--d1', 'my-db', '--run', '--dir', dir, '--export-dir', out], { env });
    assert.equal(ran.status, 0, ran.stderr);
    assert.ok(statSync(path.join(out, '0002_drop.sql', 'org.sql')).size > 0);
    const empty = py(['--d1', 'my-db', '--run', '--dir', dir, '--export-dir', path.join(root, 'exports2')], { env: { ...env, EMPTY: '1' } });
    assert.equal(empty.status, 1); assert.match(empty.stderr, /export of org before 0002_drop\.sql is missing or empty; migration refused/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
