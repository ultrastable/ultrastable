// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The Worker's one ordered migrations directory is generated from the module list; drift fails the build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildMigrations, writeMigrations, OUT_DIR } from '../../tools/build_migrations.mjs';
import { MODULES, moduleList } from './modules.js';

test('the committed migrations directory equals the build output (no drift)', () => {
  const built = buildMigrations();
  const have = readdirSync(OUT_DIR).filter(f => f.endsWith('.sql')).sort();
  assert.deepEqual(have, built.map(b => b.file), 'file list drifted: run node tools/build_migrations.mjs');
  for (const b of built) assert.equal(readFileSync(path.join(OUT_DIR, b.file), 'utf8'), b.sql, `${b.file} drifted`);
});

test('files are numbered 0001 upward without a gap and named NNNN_<module>_<name>.sql', () => {
  const files = buildMigrations().map(b => b.file);
  files.forEach((f, i) => assert.match(f, new RegExp(`^${String(i + 1).padStart(4, '0')}_[a-z_]+_[A-Za-z0-9_]+\.sql$`)));
  const ids = MODULES.map(m => m.id);
  for (const f of files) assert.ok(ids.some(id => f.slice(5).startsWith(id + '_')), `${f} names no module`);
});

test('the bundle is append-only: a module that gains a migration adds one file and renames none', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'mig-'));
  try {
    const out = path.join(root, 'adapters/cloudflare/migrations');
    const modules = [{ id: 'one', dir: 'one/migrations' }, { id: 'two', dir: 'two/migrations' }];
    const put = (dir, name) => { mkdirSync(path.join(root, dir), { recursive: true }); writeFileSync(path.join(root, dir, name), `-- ${dir}/${name}\nSELECT 1;\n`); };
    put('one/migrations', '0001_a.sql'); put('two/migrations', '0001_b.sql');
    const first = buildMigrations({ root, outDir: out, modules });
    assert.deepEqual(first.map(f => f.file), ['0001_one_a.sql', '0002_two_b.sql']);
    writeMigrations(first, out);
    put('one/migrations', '0002_c.sql'); // the earlier module gains one: it must not push two_b to 0003
    const second = buildMigrations({ root, outDir: out, modules });
    assert.deepEqual(second.map(f => f.file), ['0001_one_a.sql', '0002_two_b.sql', '0003_one_c.sql']);
    assert.throws(() => { put('one/migrations', '0003_c.sql'); buildMigrations({ root, outDir: out, modules }); }, /two migrations are named c/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('pack migrations are added only when listed in config', () => {
  assert.equal(moduleList({}).length, MODULES.length);
  assert.deepEqual(moduleList({ pack_migrations: ['email'] }).at(-1), { id: 'pack_email', dir: 'packs/email/migrations' });
});

test('applying every migration in order to a fresh database succeeds, twice (idempotent)', () => {
  const raw = new DatabaseSync(':memory:');
  const files = readdirSync(OUT_DIR).filter(f => f.endsWith('.sql')).sort();
  for (let pass = 0; pass < 2; pass++) for (const f of files) raw.exec(readFileSync(path.join(OUT_DIR, f), 'utf8'));
  const tables = raw.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map(r => r.name);
  for (const t of ['items', 'tick_runs', 'claims_lock', 'router_calls', 'kernel_step_evidence', 'runner_runs', 'describe_claims', 'packs_registry', 'yield_calls', 'docgate_docs']) assert.ok(tables.includes(t), t);
});
