// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Default personas (US-02-R17): a portfolio persona and one program persona for every registered program, so the staff step does
// something on a composed deployment without a person writing persona rows. Seeding never overwrites a persona that exists (a
// person-filled or an edited one stays as it is), and a read-only probe lets a deployed account be read without any credential.
import { all, first, iso } from '../kernel/util.js';
import { registerPersona, ROLE_CEILING, planeOfProgram } from './index.js';

export const SEED_DEFAULTS = {
  portfolio: { id: 'pfm', role: 'portfolio-manager', authority: ['allocate', 'demote', 'score'], tick_every: 6, source: 'agents/roles/portfolio-manager.md' },
  program: { role: 'program-manager', tick_every: 4, source: 'agents/roles/program-manager.md', fallback_source: 'agents/roles/product-manager.md' },
};

// Register a persona only when none holds the id. Returns true when it was created.
export async function registerPersonaIfAbsent(db, p, opts = {}) {
  if (await first(db, `SELECT 1 AS x FROM staff_personas WHERE id = ?`, p.id)) return false;
  await registerPersona(db, p, opts);
  return true;
}

// ports (all optional): instructionFor(role, program_id) -> path; instructionExists(path) -> boolean (so a missing role file falls back
// to the product manager's, which every deployment carries). config: { staff: { seed_personas, ... } }.
export async function seedPersonas(db, { now = Date.now(), config = {}, ports = {} } = {}) {
  const sc = config.staff || {};
  if (sc.seed_personas === false) return { seeded: [], skipped: 'config.staff.seed_personas is false' };
  const seeded = [];
  const opts = { requireNeverList: sc.require_never_list === true, readInstruction: ports.readFile };
  const source = async (def, role, program) => {
    if (typeof ports.instructionFor === 'function') { const s = await ports.instructionFor(role, program); if (s) return s; }
    if (def.fallback_source && typeof ports.instructionExists === 'function' && !(await ports.instructionExists(def.source))) return def.fallback_source;
    return def.source;
  };
  const pf = SEED_DEFAULTS.portfolio;
  if (!(await first(db, `SELECT 1 AS x FROM staff_personas WHERE role = ?`, pf.role))
    && await registerPersonaIfAbsent(db, { id: pf.id, role: pf.role, scope: 'all programs', instruction_source: await source(pf, pf.role, null), authority: pf.authority, tick_every: pf.tick_every, now }, opts)) seeded.push(pf.id);
  const pg = SEED_DEFAULTS.program;
  for (const prog of await all(db, `SELECT id, name, objective FROM kernel_programs WHERE status = 'active' ORDER BY id`)) {
    if (await first(db, `SELECT 1 AS x FROM staff_personas WHERE role = ? AND program_id = ?`, pg.role, prog.id)) continue;
    const plane = await planeOfProgram(db, prog.id);
    const created = await registerPersonaIfAbsent(db, { id: `pgm-${prog.id}`, role: pg.role, plane, program_id: prog.id, scope: `program ${prog.id}`, charter: prog.objective ?? prog.name ?? null,
      instruction_source: await source(pg, pg.role, prog.id), authority: ROLE_CEILING[pg.role], tick_every: pg.tick_every, now }, opts);
    if (created) seeded.push(`pgm-${prog.id}`);
  }
  return { seeded };
}

// Read-only: what a deployed account shows about the staff step, from its own tables. A count the store cannot answer is null.
export async function staffProbe(db, { now = Date.now() } = {}) {
  const n = async (sql, ...a) => { try { return (await first(db, sql, ...a))?.n ?? null; } catch { return null; } };
  const since = iso(now - 24 * 3600e3);
  const latest = await n(`SELECT MAX(id) AS n FROM tick_runs`);
  return {
    personas: await n(`SELECT COUNT(*) AS n FROM staff_personas`),
    active: await n(`SELECT COUNT(*) AS n FROM staff_personas WHERE status = 'active'`),
    filled_by_person: await n(`SELECT COUNT(*) AS n FROM staff_personas WHERE filled_by = 'person'`),
    latest_tick: latest,
    briefs_on_latest_tick: latest === null ? null : await n(`SELECT COUNT(*) AS n FROM staff_briefs WHERE tick_id = ?`, latest),
    actions_24h: await n(`SELECT COUNT(*) AS n FROM staff_actions WHERE at > ?`, since),
    denials_24h: await n(`SELECT COUNT(*) AS n FROM staff_denials WHERE at > ?`, since),
  };
}
