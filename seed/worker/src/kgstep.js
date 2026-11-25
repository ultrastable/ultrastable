// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// KGRAPH-1: the tick step that gives every system built from the seed its own knowledge graph from day one, with no configuration. It maps the
// system's own records (work items, objectives, metrics, roles) into the shared engine (knowledge.js), once an hour, and turns its sharpest
// finding into work: an objective no metric measures is a gap, filed as KG-<gap> (at most one a day, inside the originate cap) and closed by
// the graph itself when the gap is gone. Tenants feed the same engine with their own data (Unlearn: entries, studies, authors, topics).
import { runKg, insights, KG_DEFAULTS, tableRecords, TABLE_MAPPERS } from './knowledge.js';
import { tenantOf } from './tenant.js';
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];

export const SYSTEM_MAPPERS = {
  item: (d, { node, edge }) => {
    const i = node('item', d.title || d.id, { status: d.status, kind: d.kind }, 'item:' + d.id);
    if (d.owner_role) edge(i, 'owned_by', node('role', d.owner_role));
    if (d.project) edge(i, 'in_project', node('project', d.project));
    if (d.trigger_on) edge(i, 'after', node('item', d.trigger_on, {}, 'item:' + d.trigger_on));
  },
  objective: (d, { node, edge }) => { const o = node('objective', d.statement, {}, 'objective:' + d.id); if (d.owner_role) edge(o, 'owned_by', node('role', d.owner_role)); },
  metric: (d, { node, edge }) => {
    const m = node('metric', d.name, { kind: d.kind, source: d.source }, 'metric:' + d.id);
    if (d.objective_id) edge(m, 'measures', node('objective', d.objective_id, {}, 'objective:' + d.objective_id));
    if (d.owner_role) edge(m, 'owned_by', node('role', d.owner_role));
  },
};
export const SYSTEM_SPEC = {
  predict: [{ from: 'metric', to: 'objective' }],
  gaps: [{ id: 'unmeasured', kind: 'objective', need: { rel: 'measures', dir: 'in' }, text: n => `No metric measures the objective "${n.label}".`, weight: 1 }],
  link_text: (a, b, via) => `Metric "${a}" may measure objective "${b}" (both owned by ${via.join(', ')}).`,
  max_new_per_run: 3,
};

export async function systemRecords(db, tenant) {
  const own = `(tenant_id IS NULL OR tenant_id = ?)`;
  const items = await all(db, `SELECT id, title, kind, project, owner_role, trigger_on, status FROM items WHERE ${own} AND status NOT IN ('superseded','cancelled') ORDER BY id LIMIT 2000`, tenant);
  const objectives = await all(db, `SELECT id, statement, owner_role FROM objectives WHERE ${own} ORDER BY id`, tenant);
  const metrics = await all(db, `SELECT id, name, kind, source, objective_id, owner_role FROM metrics WHERE ${own} ORDER BY id`, tenant);
  return [...items.map(d => ({ type: 'item', source: 'item/' + d.id, data: d })), ...objectives.map(d => ({ type: 'objective', source: 'objective/' + d.id, data: d })),
    ...metrics.map(d => ({ type: 'metric', source: 'metric/' + d.id, data: d }))];
}

export async function knowledgeStep(db, ctx, ensureItem, { now = Date.now(), every_min = 55 } = {}) {
  const tenant = tenantOf(ctx);
  const last = await db.prepare(`SELECT at FROM kg_runs WHERE tenant = ? ORDER BY at DESC LIMIT 1`).bind(tenant).first().catch(() => null);
  if (last && now - last.at < every_min * 60000) return { skipped: true };
  // the system's own mapped records, plus every other table read with no configuration (zero-config extraction, from DATAGRAPH-1)
  const records = [...await systemRecords(db, tenant), ...await tableRecords(db, { as: { items: 'item', objectives: 'objective', metrics: 'metric' } })];
  const r = await runKg(db, { tenant, records, mappers: { ...TABLE_MAPPERS, ...SYSTEM_MAPPERS }, spec: { ...KG_DEFAULTS, ...SYSTEM_SPEC, ...((ctx.config && ctx.config.knowledge) || {}) }, now });
  const filed = [];
  if (r.ok) for (const g of (await insights(db, tenant, { kind: 'gap', limit: 1 }))) {
    const id = `KG-${g.id.replace(/[^A-Za-z0-9_-]+/g, '-')}`.slice(0, 80);
    if (await ensureItem(db, { id, kind: 'fix', owner_role: 'product-manager', priority: 20, title: `Knowledge graph: ${g.text}`.slice(0, 300),
      done_check: `the knowledge graph no longer reports gap ${g.id}`, closing_probe: `GET /api/graph/insights?status=kept shows ${g.id}` })) filed.push(id);
  }
  return { ...r, filed };
}
