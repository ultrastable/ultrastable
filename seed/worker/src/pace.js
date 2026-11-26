// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// PACE-2: the tick paces its own loops and orders its own work; nothing here is set by hand at run time.
//   stride   a heavy loop whose last `idle_runs` real runs returned nothing runs every 2nd cycle, then every 4th (max_stride); the first run
//            that returns work puts it back to every cycle. A deferred run (subrequest cap) is neither idle nor work and is skipped when counting. A skipped slot still leaves a beat ({ paced: true, stride }), so the loop clock
//            sees a decision, never a missed slot. Loops in never_pace always run.
//   rank     ready items of one priority are ordered by reach / cost of the first matching id prefix (config.pace.rank); priority still wins.
// Config: seed/autonomy/pace.json (config.pace). Same rule as workers/core/pace plan(): idle loops back off, productive loops run.
export const PACE_DEFAULTS = { idle_runs: 4, max_stride: 4, never_pace: ['executor', 'lane', 'handoffs'], rank: [], gauges: ['open_loop_age_hours', 'used', 'limit', 'refused'] };
const cfgOf = config => ({ ...PACE_DEFAULTS, ...((config && config.pace) || {}) });
const EMPTY = v => v == null || v === false || v === 0 || v === '' || (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0);

// A finished run is idle when its recorded result holds no work: nothing but empty lists, zeros, nulls and a status word.
// A result that cannot be parsed (truncated at 300 characters) held enough to count as work. Keys named in `gauges` (a reading such as
// open_loop_age_hours, not an action) are ignored: the sweeper reports one on every run, and counting it as work kept the sweeper at stride 1.
export function isIdle(detail, gauges = PACE_DEFAULTS.gauges) {
  if (detail == null) return true;
  let v; try { v = JSON.parse(detail); } catch { return false; }
  if (EMPTY(v)) return true;
  if (typeof v !== 'object' || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, x]) => gauges.includes(k) || EMPTY(x) || (k === 'status' && /^(ok|idle|none|nothing|skipped|no-op)$/i.test(String(x))));
}

// The stride a loop has earned: 1, 2, 4 ... max_stride, doubling per full `idle_runs` of consecutive idle real runs (paced beats excluded).
export async function strideFor(db, loop, config) {
  const c = cfgOf(config);
  if (c.never_pace.includes(loop)) return 1;
  let rows = [];
  try {
    rows = (await db.prepare(`SELECT ok, detail FROM loop_beats WHERE loop = ? AND finished_at IS NOT NULL AND (detail IS NULL OR (detail NOT LIKE '{"paced"%' AND detail NOT LIKE '{"status":"deferred"%')) ORDER BY slot DESC, id DESC LIMIT ?`)  // READ-BUDGET-9: newest first by the (loop, slot) index, so the read stops at the limit; ORDER BY id sorted every beat the loop ever left (1,488 rows a call, measured)
      .bind(loop, c.idle_runs * 4).all()).results || [];
  } catch (e) { console.error('pace', loop, 'stride unread:', e && e.message); return 1; }  // no ledger yet: run
  let idle = 0;
  for (const r of rows) { if (r.ok === 1 && isIdle(r.detail, c.gauges)) idle++; else break; }
  let s = 1;
  for (let n = idle; n >= c.idle_runs && s < c.max_stride; n -= c.idle_runs) s *= 2;
  return Math.min(s, c.max_stride);
}

// True when this cycle is one the loop skips. cycle is the count of the loop's own slots since the epoch.
// BOUNDARIES-1: the optimizer's tuning (roi.js tune) changes the stride. slow: stretch to at least ceil(pace_factor), up to 2x max_stride, so a tenant near its plan's limit
// spends fewer runs; use-headroom: halve the earned stride so more of the backlog runs while the day has room. Loops in never_pace are untouched.
export function applyTuning(stride, tuning, config, loop) {
  const c = cfgOf(config);
  if (!tuning || c.never_pace.includes(loop)) return stride;
  if (tuning.action === 'slow') return Math.min(Math.max(stride, Math.ceil(tuning.pace_factor)), c.max_stride * 2);
  if (tuning.action === 'use-headroom') return Math.max(1, Math.floor(stride / 2));
  return stride;
}
export async function paced(db, loop, cycle, config, tuning = null) {
  const stride = applyTuning(await strideFor(db, loop, config), tuning, config, loop);
  return stride > 1 && cycle % stride !== 0 ? { paced: true, stride } : null;
}

// Orders rows that are already sorted by priority: within one priority, higher reach / cost first; ties keep their order.
export function rankRows(rows, rank = []) {
  const score = r => { const m = rank.find(x => String(r.id).startsWith(x.prefix)); return m ? Number(m.reach || 1) / Math.max(Number(m.cost || 1), 0.01) : 1; };
  return rows.map((r, i) => ({ r, i, s: score(r) })).sort((a, b) => (a.r.priority ?? 0) - (b.r.priority ?? 0) || b.s - a.s || a.i - b.i).map(x => x.r);
}
