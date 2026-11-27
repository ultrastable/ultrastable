// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// US-SPEC-04 (the plus loop): US-04-R03, every closed item proposes one plus, proved against the seed runtime that implements it
// (worker/src/criticality.js emitSuccessors). Clocks are frozen, the database is in memory, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { ensureItem } from '../src/tick.js';
import { emitSuccessors } from '../src/criticality.js';

const crit = JSON.parse(readFileSync(new URL('../../autonomy/criticality.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-10T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const ctx = () => ({ now: NOW, nowIso: iso(NOW), tickId: 1, errors: [], notes: [], config: { org_slug: 'mine' } });
const done = (db, id, owner, priority, updated) => db.raw.prepare('INSERT INTO items (id, title, kind, owner_role, done_check, status, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
  .run(id, 't', 'work', owner, 'd', 'done', priority, iso(NOW - 864e5), updated);

test('US-04-R03: every closed item proposes one plus, a kind plus item for the same owner with a closing probe, and never two for the same item', async () => {
  const db = makeDb();
  done(db, 'A', 'program-manager', 7, '2026-11-09 10:00:00');
  done(db, 'B', 'operations', 12, '2026-11-09 11:00:00');
  assert.equal(await emitSuccessors(db, crit, ctx(), ensureItem), 2);
  const rows = db.raw.prepare("SELECT id, kind, owner_role, priority, closing_probe, done_check FROM items WHERE id LIKE 'NEXT-%' ORDER BY id").all();
  assert.deepEqual(rows.map((r) => [r.id, r.kind, r.owner_role, r.priority, r.closing_probe]),
    [['NEXT-A', 'plus', 'program-manager', 7, 'successor:A'], ['NEXT-B', 'plus', 'operations', 12, 'successor:B']]);
  assert.ok(rows.every((r) => r.done_check), 'each carries a done check');
  assert.equal(await emitSuccessors(db, crit, ctx(), ensureItem), 0, 'a second pass proposes nothing for an item that already has its plus');
});

test('US-04-R03: an item that is itself a successor or an idle repair proposes no plus of its own', async () => {
  const db = makeDb();
  done(db, 'NEXT-Z', 'operations', 5, '2026-11-09 10:00:00');
  done(db, 'IDLE-1', 'operations', 5, '2026-11-09 10:00:00');
  assert.equal(await emitSuccessors(db, crit, ctx(), ensureItem), 0);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM items WHERE id LIKE 'NEXT-NEXT-%' OR id = 'NEXT-IDLE-1'").get().n, 0);
});
