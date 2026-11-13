// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// AUTH-1 adapter: Cloudflare-to-Cloudflare calls use service bindings, which carry no token at all; the "credential" is the binding's presence.
export const cloudflare = {
  id: 'cloudflare',
  async mint(m, { env = {} } = {}) {
    const name = m && m.meta && m.meta.binding;
    if (!name || !env[name] || typeof env[name].fetch !== 'function') return { ok: false, error: `service binding ${name || '(unnamed)'} is not present` };
    return { ok: true, token: null, expiresAt: null, binding: name };
  },
};
