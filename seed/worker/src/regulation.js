// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ASHBY-KERNEL-1: the law of requisite variety read from the system's own work queue (the law itself is in ashby.js, J.4658 and J.4846).
// Every fix item a detector files is one disturbance class (BREACH-<metric>, FM-<mode>, MISSED-<loop>, IGNITE-<stage>, GOAL-<goal> ...).
// A class is regulated when its item closed on evidence inside the window; it is let through when its item has stood open past the grace
// period, because no response the system has was able to hold it. The reading is the builtin metric unregulated_disturbances_14d. No
// step-function can move it, so the goal loop files the lever as work (VARIETY-DEFICIT, naming the classes) and closes it by the same reading.
// Two indexed reads (status, updated_at and status, priority), kept for an hour in one org row, so a tick costs one row.
import { requisiteVariety } from './ashby.js';
import { OWN_SQL, tenantOf } from './tenant.js';

// The item the goal loop files when this very reading is above 0. It is the remedy for the reading, not a disturbance: counted, it would keep the
// reading above 0 for as long as it stood open and nothing could ever close it.
export const OWN_ITEM = 'VARIETY-DEFICIT';
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const ms = s => { const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(String(s)) ? s : String(s).replace(' ', 'T') + 'Z'); return Number.isFinite(t) ? t : null; };

export async function varietyReading(db, now = Date.now(), tenant, { window_d = 14, grace_h = 72, ttl_min = 60 } = {}) {
  const own = tenantOf(tenant), key = `variety_${window_d}d:${own || 'own'}`;
  try { const c = await db.prepare(`SELECT value FROM org WHERE key = ?`).bind(key).first(); const v = c ? JSON.parse(c.value) : null; if (v && now - v.read_ms < ttl_min * 60e3 && now >= v.read_ms) return v; }
  catch (e) { /* allow-silent: an unreadable cache row only costs this tick the two reads below; the reading itself is then fresh */ console.error('regulation: cache unread:', e && e.message); }
  const since = new Date(now - window_d * 86400e3).toISOString();
  const done = await all(db, `SELECT id, owner_role FROM items WHERE status = 'done' AND updated_at >= ? AND kind = 'fix' AND ${OWN_SQL()}`, since, own);
  const open = await all(db, `SELECT id, created_at FROM items WHERE status IN ('open','ready','claimed','blocked') AND kind = 'fix' AND ${OWN_SQL()}`, own);
  const stood = open.filter(i => { if (i.id === OWN_ITEM) return false; const t = ms(i.created_at); return t !== null && now - t > grace_h * 3600e3; });
  const r = requisiteVariety([...done.map(i => ({ d: i.id, r: i.owner_role, ok: true })), ...stood.map(i => ({ d: i.id, r: null, ok: false }))]);
  const out = { ...r, uncovered: r.uncovered.slice(0, 40), uncovered_n: r.uncovered.length, pending: open.filter(i => i.id !== OWN_ITEM).length - stood.length, window_d, grace_h, read_ms: now, read_at: new Date(now).toISOString() };
  try { await db.prepare(`INSERT INTO org (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).bind(key, JSON.stringify(out)).run(); }
  catch (e) { /* allow-silent: a cache write miss leaves this reading good and only costs the next tick the same two reads */ console.error('regulation: cache not written:', e && e.message); }
  return out;
}
