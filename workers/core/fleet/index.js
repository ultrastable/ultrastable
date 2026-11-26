// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Fleet runtime (US-SPEC-11): worker contract and registry reconciliation, row-driven dispatcher, typed executor with an
// eleven-column run ledger and validated event envelopes (also carried as CloudEvents 1.0), the batch accounting invariant as
// a gate, the slot-counting dead-man check, one acting firing per slot, event-triggered scheduling, automatic staggering and
// items that close when the reading that filed them clears.
// Ports only: ctx = { db, now(), config, fetch?, ai?({model,prompt,max_tokens}), bindings?: {name: db}, executor?(msg),
//                     deployed?: { list() }, claims? (core/claims module), claimsCtx?, sleep?(ms) }. No platform imports.

export const VERSION = '0.2.0';

const DEFAULTS = {
  worker: 'fleet', scheduler_name: 'dispatcher', queued_ttl_minutes: 15, running_ttl_minutes: 60,
  max_tokens: 1024, allowed_models: [], reconcile_every_minutes: 60, deadman_window_minutes: 60,
  tick_procedure: null, auto_stagger: false, stagger_literals: false, tick_scheduler: 'platform-cron', alert_role: 'operations', result_chars: 4000, error_chars: 1000,
  deadman_lookback_minutes: 1440, dispatch_every_minutes: 10, retry_backoff_ms: 0, max_retries: 5, stagger_auto: false, stagger_pin: [],
  cloudevent_type_prefix: 'io.ultrastable.',
};
export const cfg = ctx => ({ ...DEFAULTS, ...(ctx.config || {}) });
export const TRIGGERS = ['cron', 'http', 'event', 'manual'];
export const TASK_TYPES = ['sql', 'http', 'ai', 'workflow'];
export const BUCKETS = ['executed', 'failed', 'needs_human', 'no_action'];

export function nowMs(ctx) {
  const v = ctx.now();
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') return Date.parse(v.includes('T') ? v : v.replace(' ', 'T') + 'Z');
  return v;
}
export const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
export const parseIso = s => Date.parse(String(s).replace(' ', 'T') + 'Z');
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const msg = e => String((e && e.message) || e);
const slug = s => String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** File an item. An item the same reading closed earlier (status done) is reopened when the reading recurs (US-11-R20). */
async function openItem(ctx, id, title, doneCheck, probe, priority) {
  const r = await run(ctx.db, `INSERT OR IGNORE INTO items (id,title,kind,owner_role,done_check,closing_probe,priority,status) VALUES (?,?,'fix',?,?,?,?,'open')`,
    id, String(title).slice(0, 300), cfg(ctx).alert_role, doneCheck, probe, priority);
  if (r.meta.changes > 0) return true;
  const u = await run(ctx.db, `UPDATE items SET status = 'open', disposition = NULL, updated_at = ? WHERE id = ? AND status = 'done'`, iso(nowMs(ctx)), id);
  return u.meta.changes > 0;
}
/** Close an item with the reading that cleared it. Only an item still in the active set is touched. */
async function closeItem(ctx, id, reading) {
  const r = await run(ctx.db, `UPDATE items SET status = 'done', disposition = ?, updated_at = ? WHERE id = ? AND status NOT IN ('done','superseded','cancelled')`,
    `probe green: ${reading}`.slice(0, 1000), iso(nowMs(ctx)), id);
  return r.meta.changes > 0;
}

// ---- cron (US-SPEC-11 section 5) ---------------------------------------------------------------

const MINUTE = 60000;
const INT = /^\d+$/;
function matchTerm(term, v) {
  if (term === '*') return true;
  let m = /^\*\/(\d+)$/.exec(term);
  if (m) return Number(m[1]) > 0 && v % Number(m[1]) === 0;
  m = /^(\d+)-(\d+)$/.exec(term);
  if (m) return v >= Number(m[1]) && v <= Number(m[2]);
  return INT.test(term) && Number(term) === v;
}
const TERM = /^(\*|\*\/[1-9]\d*|\d+-\d+|\d+)$/;
export function matchField(field, v) { return String(field).split(',').some(t => matchTerm(t, v)); }
export function parseCron(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length !== 5 || !f.every(x => x.split(',').every(t => TERM.test(t)))) return null;
  return f;
}
function matches(f, t) {
  const d = new Date(t), dow = d.getUTCDay();
  return matchField(f[0], d.getUTCMinutes()) && matchField(f[1], d.getUTCHours()) && matchField(f[2], d.getUTCDate())
    && matchField(f[3], d.getUTCMonth() + 1) && (matchField(f[4], dow) || (dow === 0 && matchField(f[4], 7)));
}
/** The first matching minute strictly after `fromMs` (UTC), or null for a bad expression or no match in 366 days. */
export function nextFire(expr, fromMs) {
  const f = parseCron(expr);
  if (!f) return null;
  let t = Math.floor(fromMs / MINUTE) * MINUTE + MINUTE;
  for (let i = 0; i < 527040; i++, t += MINUTE) if (matches(f, t)) return t;
  return null;
}
/** Slot start times of `expr` with fromMs <= start < toMs. */
export function expectedSlots(expr, fromMs, toMs) {
  const out = [];
  for (let t = nextFire(expr, fromMs - MINUTE); t !== null && t < toMs; t = nextFire(expr, t)) out.push(t);
  return out;
}
/** US-11-R12: minutes in the window where more than one enabled schedule fires. */
export async function collisions(ctx, { from, to } = {}) {
  const end = to ?? nowMs(ctx) + 60 * MINUTE, start = from ?? end - 60 * MINUTE;
  const per = new Map();
  for (const c of await all(ctx.db, `SELECT name, expr FROM fleet_crons WHERE enabled = 1 ORDER BY name`))
    for (const t of expectedSlots(c.expr, start, end)) per.set(t, [...(per.get(t) || []), c.name]);
  const minutes = [...per.entries()].filter(([, n]) => n.length > 1).sort((a, b) => a[0] - b[0]).map(([t, names]) => ({ minute: iso(t), names }));
  return { from: iso(start), to: iso(end), fired_minutes: per.size, collisions: minutes.length, max_per_minute: Math.max(0, ...[...per.values()].map(n => n.length)), minutes };
}

// The period and phase of a minute field: a step term with n dividing 60, a comma list that is one such progression, or a single literal (period 60).
export function minutePhase(field) {
  const f = String(field);
  let m = /^\*\/(\d+)$/.exec(f);
  if (m) { const n = Number(m[1]); return n > 1 && 60 % n === 0 ? { period: n, offset: 0 } : null; }
  if (!/^\d+(,\d+)*$/.test(f)) return null;
  const v = [...new Set(f.split(',').map(Number))].sort((a, b) => a - b);
  if (v.some(x => x > 59)) return null;
  if (v.length === 1) return { period: 60, offset: v[0] };
  const n = v[1] - v[0];
  if (n < 2 || 60 % n !== 0 || v.length !== 60 / n || v[0] >= n || v.some((x, i) => x !== v[0] + i * n)) return null;
  return { period: n, offset: v[0] };
}
const withPhase = (period, offset) => (period === 60 ? String(offset) : offset === 0 ? `*/${period}` : Array.from({ length: 60 / period }, (_, i) => offset + i * period).join(','));

/**
 * US-11-R12: stagger the enabled schedules. A schedule whose minute field is periodic keeps its period and its other four fields and is
 * moved to the phase that shares the fewest minutes with the schedules already placed; a tie keeps the phase it has. Schedules are placed
 * in name order, so the result is the same on every run and a second run changes nothing. A single-minute schedule (`0 3 * * *`) names a
 * time of day and is moved only with `literals: true`. `apply` writes the rows (a schedule change is a row write, US-11-R04).
 */
export async function stagger(ctx, { from, to, apply = false, literals = false } = {}) {
  const start = from ?? Math.floor(nowMs(ctx) / (60 * MINUTE)) * 60 * MINUTE, end = to ?? start + 24 * 60 * MINUTE;
  const before = await collisions(ctx, { from: start, to: end });
  const load = new Map(), changes = [], fixed = [];
  const place = slots => { for (const t of slots) load.set(t, (load.get(t) || 0) + 1); };
  const rows = await all(ctx.db, `SELECT name, expr, task_id FROM fleet_crons WHERE enabled = 1 ORDER BY name`);
  for (const c of rows) {
    const f = parseCron(c.expr), ph = f && minutePhase(f[0]);
    if (!ph || (ph.period === 60 && !literals)) { fixed.push(c.name); place(expectedSlots(c.expr, start, end)); }
  }
  for (const c of rows) {
    if (fixed.includes(c.name)) continue;
    const f = parseCron(c.expr), ph = minutePhase(f[0]);
    let best = null;
    for (let i = 0; i < ph.period; i++) {
      const offset = (ph.offset + i) % ph.period;   // the present phase is tried first, so it wins a tie
      const expr = [withPhase(ph.period, offset), ...f.slice(1)].join(' ');
      const slots = expectedSlots(expr, start, end), cost = slots.reduce((n, t) => n + (load.get(t) || 0), 0);
      if (!best || cost < best.cost) best = { expr, slots, cost };
      if (cost === 0) break;
    }
    place(best.slots);
    if (best.expr !== c.expr) changes.push({ name: c.name, from: c.expr, to: best.expr });
  }
  if (apply) for (const ch of changes) { const c = rows.find(r => r.name === ch.name); await setCron(ctx, { name: c.name, expr: ch.to, task_id: c.task_id }); }
  const shared = [...load.values()].filter(n => n > 1);
  return { from: iso(start), to: iso(end), applied: Boolean(apply), changes, fixed, collisions_before: before.collisions, max_per_minute_before: before.max_per_minute,
    collisions_after: shared.length, max_per_minute_after: Math.max(0, ...load.values()) };
}

