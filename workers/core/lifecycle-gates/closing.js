// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Closing (US-SPEC-15 s7 and A-CLO-5, US-15-R18): when every chartered outcome of an executing project has a disposition, the
// project moves to closing by itself and the closing artifacts are filed as items; when a project is closed, its record is archived
// once: claims released, what was retained listed, counts kept. Nothing with an open item is archived and nothing is deleted.
import { all, first, run, iso } from '../kernel/util.js';
import { advancePhase } from '../kernel/lifecycle.js';

// Monitoring items (risk review, issue probes, compliance) are not chartered outcomes: they do not hold a project open, and the
// ones still open when the project closes are superseded with a disposition, never dropped silently.
export const MONITOR_PREFIXES = ['RISKREVIEW-', 'RISKFIX-', 'ISSUEPROBE-', 'COMPLIANCE-'];
const monitorSql = (col = 'id') => MONITOR_PREFIXES.map(() => `${col} NOT LIKE ?`).join(' AND ');
const monitorArgs = () => MONITOR_PREFIXES.map(p => `${p}%`);

export async function openClosing(db, { now = Date.now() } = {}) {
  const moved = [];
  for (const p of await all(db, `SELECT id FROM kernel_projects WHERE current_phase = 'executing' ORDER BY id`)) {
    const base = `project = ? AND id NOT LIKE 'GATE-%' AND ${monitorSql()}`, args = [p.id, ...monitorArgs()];
    const n = (await first(db, `SELECT COUNT(*) AS n FROM items WHERE ${base}`, ...args)).n;
    const undisposed = (await first(db, `SELECT COUNT(*) AS n FROM items WHERE ${base} AND (disposition IS NULL OR disposition = '')`, ...args)).n;
    if (n === 0 || undisposed > 0) continue;
    for (const pre of MONITOR_PREFIXES) {          // the monitoring items that are still open end with the project, with their disposition
      await run(db, `UPDATE items SET status = 'superseded', disposition = 'superseded: the project is closing', updated_at = ? WHERE project = ? AND id LIKE ? AND status NOT IN ('done','superseded','cancelled')`, iso(now), p.id, `${pre}%`);
    }
    const r = await advancePhase(db, p.id, 'closing', { now });
    if (r.ok) moved.push(p.id);
  }
  return moved;
}

const ids = async (db, sql, ...a) => (await all(db, sql, ...a)).map(r => r.id);
export async function archiveProject(db, projectId, { now = Date.now(), by = 'system' } = {}) {
  const p = await first(db, `SELECT * FROM kernel_projects WHERE id = ?`, projectId);
  if (!p) throw new Error('unknown project');
  if (p.current_phase !== 'closed') throw new Error(`only a closed project is archived; ${projectId} is in ${p.current_phase}`);
  const have = await first(db, `SELECT * FROM lifecycle_archive WHERE project_id = ?`, projectId);
  if (have) return { archived: false, existing: true, ...have, records: JSON.parse(have.records) };
  const prog = p.program_id ?? projectId;
  const items = await all(db, `SELECT id, status FROM items WHERE project = ?`, projectId);
  const claims = (await first(db, `SELECT COUNT(*) AS n FROM claims WHERE item_id IN (SELECT id FROM items WHERE project = ?)`, projectId)).n;
  await run(db, `DELETE FROM claims WHERE item_id IN (SELECT id FROM items WHERE project = ?)`, projectId);
  const records = {
    artifacts: await ids(db, `SELECT id FROM artifacts WHERE project_id = ? ORDER BY id`, projectId),
    decisions: await ids(db, `SELECT id FROM kernel_decisions WHERE program_id IN (?, ?) ORDER BY id`, projectId, prog),
    status_reports: (await all(db, `SELECT id FROM lifecycle_status_reports WHERE project_id = ? ORDER BY id`, projectId)).map(r => r.id),
    change_requests: (await all(db, `SELECT id FROM change_requests WHERE project_id = ? ORDER BY id`, projectId)).map(r => r.id),
    risk_reviews: (await all(db, `SELECT id FROM lifecycle_risk_reviews WHERE project_id = ? ORDER BY id`, projectId)).map(r => r.id),
    quality: (await all(db, `SELECT id FROM lifecycle_quality WHERE project_id = ? ORDER BY id`, projectId)).map(r => r.id),
    lessons: (await all(db, `SELECT id FROM lessons WHERE project_id = ? ORDER BY id`, projectId)).map(r => r.id),
    items: items.map(i => i.id),
  };
  const done = items.filter(i => i.status === 'done').length;
  await run(db, `INSERT INTO lifecycle_archive (project_id, archived_at, archived_by, items_total, items_done, claims_released, records) VALUES (?,?,?,?,?,?,?)`,
    projectId, iso(now), by, items.length, done, claims, JSON.stringify(records));
  return { archived: true, project_id: projectId, items_total: items.length, items_done: done, claims_released: claims, records };
}
export async function archiveClosed(db, { now = Date.now() } = {}) {
  const out = [];
  for (const p of await all(db, `SELECT id FROM kernel_projects WHERE current_phase = 'closed' AND id NOT IN (SELECT project_id FROM lifecycle_archive) ORDER BY id`)) out.push((await archiveProject(db, p.id, { now })).project_id);
  return out;
}
