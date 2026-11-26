// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Virtual staff (US-SPEC-02): personas with an enumerated decision authority, a tool layer that enforces the lane from
// the requester's identity, an action log with from and to values, and one brief per tick. The manager operations of
// US-SPEC-03 s4 (promote, restore, close with evidence, supersede, demote, assign a doer) run through that tool layer.
import { fileURLToPath } from 'node:url';
import { all, first, run, iso, parseIso, compare, TERMINAL_SQL } from '../kernel/util.js';
import { recordDecision, parsePrediction } from '../kernel/decisions.js';
import { checkRoleInstruction } from './rolefile.js';

export const MIGRATIONS_DIR = (() => { try { return fileURLToPath(new URL('./migrations/', import.meta.url)); } catch { return null; } })();

// Every operation the tool layer knows. A persona's authority is a subset, stored as data.
export const OPERATIONS = ['promote', 'restore', 'close_with_evidence', 'supersede', 'assign_doer', 'demote', 'allocate', 'originate', 'score'];
// US-02-R08: the widest authority a role may be given. A role with no row here is configuration (US-02-R04) and may be given
// any operation except the ones reserved below.
export const ROLE_CEILING = {
  'program-manager': ['promote', 'restore', 'close_with_evidence', 'supersede', 'assign_doer', 'originate', 'score'],
  'portfolio-manager': ['allocate', 'demote', 'score'],
};
const PROGRAM_ONLY = ['promote', 'restore', 'close_with_evidence', 'supersede', 'assign_doer', 'originate']; // within the persona's own program
export const DEFAULTS = {
  high_priority_max: 10, demote_to: 20, demote_after_h: 24, close_min_age_h: 1, default_trust: 0.5,
  machine_prefixes: ['TICKFAIL-', 'BREACH-', 'REVERT-', 'L2MISSING-', 'GATE-', 'FM-', 'LADDER-', 'REBALANCE-'],
  // US-02-R10: the tick (every implementation of it), policy, governance and permission configuration, the instruction files, and the
  // guards the repository protects (scripts/protected_paths.py, workers/AGENTS.md rule 7). control_plane replaces this list; control_plane_extra adds to it.
  control_plane: ['core/src/tick.js', 'core/kernel/index.js', 'autonomy/', '.github/', 'agents/', 'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', 'SCOPE.md', 'LICENSE', 'ultrastable.json',
    'tools/spec_truth.py', 'tools/selfhost_check.py', 'core/test/no-qnfo.test.js', 'scripts/protected_paths.py',
    'core/org/index.js', 'core/org/buildout.js', 'adapters/cloudflare/src/index.js', 'adapters/cloudflare/src/heartbeat.js',
    'runtimes/python/ultrastable/engine.py', 'seed/worker/src/tick.js', 'worker/src/tick.js'],
  control_plane_extra: [],
  roadmap_min: 3, origination_daily_cap: 4,
};
const cfg = (c) => ({ ...DEFAULTS, ...(c || {}) });
const day = (now) => iso(now).slice(0, 10);

// US-02-R10: the tick, policy, governance and permission configuration are never a manager's target.
export function isControlPlane(path, config) {
  const p = String(path || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p) return false;
  if (/(^|\/)(policy|policies|governance|permissions?)(\.|\/|$)/i.test(p)) return true;
  const k = cfg(config);
  return [...k.control_plane, ...(k.control_plane_extra || [])].some(c => (c.endsWith('/') ? p.startsWith(c) || p.includes(`/${c}`) : p === c || p.endsWith(`/${c}`)));
}

