// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Verifies a GitHub Actions OIDC token (RS256) so a workflow run can use the Worker's Workers AI binding with no stored secret:
// GitHub mints the token for each run, the Worker checks signature, issuer, audience, expiry and the repository claim.
export const ISSUER = 'https://token.actions.githubusercontent.com';
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0));
const json = s => JSON.parse(new TextDecoder().decode(b64u(s)));

export async function verifyOidc(token, { fetch: f = globalThis.fetch, audience, repository, now = Date.now(), jwks } = {}) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed token' };
  let head, claims;
  try { head = json(parts[0]); claims = json(parts[1]); } catch { return { ok: false, reason: 'malformed token' }; }
  if (head.alg !== 'RS256') return { ok: false, reason: 'alg' };
  if (claims.iss !== ISSUER) return { ok: false, reason: 'issuer' };
  if (claims.aud !== audience) return { ok: false, reason: 'audience' };
  if (!claims.exp || claims.exp * 1000 < now) return { ok: false, reason: 'expired' };
  if (claims.repository !== repository) return { ok: false, reason: 'repository' };
  const keys = jwks || (await (await f(`${ISSUER}/.well-known/jwks`)).json()).keys;
  const jwk = (keys || []).find(k => k.kid === head.kid);
  if (!jwk) return { ok: false, reason: 'unknown key' };
  const key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64u(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  return ok ? { ok: true, claims } : { ok: false, reason: 'signature' };
}
