// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// AUDIT-CHAIN-1: owner-only routes accept a bearer token the owner's side already holds (ANALYTICS_TOKEN or INTERNAL_DEPLOY_KEY). Constant-time compare.
export function bearerOk(request, env) {
  const h = request.headers.get('authorization') || '';
  for (const k of [env.ANALYTICS_TOKEN, env.INTERNAL_DEPLOY_KEY]) {
    if (!k) continue; const want = 'Bearer ' + k;
    if (h.length === want.length) { let d = 0; for (let i = 0; i < want.length; i++) d |= h.charCodeAt(i) ^ want.charCodeAt(i); if (d === 0) return true; }
  }
  return false;
}