// ---- schedule and task rows (US-11-R04) --------------------------------------------------------

export async function setCron(ctx, { name, expr, task_id, enabled = true }) {
  if (!parseCron(expr)) throw new Error('cron expression must have five valid fields');
  await run(ctx.db, `INSERT INTO fleet_crons (name, expr, task_id, enabled) VALUES (?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET expr=excluded.expr, task_id=excluded.task_id, enabled=excluded.enabled,
      next_fire = CASE WHEN fleet_crons.expr = excluded.expr THEN fleet_crons.next_fire ELSE NULL END`, name, expr, task_id, enabled ? 1 : 0);
}
export async function setTask(ctx, { id, type, definition = {}, enabled = true, name, timeout_ms, retries, version }) {
  const c = cfg(ctx);
  if (timeout_ms !== undefined && timeout_ms !== null && !(Number.isInteger(timeout_ms) && timeout_ms > 0)) throw new Error('timeout_ms is a positive integer');
  if (retries !== undefined && retries !== null && !(Number.isInteger(retries) && retries >= 0 && retries <= c.max_retries)) throw new Error(`retries is an integer from 0 to ${c.max_retries}`);
  await run(ctx.db, `INSERT INTO fleet_tasks (id, type, definition, enabled) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET type=excluded.type, definition=excluded.definition, enabled=excluded.enabled`, id, String(type), JSON.stringify(definition), enabled ? 1 : 0);
  if ([name, timeout_ms, retries, version].some(v => v !== undefined))
    await run(ctx.db, `INSERT INTO fleet_task_options (task_id, name, timeout_ms, retries, version, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(task_id) DO UPDATE SET name=excluded.name, timeout_ms=excluded.timeout_ms, retries=excluded.retries, version=excluded.version, updated_at=excluded.updated_at`,
      id, name ?? null, timeout_ms ?? null, retries ?? null, version ?? null, iso(nowMs(ctx)));
}
export async function declareProcedure(ctx, { name, expr, schedulers }) {
  if (!parseCron(expr)) throw new Error('cron expression must have five valid fields');
  if (!Array.isArray(schedulers) || !schedulers.length) throw new Error('a procedure names at least one scheduler');
  await run(ctx.db, `INSERT INTO fleet_procedures (name, expr, schedulers) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET expr=excluded.expr, schedulers=excluded.schedulers`,
    name, expr, JSON.stringify(schedulers));
}

// ---- dispatcher (US-11-R03, R04, R11) ----------------------------------------------------------

/**
 * Hand a queued run to the executor. With no `ctx.executor` port the module executes it inline (a long task blocks this
 * invocation); a host that wants another worker to do the work passes `executor` and posts to it.
 */
async function post(ctx, m) {
  const r = typeof ctx.executor === 'function' ? await ctx.executor(m) : await execute(ctx, m);
  if (r && r.ok === false && r.rejected_before_start) throw new Error(r.error || 'executor refused');
  return r;
}

/**
 * One dispatcher invocation: fire every due row, advance next_fire and last_fired whether or not the post succeeded.
 * The cadence is the invocation cadence: a schedule finer than the interval at which the host calls this fires once per call
 * (see `cadenceReport`). The overlap guard is one conditional insert, so two concurrent dispatchers cannot both queue a task.
 */
export async function dispatch(ctx) {
  const c = cfg(ctx), now = nowMs(ctx), nowS = iso(now);
  const out = { fired: [], skipped: [], errors: [] };
  const due = await all(ctx.db, `SELECT * FROM fleet_crons WHERE enabled = 1 AND (next_fire IS NULL OR next_fire <= ?) ORDER BY name`, nowS);
  for (const cr of due) {
    const nf = nextFire(cr.expr, now);
    // US-11-R11: one live run per task, enforced by the store: the row is inserted only when the task has no queued or running run.
    const ins = await run(ctx.db, `INSERT INTO fleet_runs (worker, trigger, status, task_id, cron_name, scheduler, queued_at, evidence_refs)
      SELECT ?, 'cron', 'queued', ?, ?, ?, ?, '[]' WHERE NOT EXISTS (SELECT 1 FROM fleet_runs WHERE task_id = ? AND status IN ('queued','running'))`,
      c.worker, cr.task_id, cr.name, c.scheduler_name, nowS, cr.task_id);
    let error = null;
    if (!ins.meta.changes) {
      const live = await first(ctx.db, `SELECT run_id FROM fleet_runs WHERE task_id = ? AND status IN ('queued','running') ORDER BY run_id LIMIT 1`, cr.task_id);
      out.skipped.push({ cron: cr.name, reason: 'overlap', run_id: live ? live.run_id : null });
    } else {
      const runId = ins.meta.last_row_id;
      try { await post(ctx, { task_id: cr.task_id, cron_name: cr.name, run_id: runId }); out.fired.push({ cron: cr.name, run_id: runId }); }
      catch (e) { error = msg(e).slice(0, 300); out.errors.push({ cron: cr.name, run_id: runId, error }); }
    }
    await run(ctx.db, `UPDATE fleet_crons SET last_fired = ?, next_fire = ? WHERE name = ?`, nowS, nf === null ? null : iso(nf), cr.name);
    if (nf === null) await run(ctx.db, `UPDATE fleet_crons SET enabled = 0 WHERE name = ?`, cr.name); // an expression that never fires must not be due every minute
  }
  return out;
}

/** Enabled schedules whose minimum gap between slots is shorter than the dispatch cadence: they fire once per invocation, not per slot. */
export async function cadenceReport(ctx, { every_minutes } = {}) {
  const c = cfg(ctx), every = every_minutes ?? c.dispatch_every_minutes, now = nowMs(ctx);
  const coarsened = [];
  for (const cr of await all(ctx.db, `SELECT name, expr FROM fleet_crons WHERE enabled = 1 ORDER BY name`)) {
    let prev = nextFire(cr.expr, now), min = null;
    for (let i = 0; i < 50 && prev !== null; i++) {
      const nx = nextFire(cr.expr, prev);
      if (nx === null) break;
      const gap = (nx - prev) / MINUTE;
      if (min === null || gap < min) min = gap;
      prev = nx;
    }
    if (min !== null && min < every) coarsened.push({ cron: cr.name, expr: cr.expr, min_gap_minutes: min });
  }
  return { every_minutes: every, coarsened };
}

/** Stale `queued` and `running` rows end as failed with an alert item, so a silent executor is visible (US-11-R11). */
export async function reapStale(ctx) {
  const c = cfg(ctx), now = nowMs(ctx), nowS = iso(now), reaped = [];
  const rows = [
    ...await all(ctx.db, `SELECT run_id, cron_name, task_id, 'stale_queued' AS cls FROM fleet_runs WHERE status = 'queued' AND queued_at <= ?`, iso(now - c.queued_ttl_minutes * MINUTE)),
    ...await all(ctx.db, `SELECT run_id, cron_name, task_id, 'stale_running' AS cls FROM fleet_runs WHERE status = 'running' AND ts_start <= ?`, iso(now - c.running_ttl_minutes * MINUTE)),
  ];
  for (const r of rows) {
    const u = await run(ctx.db, `UPDATE fleet_runs SET status = 'failed', error_class = ?, error = ?, ts_end = ? WHERE run_id = ? AND status IN ('queued','running')`,
      r.cls, r.cls === 'stale_queued' ? 'never left queued: the executor did not take the run' : 'never finished', nowS, r.run_id);
    if (!u.meta.changes) continue;
    reaped.push(r.run_id);
    await openItem(ctx, `FLEET-STALE-${slug(r.task_id || r.run_id)}`, `Task ${r.task_id} has runs that ${r.cls === 'stale_queued' ? 'never left queued' : 'never finished'} (first: run ${r.run_id})`,
      `the next run of task ${r.task_id} ends ok`, `fleet_runs: newest row for task ${r.task_id} has status ok`, 20);
  }
  return { reaped };
}

