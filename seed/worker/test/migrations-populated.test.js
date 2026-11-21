// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// STATEFUL-MIGRATE-1: every migration is applied to a populated database, never only an empty one. After each file one synthetic
// row is written to every table that exists; after the last file every seeded row must still be there. An empty-database run
// cannot tell a table rebuild that copies rows (0027) from one that drops them. Idea credited to REP-0005 "stateful regeneration
// test" in tysoncung/regen.engineering (CC BY-SA 4.0 text; reimplemented here, no text or code copied).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../migrations/', import.meta.url);
const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
const tables = raw => raw.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_backup_%'`).all().map(r => r.name);
const value = c => /INT|REAL|NUM/i.test(c.type) ? 1 : `seed-${c.name}`;

function seedRow(raw, t, tag) {
  const cols = raw.prepare(`PRAGMA table_info("${t}")`).all();
  const use = cols.filter(c => (c.notnull && c.dflt_value == null) || c.pk);
  const names = use.length ? use.map(c => `"${c.name}"`) : [`"${cols[0].name}"`];
  const vals = (use.length ? use : [cols[0]]).map(c => { const v = value(c); return typeof v === 'string' ? `${v}-${tag}` : (c.pk ? null : v); });
  try { raw.prepare(`INSERT INTO "${t}" (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...vals); return true; }
  catch { return false; }   // a CHECK or foreign key the synthetic row cannot meet: that table is reported, not silently counted
}

test('migrations applied one by one to a populated database keep every row written before them', () => {
  const raw = new DatabaseSync(':memory:');
  const seeded = new Map(); const unseedable = new Set();
  files.forEach((f, i) => {
    raw.exec(readFileSync(new URL(f, dir), 'utf8'));
    for (const t of tables(raw)) {
      if (seedRow(raw, t, i)) seeded.set(t, (seeded.get(t) || 0) + 1); else unseedable.add(t);
    }
  });
  const lost = [];
  for (const [t, n] of seeded) {
    const have = tables(raw).includes(t) ? raw.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n : 0;
    if (have < n) lost.push(`${t}: wrote ${n}, kept ${have}`);
  }
  assert.deepEqual(lost, [], 'a migration dropped rows written before it');
  assert.ok(seeded.size >= tables(raw).length * 0.8, `most tables are exercised (seeded ${seeded.size}, unseedable: ${[...unseedable].join(', ')})`);
  assert.ok(seeded.has('trust_ledger'), 'the 0027 table rebuild runs against rows');
});
