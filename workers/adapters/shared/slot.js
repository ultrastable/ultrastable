// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// At most one tick per slot (US-14-R03, US-14-R09, US-14-T03). A scheduler may deliver the same firing twice, and two instances
// may receive it at once: the handler inserts the slot number first and returns without running when the insert conflicts.
// The slot is kept even if the tick fails, so a slot never holds two ticks; the next slot runs normally.
// One tick at a time across slots (US-14-R03): a tick still running when the next slot starts (an earlier slot whose outcome is not yet
// recorded, claimed less than noOverlapMs ago, two slots by default) is not overlapped; the later firing returns { ran: false, overlap: true } without taking its
// slot. A claim older than noOverlapMs whose process never recorded an outcome (it died) is marked `abandoned` and the new slot runs, so a
// tick killed mid-run no longer burns slots for ever.
export const SLOT_MS = 600000;
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

/** Try to take the slot that `now` falls in. Returns { won, slot }. */
export async function claimSlot(db, now = Date.now(), { slotMs = SLOT_MS } = {}) {
  const slot = Math.floor(now / slotMs);
  const r = await db.prepare(`INSERT OR IGNORE INTO sched_slots (slot, claimed_at) VALUES (?, ?)`).bind(slot, iso(now)).run();
  return { won: (r.meta?.changes ?? 0) === 1, slot };
}

/** Run `tick()` only if this call takes the slot. `tick` is the adapter's call to runTick and should resolve to its result
 *  ({ tickId, completed, total }). Returns { ran, slot, result } { ran: false, slot, duplicate: true } for the same slot, or { ran: false, slot, overlap: true } while an earlier tick is still running. */
export async function runOncePerSlot(db, tick, { now = Date.now(), slotMs = SLOT_MS, noOverlapMs = 2 * slotMs } = {}) {
  const current = Math.floor(now / slotMs);
  const running = await db.prepare(`SELECT slot, claimed_at FROM sched_slots WHERE outcome IS NULL AND slot < ? ORDER BY slot DESC LIMIT 1`).bind(current).first();
  if (running) {
    const age = now - Date.parse(`${running.claimed_at.replace(' ', 'T')}Z`);
    if (age < noOverlapMs) return { ran: false, slot: current, overlap: true, running_slot: running.slot };
    await db.prepare(`UPDATE sched_slots SET outcome='abandoned' WHERE outcome IS NULL AND slot < ? AND claimed_at <= ?`).bind(current, iso(now - noOverlapMs)).run();
  }
  const { won, slot } = await claimSlot(db, now, { slotMs });
  if (!won) return { ran: false, slot, duplicate: true };
  const mark = (id, outcome) => db.prepare(`UPDATE sched_slots SET tick_run_id=?, outcome=? WHERE slot=?`).bind(id ?? null, outcome, slot).run();
  try {
    const result = await tick();
    await mark(result?.tickId, result && result.completed === result.total ? 'completed' : 'incomplete');
    return { ran: true, slot, result };
  } catch (e) {
    await mark(null, 'error');
    throw e;
  }
}
