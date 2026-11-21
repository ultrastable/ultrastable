// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Service levels and the loops around them (US-SPEC-13 sections 4 and 5):
// FLOW-BALANCE-1 (owner, 2026-11-21): every issue is resolved within its SLA, and daily and weekly inflow of new issues never exceeds closed issues,
// for every system built on Ultrastable. Pure and tenant-agnostic: a tenant passes its own item rows and gets the same measurement and the same
// corrective plan as core (python twin: foundation/balance.py in ultrastable/ultrastable; seed: scripts/balance.py).
// Row: { id, title, trigger, probe, status: 'open'|'closed'|..., disposition: ''|'fixed'|'gate'|'shelved'|'superseded', labels: [], created, closed }.
// Superseded rows lower net inflow and never count as closures, so consolidation can never game the number.
export const DEFAULTS = {
  sla_days: { p0: 2, p1: 7, default: 14 }, windows: { day: 1, week: 7 }, family: /^([A-Z]+(?:-[A-Z]+)?)/,
  batch_threshold: 5, batch_window_days: 1, batch_exclude: ['OL-PR', 'OL', 'PORT-BRANCH', 'PORT', 'BATCH'],
  throttle: { daily_quota_floor: 3, quota_share_of_weekly_outflow: 1 }, boost: { normal: 1, tipped: 3, max: 4 },
  final_statuses: ['closed', 'done', 'live', 'superseded', 'cancelled'], never_closure: ['superseded'],
};
const D = 86400e3;
const ms = s => (s == null ? NaN : typeof s === 'number' ? s : Date.parse(String(s).replace(' ', 'T').replace(/(\d\d:\d\d(:\d\d)?)$/, '$1Z')));
const isFinal = (r, c) => c.final_statuses.includes(String(r.status || '').toLowerCase());
const slaOf = (r, c) => { for (const l of r.labels || []) if (c.sla_days[l] != null) return c.sla_days[l]; return c.sla_days.default; };
export const normTitle = t => String(t || '').replace(/^\S+:\s*/, '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim();

export function measure(rows, now, config = {}) {
  const c = { ...DEFAULTS, ...config }, t = typeof now === 'number' ? now : ms(now);
  const windows = {};
  for (const [name, days] of Object.entries(c.windows)) {
    const since = t - days * D;
    const filed = rows.filter(r => ms(r.created) >= since);
    const sup = filed.filter(r => isFinal(r, c) && c.never_closure.includes(r.disposition || ''));
    const closed = rows.filter(r => isFinal(r, c) && !c.never_closure.includes(r.disposition || '') && String(r.status) !== 'superseded' && ms(r.closed) >= since).length;
    const net = filed.length - sup.length;
    windows[name] = { days, filed: filed.length, superseded: sup.length, net_inflow: net, closed, balance: closed - net, ok: net <= closed };
  }
  const open = rows.filter(r => !isFinal(r, c));
  const breaches = open.map(r => ({ id: r.id, age_days: Math.round((t - ms(r.created)) / D * 10) / 10, sla_days: slaOf(r, c) }))
    .filter(r => r.age_days > r.sla_days).sort((a, b) => b.age_days - a.age_days);
  const tipped = !Object.values(windows).every(w => w.ok) || breaches.length > 0;
  const quota = Math.max(c.throttle.daily_quota_floor, Math.floor((windows.week?.closed || 0) * c.throttle.quota_share_of_weekly_outflow / 7));
  return {
    windows, open: open.length, tipped,
    sla: { within: open.length - breaches.length, breached: breaches.length, compliance: open.length ? Math.round((open.length - breaches.length) / open.length * 1000) / 1000 : 1, worst: breaches.slice(0, 10) },
    throttle: { on: tipped, daily_quota: quota, quota_left: tipped ? Math.max(0, quota - (windows.day?.net_inflow || 0)) : null },
    closure_boost: Math.min(c.boost.max, tipped ? c.boost.tipped : c.boost.normal),
  };
}

// The corrective plan for one pass: duplicates (same title, trigger and closing probe) are superseded by the oldest; a family that filed more than
// batch_threshold open items inside the batch window becomes one batch item. Per-object families (one item per PR or branch) are never batched.
export function consolidate(rows, now, config = {}) {
  const c = { ...DEFAULTS, ...config }, t = typeof now === 'number' ? now : ms(now);
  const open = rows.filter(r => !isFinal(r, c) && !String(r.id).startsWith('BATCH-')).sort((a, b) => ms(a.created) - ms(b.created));
  const acts = [], gone = new Set(), seen = new Map();
  for (const r of open) {
    const k = [normTitle(r.title), r.trigger || '', r.probe || ''].join(' || ');
    if (k.length < 16) continue;
    if (seen.has(k)) { acts.push({ act: 'supersede', id: r.id, by: seen.get(k) }); gone.add(r.id); } else seen.set(k, r.id);
  }
  const fams = new Map(), since = t - c.batch_window_days * D;
  for (const r of open) {
    if (gone.has(r.id) || !(ms(r.created) >= since)) continue;
    const f = (String(r.id).match(c.family) || [, r.id])[1];
    if (c.batch_exclude.includes(f)) continue;
    fams.set(f, [...(fams.get(f) || []), r.id]);
  }
  const day = new Date(t).toISOString().slice(0, 10).replace(/-/g, '');
  for (const [f, ids] of [...fams].sort()) if (ids.length > c.batch_threshold) acts.push({ act: 'batch', id: `BATCH-${f}-${day}`, family: f, members: ids.sort() });
  return acts;
}

// A filer asks before it writes a new item: false only while the balance is tipped and today's quota is spent.
export const admit = state => !state?.throttle?.on || (state.throttle.quota_left || 0) > 0;