// US-02-R01, R05: a persona is a record naming role, scope and instruction source, with an enumerated authority.
// opts (US-02-R12): { readInstruction(path) -> text, requireNeverList }. With requireNeverList on (config.staff.require_never_list), a persona
// whose instruction source is a file is refused unless that file carries the never list of core/staff/rolefile.js; with no reader the
// check cannot run and the registration is refused (an unreadable file is never a pass). A prompt reference (not a path) is not a file.
const looksLikeFile = (s) => /[\/]/.test(s) || /\.(md|txt)$/i.test(s);
export async function registerPersona(db, p, opts = {}) {
  for (const f of ['id', 'role', 'scope', 'instruction_source']) if (!p[f] || !String(p[f]).trim()) throw new Error(`persona requires ${f}`);
  if (!Array.isArray(p.authority) || !p.authority.length) throw new Error('decision authority must be an enumerated list');
  const unknown = p.authority.filter(o => !OPERATIONS.includes(o));
  if (unknown.length) throw new Error(`unknown operation(s): ${unknown.join(', ')}`);
  const ceiling = ROLE_CEILING[p.role];
  const over = ceiling ? p.authority.filter(o => !ceiling.includes(o)) : p.authority.filter(o => o === 'demote' || o === 'allocate');
  if (over.length) throw new Error(`role ${p.role} may not hold: ${over.join(', ')}`);
  if (p.authority.some(o => PROGRAM_ONLY.includes(o)) && !p.program_id) throw new Error('a persona with program operations needs program_id');
  if (!['agent', 'person'].includes(p.filled_by || 'agent')) throw new Error('filled_by must be agent or person');
  if (opts.requireNeverList && looksLikeFile(String(p.instruction_source))) {
    if (typeof opts.readInstruction !== 'function') throw new Error('the never-list check needs a readInstruction port (US-02-R12)');
    let text; try { text = await opts.readInstruction(p.instruction_source); } catch (e) { throw new Error(`cannot read ${p.instruction_source}: ${e.message}`); }
    const r = checkRoleInstruction(text);
    if (!r.ok) throw new Error(`${p.instruction_source} has no complete never list (US-02-R12): ${r.has_section ? `missing ${r.missing.join(', ')}` : 'no Never section'}`);
  }
  await run(db, `INSERT INTO staff_personas (id, role, plane, program_id, scope, charter, instruction_source, authority, filled_by, holder, tick_every, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET role=excluded.role, plane=excluded.plane, program_id=excluded.program_id, scope=excluded.scope, charter=excluded.charter,
        instruction_source=excluded.instruction_source, authority=excluded.authority, filled_by=excluded.filled_by, holder=excluded.holder,
        tick_every=excluded.tick_every, status=excluded.status`,
    p.id, p.role, p.plane || 'org', p.program_id ?? null, p.scope, p.charter ?? null, p.instruction_source, JSON.stringify([...new Set(p.authority)]),
    p.filled_by || 'agent', p.holder ?? null, Math.max(1, p.tick_every ?? 1), p.status || 'active', iso(p.now ?? Date.now()));
  if (p.program_id && p.plane && p.plane !== 'org') await setProgramPlane(db, p.program_id, p.plane);
}
export async function setProgramPlane(db, programId, plane) {
  await run(db, `INSERT INTO staff_planes (program_id, plane) VALUES (?, ?) ON CONFLICT(program_id) DO UPDATE SET plane = excluded.plane`, programId, plane);
}
export async function registerStore(db, store, plane) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(store)) throw new Error('store must be a table name');
  await run(db, `INSERT INTO staff_plane_stores (store, plane) VALUES (?, ?) ON CONFLICT(store) DO UPDATE SET plane = excluded.plane`, store, plane);
}
export async function getPersona(db, id) {
  const p = await first(db, `SELECT * FROM staff_personas WHERE id = ?`, id);
  return p ? { ...p, authority: JSON.parse(p.authority) } : null;
}

// The program an item belongs to: items.project is a program id, or a kernel project of a program.
const ITEM_VIEW = `SELECT i.*, COALESCE(kp.program_id, i.project) AS program_id, COALESCE(sp.plane, 'org') AS plane,
    m.metric_id, m.doer, m.critical, (SELECT COUNT(*) FROM claims c WHERE c.item_id = i.id) AS claimed
  FROM items i LEFT JOIN kernel_projects kp ON kp.id = i.project
  LEFT JOIN staff_planes sp ON sp.program_id = COALESCE(kp.program_id, i.project)
  LEFT JOIN kernel_item_meta m ON m.item_id = i.id`;
export const itemView = (db, id) => first(db, `${ITEM_VIEW} WHERE i.id = ?`, id);
const planeOfProgram = async (db, programId) => (await first(db, `SELECT plane FROM staff_planes WHERE program_id = ?`, programId))?.plane || 'org';
const norm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const isMachineFiled = (it, c) => Boolean(it.metric_id) || c.machine_prefixes.some(p => it.id.startsWith(p));

class Refusal extends Error { constructor(kind, reason) { super(reason); this.kind = kind; } }
const deny = (kind, reason) => { throw new Refusal(kind, reason); };

