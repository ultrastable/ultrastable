// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The outbound guard (US-SPEC-21 s6): the only door out, the same code for every pack and platform (US-21-R06, R14).
import { all, first, run, iso } from '../kernel/util.js';

export const DEFAULT_RUNGS = ['observed', 'assisted', 'delegated', 'autonomous', 'self-directed', 'self-modifying', 'self-extending'];
// Secret shapes that must never leave the organization or be stored (US-21-R09).
export const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(sk|pk|rk)[-_](live|test|proj|ant)?[-_]?[A-Za-z0-9]{16,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}=*/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"]?[A-Za-z0-9\/+_.-]{12,}/i,
];

export async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(s)));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function setSwitch(db, scope, on, reason = null, now = Date.now()) {
  await run(db, `INSERT INTO packs_switches (scope, is_on, reason, set_at) VALUES (?,?,?,?)
    ON CONFLICT(scope) DO UPDATE SET is_on=excluded.is_on, reason=excluded.reason, set_at=excluded.set_at`, scope, on ? 1 : 0, reason, iso(now));
}
export async function engagedSwitches(db) {
  return new Set((await all(db, `SELECT scope FROM packs_switches WHERE is_on = 1`)).map(r => r.scope));
}

export function rungCeilings(config = {}) {
  const rungs = config.rungs || DEFAULT_RUNGS;
  return { A: rungs[rungs.length - 1], B: 'autonomous', C: rungs[0], D: 'delegated', ...(config.ceilings || {}) };
}

const norm = s => String(s ?? '').trim().toLowerCase();

