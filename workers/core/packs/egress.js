// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Egress allowlist for the fetch a host injects into a pack's channel (US-21-R28). The pack source scan refuses ambient network access
// (US-21-R27); this is the second half: the one fetch a pack does receive can reach only the hosts its manifest declares under
// outbound.hosts, over https. The same rule the plugin tier enforces in seed/plugins/api.py (Runtime.egress against SCOPE.json hosts).
export const hostAllowed = (host, hosts) => {
  const h = String(host || '').toLowerCase();
  return !!h && (hosts || []).some(a => { const x = String(a).toLowerCase(); return h === x || h.endsWith('.' + x); });
};

// createEgressFetch({ fetch, hosts, onRefuse }) -> fetch-compatible function. Refuses non-https, unlisted hosts and lookalike suffixes
// (evilexample.com is not a subdomain of example.com) with Error `egress_refused:<host>`; onRefuse(host, url) lets the host log it.
// Redirects are followed by this function, not by the platform: each hop goes out with redirect 'manual', and the Location it returns must name
// a listed host too, so an allowed host that answers 30x to another host does not take the request off the list (at most MAX_REDIRECTS hops).
export const MAX_REDIRECTS = 5;
export function createEgressFetch({ fetch, hosts, onRefuse = null } = {}) {
  if (typeof fetch !== 'function') throw new Error('fetch must be injected');
  if (!Array.isArray(hosts) || !hosts.length) throw new Error('egress hosts required');
  const allow = (u) => {
    if (u.protocol !== 'https:' || !hostAllowed(u.hostname, hosts)) {
      if (onRefuse) onRefuse(u.hostname, u.href);
      throw new Error(`egress_refused:${u.hostname}`);
    }
  };
  return async function egressFetch(input, init) {
    let u;
    try { u = new URL(typeof input === 'string' ? input : (input && input.url) || String(input)); } catch { throw new Error('egress_refused:invalid_url'); }
    allow(u);
    const follow = !(init && (init.redirect === 'manual' || init.redirect === 'error'));
    let res = await fetch(input, { ...(init || {}), redirect: 'manual' });
    for (let hop = 0; follow && hop < MAX_REDIRECTS && res && res.status >= 300 && res.status < 400 && res.headers && res.headers.get && res.headers.get('location'); hop++) {
      const next = new URL(res.headers.get('location'), u);
      allow(next);
      const method = res.status === 303 || ((res.status === 301 || res.status === 302) && init && init.method && init.method.toUpperCase() === 'POST') ? 'GET' : (init && init.method);
      const keepBody = method === (init && init.method);
      u = next;
      res = await fetch(next.href, { ...(init || {}), method, body: keepBody ? init && init.body : undefined, redirect: 'manual' });
    }
    if (follow && res && res.status >= 300 && res.status < 400 && res.headers && res.headers.get && res.headers.get('location')) throw new Error('egress_refused:too_many_redirects');
    return res;
  };
}
