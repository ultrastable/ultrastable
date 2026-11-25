// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// KNOWLEDGE-GRAPH-1: every deployment keeps a graph of its own items and mines it for insights, with no tenant script. The tick maps the org's items
// to core/knowledge records (an item links to the item that triggers it; owner role and project are entities), diffs against the stored snapshot,
// and writes each insight to knowledge_insights (read at /api/knowledge) and the tick notes. Twin of tools/graph.mjs in tenants that bring richer records.
import { tenantOf } from './tenant.js';  // Q-TENANT-row-isolation
import * as K from './vendor/core/knowledge.js';
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];

// SCHEMA-SELF-1: kept equal to migrations/0020_knowledge.sql by test/knowledge.test.js.
export const KNOWLEDGE_DDL = [
  `CREATE TABLE IF NOT EXISTS knowledge_snapshots ( tenant_id TEXT NOT NULL, at TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (tenant_id) )`,
  `CREATE TABLE IF NOT EXISTS knowledge_insights ( id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, evidence TEXT NOT NULL )`,
  `CREATE INDEX IF NOT EXISTS knowledge_insights_at ON knowledge_insights(tenant_id, at)`,
];
const ready = new WeakSet();
async function ensureSchema(db) { if (ready.has(db)) return; for (const q of KNOWLEDGE_DDL) await db.prepare(q).run(); ready.add(db); }

export const toRecords = items => items.map(i => ({ id: i.id, kind: i.kind || 'work', title: i.title, text: i.done_check || '', refs: i.trigger_on ? [i.trigger_on] : [], entities: [i.owner_role, i.project].filter(Boolean), source: 'items', at: i.updated_at || i.created_at }));

export async function knowledgeStep(db, ctx, { max_items = 3000, max_insights = 12 } = {}) {
  await ensureSchema(db);
  const t = tenantOf(ctx) || 'self';
  const items = await all(db, `SELECT id, kind, title, done_check, trigger_on, owner_role, project, updated_at, created_at FROM items WHERE (tenant_id IS NULL OR tenant_id = ?) ORDER BY updated_at DESC LIMIT ?`, t, max_items);
  if (items.length < 2) return { insights: 0, skipped: 'fewer than two items' };
  const prevRow = (await all(db, `SELECT json FROM knowledge_snapshots WHERE tenant_id = ?`, t))[0];
  const prev = prevRow ? JSON.parse(prevRow.json) : null, now = (ctx.nowIso || new Date().toISOString()).replace(' ', 'T');
  const g = K.build({ records: toRecords(items), now }), snap = K.snapshot(g);
  const ins = K.insights(g, prev, { now, params: { maxInsights: max_insights } });
  // an unchanged graph writes nothing, so a quiet org produces no rows and no "changes"
  if (prev && JSON.stringify({ ...prev, at: 0 }) === JSON.stringify({ ...snap, at: 0 })) return { insights: 0, unchanged: true };
  await db.prepare(`INSERT INTO knowledge_snapshots (tenant_id, at, json) VALUES (?, ?, ?) ON CONFLICT(tenant_id) DO UPDATE SET at = excluded.at, json = excluded.json`).bind(t, now, JSON.stringify(snap)).run();
  for (const i of ins) await db.prepare(`INSERT INTO knowledge_insights (tenant_id, at, kind, text, evidence) VALUES (?, ?, ?, ?, ?)`).bind(t, i.at, i.kind, i.id, JSON.stringify(i.evidence)).run();
  return { insights: ins.length, stats: g.stats };
}
export async function readKnowledge(db, t = 'self', limit = 50) { await ensureSchema(db); return { insights: (await all(db, `SELECT at, kind, text, evidence FROM knowledge_insights WHERE tenant_id = ? ORDER BY id DESC LIMIT ?`, t, limit)).map(r => ({ ...r, evidence: JSON.parse(r.evidence) })) }; }
