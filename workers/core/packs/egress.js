// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Egress allowlist for the fetch a host injects into a pack's channel (US-21-R16). The pack source scan refuses ambient network access
// (US-21-R15); this is the second half: the one fetch a pack does receive can reach only the hosts its manifest declares under
// outbound.hosts, over https. The same rule the plugin tier enforces in seed/plugins/api.py (Runtime.egress against SCOPE.json hosts).
export const hostAllowed = (host, hosts) => {
  const h = String(host || '').toLowerCase();
  return !!h && (hosts || []).some(a => { const x = String(a).toLowerCase(); return h === x || h.endsWith('.' + x); });
};

// createEgressFetch({ fetch, hosts, onRefuse }) -> fetch-compatible function. Refuses non-https, unlisted hosts and lookalike suffixes
// (evilexample.com is not a subdomain of example.com) with Error `egress_refused:<host>`; onRefuse(host, url) lets the host log it.
export function createEgressFetch({ fetch, hosts, onRefuse = null } = {}) {
  if (typeof fetch !== 'function') throw new Error('fetch must be injected');
  if (!Array.isArray(hosts) || !hosts.length) throw new Error('egress hosts required');
  return async function egressFetch(input, init) {
    let u;
    try { u = new URL(typeof input === 'string' ? input : (input && input.url) || String(input)); } catch { throw new Error('egress_refused:invalid_url'); }
    if (u.protocol !== 'https:' || !hostAllowed(u.hostname, hosts)) {
      if (onRefuse) onRefuse(u.hostname, u.href);
      throw new Error(`egress_refused:${u.hostname}`);
    }
    return fetch(input, init);
  };
}
