// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// CACHE-FRESH-1 (REDTEAM-1, 2026-11-25): after a deploy, ultrastable.io kept serving the old /claims and /live for over 30 minutes while a
// cache-busted fetch showed the new pages. Every HTML page from every system goes through freshHtml: browsers revalidate on each visit,
// the shared edge cache keeps a page at most EDGE_S seconds, and the page names the build it came from (x-ultrastable-build) so a
// post-deploy probe (deploy/stale-probe.mjs, seed/scripts/stale_probe.mjs) can tell old content from new without bypassing the cache.
export const EDGE_S = 60;

export function freshHtml(resp, build = '') {
  if (!resp || !resp.headers) return resp;
  const ct = String(resp.headers.get('content-type') || '');
  if (!/^text\/html/i.test(ct) || resp.status >= 300) return resp;
  const cc = String(resp.headers.get('cache-control') || '');
  if (/no-store|private/i.test(cc)) return resp;
  const h = new Headers(resp.headers);
  h.set('cache-control', 'public, max-age=0, must-revalidate');
  h.set('cdn-cache-control', 'public, max-age=' + EDGE_S);
  h.set('cloudflare-cdn-cache-control', 'public, max-age=' + EDGE_S);
  if (build) h.set('x-ultrastable-build', String(build));
  return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: h });
}

// The probe's judgement, shared by the platform and every seeded system: the page served through the cache must carry the build
// the cache-busted fetch carries, and must not ask an edge to hold it longer than EDGE_S.
export function staleVerdict(plain, busted) {
  const p = plain || {}, b = busted || {};
  const fails = [];
  if (b.build && p.build !== b.build) fails.push('cached page serves build ' + (p.build || 'none') + ' while the origin serves ' + b.build);
  const m = /max-age=(\d+)/.exec(String(p.cdn || ''));
  if (!m || Number(m[1]) > EDGE_S) fails.push('edge cache lifetime is ' + (m ? m[1] + ' s' : 'unset') + ', above ' + EDGE_S + ' s');
  return { ok: !fails.length, fails };
}
