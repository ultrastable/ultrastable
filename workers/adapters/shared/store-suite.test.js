// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-14-T01 and US-14-R07: a store adapter passes the core's tick tests over its own handle. The L1 tick suite (core/test/tick.test.js,
// tick-metrics.test.js and the conformance tests core/conformance/l1.test.js) is run as child processes once per store named by
// ULTRASTABLE_STORE: `sqlite` (the adapter's handle, adapters/sqlite/d1-sqlite.js wrapSqlite) and `pg-recording` (the same handle, with
// every statement also translated by the Postgres shim at prepare time, so a SQLite-only construct fails the suite and the translated
// text is recorded). A live Postgres is adapters/postgres/live.test.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SUITE = ['core/test/tick.test.js', 'core/test/tick-metrics.test.js', 'core/conformance/l1.test.js'];

const runSuite = (store, record) => new Promise(resolve => {
  const env = { ...process.env, ULTRASTABLE_STORE: store, ...(record ? { ULTRASTABLE_PG_RECORD: record } : {}) };
  delete env.NODE_TEST_CONTEXT; // a child `node --test` started from inside a test would otherwise run as a sub-reporter and print no summary
  const child = spawn(process.execPath, ['--test', '--no-warnings', ...SUITE], { cwd: ROOT, env });
  let out = ''; child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { out += d; });
  const timer = setTimeout(() => child.kill('SIGKILL'), 150000); timer.unref();
  child.on('close', code => { clearTimeout(timer); resolve({ code, out }); });
});
const summary = out => Object.fromEntries([...out.matchAll(/^# (tests|pass|fail) (\d+)/gm)].map(m => [m[1], Number(m[2])]));

test("US-14-T01 and US-14-R07: the L1 tick suite passes over the SQLite adapter's own handle", async () => {
  const r = await runSuite('sqlite');
  const s = summary(r.out);
  assert.equal(r.code, 0, r.out.slice(-1500));
  assert.equal(s.fail, 0); assert.ok(s.tests >= 40, `the suite ran ${s.tests} tests`);
});

test('US-14-T01 and US-14-R07: the same suite passes with every statement also translated by the Postgres shim, and the translations are Postgres', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'us-store-'));
  try {
    const rec = path.join(dir, 'statements.jsonl');
    const r = await runSuite('pg-recording', rec);
    assert.equal(r.code, 0, r.out.slice(-1500));
    assert.ok(existsSync(rec), 'statements were recorded');
    const rows = [...new Set(readFileSync(rec, 'utf8').trim().split('\n'))].map(l => JSON.parse(l));
    assert.ok(rows.length >= 40, `${rows.length} distinct statements recorded`);
    for (const { sql, text, params } of rows) {
      assert.ok(!/datetime\('now'/i.test(text), `datetime('now') left in: ${text}`);
      assert.ok(!/\bINSERT\s+OR\s+/i.test(text), `INSERT OR left in: ${text}`);
      assert.ok(!/\bAUTOINCREMENT\b/i.test(text), `AUTOINCREMENT left in: ${text}`);
      assert.equal((text.replace(/'(?:[^']|'')*'/g, "''").match(/\$\d+/g) || []).length, params, `placeholders in: ${sql}`);
    }
    assert.ok(rows.some(x => /\$2/.test(x.text)), 'question marks became numbered placeholders');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
