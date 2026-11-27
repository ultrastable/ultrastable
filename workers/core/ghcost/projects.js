// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// core/ghcost: a one-way Projects (v2) view of the ledger (US-24-R03). The ledger stays the single source of truth: this
// never reads a value from the board into the ledger. A field changed on the board is reported as drift and the ledger value
// is asserted again; an item leaves the board only after its ledger item is closed with a disposition.
// Ports: ctx.github.projectItems(project) -> [{ id, itemId, fields }], upsertProjectItem({ project, itemId, fields }),
// deleteProjectItem({ project, id }). The live GraphQL adapter for these three is ./projects-graphql.js (composed into githubPort in
// ./github.js; tested against a fake GraphQL server only, no live board has been read).
import { iso, nowMs, all, cfg, recordProbe } from './util.js';

const TERMINAL = new Set(['done', 'superseded', 'cancelled']);
export const fieldsOf = it => ({ Status: it.status, Program: it.project || '', Probe: it.closing_probe || '' });

export async function projectMirror(ctx) {
  const c = cfg(ctx).projects || {}, ts = iso(nowMs(ctx)), db = ctx.db;
  if (!c.enabled) return { skipped: true };
  let board;
  try { board = await ctx.github.projectItems(c.project); if (!Array.isArray(board)) throw new Error('board response is not a list'); }
  catch (e) { const evidence = String(e?.message || e).slice(0, 300); await recordProbe(db, 'projects', 'unknown', evidence, ts); return { result: 'unknown', error: evidence }; }
  const byItem = new Map(board.map(b => [b.itemId, b]));
  const open = await all(db, `SELECT id, title, status, project, closing_probe FROM items WHERE status NOT IN ('done','superseded','cancelled') ORDER BY id`);
  const out = { added: [], drift: [], removed: [], unchanged: 0 };
  for (const it of open) {
    const want = fieldsOf(it), b = byItem.get(it.id);
    if (!b) { await ctx.github.upsertProjectItem({ project: c.project, itemId: it.id, fields: want }); out.added.push(it.id); continue; }
    const diff = Object.keys(want).filter(k => String(b.fields?.[k] ?? '') !== String(want[k]));
    if (diff.length) { out.drift.push({ item: it.id, fields: diff }); await ctx.github.upsertProjectItem({ project: c.project, itemId: it.id, fields: want }); }
    else out.unchanged++;
  }
  const openIds = new Set(open.map(i => i.id));
  for (const b of board) {
    if (openIds.has(b.itemId)) continue;
    const row = (await all(db, `SELECT status, disposition FROM items WHERE id=?`, b.itemId))[0];
    if (row && TERMINAL.has(row.status) && row.disposition) { await ctx.github.deleteProjectItem({ project: c.project, id: b.id }); out.removed.push(b.itemId); }
  }
  await recordProbe(db, 'projects', out.drift.length ? 'fail' : 'pass', { added: out.added.length, drift: out.drift, removed: out.removed.length }, ts);
  return { result: out.drift.length ? 'drift' : 'pass', ...out };
}
