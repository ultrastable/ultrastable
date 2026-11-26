// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Starting the discipline for everyone (US-SPEC-15 s1, US-15-R01, R14): the outcomes a deployment already has (the roles table names
// one project per outcome) become a program and a project each, in the hybrid mode the rule gives when the person cannot say, and the
// initiation artifacts are drafted from the person's answers through a port, never invented. A drafted artifact is a record with a
// form check; it is never marked reviewed by its producer, so the gate still needs a different agent (US-15-R05, R07).
import { all, first } from '../kernel/util.js';
import { registerProgram } from '../kernel/programs.js';
import { startProject, submitTailored } from './index.js';

// Outcomes with no project yet. A deployment that has no outcome rows adopts nothing. Never above the portfolio cap (startProject
// files the CAPACITY- item itself). Off when config.lifecycle.auto_start is false.
export async function adoptOutcomes(db, { now = Date.now(), config = {} } = {}) {
  if (config.auto_start === false) return { adopted: [], skipped: 'config.lifecycle.auto_start is false' };
  const adopted = [], held = [];
  for (const r of await all(db, `SELECT DISTINCT project FROM roles WHERE project IS NOT NULL AND project <> '' ORDER BY project`)) {
    if (await first(db, `SELECT 1 AS x FROM kernel_projects WHERE id = ?`, r.project)) continue;
    await registerProgram(db, { id: r.project, name: r.project, owner_role: 'program-manager' });
    const s = await startProject(db, { id: r.project, name: r.project, program_id: r.project, answers: {}, capacity: config.default_capacity ?? 0, now }, { config });
    if (s.started) adopted.push(r.project); else held.push({ project: r.project, reason: s.reason, item_id: s.item_id });
  }
  return { adopted, held };
}

// The need ids the default drafting reads (core/walkthrough/catalog.json). A caller with other ids passes map.
export const DRAFT_MAP = { 'A-INI-1': { want_verbatim: 'want', for_whom: 'audience', first_outcomes: 'first_outcome', constraints: 'constraints' } };

// readback: [{ need_id, value, assumption?, default_consequence? }] (the read-back of US-SPEC-16, an assumption is a default taken for
// the person). fields: { want } the person's own words. Returns { drafted: [{ kind, ok, missing }], assumptions }.
export async function draftArtifacts(db, { project_id, readback = [], fields = {}, map = DRAFT_MAP, now = Date.now(), produced_by = 'system' }) {
  const p = await first(db, `SELECT delivery_mode FROM kernel_projects WHERE id = ?`, project_id);
  if (!p) throw new Error('unknown project');
  const by = Object.fromEntries(readback.map(r => [r.need_id, r]));
  const get = (id) => (id === 'want' && fields.want ? fields.want : by[id]?.value);
  const drafted = [];
  for (const [kind, spec] of Object.entries(map)) {
    const content = {};
    for (const [field, need] of Object.entries(spec)) {
      const v = get(need);
      if (v !== undefined && v !== null && String(v).trim() !== '') content[field] = field === 'first_outcomes' && !Array.isArray(v) ? [v] : v;   // a field with no source stays empty: the form check says so
    }
    const f = await submitTailored(db, { project_id, kind, path_or_ref: `records/${project_id}/${kind}.json`, content, produced_by, now });
    drafted.push({ kind, ok: f.ok, missing: f.missing });
  }
  const assumptions = readback.filter(r => r.assumption).map(r => ({ need: r.need_id, assumed: r.value, consequence: r.default_consequence ?? null, revert_path: `ask again: change the answer for ${r.need_id}` }));
  const log = await submitTailored(db, { project_id, kind: 'A-INI-4', path_or_ref: `records/${project_id}/A-INI-4.json`, content: { assumptions, note: assumptions.length ? undefined : 'no default was taken for the person' }, produced_by, now });
  drafted.push({ kind: 'A-INI-4', ok: log.ok, missing: log.missing });
  const md = await first(db, `SELECT mode, reason FROM lifecycle_mode_decisions WHERE project_id = ?`, project_id);
  if (md) { const m = await submitTailored(db, { project_id, kind: 'A-INI-6', path_or_ref: `records/${project_id}/A-INI-6.json`, content: { mode: md.mode, reason: md.reason }, produced_by, now }); drafted.push({ kind: 'A-INI-6', ok: m.ok, missing: m.missing }); }
  return { drafted, assumptions };
}
