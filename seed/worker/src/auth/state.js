// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// CONNECT-1: HMAC helpers shared by the GitHub flow and the generic connector flow. State is signed with CREDENTIAL_KEY, so a callback can only carry a state this Worker issued.
const enc = s => new TextEncoder().encode(s);
export async function hmac(env, msg) {
  const k = await crypto.subtle.importKey('raw', enc(env.CREDENTIAL_KEY || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, enc(msg)))].map(b => b.toString(16).padStart(2, '0')).join('');
}
const b64u = s => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));
// A connector state carries tenant, provider key and a one-time nonce; valid for one hour.
export async function makeConnectorState(env, tenant, provider, nonce, now = Date.now()) {
  const body = b64u(JSON.stringify({ t: tenant, p: provider, n: nonce, ts: now }));
  return `${body}.${await hmac(env, body)}`;
}
export async function checkConnectorState(env, state, now = Date.now()) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig || sig !== await hmac(env, body)) return null;
  try { const o = JSON.parse(unb64u(body)); return now - o.ts > 3600e3 ? null : o; } catch (_) { return null; }
}
