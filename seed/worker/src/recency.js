// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// RECENCY-1: every page and API that shows live data says when it was last updated and how often it updates, for people and for code.
// People get one plain line; code gets headers (Last-Modified, X-Updated-At, X-Update-Schedule, X-Max-Age-Seconds, X-Stale) and a `recency` JSON field.
// A response past its schedule says so (X-Stale: true). A response with no stamp is a defect: stamp() adds the fallback stamp at the edge.
const iso = (t) => new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function recency({ updatedAt, maxAgeS, schedule, source = null, now = Date.now() }) {
  const t = Date.parse(updatedAt || '');
  const known = !isNaN(t);
  const age_s = known ? Math.max(0, Math.round((now - t) / 1000)) : null;
  return { updated_at: known ? iso(t) : null, schedule, max_age_s: maxAgeS, age_s, stale: !known || age_s > maxAgeS, source, checked_at: iso(now) };
}

export function recencyText(r) {
  if (!r.updated_at) return 'Last update unknown. ' + r.schedule + '.';
  const d = r.updated_at;
  return 'Last updated ' + d.slice(11, 16) + ' UTC on ' + d.slice(0, 10) + '. ' + r.schedule + '.' + (r.stale ? ' This is older than its schedule.' : '');
}

export function recencyHeaders(r) {
  const h = { 'X-Update-Schedule': r.schedule, 'X-Max-Age-Seconds': String(r.max_age_s), 'X-Stale': String(r.stale) };
  if (r.updated_at) { h['X-Updated-At'] = r.updated_at; h['Last-Modified'] = new Date(r.updated_at).toUTCString(); }
  return h;
}

// Adds the stamp to a response that lacks one. A handler that knows a fresher time sets its own X-Updated-At first and wins.
export function stamp(res, r) {
  if (!res || !res.headers || res.headers.has('x-updated-at') || res.status >= 300) return res;
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(recencyHeaders(r))) if (!out.headers.has(k)) out.headers.set(k, v);
  return out;
}

// RECENCY-1: a tenant's freshness is its newest finished tick.
export function tickRecency(row, now = Date.now()) {
  return recency({ updatedAt: row && row.finished_at, maxAgeS: 2 * 3600, schedule: 'Updated by the tick every 10 minutes; older than 2 hours counts as stale', source: 'tick_runs', now });
}
