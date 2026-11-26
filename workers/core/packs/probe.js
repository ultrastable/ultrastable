// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Read-only channel probes and the live-trial gate (US-21-R25). A channel port may offer probe(): a check that reads (a session, a
// profile, a token verification) and never sends. Enabling an outbound pack opens one gate card, "live trial of <pack>", whose default
// in effect is that every send waits for a person's approval (the pack starts at the lowest rung and the guard queues). The card
// closes through the tick's own item_done probe when every declared channel's probe has passed, so no person has to close it.
import { all, first, run, iso, ensureItem } from '../kernel/util.js';

export const trialItemId = id => `PACKTRIAL-${id}`;
export const trialCardId = id => `pack-trial-${id}`;
export const probeItemId = (id, ch) => `PACKPROBE-${id}-${ch}`;

// Called by enablePack for an outbound pack. Idempotent.
export async function openTrial(db, m, managerRole) {
  if (!m.outbound) return false;
  await ensureItem(db, { id: trialItemId(m.id), title: `Live trial of pack ${m.id}: every declared channel passes its read-only probe`, kind: 'plus',
    project: `pack-${m.id}`, owner_role: managerRole(m.id), done_check: `packs_probes holds a passing row for each of ${m.outbound.channels.join(', ')}`, priority: 30 });
  await run(db, `INSERT OR IGNORE INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES (?,?,?,?,?,?)`,
    trialCardId(m.id), `Live trial of pack ${m.id}: first real sends on ${m.outbound.channels.join(', ')}`,
    'A real send uses the person\'s provider credential and reaches real people; nothing sends until each channel has shown it can be read.',
    'Every send waits for a person\'s approval (the pack starts below the act rung and the guard queues each one).',
    'read-only probes on every declared channel; approval queue; per-pack kill switch', `item_done:${trialItemId(m.id)}`);
  return true;
}

// ports: { <channel>: { probe?() } }. Returns one result per declared channel of every enabled outbound pack.
export async function runChannelProbes({ db, now = Date.now, ports = {}, redact = x => x, managerRole = id => `pack-manager-${id}` } = {}) {
  const results = [];
  for (const r of await all(db, `SELECT id, manifest_json FROM packs_registry WHERE enabled = 1 ORDER BY id`)) {
    const m = JSON.parse(r.manifest_json);
    if (!m.outbound) continue;
    let every = true;
    for (const ch of m.outbound.channels) {
      const port = ports[ch];
      if (!port || typeof port.probe !== 'function') { results.push({ pack: m.id, channel: ch, ok: null, detail: 'no_probe' }); every = false; continue; }
      let ok, detail = null;
      try { const res = await port.probe(); ok = res === undefined ? true : !!(res && typeof res === 'object' ? res.ok : res); detail = res && typeof res === 'object' ? res.detail ?? null : null; }
      catch (e) { ok = false; detail = e && e.message; }
      detail = detail == null ? null : redact(String(detail)).slice(0, 200);
      await run(db, `INSERT INTO packs_probes (pack_id, channel, ok, detail, at) VALUES (?,?,?,?,?)`, m.id, ch, ok ? 1 : 0, detail, iso(now()));
      if (!ok) {
        every = false;
        await ensureItem(db, { id: probeItemId(m.id, ch), title: `Pack ${m.id} channel ${ch} failed its read-only probe${detail ? `: ${detail}` : ''}`, owner_role: managerRole(m.id),
          done_check: `the next probe of ${m.id}:${ch} passes`, priority: 10, project: `pack-${m.id}` });
      } else {
        await run(db, `UPDATE items SET status = 'done', disposition = 'closed: the channel probe passed', updated_at = ? WHERE id = ? AND status NOT IN ('done','superseded','cancelled')`, iso(now()), probeItemId(m.id, ch));
      }
      results.push({ pack: m.id, channel: ch, ok, detail });
    }
    if (every) await run(db, `UPDATE items SET status = 'done', disposition = 'closed: every declared channel passed its read-only probe', updated_at = ? WHERE id = ? AND status NOT IN ('done','superseded','cancelled')`, iso(now()), trialItemId(m.id));
  }
  return results;
}

export const lastProbes = (db, packId) => all(db, `SELECT channel, ok, detail, at FROM packs_probes WHERE pack_id = ? AND id IN (SELECT MAX(id) FROM packs_probes WHERE pack_id = ? GROUP BY channel) ORDER BY channel`, packId, packId);
export const probeCount = async db => (await first(db, `SELECT COUNT(*) AS n FROM packs_probes`)).n;
