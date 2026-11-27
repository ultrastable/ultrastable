// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The ignorance audit as a duty of the tick (US-SPEC-16 section 6, R24): default inputs (the REQUIRED artifact fields of US-SPEC-15 and a tenant-agnostic analogy
// list), triggers (readiness at G1, a gate entered, a new failed prediction), and a red-team sweep that is a model of another family when one is reachable and the
// deterministic rule floor otherwise. With no independent model the audit says so, files one item, and never records independence it did not get.
import ANALOGIES from './analogies.json' with { type: 'json' };
import { requiredArtifacts } from '../lifecycle-gates/index.js';
import { ruleRedTeam, redTeamPrompt } from '../ignorance/index.js';
import { modelFor } from '../ignorance/org.js';

export const DEFAULT_ANALOGIES = ANALOGIES.items;
export const MODEL_ROUTE_ITEM = 'ELICIT-AUDIT-MODEL-ROUTE';
// The closing probe of that item and of the live act in US-16-R24: a red-team sweep recorded a known family that is not the rule floor.
export const MODEL_ROUTE_PROBE = `SELECT COUNT(*) FROM elicit_audit WHERE sweep='redteam' AND evidence LIKE 'model family: %' AND evidence NOT LIKE '%unknown%' AND evidence NOT LIKE '%none%' AND evidence NOT LIKE '%unverified%'`;
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const one = (db, sql, ...a) => db.prepare(sql).bind(...a).first();

/** The inputs the audit uses when the caller gives none: every REQUIRED artifact field of the mode that the managers do not fill themselves
 *  (`catalog.system_fields`), and the analogy list. */
export function auditInputs({ mode = 'hybrid', catalog = {} } = {}) {
  const system = new Set((catalog.system_fields || []).map(f => `${f.artifact}.${f.field}`));
  const required_fields = requiredArtifacts(mode).flatMap(a => a.fields.map(field => ({ artifact: a.kind, field }))).filter(f => !system.has(`${f.artifact}.${f.field}`));
  return { required_fields, analogies: DEFAULT_ANALOGIES };
}

/** Is an audit due for the project? At the first time G1 readiness holds, when a gate is entered that no audit has covered, and when a failed prediction is newer than the last audit. */
export async function auditDue({ db, elicit }, project, { gate = null } = {}) {
  const runs = (await one(db, `SELECT 1 AS x FROM sqlite_master WHERE name='elicit_audit_runs'`)) ? await all(db, `SELECT trigger FROM elicit_audit_runs WHERE project=?`, project) : [];
  const done = new Set(runs.map(r => r.trigger));
  if (gate && !done.has(`gate:${gate}`)) return { due: true, reason: `gate:${gate}` };
  if (!done.has('g1') && (await elicit.readiness(project)).g1) return { due: true, reason: 'g1' };
  if ((await elicit.surprisesSince(project)).length && (await one(db, `SELECT 1 AS x FROM elicit_audit WHERE project=?`, project))) return { due: true, reason: 'surprise' };
  return { due: false, reason: null };
}

const subjectOf = (project, needs) => ({ title: `the plan for ${project}`, claim: needs.filter(n => n.value != null).map(n => `${n.label}: ${n.value}`).join('; ').slice(0, 300) || 'nothing is settled yet', evidence: [], limits: 'the needs register of this project' });

/** The tick step. opts: { db, now, config, env, fetch, elicit, catalog, mode, model, author_family, gates } (model and author_family override the route read from config.ignorance;
 *  gates: { <project>: 'G1' | 'G2' | ... } names a gate just entered). */
export function elicitAuditStep({ db, now = () => Date.now(), config = {}, env = {}, fetch: f, elicit, catalog = {}, mode = 'hybrid', model, author_family, gates = {} } = {}) {
  return { name: 'elicit_audit', run: async (_db, ctx) => {
    const route = model !== undefined ? { model, author_family: author_family ?? config.ignorance?.author_family ?? null } : modelFor({ config, env, fetch: f });
    const inputs = auditInputs({ mode, catalog });
    for (const { project } of await all(db, `SELECT DISTINCT project FROM elicit_needs`)) {
      const d = await auditDue({ db, elicit }, project, { gate: gates[project] || null });
      if (!d.due) continue;
      const floor = async ({ needs }) => ({ family: null, floor: true, question: 'rule floor: what would make this fail or harm someone that the person has not mentioned?', points: ruleRedTeam(subjectOf(project, needs)).slice(0, 6).map(x => ({ point: x.challenge, disposition: 'risk' })) });
      const viaModel = async ({ needs }) => {
        const s = subjectOf(project, needs);
        const r = await route.model({ prompt: redTeamPrompt(s), subject: s });
        return { family: r?.family || null, points: (r?.findings || []).map(x => ({ point: String(x.challenge || '').slice(0, 360), disposition: 'risk' })).filter(x => x.point.length > 20) };
      };
      let r;
      try { r = await elicit.audit(project, { ...inputs, redteam: route.model ? viaModel : floor, author_family: route.author_family, trigger: d.reason }); }
      catch (e) {
        ctx.notes.push(`elicit audit ${project}: the model route failed (${String(e.message || e).slice(0, 120)}); the rule floor ran instead`);
        r = await elicit.audit(project, { ...inputs, redteam: floor, author_family: route.author_family, trigger: d.reason });
      }
      if (!r.independent) await db.prepare(`INSERT OR IGNORE INTO items (id, title, kind, project, owner_role, done_check, closing_probe, priority, status) VALUES (?,?,'work','elicit','operations',?,?,25,'open')`)
        .bind(MODEL_ROUTE_ITEM, 'The ignorance audit has no independent red-team model', 'a model route of a family other than the author\'s is configured (config.ignorance.model_alias with models and author_family) and one red-team sweep recorded its family', MODEL_ROUTE_PROBE).run();
      ctx.notes.push(`elicit audit ${project} (${d.reason}): ${r.complete ? 'complete' : 'incomplete'}, ${r.new_needs} field${r.new_needs === 1 ? '' : 's'} without a need${r.independent ? '' : ', red team not independent'}`);
    }
  } };
}
