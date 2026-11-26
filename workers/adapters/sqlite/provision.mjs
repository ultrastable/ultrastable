// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The provision stage for a SQLite store (US-14-R07, T02). The bootstrap's provision stage is a plan of commands that create a store, apply the
// migrations and load the seed (wrangler for D1); an adapter replaces it with its own. This is the SQLite one:
//   node adapters/sqlite/provision.mjs --db <path | :memory:> --migrations <dir> [--seed <seed.sql>]
// It creates the file, applies every migration in order through the adapter's own handle (idempotent), executes the seed when given, prints one
// JSON line { db, tables, rows } and exits 0, or prints { error } and exits 1. Applying it twice leaves the same tables and rows.
import { readFileSync } from 'node:fs';
import { openDb } from './d1-sqlite.js';

export function provision({ db: file, migrations, seed = null } = {}) {
  if (!file) throw new Error('--db is required');
  if (!migrations) throw new Error('--migrations is required');
  const handle = openDb(file, migrations);
  try {
    if (seed) handle.raw.exec(readFileSync(seed, 'utf8'));
    const tables = handle.raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all().map(r => r.name);
    const rows = Object.fromEntries(['roles', 'items', 'gate_cards', 'org'].filter(t => tables.includes(t)).map(t => [t, handle.raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
    return { db: file, tables, rows };
  } finally { handle.close(); }
}

const arg = (argv, name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null; };
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const out = provision({ db: arg(process.argv, 'db'), migrations: arg(process.argv, 'migrations'), seed: arg(process.argv, 'seed') });
    process.stdout.write(JSON.stringify({ ...out, tables: out.tables.length, table_names: out.tables }) + '\n');
  } catch (e) { process.stdout.write(JSON.stringify({ error: String(e.message).slice(0, 300) }) + '\n'); process.exitCode = 1; }
}
