// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// UNKNOWNS-1: the tick questions what the system does not know. Twin of foundation/unknowns.py, driven by the same doctrine/unknowns.json
// (config.unknowns). Units are items the org has opened (their done_check and closing_probe are the assumptions); one inverted question per
// (unit, lens) is filed as a plus item UNK-<unit>-<lens>, never repeated within cadence_days, at most max_new_per_run per tick.
import { tenantOf } from './tenant.js';  // Q-TENANT-row-isolation
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const fill = (q, u) => q.replace(/\{(id|done|probe|trigger)\}/g, (_, k) => u[k] || '(none recorded)');

// SCHEMA-SELF-1: the Worker carries this DDL (kept equal to migrations/0017_unknowns.sql by test/unknowns.test.js) so a deploy ahead of its migration cannot fail.
export const UNKNOWNS_DDL = [
  `CREATE TABLE IF NOT EXISTS unknown_questions ( key TEXT NOT NULL, at TEXT NOT NULL, lens TEXT NOT NULL, unit TEXT NOT NULL, item_id TEXT NOT NULL )`,
  `CREATE INDEX IF NOT EXISTS unknown_questions_key ON unknown_questions(key, at)`,
];
const ready = new WeakSet();
async function ensureSchema(db) { if (ready.has(db)) return; for (const q of UNKNOWNS_DDL) await db.prepare(q).run(); ready.add(db); }

export function pickQuestions(cfg, units, asked, nowIso) {
  const day = Date.parse(nowIso.replace(' ', 'T') + (nowIso.includes('Z') ? '' : 'Z'));
  const last = new Map(); const perUnit = new Map();
  for (const r of asked) { last.set(r.key, Math.max(last.get(r.key) || 0, Date.parse(r.at.replace(' ', 'T') + 'Z'))); const u = r.key.split('|')[0]; perUnit.set(u, (perUnit.get(u) || 0) + 1); }
  const out = [];
  for (const u of units) for (const l of cfg.lenses) {
    const key = `${u.id}|${l.id}`;
    if (last.has(key) && (day - last.get(key)) / 864e5 < cfg.cadence_days) continue;
    const impact = cfg.kind_impact[u.kind] || cfg.kind_impact.default;
    const score = impact / (1 + (perUnit.get(u.id) || 0) * 0.5);
    out.push({ key, unit: u.id, lens: l.id, method: l.method, question: fill(l.q, u), score });
  }
  return out.sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : 1)).slice(0, cfg.max_new_per_run);
}

export async function unknownsStep(db, ctx, cfg, ensureItem) {
  if (!cfg || !Array.isArray(cfg.lenses)) return { filed: [] };
  await ensureSchema(db);
  const units = (await all(db, `SELECT id, kind, done_check AS done, closing_probe AS probe FROM items WHERE id NOT LIKE 'UNK-%' AND id NOT LIKE 'FM-%' AND (tenant_id IS NULL OR tenant_id = ?) ORDER BY updated_at DESC LIMIT 60`, tenantOf(ctx))).map(r => ({ ...r, trigger: 'tick' }));
  const asked = await all(db, `SELECT key, at FROM unknown_questions`);
  // Reserve: at most max_new_per_day questions a day, outside the general originate cap (ORIGINATE-CAP-1), so repairs cannot starve them.
  const perDay = cfg.max_new_per_day || cfg.max_new_per_run;
  let today = asked.filter(r => r.at.slice(0, 10) === ctx.nowIso.slice(0, 10)).length;
  const filed = [];
  for (const q of pickQuestions(cfg, units, asked, ctx.nowIso)) {
    if (today >= perDay) break;
    const id = `UNK-${q.key.replace('|', '-').replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 80);
    const made = await ensureItem(db, { id, kind: 'plus', owner_role: 'product-manager', priority: 5,
      title: `Question the unknown (${q.method}) in ${q.unit}: ${q.question}`.slice(0, 400),
      done_check: 'an answer with evidence (none, gap, new-objective or cannot-know) is recorded in ops/unknowns/ledger.jsonl',
      closing_probe: 'manual' }, { cap: Infinity });
    // ORIGINATE-CAP-1: when the daily cap refuses the item, the question was not asked; it stays eligible for the next tick.
    if (!made && !(await db.prepare(`SELECT 1 AS x FROM items WHERE id = ?`).bind(id).first())) continue;
    await run(db, `INSERT INTO unknown_questions (key, at, lens, unit, item_id) VALUES (?,?,?,?,?)`, q.key, ctx.nowIso, q.lens, q.unit, id);
    today++;
    if (made) filed.push(id);
  }
  return { filed };
}