// Latest reading of a kernel metric judged against the injected clock (the kernel view reads the wall clock).
export async function metricState(db, metricId, now) {
  const m = await first(db, `SELECT * FROM kernel_metrics WHERE id = ?`, metricId);
  if (!m) return { state: 'unknown' };
  const r = await first(db, `SELECT value, read_at FROM kernel_metric_readings WHERE metric_id = ? ORDER BY id DESC LIMIT 1`, metricId);
  if (!r || r.value === null) return { state: 'unmeasured' };
  if ((now - parseIso(r.read_at)) / 3600e3 > m.max_age_h) return { state: 'unmeasured', value: r.value, read_at: r.read_at, stale: true };
  return { state: compare(m.op, r.value, m.target) ? 'on_target' : 'breach', value: r.value, read_at: r.read_at };
}

// Each handler checks its preconditions and returns the one field it changes. It writes nothing itself.
const HANDLERS = {
  async promote(db, pz, it, a, c) {
    const f = await first(db, `SELECT rank, tier FROM kernel_focus WHERE program_id = ? AND item_id = ?`, pz.program_id, it.id);
    if (!f) deny('precondition', 'only a focus item is promoted');
    const to = a.to ?? c.high_priority_max;
    if (!(to < it.priority)) deny('precondition', `priority ${it.priority} is already at or above ${to}`);
    return { field: 'priority', from: it.priority, to, evidence: a.evidence || `focus rank ${f.rank}, tier ${f.tier}` };
  },
  async restore(db, pz, it, a) {
    const last = await first(db, `SELECT * FROM staff_actions WHERE item_id = ? AND op = 'demote' AND reversed_by IS NULL ORDER BY id DESC LIMIT 1`, it.id);
    if (!last) deny('precondition', 'no demotion to restore');
    return { field: 'priority', from: it.priority, to: Number(last.from_value), evidence: a.evidence || `restores the priority before action ${last.id}`, reverses: last.id };
  },
  async close_with_evidence(db, pz, it, a, c, now) {
    if (!it.metric_id) deny('precondition', 'only a trigger-filed item closes on its metric');
    const s = await metricState(db, it.metric_id, now);
    if (s.state !== 'on_target') deny('precondition', s.stale ? `the reading of ${it.metric_id} is stale` : `metric ${it.metric_id} is ${s.state}`);
    if ((now - parseIso(it.created_at)) / 3600e3 < c.close_min_age_h) deny('precondition', 'the item is not old enough');
    const rem = await first(db, `SELECT status FROM kernel_remediations WHERE item_id = ?`, it.id);
    if (rem && rem.status !== 'closed') deny('precondition', `its remediation contract is ${rem.status}`);
    return { field: 'status', from: it.status, to: 'done', evidence: `metric ${it.metric_id} = ${s.value} on target, read ${s.read_at}`, disposition: `done: metric ${it.metric_id} back on target (${s.value})` };
  },
  async supersede(db, pz, it, a) {
    const by = a.by ? await itemView(db, a.by) : null;
    if (!by || by.id === it.id) deny('precondition', 'supersede names the item that replaces this one');
    if (by.program_id !== pz.program_id) deny('lane', 'the replacing item is in another program');
    if (['done', 'superseded', 'cancelled'].includes(by.status)) deny('precondition', 'the replacing item is not active');
    const dup = norm(by.title) === norm(it.title) || (it.metric_id && it.metric_id === by.metric_id);
    if (!dup) deny('precondition', 'the two items are not duplicates (same title or same metric)');
    if (String(it.created_at) > String(by.created_at)) deny('precondition', 'only the older duplicate is superseded');
    return { field: 'status', from: it.status, to: 'superseded', evidence: a.evidence || `duplicate of ${by.id}`, disposition: `superseded by ${by.id}` };
  },
  async assign_doer(db, pz, it, a, c, now, ports) {
    if (!a.doer) deny('precondition', 'assign_doer names a doer');
    if (a.path) {
      if (isControlPlane(a.path, c)) deny('control_plane', `${a.path} is a control-plane file (US-02-R10)`);
      if (!ports.readFile) deny('precondition', 'no file reader: the anchor cannot be validated');
      let text; try { text = await ports.readFile(a.path); } catch (e) { deny('precondition', `cannot read ${a.path}: ${e.message}`); }
      const n = a.anchor ? String(text ?? '').split(a.anchor).length - 1 : 0;
      if (n !== 1) deny('precondition', `the anchor occurs ${n} time(s) in ${a.path}; exactly once is required`);
    }
    return { field: 'doer', from: it.doer ?? null, to: a.doer, evidence: a.path ? `target ${a.path}, anchor found once` : (a.evidence || 'doer line assigned') };
  },
  async demote(db, pz, it, a, c, now) {
    if (!isMachineFiled(it, c)) deny('precondition', 'only a machine-filed item is demoted');
    if (!(it.critical || it.priority <= 0)) deny('precondition', 'the item is not critical');
    const age = (now - parseIso(it.created_at)) / 3600e3;
    if (age <= c.demote_after_h) deny('precondition', `the item is ${age.toFixed(1)} h old; older than ${c.demote_after_h} h is required`);
    if (it.doer || it.claimed) deny('precondition', 'the item has a doer');
    return { field: 'priority', from: it.priority, to: a.to ?? c.demote_to, evidence: a.evidence || `machine-filed critical, ${age.toFixed(0)} h old, no doer` };
  },
};

