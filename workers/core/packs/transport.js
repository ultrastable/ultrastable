// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// A guard-backed transport (US-21-R23, R14). core/outreach and core/promote carry their own controls (approval, caps, suppression,
// dry run) and deliver through an injected transport. Handing them this transport sends the same messages through guard.send, so the
// one door out (consent, suppression, caps, content rules, rung approval, ledger) applies to them too, with the same code as every pack.
//
// guard: a bound guard (packs.boundGuard('<a class B pack id>')); the pack must declare `channel`. The returned function accepts
//   { to, subject, text, reply_to }  (core/outreach.dispatch)   or   { recipient, content }  (a generic caller)
// and resolves { id } only when the guard SENT. Any other decision throws Error(`guard_<decision>:<reason>`), so the caller records
// no send: a queued or refused message stays approved and is retried by the next dispatch (the guard de-duplicates by key).
import { sha256 } from './guard.js';

export function guardTransport({ guard, channel, kind = 'message', keyOf = null } = {}) {
  if (!guard || typeof guard.send !== 'function') throw new Error('guard required');
  if (!channel) throw new Error('channel required');
  return async function transport(msg = {}) {
    const recipient = msg.to ?? msg.recipient;
    const content = msg.content ?? [msg.subject, msg.text].filter(x => x != null && x !== '').join('\n\n');
    const idempotencyKey = keyOf ? keyOf(msg) : await sha256(`${channel}|${recipient}|${msg.subject ?? ''}|${content}`);
    const r = await guard.send({ channel, kind, recipient, content, idempotencyKey });
    if (r.decision !== 'sent') throw new Error(`guard_${r.decision}:${r.reason}`);
    return { id: r.providerId ?? String(r.id) };
  };
}
