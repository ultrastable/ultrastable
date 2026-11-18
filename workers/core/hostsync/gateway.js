// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Host adapter over the deploy gateway's read-only /state route (HOSTSYNC-1): the run proves itself with its GitHub OIDC token, the gateway holds the
// host credential, and the state comes back as names and hashes only. Any other host (another cloud, a container platform) implements the same
// two members: { id, observe(script) -> state }.
export function gatewayHost({ fetch = globalThis.fetch, gateway, oidc }) {
  return {
    id: 'cloudflare-gateway',
    async observe(script) {
      const tok = await oidc(gateway);
      const r = await fetch(gateway.replace(/\/$/, '') + '/state?script=' + encodeURIComponent(script), { headers: { authorization: 'Bearer ' + tok } });
      if (!r.ok) throw new Error('gateway /state ' + r.status);
      return r.json();
    },
  };
}