// ---- event envelopes (US-11-R06) ---------------------------------------------------------------

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
export async function buildEnvelope({ kind, id, ts, emitter, session, payload }) {
  return { schema_version: '1', kind, id, ts, provenance: { emitter, session, sha256: await sha256Hex(JSON.stringify(payload ?? null)) } };
}
/** Returns null when valid, else the reason. The payload hash is recomputed, never trusted. */
export async function validateEnvelope(env, payload) {
  if (!env || typeof env !== 'object') return 'envelope missing';
  if (env.schema_version !== '1') return 'unsupported schema_version';
  if (typeof env.kind !== 'string' || !/^[a-z0-9][a-z0-9_.-]{0,80}$/.test(env.kind)) return 'kind missing or malformed';
  if (typeof env.id !== 'string' || !env.id || env.id.length > 200) return 'id missing';
  if (typeof env.ts !== 'string' || Number.isNaN(parseIso(env.ts))) return 'ts missing or unparsable';
  const p = env.provenance;
  if (!p || typeof p !== 'object') return 'provenance missing';
  if (typeof p.emitter !== 'string' || !p.emitter) return 'provenance.emitter missing';
  if (typeof p.session !== 'string' || !p.session) return 'provenance.session missing';
  if (typeof p.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(p.sha256)) return 'provenance.sha256 missing or malformed';
  if (p.sha256 !== await sha256Hex(JSON.stringify(payload ?? null))) return 'provenance.sha256 does not match the payload';
  return null;
}

// ---- CloudEvents 1.0 carriage (US-11-R22) ------------------------------------------------------
// The fleet envelope (with its payload hash) is the integrity record; CloudEvents 1.0 is the open standard other tools read. The
// provenance rides as extension attributes (`emitter`, `session`, `payloadsha256`, `schemaversion`: lower-case letters and digits only).

const CE_NAME = /^[a-z0-9]{1,20}$/;
const CE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const CE_CONTEXT = new Set(['specversion', 'id', 'source', 'type', 'datacontenttype', 'dataschema', 'subject', 'time', 'data', 'data_base64']);
/** Returns null when `ce` conforms to the CloudEvents 1.0 core attributes (checked locally, no library), else the reason. */
export function validateCloudEvent(ce) {
  if (!ce || typeof ce !== 'object' || Array.isArray(ce)) return 'not an object';
  if (ce.specversion !== '1.0') return `specversion must be "1.0", got ${JSON.stringify(ce.specversion)}`;
  for (const k of ['id', 'source', 'type']) if (typeof ce[k] !== 'string' || !ce[k]) return `${k} is required and must be a non-empty string`;
  if (/\s/.test(ce.source)) return 'source must be a URI-reference without whitespace';
  if (ce.time !== undefined && (typeof ce.time !== 'string' || !CE_TIME.test(ce.time) || Number.isNaN(Date.parse(ce.time)))) return 'time must be an RFC 3339 timestamp';
  if (ce.datacontenttype !== undefined && (typeof ce.datacontenttype !== 'string' || !ce.datacontenttype)) return 'datacontenttype must be a non-empty string';
  if (ce.data !== undefined && ce.data_base64 !== undefined) return 'data and data_base64 are mutually exclusive';
  for (const [k, v] of Object.entries(ce)) {
    if (CE_CONTEXT.has(k)) continue;
    if (!CE_NAME.test(k)) return `attribute name ${JSON.stringify(k)} must be 1 to 20 lower-case letters or digits`;
    if (!['string', 'number', 'boolean'].includes(typeof v)) return `attribute ${k} must be a string, number or boolean`;
  }
  return null;
}
/** The fleet envelope as a CloudEvents 1.0 event: type = prefix + kind, payload under `data`, provenance as extension attributes. */
export function toCloudEvent(env, payload, { source = 'urn:fleet', type_prefix = DEFAULTS.cloudevent_type_prefix } = {}) {
  const t = parseIso(env.ts);
  return { specversion: '1.0', id: env.id, source, type: `${type_prefix}${env.kind}`, time: Number.isNaN(t) ? env.ts : new Date(t).toISOString(),
    datacontenttype: 'application/json', data: payload ?? null,
    schemaversion: env.schema_version, emitter: env.provenance.emitter, session: env.provenance.session, payloadsha256: env.provenance.sha256 };
}
/** A CloudEvent back to { envelope, payload }; `ok: false` with the reason when it does not conform or does not carry the fleet provenance. */
export function fromCloudEvent(ce, { type_prefix = DEFAULTS.cloudevent_type_prefix } = {}) {
  const bad = validateCloudEvent(ce);
  if (bad) return { ok: false, error: `cloudevent: ${bad}` };
  if (!ce.type.startsWith(type_prefix)) return { ok: false, error: `cloudevent: type must start with ${type_prefix}` };
  if (ce.time === undefined) return { ok: false, error: 'cloudevent: the fleet envelope needs a time' };
  if (ce.data_base64 !== undefined) return { ok: false, error: 'cloudevent: data_base64 is not carried (the payload is JSON)' };
  const envelope = { schema_version: String(ce.schemaversion ?? '1'), kind: ce.type.slice(type_prefix.length), id: ce.id, ts: iso(Date.parse(ce.time)),
    provenance: { emitter: ce.emitter, session: ce.session, sha256: ce.payloadsha256 } };
  return { ok: true, envelope, payload: ce.data ?? null };
}

/**
 * Store an event. `env` is the fleet envelope, or a CloudEvents 1.0 event (recognised by `specversion`), in which case the
 * payload is its `data`. Valid events are stored `accepted`; anything else, a repeated id included, is stored `rejected` with the reason.
 */
