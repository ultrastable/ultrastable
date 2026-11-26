// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Test helper: a D1-shaped in-memory database with the seed migrations plus any extra migration directories. The handle is the SQLite
// adapter's own (core/test/d1shim.js storeFor), so every module test runs over the adapter's handle (US-14-R07).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { storeFor } from '../test/d1shim.js';

const SEED_MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

export function makeDb(extraMigrationDirs = []) {
  const raw = new DatabaseSync(':memory:');
  for (const dir of [SEED_MIGRATIONS, ...extraMigrationDirs]) {
    for (const f of readdirSync(dir).filter(n => n.endsWith('.sql')).sort()) raw.exec(readFileSync(path.join(dir, f), 'utf8'));
  }
  return storeFor(raw);
}
