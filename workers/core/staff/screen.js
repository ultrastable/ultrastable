// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The person's screen for a role (US-02-R18): two pure handlers over the tool layer, with no HTML and no import of the console.
// A person who fills a role (US-02-R11) sees what the role may do now and does it through the same tool layer an agent uses, so the
// action row, the prediction, the trust outcome and the brief are the same. Identity is the principal the console authenticated and
// the persona row, never the request body; another principal, or an agent persona, is refused and the refusal is recorded.
import { all, first } from '../kernel/util.js';
import { writeBrief, getPersona } from './index.js';

const ARGLESS = ['promote', 'restore', 'close_with_evidence', 'demote'];   // preconditions can be tried with the item alone
const NEEDS = { supersede: ['by'], assign_doer: ['doer'] };                  // listed as candidates: the person supplies what is missing
const json = (status, body) => ({ status, body });

async function latestTick(db) { try { return (await first(db, `SELECT MAX(id) AS n FROM tick_runs`))?.n ?? null; } catch { return null; } }

async function view(tools, pz) {
  const { db } = tools;
  const rows = (await tools.items(pz.id, pz.program_id ? { program_id: pz.program_id } : {})).rows.filter(r => !['done', 'superseded', 'cancelled'].includes(r.status)).slice(0, 50);
  const eligible = {};
  for (const op of pz.authority) {
    if (ARGLESS.includes(op)) {
      eligible[op] = [];
      for (const it of rows) { const r = await tools.act(pz.id, op, { item_id: it.id }, { dry: true }); if (r.ok) eligible[op].push({ item_id: it.id, field: r.field, from: r.from, to: r.to, evidence: r.evidence }); }
    } else if (NEEDS[op]) eligible[op] = { needs: NEEDS[op], candidates: rows.map(r => r.id) };
  }
  const actions = await all(db, `SELECT id, op, item_id, field, from_value, to_value, evidence, reversed_by, reverses, at FROM staff_actions WHERE persona_id = ? ORDER BY id DESC LIMIT 20`, pz.id);
  const denials = await all(db, `SELECT op, target, kind, reason, at FROM staff_denials WHERE persona_id = ? ORDER BY id DESC LIMIT 10`, pz.id);
  const brief = await first(db, `SELECT tick_id, text, at FROM staff_briefs WHERE persona_id = ? ORDER BY tick_id DESC LIMIT 1`, pz.id);
  return { id: pz.id, role: pz.role, program_id: pz.program_id, plane: pz.plane, scope: pz.scope, authority: pz.authority, eligible,
    actions: actions.map(a => ({ ...a, reversed: Boolean(a.reversed_by), reversible: !a.reversed_by && !String(a.op).startsWith('reverse:') })), denials, brief };
}

// The personas a principal fills, each with what it may do now. Returns { principal, personas }.
export async function buildStaffScreen(tools, { principal } = {}) {
  if (!principal) throw new Error('the screen needs the authenticated principal');
  const ids = (await all(tools.db, `SELECT id FROM staff_personas WHERE filled_by = 'person' AND holder = ? AND status = 'active' ORDER BY id`, principal)).map(r => r.id);
  const personas = [];
  for (const id of ids) personas.push(await view(tools, await getPersona(tools.db, id)));
  return { principal, personas };
}

// { method, path, principal, body } -> { status, body }. GET /api/staff; POST /api/staff/<persona>/act { op, args, prediction? };
// POST /api/staff/<persona>/reverse { action_id, evidence }.
export async function handleStaffRequest(tools, { method = 'GET', path = '', principal = null, body = {} } = {}) {
  if (!principal) return json(401, { error: 'sign in first' });
  const p = String(path).split('?')[0].replace(/\/+$/, '');
  if (method === 'GET' && p === '/api/staff') return json(200, await buildStaffScreen(tools, { principal }));
  const m = /^\/api\/staff\/([^/]+)\/(act|reverse)$/.exec(p);
  if (!m || method !== 'POST') return json(404, { error: 'not found' });
  const pz = await getPersona(tools.db, decodeURIComponent(m[1]));
  if (!pz) return json(404, { error: 'no such persona' });
  if (pz.filled_by !== 'person') { await tools.refuse(pz, `screen:${m[2]}`, null, 'authority', 'an agent persona cannot be driven from the person screen'); return json(403, { error: 'this role is filled by an agent' }); }
  if (pz.holder !== principal) { await tools.refuse(pz, `screen:${m[2]}`, null, 'authority', `principal ${principal} does not hold this persona`); return json(403, { error: 'you do not hold this role' }); }
  const tickId = await latestTick(tools.db);
  const b = body && typeof body === 'object' ? body : {};
  let r;
  if (m[2] === 'act') {
    if (!b.op) return json(400, { error: 'op is required' });
    r = await tools.act(pz.id, String(b.op), { ...(b.args || {}), ...(b.prediction ? { prediction: b.prediction } : {}) }, { tickId });
  } else {
    if (!Number.isInteger(b.action_id)) return json(400, { error: 'action_id is required' });
    r = await tools.reverse(pz.id, b.action_id, { evidence: b.evidence, tickId });
  }
  if (tickId !== null) await writeBrief(tools.db, pz.id, tickId, tools.now());  // the same brief an agent persona gets (US-02-R07, R11)
  return json(r.ok ? 200 : 422, r);
}