export async function recordEvent(ctx, env, payload, { run_id = null } = {}) {
  const str = v => (typeof v === 'string' ? v.slice(0, 200) : null);
  if (env && typeof env === 'object' && 'specversion' in env) {
    const conv = fromCloudEvent(env, { type_prefix: cfg(ctx).cloudevent_type_prefix });
    if (!conv.ok) {
      await run(ctx.db, `INSERT INTO fleet_events (event_id, schema_version, kind, ts, emitter, session, payload_sha256, payload, state, error, run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        str(env.id), str(env.specversion), str(env.type), str(env.time), str(env.emitter), str(env.session), str(env.payloadsha256), JSON.stringify(env.data ?? null).slice(0, 4000), 'rejected', conv.error, run_id);
      return { accepted: false, error: conv.error };
    }
    env = conv.envelope; payload = conv.payload;
  }
  let error = await validateEnvelope(env, payload);
  const e = env && typeof env === 'object' ? env : {}, p = e.provenance && typeof e.provenance === 'object' ? e.provenance : {};
  const body = JSON.stringify(payload ?? null).slice(0, 4000);
  const put = (state, err) => run(ctx.db, `INSERT INTO fleet_events (event_id, schema_version, kind, ts, emitter, session, payload_sha256, payload, state, error, run_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    str(e.id), str(e.schema_version), str(e.kind), str(e.ts), str(p.emitter), str(p.session), str(p.sha256), body, state, err, run_id);
  if (!error) {
    try { await put('accepted', null); return { accepted: true, id: e.id }; }
    catch (x) { if (!/UNIQUE|constraint/i.test(msg(x))) throw x; error = 'duplicate event id'; }
  }
  await put('rejected', error);
  return { accepted: false, error };
}

// ---- executor (US-11-R05, R06) -----------------------------------------------------------------

class TaskError extends Error { constructor(cls, m, retryable = false) { super(m); this.cls = cls; this.retryable = retryable; } }

async function runSql(ctx, def) {
  // `db` and `sql` are accepted as aliases of `binding` and `statement` (the keys of the reference deployment's rows).
  const name = def.binding ?? def.db;
  const db = name ? (ctx.bindings || {})[name] : ctx.db;
  if (!db) throw new TaskError('no_binding', `binding ${name} is not configured`);
  const s = String(def.statement ?? def.sql ?? '').trim().replace(/;\s*$/, '');
  if (!s || s.includes(';')) throw new TaskError('bad_definition', 'sql task takes exactly one statement');
  const st = db.prepare(s).bind(...(Array.isArray(def.params) ? def.params : []));
  if (/^(select|with)\b/i.test(s)) { const rows = (await st.all()).results || []; return { row_count: rows.length, rows: rows.slice(0, 3) }; }
  return { row_count: (await st.run()).meta.changes };
}
async function runHttp(ctx, def) {
  if (typeof ctx.fetch !== 'function') throw new TaskError('no_fetch', 'no fetch port');
  if (!def.url) throw new TaskError('bad_definition', 'http task needs a url');
  const r = await ctx.fetch(def.url, { method: def.method || 'GET', headers: def.headers || {}, body: def.body == null ? undefined : (typeof def.body === 'string' ? def.body : JSON.stringify(def.body)) });
  const text = (await r.text()).slice(0, 500);
  if (r.status >= 400) throw new TaskError('http_status', `status ${r.status}: ${text}`, r.status >= 500); // a 5xx may clear on a retry; a 4xx will not
  return { status: r.status, body: text };
}
/** The model must be on the allowed list; with none named, the cheapest allowed model is used. */
export function chooseModel(c, wanted) {
  const list = (c.allowed_models || []).map(m => (typeof m === 'string' ? { id: m, cost: 0 } : m));
  if (!list.length) throw new TaskError('no_model', 'no allowed models configured');
  if (wanted) { const m = list.find(x => x.id === wanted); if (!m) throw new TaskError('model_not_allowed', `model ${wanted} is not on the allowed list`); return m; }
  return list.reduce((a, b) => (Number(b.cost) < Number(a.cost) ? b : a));
}
async function runAi(ctx, def) {
  const c = cfg(ctx);
  if (typeof ctx.ai !== 'function') throw new TaskError('no_gateway', 'no model gateway port');
  const model = chooseModel(c, def.model);
  const max_tokens = Math.max(1, Math.min(Number(def.max_tokens) > 0 ? Number(def.max_tokens) : c.max_tokens, c.max_tokens));
  const r = await ctx.ai({ model: model.id, prompt: String(def.prompt || ''), max_tokens });
  return { model: model.id, max_tokens, text: String((r && r.text) ?? '').slice(0, 2000), cost: Number(r && r.cost) || 0 };
}
const SIMPLE = { sql: runSql, http: runHttp, ai: runAi };
async function runTask(ctx, type, def) {
  if (SIMPLE[type]) return SIMPLE[type](ctx, def || {});
  if (type === 'workflow') {
    const steps = Array.isArray(def && def.steps) ? def.steps : null;
    if (!steps || !steps.length) throw new TaskError('bad_definition', 'workflow needs a non-empty steps list');
    const results = []; let cost = 0;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i] || {};
      if (!SIMPLE[s.type]) throw new TaskError('unknown_type', `workflow step ${i + 1} has unknown type ${s.type}`);
      try { const r = await SIMPLE[s.type](ctx, s.definition || {}); cost += Number(r.cost) || 0; results.push({ step: i + 1, type: s.type, ...(s.name ? { name: String(s.name).slice(0, 80) } : {}), ...r }); }
      catch (e) { throw new TaskError(e.cls || 'exception', `workflow step ${i + 1} (${s.type}): ${msg(e)}`, e instanceof TaskError ? e.retryable : true); }
    }
    return { steps: results, cost };
  }
  throw new TaskError('unknown_type', `unknown task type ${type}`);
}

const pause = (ctx, ms) => (typeof ctx.sleep === 'function' ? ctx.sleep(ms) : new Promise(r => setTimeout(r, ms)));
/** Race `fn` against a timer. The work is not cancelled when the timer wins: the run is recorded as failed (class `timeout`). */
async function withTimeout(ctx, ms, fn) {
  if (!ms) return fn();
  let timer = null;
  const guard = new Promise((_, reject) => {
    const boom = () => reject(new TaskError('timeout', `task did not finish within ${ms} ms`, true));
    if (typeof ctx.sleep === 'function') ctx.sleep(ms).then(boom); else timer = setTimeout(boom, ms);
  });
  try { return await Promise.race([fn(), guard]); } finally { if (timer) clearTimeout(timer); }
}

/**
 * Execute one task and write its run record. m = { task_id, cron_name?, run_id?, trigger?, parent_run?, session?, task? }.
 * `task` (an inline {type, definition, timeout_ms?, retries?}) is for posted tasks; every execution, accepted or rejected, ends in a run row.
 * A stored task may carry options (timeout_ms, retries; `setTask`). A retry re-runs only a failure that may clear (a 5xx, a timeout, an
 * exception); every failed earlier attempt keeps its own child run row (parent_run) and the parent row is the last attempt.
 */
export async function execute(ctx, m = {}) {
  const c = cfg(ctx), startS = iso(nowMs(ctx));
  const trigger = m.run_id ? null : (m.trigger || 'http');
  if (trigger && !TRIGGERS.includes(trigger)) {
    // US-11-R05: a rejected request still leaves a record.
    const reason = `unknown trigger ${String(trigger).slice(0, 100)}`;
    const rej = await run(ctx.db, `INSERT INTO fleet_runs (worker, trigger, ts_start, ts_end, status, error_class, summary, task_id, cron_name, queued_at, evidence_refs, error) VALUES (?, 'http', ?, ?, 'failed', 'unknown_trigger', 'request rejected before it started', ?, ?, ?, '[]', ?)`,
      c.worker, startS, startS, m.task_id ?? (m.task ? 'inline' : null), m.cron_name ?? null, startS, reason);
    return { ok: false, rejected_before_start: true, run_id: rej.meta.last_row_id, error: `unknown trigger ${trigger}` };
  }
  let runId = m.run_id;
  if (runId) {
    const u = await run(ctx.db, `UPDATE fleet_runs SET status = 'running', ts_start = ? WHERE run_id = ? AND status = 'queued'`, startS, runId);
    if (!u.meta.changes) return { ok: false, rejected_before_start: true, run_id: runId, error: 'run is not queued (already taken or reaped)' };
  } else {
    const ins = await run(ctx.db, `INSERT INTO fleet_runs (worker, trigger, ts_start, status, task_id, cron_name, parent_run, queued_at, evidence_refs) VALUES (?,?,?, 'running', ?,?,?,?, '[]')`,
      c.worker, trigger, startS, m.task_id ?? (m.task ? 'inline' : null), m.cron_name ?? null, m.parent_run ?? null, startS);
    runId = ins.meta.last_row_id;
  }
  let task = null, opts = {}, type = null, first_fail = null;
  try {
    task = m.task || null;
    if (task) opts = { timeout_ms: task.timeout_ms, retries: task.retries };
    else {
      const row = await first(ctx.db, `SELECT * FROM fleet_tasks WHERE id = ?`, m.task_id ?? '');
      if (!row) throw new TaskError('no_task', `task ${m.task_id} not found`);
      if (!row.enabled) throw new TaskError('task_disabled', `task ${m.task_id} is disabled`);
      let definition;
      try { definition = JSON.parse(row.definition); } catch { throw new TaskError('bad_definition', 'task definition is not JSON'); }
      task = { type: row.type, definition };
      opts = (await first(ctx.db, `SELECT timeout_ms, retries FROM fleet_task_options WHERE task_id = ?`, row.id)) || {};
    }
    type = task.type;
    if (!TASK_TYPES.includes(type)) throw new TaskError('unknown_type', `unknown task type ${type}`);
  } catch (e) { first_fail = { status: 'failed', cls: e.cls || 'exception', error: msg(e).slice(0, c.error_chars), retryable: false }; }
  const attemptOnce = async () => {
    const at = iso(nowMs(ctx));
    try { const result = await withTimeout(ctx, opts.timeout_ms, () => runTask(ctx, type, task.definition)); return { status: 'ok', result, start: at, end: iso(nowMs(ctx)) }; }
    catch (e) { return { status: 'failed', cls: e.cls || 'exception', error: msg(e).slice(0, c.error_chars), retryable: e instanceof TaskError ? Boolean(e.retryable) : true, start: at, end: iso(nowMs(ctx)) }; }
  };
  const tid = m.task_id ?? 'inline';
  const attempts = [];
  let o = first_fail || await attemptOnce();
  attempts.push(o);
  const budget = 1 + (Number.isInteger(opts.retries) && opts.retries > 0 ? Math.min(opts.retries, c.max_retries) : 0);
  while (o.status === 'failed' && o.retryable && attempts.length < budget) {
    if (c.retry_backoff_ms > 0) await pause(ctx, c.retry_backoff_ms);
    o = await attemptOnce(); attempts.push(o);
  }
  if (attempts.length > 1) {
    const parent = await first(ctx.db, `SELECT trigger FROM fleet_runs WHERE run_id = ?`, runId);
    for (let i = 0; i < attempts.length - 1; i++) {
      const a = attempts[i];
      await run(ctx.db, `INSERT INTO fleet_runs (worker, trigger, ts_start, ts_end, status, error_class, summary, task_id, cron_name, parent_run, queued_at, evidence_refs, error) VALUES (?,?,?,?, 'failed', ?, ?, ?, ?, ?, ?, '[]', ?)`,
        c.worker, parent ? parent.trigger : 'manual', a.start, a.end, a.cls, `${type} ${tid} attempt ${i + 1} of ${attempts.length} failed: ${a.cls}`, m.task_id ?? 'inline', m.cron_name ?? null, runId, a.start, a.error);
    }
  }
  const endS = iso(nowMs(ctx)), result = o.status === 'ok' ? o.result : null, cls = o.status === 'ok' ? null : o.cls, error = o.status === 'ok' ? null : o.error;
  const resultText = result === null ? null : JSON.stringify(result).slice(0, c.result_chars);
  const tried = attempts.length > 1 ? ` after ${attempts.length} attempts (${attempts.map((a, i) => `${i + 1} ${a.status === 'ok' ? 'ok' : a.cls}`).join(', ')})` : '';
  const summary = (o.status === 'ok' ? `${type} task ${tid} ok` : `${type ?? 'task'} ${tid} failed: ${cls}`) + tried;
  const payload = { run_id: runId, task_id: m.task_id ?? null, type, status: o.status, error_class: cls };
  const env = await buildEnvelope({ kind: 'fleet.run', id: `run-${runId}`, ts: endS, emitter: c.worker, session: String(m.session || `run-${runId}`), payload });
  const ev = await recordEvent(ctx, env, payload, { run_id: runId });
  await run(ctx.db, `UPDATE fleet_runs SET status = ?, ts_end = ?, error_class = ?, summary = ?, result = ?, error = ?, cost = ?, evidence_refs = ? WHERE run_id = ?`,
    o.status, endS, cls, summary, resultText, error, Number(result && result.cost) || 0, JSON.stringify([`fleet_events:run-${runId}:${ev.accepted ? 'accepted' : 'rejected'}`]), runId);
  return { ok: o.status === 'ok', run_id: runId, status: o.status, error_class: cls, error, result, event: ev, attempts: attempts.length };
}

// ---- accounting invariant as a gate (US-11-R07) ------------------------------------------------

const cnt = v => (Array.isArray(v) ? v.length : Number(v) || 0);
/** Book one batch. A gap makes the batch a failure, fails its run row, opens an incident item and closes the gate. */
export async function recordBatch(ctx, b = {}) {
  const ids = Array.isArray(b.scanned_ids) ? b.scanned_ids : null;
  const scanned = ids ? ids.length : cnt(b.scanned);
  const gap = scanned - BUCKETS.reduce((s, k) => s + cnt(b[k]), 0);
  let unaccounted = null;
  if (ids && BUCKETS.every(k => b[k] === undefined || Array.isArray(b[k]))) { const seen = new Set(BUCKETS.flatMap(k => b[k] || [])); unaccounted = ids.filter(i => !seen.has(i)); }
  const at = iso(nowMs(ctx)), executor = String(b.executor || 'executor'), status = gap === 0 ? 'ok' : 'failed';
  const ins = await run(ctx.db, `INSERT INTO fleet_batches (at, executor, run_id, scanned, executed, failed, needs_human, no_action, gap, status, unaccounted) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    at, executor, b.run_id ?? null, scanned, cnt(b.executed), cnt(b.failed), cnt(b.needs_human), cnt(b.no_action), gap, status, unaccounted ? JSON.stringify(unaccounted) : null);
  const out = { ok: gap === 0, batch_id: ins.meta.last_row_id, scanned, gap, status, unaccounted: unaccounted || [], item_id: null };
  if (gap === 0) return out;
  if (b.run_id) await run(ctx.db, `UPDATE fleet_runs SET status = 'failed', error_class = 'accounting_gap', error = ? WHERE run_id = ?`, `scanned ${scanned}, accounted ${scanned - gap}`, b.run_id);
  out.item_id = `FLEET-UNACCOUNTED-${slug(executor)}`;
  await openItem(ctx, out.item_id, `Executor ${executor} scanned ${scanned} and accounted for ${scanned - gap}`,
    `the next batch of ${executor} balances: executed + failed + needs_human + no_action = scanned`, `fleet_batches: newest row for executor ${executor} has gap 0`, 0);
  return out;
}
/** The gate: an executor whose newest batch does not balance is not passed. Consumers call this before trusting its output. */
export async function batchGate(ctx, executor) {
  const last = await first(ctx.db, `SELECT * FROM fleet_batches WHERE executor = ? ORDER BY id DESC LIMIT 1`, String(executor));
  if (!last) return { pass: true, reason: 'no_batches' };
  return last.gap === 0 ? { pass: true, batch_id: last.id } : { pass: false, reason: 'accounting_gap', batch_id: last.id, gap: last.gap, unaccounted: JSON.parse(last.unaccounted || '[]') };
}
/** Drain a batch booking exactly one bucket per item. A handler that throws books `failed`; any other answer is unaccounted. */
export async function drain(ctx, { executor, items, handle, run_id = null }) {
  const b = { executor, run_id, scanned_ids: items.map(i => i.id), executed: [], failed: [], needs_human: [], no_action: [] };
  for (const it of items) {
    let bucket;
    try { bucket = await handle(it); } catch { bucket = 'failed'; }
    if (BUCKETS.includes(bucket)) b[bucket].push(it.id);
  }
  return recordBatch(ctx, b);
}

// ---- one acting firing per slot (US-11-R10) ----------------------------------------------------

/**
 * Run `fn` at most once per (procedure, slot). The winner takes the slot row (a store-enforced claim) and, when the claims
 * port is present, a US-SPEC-08 work claim for the duration. The other firing writes a run record and ends without acting.
 */
export async function fireOnce(ctx, { procedure, scheduler, expr = null, trigger = 'cron' }, fn) {
  const c = cfg(ctx), now = nowMs(ctx), nowS = iso(now);
  let slot = Math.floor(now / MINUTE) * MINUTE; // without an expression the slot is the current minute
  if (expr) { const f = parseCron(expr); if (!f) throw new Error('bad cron expression'); for (let i = 0; i < 527040 && !matches(f, slot); i++) slot -= MINUTE; }
  const slotS = iso(slot);
  const record = (status, summary, cls = null, error = null) => run(ctx.db,
    `INSERT INTO fleet_runs (worker, trigger, ts_start, ts_end, status, error_class, summary, cron_name, scheduler, queued_at, evidence_refs, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    c.worker, trigger, nowS, iso(nowMs(ctx)), status, cls, summary, procedure, scheduler, nowS, JSON.stringify([`fleet_slot_claims:${procedure}:${slotS}`]), error);
  const won = (await run(ctx.db, `INSERT OR IGNORE INTO fleet_slot_claims (procedure, slot, scheduler, at) VALUES (?,?,?,?)`, procedure, slotS, scheduler, nowS)).meta.changes > 0;
  if (!won) { await record('ok', 'duplicate firing: the slot was already taken, ended without acting'); return { acted: false, slot: slotS, reason: 'slot_taken' }; }
  let claim = null;
  if (ctx.claims) {
    claim = await ctx.claims.acquire(ctx.claimsCtx || ctx, { key: `procedure:${procedure}`, holder: scheduler, intent: `fire ${procedure} ${slotS}`, allow_duplicate: true });
    if (!claim.acquired) { await record('ok', `duplicate firing: work claim held by ${claim.holder || 'another'}, ended without acting`); return { acted: false, slot: slotS, reason: claim.reason }; }
  }
  try {
    const result = await fn({ slot: slotS });
    await record('ok', `${procedure} acted for slot ${slotS}`);
    return { acted: true, slot: slotS, result };
  } catch (e) {
    await record('failed', `${procedure} failed for slot ${slotS}`, 'exception', msg(e).slice(0, c.error_chars));
    return { acted: true, slot: slotS, error: msg(e) };
  } finally {
    if (claim) await ctx.claims.release(ctx.claimsCtx || ctx, { key: `procedure:${procedure}`, token: claim.token, outcome: 'done' });
  }
}

// ---- dead-man check (US-11-R08, R09) -----------------------------------------------------------

/**
 * For each declared procedure: expected slots from its cron expression, records per slot and per scheduler, an alert for
 * each fully elapsed slot with no record (`stop`), and a `single_path` label where one of several declared schedulers is silent.
 */
export async function deadman(ctx, { from, to } = {}) {
  const c = cfg(ctx), now = nowMs(ctx);
  const end = to ?? now;
  // Without an explicit window the check resumes from the end of its last pass (less one window, so a slot that was still open then
  // is judged now), at most `deadman_lookback_minutes` back: slots that elapsed while the check itself did not run are not lost.
  let start = from;
  if (start === undefined) {
    const prev = await first(ctx.db, `SELECT checked_to FROM fleet_deadman_state WHERE id = 1`);
    start = prev ? Math.max(parseIso(prev.checked_to) - c.deadman_window_minutes * MINUTE, end - c.deadman_lookback_minutes * MINUTE) : end - c.deadman_window_minutes * MINUTE;
  }
  const out = { from: iso(start), to: iso(end), procedures: [], alerts: [] };
  for (const p of await all(ctx.db, `SELECT * FROM fleet_procedures ORDER BY name`)) {
    const declared = JSON.parse(p.schedulers);
    const slots = expectedSlots(p.expr, start, end).map(s => ({ start: s, end: nextFire(p.expr, s) })).filter(s => s.end !== null && s.end <= now);
    const rel = Object.fromEntries(declared.map(s => [s, { slots: slots.length, with_record: 0 }]));
    const row = { procedure: p.name, slots: slots.length, stops: 0, single_path: 0, reliability: {} };
    for (const s of slots) {
      const a = iso(s.start), b = iso(s.end);
      const recs = await all(ctx.db, `SELECT COALESCE(scheduler, '') AS scheduler, COUNT(*) AS n FROM fleet_runs WHERE cron_name = ? AND ts_start >= ? AND ts_start < ? GROUP BY 1`, p.name, a, b);
      const by = new Map(recs.map(r => [r.scheduler, r.n]));
      if (c.tick_procedure === p.name) {
        const t = await first(ctx.db, `SELECT COUNT(*) AS n FROM tick_runs WHERE started_at >= ? AND started_at < ?`, a, b);
        if (t.n) by.set(c.tick_scheduler, (by.get(c.tick_scheduler) || 0) + t.n);
      }
      const total = [...by.values()].reduce((x, y) => x + y, 0);
      const missing = declared.filter(d => !by.get(d));
      for (const d of declared) if (by.get(d)) rel[d].with_record++;
      let kind = null;
      if (total === 0) kind = 'stop';
      else if (declared.length > 1 && missing.length > 0) kind = 'single_path';
      if (!kind) continue;
      row[kind === 'stop' ? 'stops' : 'single_path']++;
      const priority = kind === 'stop' ? 0 : 60;
      const itemId = kind === 'stop' ? `DEADMAN-${slug(p.name)}-${a.replace(/[- :]/g, '').slice(0, 12)}` : `FLEET-PATH-${slug(p.name)}-${slug(missing.join('-'))}`;
      const ins = await run(ctx.db, `INSERT OR IGNORE INTO fleet_alerts (procedure, slot, kind, schedulers, missing, priority, item_id, at) VALUES (?,?,?,?,?,?,?,?)`,
        p.name, a, kind, p.schedulers, JSON.stringify(missing), priority, itemId, iso(now));
      if (!ins.meta.changes) continue;
      if (kind === 'stop') await openItem(ctx, itemId, `Stop: procedure ${p.name} has no record for slot ${a} (declared by ${declared.join(', ')})`,
        `a later slot of ${p.name} has a record`, `fleet_runs: a row for ${p.name} with ts_start after ${a}`, priority);
      else await openItem(ctx, itemId, `Single-path failure: ${missing.join(', ')} produced no record for ${p.name} (first seen slot ${a}); redundancy is degraded`,
        `${missing.join(', ')} records every slot of ${p.name} for one window`, `fleet deadman: reliability of ${missing.join(', ')} for ${p.name} is 1`, priority);
      out.alerts.push({ procedure: p.name, slot: a, kind, schedulers: declared, missing, priority, item_id: itemId });
    }
    for (const d of declared) row.reliability[d] = rel[d].slots ? rel[d].with_record / rel[d].slots : null;
    out.procedures.push(row);
  }
  if (from === undefined && to === undefined)
    await run(ctx.db, `INSERT INTO fleet_deadman_state (id, checked_to) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET checked_to = excluded.checked_to`, iso(end));
  return out;
}

// ---- worker contract and registry reconciliation (US-11-R01, R02) ------------------------------

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const HEALTH_FIELDS = ['status', 'worker', 'version', 'enabled', 'bindings_ok'];
const HEADER_FIELDS = ['purpose', 'capabilities', 'deploy_method', 'canonical_source'];
const REGISTRY_FIELDS = ['name', 'purpose', 'kind', 'status', 'crons', 'dependencies', 'health_url', 'autonomy_level', 'owner'];
const parseJson = (s, d) => { if (s == null) return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch { return d; } };
/** The deployed workers answer `GET /health` as {ok, ...} (the composition root and the seed) or as the contract's {status, ...}. `ok` is read as status. */
export function normalizeHealth(h) {
  const x = h && typeof h === 'object' ? h : {};
  return x.status === undefined && typeof x.ok === 'boolean' ? { ...x, status: x.ok ? 'ok' : 'degraded' } : x;
}

const sameSet = (a, b) => { const x = [...new Set(a.map(String))].sort(), y = [...new Set((b || []).map(String))].sort(); return x.length === y.length && x.every((v, i) => v === y[i]); };

/** The seven parts of the worker contract (section 4). Returns the list of unmet parts; empty means the member conforms. */
export function contractGaps(reg, deployed = null) {
  const gaps = [], r = reg || {};
  if (!SEMVER.test(String(r.version || ''))) gaps.push('1 version: no semantic VERSION');
  if (deployed) { const h = normalizeHealth(deployed.health); const miss = HEALTH_FIELDS.filter(f => !(f in h)); if (miss.length) gaps.push(`2 health: missing ${miss.join(', ')}`); }
  const header = parseJson(r.header, null) || {};
  const hm = HEADER_FIELDS.filter(f => header[f] == null || header[f] === '' || (Array.isArray(header[f]) && !header[f].length));
  if (hm.length) gaps.push(`3 header: missing ${hm.join(', ')}`);
  if (!/^[0-9a-f]{64}$/.test(String(r.source_hash || ''))) gaps.push('4 canonical source: no SHA-256 of the deployed source');
  const rm = REGISTRY_FIELDS.filter(f => r[f] == null || r[f] === '');
  if (rm.length) gaps.push(`5 registry row: missing ${rm.join(', ')}`);
  const names = parseJson(r.secret_names, null);
  if (!Array.isArray(names) || names.some(n => typeof n !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))) gaps.push('6 secrets: must be a list of names (identifiers), never values');
  if (!r.flags_source) gaps.push('7 flags: no readable kill-switch and autonomy flag source');
  return gaps;
}
export async function register(ctx, w) {
  const names = w.secret_names || [];
  if (!Array.isArray(names) || names.some(n => typeof n !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n))) throw new Error('secret_names takes names only, never values');
  const j = v => JSON.stringify(v ?? []);
  await run(ctx.db, `INSERT INTO fleet_registry (name,purpose,kind,status,crons,dependencies,health_url,autonomy_level,owner,version,source_hash,header,secret_names,flags_source) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(name) DO UPDATE SET purpose=excluded.purpose, kind=excluded.kind, status=excluded.status, crons=excluded.crons, dependencies=excluded.dependencies, health_url=excluded.health_url,
      autonomy_level=excluded.autonomy_level, owner=excluded.owner, version=excluded.version, source_hash=excluded.source_hash, header=excluded.header, secret_names=excluded.secret_names, flags_source=excluded.flags_source`,
    w.name, w.purpose ?? null, w.kind ?? null, w.status || 'active', j(w.crons), j(w.dependencies), w.health_url ?? null, w.autonomy_level ?? null, w.owner ?? null,
    w.version ?? null, w.source_hash ?? null, w.header ? JSON.stringify(w.header) : null, j(names), w.flags_source ?? null);
}