async function writeField(db, itemId, field, value, nowIso, disposition = null) {
  if (field === 'priority') await run(db, `UPDATE items SET priority = ?, updated_at = ? WHERE id = ?`, Number(value), nowIso, itemId);
  else if (field === 'status') {
    await run(db, `UPDATE items SET status = ?, disposition = ?, updated_at = ? WHERE id = ?`, value, disposition, nowIso, itemId);
    if (['done', 'superseded', 'cancelled'].includes(value)) await run(db, `DELETE FROM claims WHERE item_id = ?`, itemId);
  } else if (field === 'doer') {
    await run(db, `INSERT INTO kernel_item_meta (item_id, doer) VALUES (?, ?) ON CONFLICT(item_id) DO UPDATE SET doer = excluded.doer`, itemId, value);
  } else throw new Error(`field ${field} cannot be written`);
}
async function readField(db, itemId, field) {
  const it = await itemView(db, itemId);
  return field === 'doer' ? (it.doer ?? null) : it[field];
}

async function logAction(db, pz, a) {
  const r = await run(db, `INSERT INTO staff_actions (persona_id, op, item_id, field, from_value, to_value, evidence, tick_id, reverses, at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    pz.id, a.op, a.item_id ?? null, a.field ?? null, a.from === null || a.from === undefined ? null : String(a.from),
    a.to === null || a.to === undefined ? null : String(a.to), a.evidence, a.tick_id ?? null, a.reverses ?? null, a.at);
  return r.meta.last_row_id;
}

// The tool layer. Identity is the persona row read here, never an argument of the request (US-02-R09).
// ports: { readFile(path) -> text, research(request) -> text }.
export function createToolLayer({ db, now = () => Date.now(), config = {}, ports = {} }) {
  const c = cfg(config);
  async function refuseRow(pz, op, target, kind, reason, tickId) {
    await run(db, `INSERT INTO staff_denials (persona_id, op, target, kind, reason, tick_id, at) VALUES (?,?,?,?,?,?,?)`, pz.id, op, target ?? null, kind, reason, tickId ?? null, iso(now()));
    return { ok: false, denied: true, kind, reason };
  }
  async function identity(personaId) {
    const pz = await getPersona(db, personaId);
    if (!pz) throw new Error(`unknown persona ${personaId}`);
    return pz;
  }

  // Apply one operation. Order of checks: the persona is active, the operation is on its list, the item is in its plane,
  // the item is in its program (program operations), then the operation's own preconditions.
  // dry: check everything and write nothing (no action row, no denial row); a refusal comes back as { ok: false, kind, reason }. The person
  // screen (core/staff/screen.js) uses it to show the operations that would be accepted now.
  async function act(personaId, op, args = {}, { tickId = null, quiet = false, dry = false } = {}) {
    const pz = await identity(personaId), t = now(), nowIso = iso(t);
    // quiet: an automatic duty that probes by trying leaves no row for a failed precondition; authority and lane refusals always do.
    const refuse = (z, o, target, kind, reason, tk) => (dry || (quiet && kind === 'precondition') ? { ok: false, denied: true, kind, reason } : refuseRow(z, o, target, kind, reason, tk));
    if (pz.status !== 'active') return refuse(pz, op, args.item_id, 'authority', 'persona is not active', tickId);
    if (!pz.authority.includes(op)) return refuse(pz, op, args.item_id, 'authority', `${op} is not in the decision authority of ${pz.id}`, tickId);
    const handler = HANDLERS[op];
    if (!handler) return refuse(pz, op, args.item_id, 'precondition', `${op} is not an item operation`, tickId);
    const it = args.item_id ? await itemView(db, args.item_id) : null;
    if (!it) return refuse(pz, op, args.item_id, 'precondition', 'unknown item', tickId);
    if (it.plane !== pz.plane) return refuse(pz, op, it.id, 'lane', `item is in plane ${it.plane}`, tickId);
    if (PROGRAM_ONLY.includes(op) && it.program_id !== pz.program_id) return refuse(pz, op, it.id, 'lane', `item belongs to program ${it.program_id ?? 'none'}, not ${pz.program_id}`, tickId);
    if (['done', 'superseded', 'cancelled'].includes(it.status)) return refuse(pz, op, it.id, 'precondition', `item is ${it.status}`, tickId);
    if (args.prediction && !parsePrediction(args.prediction)) return refuse(pz, op, it.id, 'precondition', 'prediction is not parsable', tickId);
    let ch;
    try { ch = await handler(db, pz, it, args, c, t, ports); }
    catch (e) { if (e instanceof Refusal) return refuse(pz, op, it.id, e.kind, e.message, tickId); throw e; }
    if (dry) return { ok: true, dry: true, item_id: it.id, field: ch.field, from: ch.from, to: ch.to, evidence: ch.evidence };
    // A status that ends the item removes its claim; keep the claim so a reversal can restore it (US-02-R06).
    const endsItem = ch.field === 'status' && ['done', 'superseded', 'cancelled'].includes(ch.to);
    const claim = endsItem ? await first(db, `SELECT agent, claimed_at, heartbeat_at FROM claims WHERE item_id = ?`, it.id) : null;
    await writeField(db, it.id, ch.field, ch.to, nowIso, ch.disposition ?? null);
    const verified = String(await readField(db, it.id, ch.field)) === String(ch.to); // read back through a separate statement
    const id = await logAction(db, pz, { op, item_id: it.id, ...ch, tick_id: tickId, at: nowIso });
    if (claim) await run(db, `INSERT INTO staff_action_claims (action_id, item_id, agent, claimed_at, heartbeat_at) VALUES (?,?,?,?,?)`, id, it.id, claim.agent, claim.claimed_at, claim.heartbeat_at ?? null);
    if (ch.reverses) await run(db, `UPDATE staff_actions SET reversed_by = ? WHERE id = ?`, id, ch.reverses);
    // US-02-R11: the same trust accounting whoever fills the role.
    await run(db, `INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?,?,?,?,?,?,?)`,
      it.id, pz.id, 'manager-ops', op, verified ? 'verified' : 'failed', `staff action ${id}: ${ch.evidence}`.slice(0, 300), nowIso);
    let decision = null;
    if (args.prediction) {
      decision = `STAFF-${id}`;
      await recordDecision(db, { id: decision, program_id: it.program_id, kind: args.decision_kind || 'allocation', decision: `${op} ${it.id}: ${ch.from} -> ${ch.to}`,
        authority: `${pz.id} (${pz.role}): ${op}`, prediction: args.prediction, revert_path: `reverse staff action ${id}`, item_id: it.id, now: t });
      await run(db, `UPDATE staff_actions SET decision_id = ? WHERE id = ?`, decision, id);
    }
    return { ok: true, action_id: id, item_id: it.id, field: ch.field, from: ch.from, to: ch.to, verified, decision_id: decision };
  }

  // US-02-R06: reversible by recording the reverse. The reverser needs the authority for the original operation.
  const refuse = refuseRow;
  async function reverse(personaId, actionId, { evidence, tickId = null } = {}) {
    const pz = await identity(personaId), nowIso = iso(now());
    const a = await first(db, `SELECT * FROM staff_actions WHERE id = ?`, actionId);
    if (!a) throw new Error(`unknown action ${actionId}`);
    const op = a.op.replace(/^reverse:/, '');
    if (!pz.authority.includes(op)) return refuse(pz, `reverse:${op}`, a.item_id, 'authority', `${op} is not in the decision authority of ${pz.id}`, tickId);
    if (!evidence) return refuse(pz, `reverse:${op}`, a.item_id, 'precondition', 'a reversal records its evidence', tickId);
    if (a.reversed_by) return refuse(pz, `reverse:${op}`, a.item_id, 'precondition', `already reversed by action ${a.reversed_by}`, tickId);
    // The kernel's allocation is replaced by the next allocation, not restored: say so as a recorded, countable refusal.
    if (a.field === 'allocation') return refuse(pz, `reverse:${op}`, a.item_id, 'precondition', "an allocation cannot be reversed: the kernel's next allocation replaces it (US-02-R06)", tickId);
    // An originated item is reversed by cancelling it with a disposition, so it leaves the active set accountably (US-02-R06, US-08).
    if (a.field === 'item' && op === 'originate') {
      const it = a.item_id ? await itemView(db, a.item_id) : null;
      if (!it) return refuse(pz, `reverse:${op}`, a.item_id, 'precondition', 'the originated item no longer exists', tickId);
      if (it.plane !== pz.plane || it.program_id !== pz.program_id) return refuse(pz, `reverse:${op}`, it.id, 'lane', 'item is outside the lane of this persona', tickId);
      if (['done', 'superseded', 'cancelled'].includes(it.status)) return refuse(pz, `reverse:${op}`, it.id, 'precondition', `item is already ${it.status}`, tickId);
      await writeField(db, it.id, 'status', 'cancelled', nowIso, `cancelled: reversal of staff action ${a.id}`);
      await run(db, `UPDATE kernel_item_meta SET doer = NULL WHERE item_id = ? AND doer LIKE 'code-task:%'`, it.id);
      await run(db, `UPDATE staff_originations SET reason = ? WHERE item_id = ?`, `reversed by staff action (see action ${a.id})`, it.id);
      const rid = await logAction(db, pz, { op: `reverse:${op}`, item_id: it.id, field: 'item', from: a.to_value, to: 'cancelled', evidence, tick_id: tickId, reverses: a.id, at: nowIso });
      await run(db, `UPDATE staff_actions SET reversed_by = ? WHERE id = ?`, rid, a.id);
      return { ok: true, action_id: rid, item_id: it.id, field: 'item', from: a.to_value, to: 'cancelled' };
    }
    if (!a.item_id || !['priority', 'status', 'doer'].includes(a.field)) return refuse(pz, `reverse:${op}`, a.item_id, 'precondition', 'this action has no item field to restore', tickId);
    const it = await itemView(db, a.item_id);
    if (it.plane !== pz.plane || (PROGRAM_ONLY.includes(op) && it.program_id !== pz.program_id)) return refuse(pz, `reverse:${op}`, it.id, 'lane', 'item is outside the lane of this persona', tickId);
    const back = a.field === 'priority' ? Number(a.from_value) : a.from_value;
    await writeField(db, it.id, a.field, back, nowIso, null);
    // The claim the original operation removed comes back with the item (US-02-R06): a reversal leaves the item as it was found.
    if (a.field === 'status' && !['done', 'superseded', 'cancelled'].includes(back)) {
      const kept = await first(db, `SELECT * FROM staff_action_claims WHERE action_id = ?`, a.id);
      if (kept) await run(db, `INSERT OR IGNORE INTO claims (item_id, agent, claimed_at, heartbeat_at) VALUES (?,?,?,?)`, it.id, kept.agent, kept.claimed_at, kept.heartbeat_at ?? nowIso);
    }
    const id = await logAction(db, pz, { op: `reverse:${op}`, item_id: it.id, field: a.field, from: a.to_value, to: a.from_value, evidence, tick_id: tickId, reverses: a.id, at: nowIso });
    await run(db, `UPDATE staff_actions SET reversed_by = ? WHERE id = ?`, id, a.id);
    return { ok: true, action_id: id, item_id: it.id, field: a.field, from: a.to_value, to: a.from_value };
  }

  // Read tools. A request that names another plane, or a program or store of another plane, is refused and logged;
  // a request that names none returns only rows of the requester's own plane.
  async function items(personaId, { plane = null, program_id = null, text = null, limit = 100 } = {}) {
    const pz = await identity(personaId);
    if (plane && plane !== pz.plane) return { ...(await refuse(pz, 'read:items', `plane ${plane}`, 'lane', `read of plane ${plane} denied to a ${pz.plane}-plane persona`)), rows: [] };
    if (program_id && (await planeOfProgram(db, program_id)) !== pz.plane) return { ...(await refuse(pz, 'read:items', `program ${program_id}`, 'lane', `program ${program_id} is in another plane`)), rows: [] };
    const where = [`COALESCE(sp.plane, 'org') = ?`], args = [pz.plane];
    if (program_id) { where.push(`COALESCE(kp.program_id, i.project) = ?`); args.push(program_id); }
    if (text) { where.push(`i.title LIKE ?`); args.push(`%${text}%`); }
    return { ok: true, rows: await all(db, `${ITEM_VIEW} WHERE ${where.join(' AND ')} ORDER BY i.priority, i.created_at, i.id LIMIT ?`, ...args, Math.min(500, limit)) };
  }
  async function readStore(personaId, store, { limit = 100 } = {}) {
    const pz = await identity(personaId);
    const s = await first(db, `SELECT * FROM staff_plane_stores WHERE store = ?`, store);
    if (!s) return { ...(await refuse(pz, 'read:store', store, 'lane', 'store is not registered to any plane')), rows: [] };
    if (s.plane !== pz.plane) return { ...(await refuse(pz, 'read:store', store, 'lane', `store ${store} belongs to plane ${s.plane}`)), rows: [] };
    return { ok: true, rows: await all(db, `SELECT * FROM ${s.store} LIMIT ?`, Math.min(500, limit)) };
  }

  return { act, reverse, items, readStore, refuse, identity, config: c, ports, db, now };
}

// US-02-R07: one brief per persona per tick, in plain language, built from the rows the persona wrote in that tick.
export async function writeBrief(db, personaId, tickId, now = Date.now(), notes = []) {
  const pz = await getPersona(db, personaId);
  if (!pz) throw new Error(`unknown persona ${personaId}`);
  const acts = await all(db, `SELECT * FROM staff_actions WHERE persona_id = ? AND tick_id = ? ORDER BY id`, personaId, tickId);
  const dens = await all(db, `SELECT * FROM staff_denials WHERE persona_id = ? AND tick_id = ? ORDER BY id`, personaId, tickId);
  const lines = [
    `${pz.id} (${pz.role}${pz.filled_by === 'person' ? ', filled by a person' : ''}) on tick ${tickId}.`,
    acts.length ? `Did: ${acts.map(a => `${a.op}${a.item_id ? ` ${a.item_id}` : ''}${a.field ? ` ${a.field} ${a.from_value ?? 'none'} -> ${a.to_value ?? 'none'}` : ''} (${a.evidence})`).join('; ')}.` : 'Did: nothing needed doing within my authority.',
    dens.length ? `Refused: ${dens.map(d => `${d.op}${d.target ? ` ${d.target}` : ''}: ${d.reason}`).join('; ')}.` : 'Refused: nothing.',
    ...(notes.length ? [`Notes: ${notes.join('; ')}.`] : []),
  ];
  await run(db, `INSERT INTO staff_briefs (persona_id, tick_id, text, actions, denials, at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(persona_id, tick_id) DO UPDATE SET text = excluded.text, actions = excluded.actions, denials = excluded.denials, at = excluded.at`,
    personaId, tickId, lines.join('\n'), acts.length, dens.length, iso(now));
  return lines.join('\n');
}

// Personas that ran on a tick (wrote an action or a refusal, or were due) and wrote no brief.
export async function missingBriefs(db, tickId) {
  return (await all(db, `SELECT DISTINCT persona_id FROM (SELECT persona_id FROM staff_actions WHERE tick_id = ? UNION SELECT persona_id FROM staff_denials WHERE tick_id = ?)
      WHERE persona_id NOT IN (SELECT persona_id FROM staff_briefs WHERE tick_id = ?)`, tickId, tickId, tickId)).map(r => r.persona_id);
}

export { day as dayOf, cfg as staffConfig, norm as normTitle, isMachineFiled, planeOfProgram, logAction, TERMINAL_SQL };
export * from './score.js';
export * from './originate.js';
export * from './tick.js';
export * from './seed.js';
export * from './rolefile.js';
export * from './review.js';
export * from './research.js';
export * from './screen.js';
