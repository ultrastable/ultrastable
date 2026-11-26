// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The D1-compatible store for the tick tests: the SQLite adapter's own handle (adapters/sqlite/d1-sqlite.js wrapSqlite) over an in-memory
// database with the seed migrations, for tests only. ULTRASTABLE_STORE=pg-recording also translates every statement for Postgres as it is
// prepared and appends the results to the file named by ULTRASTABLE_PG_RECORD (US-14-R07: the suite runs over each adapter's handle).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, appendFileSync } from 'node:fs';
import { wrapSqlite } from '../../adapters/sqlite/d1-sqlite.js';
import { recordStatements } from '../../adapters/postgres/index.js';

/** Shared by core/_shared/testdb.js: the handle for the store named by ULTRASTABLE_STORE (sqlite by default). */
export function storeFor(raw, env = process.env) {
  const db = wrapSqlite(raw);
  if (env.ULTRASTABLE_STORE !== 'pg-recording') return db;
  const file = env.ULTRASTABLE_PG_RECORD;
  return recordStatements(db, { onStatement: file ? st => appendFileSync(file, JSON.stringify(st) + '\n') : undefined });
}

export function makeDb() {
  const raw = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) raw.exec(readFileSync(new URL(f, dir), 'utf8'));
  return storeFor(raw);
}