// deployRoute: the only way a class D pack acts. { send(req) -> { id } } backed by core/deploy (see core/deploy/packs-route.js).
// A request cannot opt in or out of it: the route is chosen from the pack's class, held by the host, never read from the request.
// policyCeiling(packId) -> the rung the protected policy surface this pack's class maps to allows, or null when no policy is configured
// (createPacks passes createPackTrust's policyCeiling). The rung a pack acts at is min(earned, class ceiling, policy ceiling) (US-21-R29), read at
// every send, so tightening the policy after a rung was earned takes effect on the next send.
export function createGuard({ db, now = Date.now, config = {}, channels = {}, deployRoute = null, redact = x => x, policyCeiling = null }) {
  const rungs = config.rungs || DEFAULT_RUNGS;
  const actRung = config.act_rung || 'delegated';
  // US-21-R22: the rung needed to act alone may differ per action kind (config.act_rungs: { notice: 'autonomous' }); the default stays act_rung.
  const actRungFor = kind => (kind && config.act_rungs && config.act_rungs[kind]) || actRung;
  const startRung = config.start_rung || rungs[0];
  const salt = config.hash_salt || '';
  const hashRecipient = r => sha256(`${salt}|${norm(r)}`);
  const ledgerAt = () => iso(now());
  // A reservation older than this is a crash between reserving and finishing, and no longer blocks its key or counts against a cap (config.inflight_ttl_ms).
  const inflightTtlMs = config.inflight_ttl_ms ?? 600000;

  async function packRow(id) {
    const r = await first(db, `SELECT * FROM packs_registry WHERE id = ?`, id);
    if (!r) return null;
    return { ...r, manifest: JSON.parse(r.manifest_json) };
  }

  async function currentRung(p, kind) {
    const row = await first(db, `SELECT rung FROM trust_ledger WHERE surface = ? AND action_class = ?`, `pack:${p.id}`, kind || 'send');
    const earned = rungs.indexOf(row ? row.rung : startRung);
    const ceil = rungs.indexOf(p.rung_ceiling);
    const pc = policyCeiling ? await policyCeiling(p.id) : null;
    const policy = pc == null ? Infinity : Math.max(0, rungs.indexOf(pc));          // an unknown rung name in the policy is read as the lowest rung, never as no limit
    return rungs[Math.max(0, Math.min(earned < 0 ? 0 : earned, ceil < 0 ? 0 : ceil, policy))]; // US-21-R12, R29
  }

  async function record(req, decision, reason, providerId = null, hashes = {}) {
    const rh = hashes.recipient ?? (req.recipient != null ? await hashRecipient(req.recipient) : null);
    const ch = hashes.content ?? (req.content != null ? await sha256(req.content) : null);
    const r = await run(db, `INSERT INTO guard_ledger (at, pack, channel, kind, recipient_hash, content_hash, idem_key, decision, reason, provider_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, ledgerAt(), String(req.pack), String(req.channel), req.kind ?? null, rh, ch, req.idempotencyKey ?? null, decision, reason, providerId);
    return r.meta.last_row_id;
  }

  // The refusal checks of US-SPEC-21 s6 in their normative order, up to and including content rules. Returns a reason or null.
  async function checks(req, p, { ignoreQueueId = null } = {}) {
    if (!p || !p.enabled) return 'pack_disabled';
    const sw = await engagedSwitches(db);
    if (sw.has('global')) return 'kill_switch_global';
    if (sw.has(`pack:${p.id}`)) return 'kill_switch_pack';
    if (sw.has(`channel:${req.channel}`)) return 'kill_switch_channel';
    const o = p.manifest.outbound;
    if (p.class === 'C') return 'class_c_never_sends';
    if (!o || !o.channels.includes(req.channel)) return 'channel_not_declared';
    if (p.class === 'D' && !(deployRoute && typeof deployRoute.send === 'function')) return 'class_d_requires_deploy';
    if (!req.idempotencyKey) return 'idempotency_key_required';
    const fresh = iso(now() - inflightTtlMs);
    const dup = await first(db, `SELECT 1 AS x FROM guard_ledger WHERE pack = ? AND idem_key = ? AND decision = 'sent'`, p.id, req.idempotencyKey)
      || await first(db, `SELECT 1 AS x FROM guard_inflight WHERE pack = ? AND idem_key = ? AND at > ?`, p.id, req.idempotencyKey, fresh)
      || await first(db, `SELECT 1 AS x FROM guard_queue WHERE pack = ? AND idem_key = ? AND status IN ('pending', 'deciding') AND id IS NOT ?`, p.id, req.idempotencyKey, ignoreQueueId);
    if (dup) return 'duplicate_idempotency_key';
    const rh = await hashRecipient(req.recipient);
    if (await first(db, `SELECT 1 AS x FROM guard_suppression WHERE recipient_hash = ? AND channel IN (?, '*')`, rh, req.channel)) return 'suppressed';
    if (o.consent !== 'none') {
      const cs = await all(db, `SELECT status FROM guard_consent WHERE recipient_hash = ? AND channel = ? AND pack IN (?, '*')`, rh, req.channel, p.id);
      if (!cs.length) return 'no_consent';
      if (!cs.some(c => c.status === 'confirmed')) return cs.some(c => c.status === 'pending') ? 'consent_not_confirmed' : 'consent_revoked';
    }
    const cap = o.caps[req.channel];
    // Sent rows plus sends that have been reserved and not finished: a call in flight counts against the cap (US-21-R14).
    const sent = async since => (await first(db, `SELECT COUNT(*) AS n FROM guard_ledger WHERE pack = ? AND channel = ? AND decision = 'sent' AND at > ?`, p.id, req.channel, iso(since))).n
      + (await first(db, `SELECT COUNT(*) AS n FROM guard_inflight WHERE pack = ? AND channel = ? AND at > ? AND at > ?`, p.id, req.channel, iso(since), fresh)).n;
    if ((await sent(now() - 86400e3)) >= cap.per_day) return 'cap_per_day';
    if ((await sent(now() - 7 * 86400e3)) >= cap.per_week) return 'cap_per_week';
    const port = (p.class === 'D' ? deployRoute : channels[req.channel]) || {};
    const content = typeof req.content === 'string' ? req.content : '';
    if (!content.trim()) return 'content_empty';
    const max = port.maxLength ?? config.max_length?.[req.channel];
    if (max && content.length > max) return 'content_too_long';
    if (SECRET_PATTERNS.some(re => re.test(content))) return 'content_secret_pattern';
    if (port.senderId && !content.includes(port.senderId)) return 'sender_identification_missing';
    return null;
  }

  // Reserve a send before the provider is called: one conditional INSERT that holds only when the key is not in flight and both caps still have room,
  // counting sent rows and other reservations. Two overlapping calls with one key, or enough calls to pass a cap together, cannot all pass (US-21-R14).
  async function reserve(req, p) {
    const t = now(), cap = p.manifest.outbound.caps[req.channel], fresh = iso(t - inflightTtlMs);
    await run(db, `DELETE FROM guard_inflight WHERE at <= ?`, fresh);
    const room = () => `((SELECT COUNT(*) FROM guard_ledger WHERE pack = ? AND channel = ? AND decision = 'sent' AND at > ?)
      + (SELECT COUNT(*) FROM guard_inflight WHERE pack = ? AND channel = ? AND at > ?))`;
    const day = iso(t - 86400e3), week = iso(t - 7 * 86400e3);
    const r = await run(db, `INSERT INTO guard_inflight (pack, idem_key, channel, at)
      SELECT ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM guard_inflight WHERE pack = ? AND idem_key = ?)
        AND ${room()} < ? AND ${room()} < ?`,
      p.id, req.idempotencyKey, req.channel, iso(t), p.id, req.idempotencyKey,
      p.id, req.channel, day, p.id, req.channel, day, cap.per_day,
      p.id, req.channel, week, p.id, req.channel, week, cap.per_week);
    return r.meta.changes > 0;
  }
  const release = (p, req) => run(db, `DELETE FROM guard_inflight WHERE pack = ? AND idem_key = ?`, p.id, req.idempotencyKey);

  // A queued entry's key in flight: another decision is delivering it and owns the entry (US-21-R26).
  const inFlight = (pack, key) => first(db, `SELECT 1 AS x FROM guard_inflight WHERE pack = ? AND idem_key = ? AND at > ?`, pack, key, iso(now() - inflightTtlMs));

  // onDone(out) runs while the reservation is still held, so a decision settles its queue entry before another decision can reserve the key:
  // there is no moment between the delivery and the entry's new status in which a second decision finds the entry pending and the key free.
  async function deliver(req, hashes, p, ignoreQueueId = null, onDone = null) {
    if (p && p.manifest && p.manifest.outbound && p.manifest.outbound.caps && p.manifest.outbound.caps[req.channel] && req.idempotencyKey) {
      if (!(await reserve(req, p))) {
        // Deciding a queued entry whose key is already being delivered by another decision: that decision owns the entry, so this one changes nothing.
        if (ignoreQueueId !== null && await first(db, `SELECT 1 AS x FROM guard_inflight WHERE pack = ? AND idem_key = ?`, p.id, req.idempotencyKey)) return { decision: 'refused', reason: 'decision_in_progress', contended: true };
        const why = (await checks(req, p, { ignoreQueueId })) || 'duplicate_idempotency_key';
        return { decision: 'refused', reason: why, id: await record(req, 'refused', why, null, hashes) };
      }
      try { const out = await deliverReserved(req, hashes, p); if (onDone) await onDone(out); return out; } finally { await release(p, req); }
    }
    const out = await deliverReserved(req, hashes, p);
    if (onDone) await onDone(out);
    return out;
  }

  async function deliverReserved(req, hashes, p) {
    const port = p && p.class === 'D' ? deployRoute : channels[req.channel];
    if (!port || typeof port.send !== 'function') return { decision: 'refused', reason: 'channel_port_missing', id: await record(req, 'refused', 'channel_port_missing', null, hashes) };
    try {
      const res = await port.send({ pack: req.pack, channel: req.channel, kind: req.kind, recipient: req.recipient, content: req.content, idempotencyKey: req.idempotencyKey });
      const providerId = res && (res.id ?? res.providerId) != null ? String(res.id ?? res.providerId) : null;
      return { decision: 'sent', reason: null, providerId, id: await record(req, 'sent', null, providerId, hashes) };
    } catch (e) {
      const reason = `delivery_failed: ${redact(String(e.message)).replace(/\s+/g, ' ').slice(0, 120)}`;
      return { decision: 'refused', reason, id: await record(req, 'refused', reason, null, hashes) };
    }
  }

  async function send(req) {
    const r = { ...req };
    const hashes = { recipient: await hashRecipient(r.recipient), content: await sha256(r.content ?? '') };
    const p = await packRow(r.pack);
    const why = await checks(r, p);
    if (why) return { decision: 'refused', reason: why, id: await record(r, 'refused', why, null, hashes) };
    const o = p.manifest.outbound;
    const rung = await currentRung(p, r.kind);
    const actRung = actRungFor(r.kind);
    if (o.approval === 'always' || rungs.indexOf(rung) < rungs.indexOf(actRung)) {
      const cardId = `guard-approve-${p.id}-${hashes.content.slice(0, 12)}-${(await sha256(r.idempotencyKey)).slice(0, 8)}`;
      const q = await run(db, `INSERT INTO guard_queue (at, pack, channel, kind, recipient_hash, content_hash, idem_key, recipient, content, card_id)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, ledgerAt(), p.id, r.channel, r.kind ?? null, hashes.recipient, hashes.content, r.idempotencyKey, r.recipient, r.content, cardId);
      const qid = q.meta.last_row_id;
      await run(db, `INSERT OR IGNORE INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe)
        VALUES (?,?,?,?,?,?)`, cardId,
        `Approve one ${r.kind || 'message'} from pack ${p.id} on ${r.channel}: "${String(r.content).slice(0, 200)}" (queue entry ${qid})`,
        `Pack ${p.id} is at rung ${rung}, below ${actRung}, so outward action needs a person (US-SPEC-21 s6).`,
        'Nothing is sent; the entry stays queued until approved or rejected.', `guard queue ${qid}`, 'manual');
      return { decision: 'queued_for_approval', reason: `rung_${rung}_below_${actRung}`, queueId: qid, cardId, id: await record(r, 'queued_for_approval', `rung_${rung}_below_${actRung}`, null, hashes) };
    }
    return deliver(r, hashes, p);
  }

  // US-21-R26: a decision claims the entry before it acts, with one conditional update (pending -> deciding) carrying a token of its own, so of an
  // approve and a reject (or two approves) that start together exactly one goes on; the other changes nothing, records no ledger row and returns
  // decision_in_progress. Only the claim's own token settles the entry. A claim left by a crash stops blocking after inflight_ttl_ms, as a
  // reservation does, and can be taken again.
  async function decide(queueId, by, approve) {
    const q = await first(db, `SELECT * FROM guard_queue WHERE id = ?`, queueId);
    const stale = iso(now() - inflightTtlMs);
    const busy = q && q.status === 'deciding' && q.decided_at > stale;
    if (busy) return { decision: 'refused', reason: 'decision_in_progress', contended: true };
    if (!q || (q.status !== 'pending' && q.status !== 'deciding')) return { decision: 'refused', reason: 'not_pending' };
    if (await inFlight(q.pack, q.idem_key)) return { decision: 'refused', reason: 'decision_in_progress', contended: true };
    const token = `claim:${[...crypto.getRandomValues(new Uint8Array(8))].map(x => x.toString(16).padStart(2, '0')).join('')}`;
    const claimed = await run(db, `UPDATE guard_queue SET status = 'deciding', decided_by = ?, decided_at = ?, reason = ?
      WHERE id = ? AND (status = 'pending' OR (status = 'deciding' AND decided_at <= ?))`, by ?? null, ledgerAt(), token, queueId, stale);
    if (!(claimed.meta.changes > 0)) return { decision: 'refused', reason: 'decision_in_progress', contended: true };
    const unclaim = () => run(db, `UPDATE guard_queue SET status = 'pending', decided_by = NULL, decided_at = NULL, reason = NULL WHERE id = ? AND status = 'deciding' AND reason = ?`, queueId, token);
    const req = { pack: q.pack, channel: q.channel, kind: q.kind, recipient: q.recipient, content: q.content, idempotencyKey: q.idem_key };
    const hashes = { recipient: q.recipient_hash, content: q.content_hash };
    let settled = false;
    const settle = async (out) => {
      if (settled) return; settled = true;
      const status = !approve ? 'rejected' : out.decision === 'sent' ? 'sent' : 'refused';
      await run(db, `UPDATE guard_queue SET status = ?, decided_by = ?, decided_at = ?, reason = ?, recipient = NULL, content = NULL WHERE id = ? AND status = 'deciding' AND reason = ?`, status, by ?? null, ledgerAt(), out.reason, queueId, token);
      await run(db, `UPDATE gate_cards SET status = 'closed', closed_at = ? WHERE id = ?`, ledgerAt(), q.card_id);
    };
    let out;
    try {
      if (!approve) out = { decision: 'refused', reason: 'approval_rejected', id: await record(req, 'refused', 'approval_rejected', null, hashes) };
      else {
        // Everything is checked again at delivery time: a switch, suppression or cap may have changed while it waited.
        const p = await packRow(q.pack);
        const why = await checks(req, p, { ignoreQueueId: q.id });
        out = why ? { decision: 'refused', reason: why, id: await record(req, 'refused', why, null, hashes) } : await deliver(req, hashes, p, q.id, settle);
      }
    } catch (e) { if (!settled) await unclaim(); throw e; }       // an error before the entry was settled leaves it pending, never held
    if (out.contended) { await unclaim(); return out; }
    await settle(out);
    return out;
  }

  const requireChannel = c => { if (!c) throw new Error('channel required'); };
  return {
    send,
    approve: (queueId, { by } = {}) => decide(queueId, by, true),
    reject: (queueId, { by } = {}) => decide(queueId, by, false),
    // Open entries: pending, or held by a claim a crash left behind (older than inflight_ttl_ms), which any decision may take again.
    pending: () => all(db, `SELECT id, at, pack, channel, kind, recipient_hash, content_hash, card_id FROM guard_queue WHERE status = 'pending' OR (status = 'deciding' AND decided_at <= ?) ORDER BY id`, iso(now() - inflightTtlMs)),
    staleClaimBefore: () => iso(now() - inflightTtlMs),

    // Double opt-in: request returns a token to put in the confirmation message; confirm(token) records consent.
    consent: {
      async request({ channel, recipient, pack = '*' }) {
        requireChannel(channel);
        const rh = await hashRecipient(recipient);
        if (await first(db, `SELECT 1 AS x FROM guard_suppression WHERE recipient_hash = ? AND channel IN (?, '*')`, rh, channel)) return { ok: false, reason: 'suppressed' };
        const token = [...crypto.getRandomValues(new Uint8Array(16))].map(x => x.toString(16).padStart(2, '0')).join('');
        await run(db, `INSERT INTO guard_consent (recipient_hash, channel, pack, status, token_hash, requested_at) VALUES (?,?,?, 'pending', ?, ?)
          ON CONFLICT(recipient_hash, channel, pack) DO UPDATE SET status = CASE WHEN status = 'confirmed' THEN 'confirmed' ELSE 'pending' END, token_hash = excluded.token_hash, requested_at = excluded.requested_at`,
          rh, channel, pack, await sha256(token), ledgerAt());
        return { ok: true, token };
      },
      async confirm(token) {
        const th = await sha256(token);
        const row = await first(db, `SELECT recipient_hash, channel, pack FROM guard_consent WHERE token_hash = ? AND status = 'pending'`, th);
        if (!row) return { ok: false, reason: 'unknown_or_used_token' };
        await run(db, `UPDATE guard_consent SET status = 'confirmed', confirmed_at = ?, token_hash = NULL WHERE recipient_hash = ? AND channel = ? AND pack = ?`, ledgerAt(), row.recipient_hash, row.channel, row.pack);
        return { ok: true };
      },
      // single_opt_in: the person's own opt-in, recorded directly.
      async grant({ channel, recipient, pack = '*' }) {
        requireChannel(channel);
        const rh = await hashRecipient(recipient);
        if (await first(db, `SELECT 1 AS x FROM guard_suppression WHERE recipient_hash = ? AND channel IN (?, '*')`, rh, channel)) return { ok: false, reason: 'suppressed' };
        await run(db, `INSERT INTO guard_consent (recipient_hash, channel, pack, status, requested_at, confirmed_at) VALUES (?,?,?, 'confirmed', ?, ?)
          ON CONFLICT(recipient_hash, channel, pack) DO UPDATE SET status = 'confirmed', confirmed_at = excluded.confirmed_at, token_hash = NULL`, rh, channel, pack, ledgerAt(), ledgerAt());
        return { ok: true };
      },
      async revoke({ channel, recipient }) {
        const rh = await hashRecipient(recipient);
        await run(db, `UPDATE guard_consent SET status = 'revoked', revoked_at = ?, token_hash = NULL WHERE recipient_hash = ? AND channel = ?`, ledgerAt(), rh, channel);
        return { ok: true };
      },
    },

    // US-21-R13: effective immediately, no approval. channel '*' suppresses every channel.
    async suppress({ channel = '*', recipient, reason = 'manual' }) {
      const rh = await hashRecipient(recipient);
      await run(db, `INSERT OR REPLACE INTO guard_suppression (recipient_hash, channel, reason, at) VALUES (?,?,?,?)`, rh, channel, reason, ledgerAt());
      await run(db, `UPDATE guard_consent SET status = 'revoked', revoked_at = ?, token_hash = NULL WHERE recipient_hash = ? AND (channel = ? OR ? = '*')`, ledgerAt(), rh, channel, channel);
      await run(db, `UPDATE guard_queue SET status = 'rejected', reason = 'suppressed', recipient = NULL, content = NULL, decided_at = ? WHERE status = 'pending' AND recipient_hash = ? AND (channel = ? OR ? = '*')`, ledgerAt(), rh, channel, channel);
      return { ok: true };
    },
    unsubscribe({ channel = '*', recipient }) { return this.suppress({ channel, recipient, reason: 'unsubscribe' }); },

    // Counts behind a pack's guard metrics (sends, refusals, queued).
    async stats(pack, sinceMs = now() - 7 * 86400e3) {
      const rows = await all(db, `SELECT decision, COUNT(*) AS n FROM guard_ledger WHERE pack = ? AND at >= ? GROUP BY decision`, pack, iso(sinceMs));
      return Object.fromEntries(rows.map(r => [r.decision, r.n]));
    },
  };
}
