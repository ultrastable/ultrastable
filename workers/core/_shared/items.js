// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// File a work item for a breach, or bring the same item back when the breach recurs after it was closed (US-13-R10, R11, R16).
// An item keyed by a fixed id used to be filed with INSERT OR IGNORE, so once it was done a later breach was silent. Here:
// a new id inserts; an id whose item is in a terminal status is reopened (status open, disposition cleared); an id whose item
// is still active is left alone, so the call is idempotent within one breach. Returns true only when a row really changed.
const TERMINAL = `('done','superseded','cancelled')`;

/** db is the D1-shaped handle. row: { id, title, kind, project, owner_role, done_check, closing_probe, priority, at } with `at` the timestamp text. */
export async function fileOrReopen(db, row) {
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const ins = await run(`INSERT OR IGNORE INTO items (id, title, kind, project, owner_role, done_check, closing_probe, priority, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,'open',?,?)`,
    row.id, String(row.title).slice(0, 300), row.kind || 'fix', row.project || null, row.owner_role, row.done_check, row.closing_probe || 'manual', row.priority ?? 20, row.at, row.at);
  if (ins.meta.changes) return true;
  // A reopened item takes the closing probe its new filing names (a probe can be dated to the recurrence), or keeps its own when none is passed.
  const re = await run(`UPDATE items SET status='open', disposition=NULL, blocker=NULL, title=?, closing_probe=COALESCE(?, closing_probe), updated_at=? WHERE id=? AND status IN ${TERMINAL}`,
    String(row.title).slice(0, 300), row.closing_probe ?? null, row.at, row.id);
  return !!re.meta.changes;
}
