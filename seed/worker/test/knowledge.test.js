// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { ensureItem } from '../src/tick.js';
import { knowledgeStep, readKnowledge, KNOWLEDGE_DDL } from '../src/knowledge.js';

test('SCHEMA-SELF-1: the Worker DDL equals the migration', () => {
  const sql = readFileSync(new URL('../migrations/0031_knowledge.sql', import.meta.url), 'utf8');
  for (const d of KNOWLEDGE_DDL) assert.ok(sql.includes(d), d.slice(0, 50));
});
test('items become a graph; insights are stored; an unchanged graph writes nothing; new items are reported', async () => {
  const db = makeDb(), ctx = { nowIso: '2026-11-25 12:00:00', notes: [] };
  for (const [id, trig] of [['A', null], ['B', 'A'], ['C', 'B']]) await ensureItem(db, { id, kind: 'work', owner_role: 'operations', title: 'Item ' + id, done_check: 'x', closing_probe: 'manual', trigger_on: trig });
  const r1 = await knowledgeStep(db, ctx); assert.ok(r1.insights > 0 && r1.stats.nodes >= 3);
  const r2 = await knowledgeStep(db, { ...ctx, nowIso: '2026-11-25 13:00:00' }); assert.equal(r2.unchanged, true);
  await ensureItem(db, { id: 'D', kind: 'work', owner_role: 'operations', title: 'Item D', done_check: 'x', closing_probe: 'manual', trigger_on: 'C' });
  await knowledgeStep(db, { ...ctx, nowIso: '2026-11-26 12:00:00' });
  const k = await readKnowledge(db); assert.ok(k.insights.some(i => i.kind === 'graph_growth') && k.insights.every(i => Array.isArray(i.evidence)));
});
