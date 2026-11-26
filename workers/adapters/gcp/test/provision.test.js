// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-14-T02 and R07: the bootstrap's provision stage replaced by the SQLite adapter's. The bootstrap is run in dry-run mode on a copy of the tree
// (it writes the plan and seed.sql and no command), and the adapter's provision command then does what that plan's migrate-and-seed commands do:
// creates the store, applies the migrations and loads the seed. The Python bootstrap tests (tests/test_bootstrap_trial.py and
// tests/test_bootstrap_temporary.py) are run beside it, unchanged. That bootstrap.py calls the adapter command itself when the runtime names one is
// the integration request recorded for cluster F; until it lands, this test proves the adapter side: the plan's two data steps are reproduced.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { provision } from '../../sqlite/provision.mjs';
import { openDb } from '../../sqlite/d1-sqlite.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const MIG = path.join(ROOT, 'core/migrations');
const L1_TABLES = ['claims', 'dispatches', 'doctrine_lineage', 'gate_cards', 'items', 'org', 'outcomes', 'predictions', 'roles', 'tick_runs', 'trust_ledger'];

function dryRunBootstrap(dir) {
  const copy = path.join(dir, 'tree'); const out = path.join(dir, 'out');
  cpSync(ROOT, copy, { recursive: true, filter: s => !/[\\/](\.git|node_modules|__pycache__)([\\/]|$)/.test(s) });
  const p = spawnSync('python3', [path.join(copy, 'bootstrap/bootstrap.py'), '--dry-run', '--root', copy, '--out', out], { encoding: 'utf8' });
  return { copy, out, p };
}

test('US-14-T02: the bootstrap plan\'s data steps (create the store, apply the migrations, load seed.sql) are done by the SQLite adapter\'s provision stage', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'us-prov-'));
  try {
    const { out, p } = dryRunBootstrap(dir);
    assert.equal(p.status, 0, String(p.stderr).slice(-400));
    const seed = path.join(out, 'seed.sql');
    assert.ok(existsSync(seed), 'the bootstrap wrote seed.sql');
    const plan = JSON.parse(readFileSync(path.join(out, 'boot-log.json'), 'utf8')).provision_plan || [];
    assert.ok(plan.some(c => /migrations apply/.test(c)) && plan.some(c => /d1 execute/.test(c)), `the plan names the migrate and seed steps: ${plan.join(' | ')}`);
    const dbFile = path.join(dir, 'store.db');
    const run = () => spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'adapters/sqlite/provision.mjs'), '--db', dbFile, '--migrations', MIG, '--seed', seed], { encoding: 'utf8' });
    const first = run(); assert.equal(first.status, 0, first.stdout + first.stderr);
    const a = JSON.parse(first.stdout);
    for (const t of L1_TABLES) assert.ok(a.table_names.includes(t), `table ${t}`);
    assert.ok(a.rows.roles > 0 && a.rows.items > 0, `the seed rows are there: ${JSON.stringify(a.rows)}`);
    const seedRoles = (readFileSync(seed, 'utf8').match(/INSERT[^;]*INTO roles/gi) || []).length;
    assert.ok(seedRoles > 0, 'seed.sql inserts roles');
    // idempotent: the same command again leaves the same tables (seed statements are INSERT OR IGNORE or fail loudly, never double)
    const second = run();
    if (second.status === 0) assert.deepEqual(JSON.parse(second.stdout).rows, a.rows);
    else assert.match(JSON.parse(second.stdout).error, /UNIQUE|constraint/i, 'a seed that is not idempotent fails loudly, never doubles');
    const h = openDb(dbFile); assert.equal(h.raw.prepare('SELECT COUNT(*) AS n FROM items').get().n, a.rows.items); h.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the provision stage reports a missing argument and an unreadable migrations directory as errors, never an empty store', () => {
  assert.throws(() => provision({ migrations: MIG }), /--db is required/);
  assert.throws(() => provision({ db: ':memory:' }), /--migrations is required/);
  assert.throws(() => provision({ db: ':memory:', migrations: '/no/such/dir' }), /ENOENT/);
  const p = spawnSync(process.execPath, ['--no-warnings', path.join(ROOT, 'adapters/sqlite/provision.mjs'), '--db', ':memory:'], { encoding: 'utf8' });
  assert.equal(p.status, 1); assert.match(JSON.parse(p.stdout).error, /--migrations is required/);
});

test('the Python bootstrap tests pass unchanged beside the adapter\'s provision stage', () => {
  const p = spawnSync('python3', ['-m', 'unittest', 'tests.test_bootstrap_trial', 'tests.test_bootstrap_temporary'], { cwd: ROOT, encoding: 'utf8', timeout: 170000 });
  assert.equal(p.status, 0, String(p.stderr).slice(-600));
});
