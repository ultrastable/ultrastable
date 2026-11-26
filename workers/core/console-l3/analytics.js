// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The analytics port of the dashboard (US-SPEC-13 section 3, US-13-R24): 24-hour requests and errors from the platform's analytics,
// per script, joined with each scheduled worker's next run. The port is a function the host supplies:
//   analytics({ from, to }) -> { measured: true, requests, errors, by_script: { <name>: { requests, errors, cpu_ms? } } }
// This module calls no platform and never throws: a port that is missing, throws, times out or returns something that is not that
// shape gives { measured: false, reason }, and the page says "not measured", never 0 (US-13-R24).
const num = v => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

/** Check and shape one reading. Totals not given are summed from the scripts; a script with a bad count makes the reading unmeasured. */
export function normalize(raw, { from = null, to = null } = {}) {
  if (!raw || typeof raw !== 'object' || raw.measured === false) return { measured: false, reason: String(raw?.reason || 'the analytics port gave no reading').slice(0, 160) };
  const by = raw.by_script && typeof raw.by_script === 'object' ? raw.by_script : null;
  if (!by) return { measured: false, reason: 'the reading names no scripts' };
  const rows = [];
  for (const [name, v] of Object.entries(by)) {
    const requests = num(v?.requests); const errors = num(v?.errors);
    if (requests == null || errors == null) return { measured: false, reason: `script ${name} has no usable request and error counts` };
    rows.push({ name, requests, errors, cpu_ms: num(v?.cpu_ms) });
  }
  rows.sort((a, b) => b.requests - a.requests || a.name.localeCompare(b.name));
  const requests = num(raw.requests) ?? rows.reduce((a, r) => a + r.requests, 0);
  const errors = num(raw.errors) ?? rows.reduce((a, r) => a + r.errors, 0);
  return { measured: true, from, to, requests, errors, by_script: rows };
}

/** Read the port inside a time limit. Never throws. */
export async function readAnalytics(port, { from, to, timeout_ms = 3000 } = {}) {
  if (typeof port !== 'function') return { measured: false, reason: 'no analytics port is configured' };
  let timer;
  try {
    const raw = await Promise.race([port({ from, to }), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('the analytics port timed out')), timeout_ms); timer.unref?.(); })]);
    return normalize(raw, { from, to });
  } catch (e) { return { measured: false, reason: String(e?.message || e).slice(0, 160) }; } finally { clearTimeout(timer); }
}

/** One row per enabled cron, joined to the script of the same name: its requests and errors (null when that script is not in the
 *  reading, so a worker with no analytics is "not measured", not "no errors") and its next run. */
export function scheduledRows(reading, crons = []) {
  const by = new Map((reading?.measured ? reading.by_script : []).map(r => [r.name, r]));
  return crons.map(c => { const s = by.get(c.name); return { name: c.name, next_fire: c.next_fire ?? null, requests: s ? s.requests : null, errors: s ? s.errors : null }; });
}
