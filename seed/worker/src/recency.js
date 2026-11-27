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
  if (r.stale_sections && r.stale_sections.length) h['X-Stale-Sections'] = r.stale_sections.join(',');
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

// RECENCY-PROBE-1: the tick reads its own live pages every pass. A page with no X-Updated-At, or one that says X-Stale: true, turns the beat red.
export const PROBE_PATHS = ['/', '/roadmap', '/roadmap.json', '/live'];
export async function probeStamps({ siteUrl, paths = PROBE_PATHS, fetchImpl = fetch } = {}) {
  const bad = [];
  for (const p of paths) {
    try {
      const r = await fetchImpl(siteUrl + p, { headers: { 'cache-control': 'no-cache' } });
      const at = r.headers.get('x-updated-at');
      if (!at) bad.push(p + ': no X-Updated-At');
      else if (r.headers.get('x-stale') === 'true') bad.push(p + ': stale since ' + at);
    } catch (e) { bad.push(p + ': unreadable ' + String(e && e.message).slice(0, 80)); }
  }
  return bad.length ? { status: 'stale', bad } : { status: 'fresh', checked: paths.length };
}