/**
 * Reconcile deployed reality against the registry. `ctx.deployed.list()` returns [{ name, version?, source_hash?, health? }]
 * read from the platform (an adapter). Each registered worker ends in exactly one state; the three drift counts are reported.
 */
export async function reconcile(ctx) {
  if (!ctx.deployed || typeof ctx.deployed.list !== 'function') return { ok: false, reason: 'no_deployed_port' };
  const at = iso(nowMs(ctx));
  const deployed = new Map((await ctx.deployed.list()).map(d => [d.name, d]));
  const reg = await all(ctx.db, `SELECT * FROM fleet_registry ORDER BY name`);
  const counts = { live: 0, drifted: 0, degraded: 0, paused: 0, retired: 0 };
  const ghosts = [], unversioned = [], states = {}, contract = {};
  for (const r of reg) {
    const d = deployed.get(r.name) || null;
    let state, detail = null;
    if (r.status === 'retired') { state = 'retired'; if (d) detail = 'retired in the registry but still deployed'; }
    else if (!d) { state = 'degraded'; detail = 'registered, not deployed'; ghosts.push(r.name); }
    else {
      const h = normalizeHealth(d.health), dv = d.version || h.version || null;
      if (!dv) unversioned.push(r.name);
      if (r.status === 'paused' || h.enabled === false) state = 'paused';
      else if (h.status !== 'ok' || h.bindings_ok === false) { state = 'degraded'; detail = `health status ${h.status ?? 'missing'}, bindings_ok ${h.bindings_ok ?? 'missing'}`; }
      else if (!dv) { state = 'drifted'; detail = 'deployed without a version: cannot be compared'; }
      else if (dv !== r.version) { state = 'drifted'; detail = `deployed ${dv}, registry ${r.version ?? 'none'}`; }
      else if (r.source_hash && d.source_hash && r.source_hash !== d.source_hash) { state = 'drifted'; detail = 'deployed source differs from the canonical copy'; }
      else if (Array.isArray(d.crons) && !sameSet(d.crons, parseJson(r.crons, []))) { state = 'drifted'; detail = `crons differ: deployed [${[...d.crons].sort().join(', ')}], registry [${[...parseJson(r.crons, [])].sort().join(', ')}]`; }
      else state = 'live';
    }
    counts[state]++; states[r.name] = state;
    const gaps = contractGaps(r, d);
    if (gaps.length) contract[r.name] = gaps;
    await run(ctx.db, `UPDATE fleet_registry SET state = ?, state_detail = ?, checked_at = ? WHERE name = ?`, state, detail, at, r.name);
    if (state === 'drifted' || (state === 'degraded' && r.status !== 'retired'))
      await openItem(ctx, `FLEET-${state.toUpperCase()}-${slug(r.name)}`, `Worker ${r.name} is ${state}: ${detail}`, `registry reconciliation reports ${r.name} live`, `fleet_registry.state = live for ${r.name}`, state === 'degraded' ? 10 : 20);
  }
  const known = new Set(reg.map(r => r.name));
  const unregistered = [...deployed.keys()].filter(n => !known.has(n)).sort();
  for (const n of unregistered) {
    if (!(deployed.get(n).version || (deployed.get(n).health || {}).version)) unversioned.push(n);
    await openItem(ctx, `FLEET-UNREGISTERED-${slug(n)}`, `Deployed worker ${n} has no registry row`, `${n} is registered or removed`, `fleet_registry has a row for ${n}, or it is no longer deployed`, 20);
  }
  const detail = { ghosts, unregistered, unversioned, contract };
  await run(ctx.db, `INSERT INTO fleet_reconciliations (at, live, drifted, degraded, paused, retired, ghosts, unregistered, unversioned, detail) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    at, counts.live, counts.drifted, counts.degraded, counts.paused, counts.retired, ghosts.length, unregistered.length, unversioned.length, JSON.stringify(detail));
  return { ok: true, at, counts, states, ...detail };
}

// ---- event-triggered scheduling ----------------------------------------------------------------

export async function setTrigger(ctx, { id, event_kind, task_id, enabled = true }) {
  await run(ctx.db, `INSERT INTO fleet_triggers (id, event_kind, task_id, enabled) VALUES (?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET event_kind=excluded.event_kind, task_id=excluded.task_id, enabled=excluded.enabled`, id, event_kind, task_id, enabled ? 1 : 0);
}
/**
 * Accept an event and start every task triggered by its kind. The envelope is validated first; a rejected or repeated
 * event starts nothing. Each started run is a `queued` row with trigger `event`, posted to the executor.
 */
export async function emit(ctx, env, payload) {
  if (env && typeof env === 'object' && 'specversion' in env) { // a CloudEvent: start tasks by the converted envelope
    const conv = fromCloudEvent(env, { type_prefix: cfg(ctx).cloudevent_type_prefix });
    if (conv.ok) { env = conv.envelope; payload = conv.payload; }
  }
  const ev = await recordEvent(ctx, env, payload);
  const out = { accepted: ev.accepted, error: ev.error || null, started: [], skipped: [], errors: [] };
  if (!ev.accepted) return out;
  const c = cfg(ctx), nowS = iso(nowMs(ctx));
  for (const t of await all(ctx.db, `SELECT * FROM fleet_triggers WHERE enabled = 1 AND event_kind = ? ORDER BY id`, env.kind)) {
    const ins = await run(ctx.db, `INSERT INTO fleet_runs (worker, trigger, status, task_id, scheduler, queued_at, evidence_refs, summary)
      SELECT ?, 'event', 'queued', ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM fleet_runs WHERE task_id = ? AND status IN ('queued','running'))`,
      c.worker, t.task_id, `event:${t.id}`, nowS, JSON.stringify([`fleet_events:${env.id}`]), `started by event ${env.kind}`, t.task_id);
    if (!ins.meta.changes) {
      const live = await first(ctx.db, `SELECT run_id FROM fleet_runs WHERE task_id = ? AND status IN ('queued','running') ORDER BY run_id LIMIT 1`, t.task_id);
      out.skipped.push({ trigger: t.id, reason: 'overlap', run_id: live ? live.run_id : null }); continue;
    }
    const runId = ins.meta.last_row_id;
    try { await post(ctx, { task_id: t.task_id, run_id: runId, session: env.provenance.session }); out.started.push({ trigger: t.id, run_id: runId }); }
    catch (e) { out.errors.push({ trigger: t.id, run_id: runId, error: msg(e).slice(0, 300) }); }
  }
  return out;
}

// ---- items close when the reading that filed them clears (US-11-R20) --------------------------

/**
 * Close the items this module filed whose own reading is now green, each with the reading as its disposition. An item the
 * module did not file is never touched: ids are matched to the registry, task, batch and alert rows that produced them.
 */
export async function settleItems(ctx) {
  const now = nowMs(ctx), c = cfg(ctx), closed = [];
  const open = new Map((await all(ctx.db, `SELECT id FROM items WHERE status NOT IN ('done','superseded','cancelled') AND (id LIKE 'FLEET-%' OR id LIKE 'DEADMAN-%')`)).map(r => [r.id, true]));
  const settle = async (id, reading) => { if (open.has(id) && await closeItem(ctx, id, reading)) closed.push(id); };
  for (const r of await all(ctx.db, `SELECT name, state FROM fleet_registry WHERE state IN ('live','paused','retired')`)) {
    await settle(`FLEET-DEGRADED-${slug(r.name)}`, `fleet_registry.state = ${r.state} for ${r.name}`);
    await settle(`FLEET-DRIFTED-${slug(r.name)}`, `fleet_registry.state = ${r.state} for ${r.name}`);
  }
  const rec = await first(ctx.db, `SELECT id, detail FROM fleet_reconciliations ORDER BY id DESC LIMIT 1`);
  if (rec) {
    const still = new Set((parseJson(rec.detail, {}).unregistered || []).map(slug));
    for (const id of open.keys()) if (id.startsWith('FLEET-UNREGISTERED-') && !still.has(id.slice('FLEET-UNREGISTERED-'.length))) await settle(id, `reconciliation ${rec.id} no longer lists the worker as unregistered`);
  }
  for (const t of await all(ctx.db, `SELECT DISTINCT task_id FROM fleet_runs WHERE task_id IS NOT NULL`)) {
    if (!open.has(`FLEET-STALE-${slug(t.task_id)}`)) continue;
    const last = await first(ctx.db, `SELECT run_id, status FROM fleet_runs WHERE task_id = ? ORDER BY run_id DESC LIMIT 1`, t.task_id);
    if (last && last.status === 'ok') await settle(`FLEET-STALE-${slug(t.task_id)}`, `fleet_runs: newest row for task ${t.task_id} (run ${last.run_id}) has status ok`);
  }
  for (const b of await all(ctx.db, `SELECT DISTINCT executor FROM fleet_batches`)) {
    if (!open.has(`FLEET-UNACCOUNTED-${slug(b.executor)}`)) continue;
    const last = await first(ctx.db, `SELECT id, gap FROM fleet_batches WHERE executor = ? ORDER BY id DESC LIMIT 1`, b.executor);
    if (last && last.gap === 0) await settle(`FLEET-UNACCOUNTED-${slug(b.executor)}`, `fleet_batches: newest row for executor ${b.executor} (batch ${last.id}) has gap 0`);
  }
  for (const a of await all(ctx.db, `SELECT a.*, p.expr FROM fleet_alerts a LEFT JOIN fleet_procedures p ON p.name = a.procedure WHERE a.item_id IS NOT NULL`)) {
    if (!open.has(a.item_id)) continue;
    if (a.kind === 'stop') {
      // a later slot of the procedure has a record: a run row (or a tick row for the configured tick procedure) that started after this slot ended
      const end = a.expr ? nextFire(a.expr, parseIso(a.slot)) : null;
      const after = end === null ? a.slot : iso(end);
      let n = (await first(ctx.db, `SELECT COUNT(*) AS n FROM fleet_runs WHERE cron_name = ? AND ts_start >= ?`, a.procedure, after)).n;
      if (!n && c.tick_procedure === a.procedure) n = (await first(ctx.db, `SELECT COUNT(*) AS n FROM tick_runs WHERE started_at >= ?`, after)).n;
      if (n) await settle(a.item_id, `a later slot of ${a.procedure} has a record (after ${after})`);
    } else if (a.kind === 'single_path' && a.expr) {
      const slots = expectedSlots(a.expr, now - c.deadman_window_minutes * MINUTE, now).map(t => ({ start: t, end: nextFire(a.expr, t) })).filter(x => x.end !== null && x.end <= now);
      const latest = slots[slots.length - 1];
      if (!latest) continue;
      const missing = parseJson(a.missing, []);
      let allOk = missing.length > 0;
      for (const sch of missing) {
        let n = (await first(ctx.db, `SELECT COUNT(*) AS n FROM fleet_runs WHERE cron_name = ? AND scheduler = ? AND ts_start >= ? AND ts_start < ?`, a.procedure, sch, iso(latest.start), iso(latest.end))).n;
        if (!n && c.tick_procedure === a.procedure && sch === c.tick_scheduler) n = (await first(ctx.db, `SELECT COUNT(*) AS n FROM tick_runs WHERE started_at >= ? AND started_at < ?`, iso(latest.start), iso(latest.end))).n;
        if (!n) allOk = false;
      }
      if (allOk) await settle(a.item_id, `${missing.join(', ')} recorded the latest slot of ${a.procedure} (${iso(latest.start)})`);
    }
  }
  return { closed };
}

// ---- automatic staggering by minute of the hour (US-11-R12): pin list, procedure sync and a log; `stagger` above plans over a day window ----------------------------------------------------------

const PERIODS = [2, 3, 4, 5, 6, 10, 12, 15, 20, 30];
/** Minute-of-hour set of an expression whose other four fields are `*`; or the reason it cannot be staggered. */
function minuteShape(expr) {
  const f = parseCron(expr);
  if (!f) return { reason: 'bad_expression' };
  if (!f.slice(1).every(x => x === '*')) return { reason: 'not_every_hour' };
  const set = []; for (let m = 0; m < 60; m++) if (matchField(f[0], m)) set.push(m);
  if (!set.length) return { reason: 'never_fires' };
  if (set.length === 1) return { period: 60, offset: set[0], single: true, count: 1 };
  const n = set[1] - set[0];
  if (60 % n === 0 && set.length === 60 / n && set[0] < n && set.every((m, i) => m === set[0] + i * n) && PERIODS.includes(n)) return { period: n, offset: set[0], count: set.length };
  return { reason: 'minute_field_unsupported' };
}
const minutesOf = (shape, offset) => { const out = []; for (let m = offset; m < 60; m += shape.period) out.push(m); return out; };
const exprFor = (shape, offset, original) => {
  if (!shape.single && offset === 0 && /^\*\/\d+ \* \* \* \*$/.test(original)) return original;
  return `${minutesOf(shape, offset).join(',')} * * * *`;
};
const collisionCount = occupied => [...occupied.values()].filter(n => n > 1).length;

/**
 * Spread the minutes at which enabled schedules fire. Only an expression whose minute field is a periodic or single minute set
 * (a star-slash-n form for n dividing 60, a literal, or the comma-list form of either) and whose other fields are `*` is moved; the firings per hour
 * never change. Greedy: the busiest schedule first, each taking the offset that adds the fewest collisions. A name in
 * `config.stagger_pin` keeps its minutes. `apply` rewrites the rows (`setCron`, clearing next_fire), the matching procedure
 * expression and the stagger log; without it the plan is only returned.
 */
export async function staggerHourly(ctx, { apply = false } = {}) {
  const c = cfg(ctx), pin = new Set(c.stagger_pin || []);
  const rows = await all(ctx.db, `SELECT name, expr, task_id FROM fleet_crons WHERE enabled = 1 ORDER BY name`);
  const skipped = [], movable = [], occupied = new Map();
  const take = (shape, off) => { for (const m of minutesOf(shape, off)) occupied.set(m, (occupied.get(m) || 0) + 1); };
  for (const r of rows) {
    const shape = minuteShape(r.expr);
    if (shape.reason) { skipped.push({ name: r.name, expr: r.expr, reason: shape.reason }); continue; }
    if (pin.has(r.name)) { take(shape, shape.offset); skipped.push({ name: r.name, expr: r.expr, reason: 'pinned' }); continue; }
    movable.push({ ...r, shape });
  }
  const before = new Map(occupied); for (const m of movable) for (const x of minutesOf(m.shape, m.shape.offset)) before.set(x, (before.get(x) || 0) + 1);
  const collisions_before = collisionCount(before);
  movable.sort((a, b) => b.shape.count - a.shape.count || a.name.localeCompare(b.name));
  const plan = [];
  for (const m of movable) {
    const limit = m.shape.single ? 60 : m.shape.period;
    let best = null;
    for (let off = 0; off < limit; off++) {
      const added = minutesOf(m.shape, off).filter(x => occupied.has(x)).length;
      if (best === null || added < best.added) best = { off, added };
      if (added === 0) break;
    }
    take(m.shape, best.off);
    const next = exprFor(m.shape, best.off, m.expr);
    plan.push({ name: m.name, from: m.expr, to: next, offset: best.off, changed: next !== m.expr });
  }
  const collisions_after = collisionCount(occupied);
  const result = { applied: false, collisions_before, collisions_after, changes: plan.filter(p => p.changed), unchanged: plan.filter(p => !p.changed).map(p => p.name), skipped };
  if (!apply) return result;
  const at = iso(nowMs(ctx));
  for (const ch of result.changes) {
    const cr = rows.find(r => r.name === ch.name);
    await setCron(ctx, { name: ch.name, expr: ch.to, task_id: cr.task_id, enabled: true });
    await run(ctx.db, `UPDATE fleet_procedures SET expr = ? WHERE name = ? AND expr = ?`, ch.to, ch.name, ch.from); // the dead-man check must expect the new slots
    await run(ctx.db, `INSERT INTO fleet_stagger_log (at, name, old_expr, new_expr, collisions_before, collisions_after) VALUES (?,?,?,?,?,?)`, at, ch.name, ch.from, ch.to, collisions_before, collisions_after);
  }
  return { ...result, applied: true };
}

// ---- surface for the composition root ----------------------------------------------------------

/** GET /health body of the worker contract. `bindings_ok` is a real read of the store. */
export async function health(ctx) {
  const c = cfg(ctx);
  let bindings_ok = true;
  try { await first(ctx.db, `SELECT COUNT(*) AS n FROM fleet_runs`); } catch { bindings_ok = false; }
  const enabled = c.enabled !== false;
  return { status: bindings_ok ? 'ok' : 'degraded', worker: c.worker, version: VERSION, enabled, bindings_ok };
}
export async function status(ctx) {
  const n = async (sql, ...a) => (await first(ctx.db, sql, ...a)).n;
  const last = await first(ctx.db, `SELECT * FROM fleet_reconciliations ORDER BY id DESC LIMIT 1`);
  return {
    runs: Object.fromEntries((await all(ctx.db, `SELECT status, COUNT(*) AS n FROM fleet_runs GROUP BY status`)).map(r => [r.status, r.n])),
    crons_enabled: await n(`SELECT COUNT(*) AS n FROM fleet_crons WHERE enabled = 1`),
    unbalanced_batches: await n(`SELECT COUNT(*) AS n FROM fleet_batches WHERE gap <> 0`),
    rejected_events: await n(`SELECT COUNT(*) AS n FROM fleet_events WHERE state = 'rejected'`),
    stop_alerts: await n(`SELECT COUNT(*) AS n FROM fleet_alerts WHERE kind = 'stop'`),
    single_path_alerts: await n(`SELECT COUNT(*) AS n FROM fleet_alerts WHERE kind = 'single_path'`),
    reconciliation: last ? { at: last.at, live: last.live, drifted: last.drifted, degraded: last.degraded, paused: last.paused, retired: last.retired, ghosts: last.ghosts, unregistered: last.unregistered, unversioned: last.unversioned } : null,
  };
}

/** One tick of the fleet runtime: stagger (opt-in), dispatch due rows, reap stale runs, run the dead-man check, reconcile when due, close items whose reading cleared. */
export async function step(ctx) {
  const c = cfg(ctx);
  if (c.enabled === false) return { enabled: false };
  const out = {};
  // US-11-R12: with `auto_stagger` on, schedules are moved apart before anything is dispatched; a staggered set is left as it is.
  if (c.auto_stagger === true) { const g = await stagger(ctx, { apply: true, literals: c.stagger_literals === true }); out.staggered = g.changes.length; }
  // The hour-minute planner (pin list, procedure sync, log) runs when `stagger_auto` is on.
  if (c.stagger_auto === true) await staggerHourly(ctx, { apply: true });
  Object.assign(out, { dispatch: await dispatch(ctx), reaped: (await reapStale(ctx)).reaped, deadman: (await deadman(ctx)).alerts.length });
  if (ctx.deployed) {
    const last = await first(ctx.db, `SELECT at FROM fleet_reconciliations ORDER BY id DESC LIMIT 1`);
    if (!last || nowMs(ctx) - parseIso(last.at) >= c.reconcile_every_minutes * MINUTE) { const r = await reconcile(ctx); out.reconcile = r.counts; }
  }
  out.settled = (await settleItems(ctx)).closed.length;
  out.coarsened = (await cadenceReport(ctx)).coarsened.length;
  return out;
}

const json = (body, code = 200) => new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
/** Routes: GET /health, GET /fleet/status, POST /fleet/dispatch and POST /fleet/execute (both authorized): dispatcher pass, posted tasks and dispatcher posts. */
export async function handle(request, ctx) {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json(await health(ctx));
  if (request.method === 'GET' && url.pathname === '/fleet/status') return json(await status(ctx));
  if (request.method === 'POST' && url.pathname === '/fleet/dispatch') {
    // the credential-free second route: an external scheduler (a finer cron, a GitHub Actions run) drives the dispatcher
    if (typeof ctx.authorize !== 'function' || !(await ctx.authorize(request))) return json({ error: 'unauthorized' }, 401);
    return json({ ...(await dispatch(ctx)), cadence: await cadenceReport(ctx) });
  }
  if (request.method === 'POST' && url.pathname === '/fleet/execute') {
    if (typeof ctx.authorize !== 'function' || !(await ctx.authorize(request))) return json({ error: 'unauthorized' }, 401);
    let body; try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
    const r = await execute(ctx, { ...body, trigger: body.run_id ? undefined : (body.trigger || 'http') });
    if (r.rejected_before_start) return json({ error: r.error }, 409);
    return json(r, r.error_class === 'unknown_type' ? 422 : 200);
  }
  return json({ error: 'not_found' }, 404);
}
