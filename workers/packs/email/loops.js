// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Tick-step entries named in pack.json. The host calls each with { db, ctx, now, pack, settings, guard } (guard bound to this pack).
// settings: { baseUrl, senderLine, hashSalt, linkSecret, batch_size, ... }; values come from configuration, never from defaults here.
import { createEmail } from './service.js';

// secrets: the host's presence-only accessor (US-21-R20). EMAIL_LINK_SECRET is read from the tick env at call time; the linkSecret
// setting remains a fallback for a host that has no accessor, and neither is ever stored or logged.
export function serviceFrom({ db, now, settings, guard, secrets }) {
  const linkSecret = (secrets && secrets.get('EMAIL_LINK_SECRET')) || settings.linkSecret;
  return createEmail({
    db, guard, now,
    config: { ...settings, linkSecret, batchSize: settings.batch_size, confirmResendMinutes: settings.confirm_resend_minutes, subscribePerHour: settings.subscribe_per_hour },
  });
}

// Newsletter and notice loop: queued messages go to confirmed, non-suppressed subscribers in batches, through guard.send only.
export async function send({ db, ctx, now, settings, guard, secrets }) {
  const r = await serviceFrom({ db, now, settings, guard, secrets }).sendPending();
  ctx.notes.push(`email send: sent ${r.sent}, skipped ${r.skipped}, queued ${r.queued}, failed ${r.failed}${r.stopped ? `, stopped (${r.stopped})` : ''}`);
}

// Metrics step: confirmed, pending, unsubscribed and bounced counts for the pack manager.
export async function metrics({ db, ctx, now, settings, guard, secrets }) {
  const m = await serviceFrom({ db, now, settings, guard, secrets }).writeMetrics();
  ctx.notes.push(`email metrics: confirmed ${m.confirmed}, pending ${m.pending}, unsubscribed ${m.unsubscribed}, bounced ${m.bounced}`);
}

// Bounce hook (US-21-R21): the host calls it after core/packs/bounce.js has applied a delivery event, so the subscriber row stops matching
// an address the guard already suppresses. The core decision stands: a soft bounce the core only counted changes nothing here, and one the
// core turned into a suppression is mirrored without being counted again against this pack's own 30-day window.
export async function onBounce({ db, now, settings, guard, secrets, event, outcome }) {
  const svc = serviceFrom({ db, now, settings, guard, secrets });
  const suppressed = String(outcome && outcome.action || '').startsWith('suppressed');
  if (event.kind === 'hard') return svc.recordBounce({ address: event.recipient, type: 'hard' });
  if (event.kind === 'complaint') return svc.recordBounce({ address: event.recipient, type: 'complaint' });
  if (event.kind === 'soft') return suppressed ? svc.recordBounce({ address: event.recipient, type: 'soft', decided: true }) : { ok: true, suppressed: false };
  if (event.kind === 'unsubscribe') return svc.unsubscribe({ email: event.recipient });
  return { ok: false, reason: 'unknown_kind' };
}
