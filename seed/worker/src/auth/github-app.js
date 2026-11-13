// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// AUTH-1 adapter: GitHub App. The Worker signs a short-lived JWT with the app private key and exchanges it for an installation token (1 hour, repository-scoped).
// No person mints or rotates a token: the token is re-minted from the key whenever the cached one is within the refresh margin of its expiry.
const API = 'https://api.github.com';
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = s => new TextEncoder().encode(s);
const der = (tag, body) => { const l = body.length; const len = l < 128 ? [l] : l < 256 ? [0x81, l] : [0x82, l >> 8, l & 255]; return Uint8Array.from([tag, ...len, ...body]); };

// GitHub issues PKCS#1 ("BEGIN RSA PRIVATE KEY"); WebCrypto imports PKCS#8. Wrap: SEQUENCE { INTEGER 0, SEQUENCE { rsaEncryption OID, NULL }, OCTET STRING { pkcs1 } }.
export function pkcs1ToPkcs8(pkcs1) {
  const alg = Uint8Array.from([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  return der(0x30, [...Uint8Array.from([0x02, 0x01, 0x00]), ...alg, ...der(0x04, pkcs1)]);
}
export function pemToDer(pem) {
  const body = pem.replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  const bin = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return /BEGIN RSA PRIVATE KEY/.test(pem) ? pkcs1ToPkcs8(bin) : bin;
}
export async function appJwt(appId, pem, now = Date.now()) {
  const key = await crypto.subtle.importKey('pkcs8', pemToDer(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const t = Math.floor(now / 1000);
  const head = b64u(enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))), pay = b64u(enc(JSON.stringify({ iat: t - 60, exp: t + 540, iss: String(appId) })));
  return `${head}.${pay}.${b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc(`${head}.${pay}`)))}`;
}
export const githubApp = {
  id: 'github-app',
  // m = { secret: { pem }, meta: { app_id, installation_id } }
  async mint(m, { fetch: f = fetch, now = Date.now() } = {}) {
    if (!m || !m.secret || !m.meta.app_id) return { ok: false, error: 'github app not registered (run the one-time connect flow)' };
    if (!m.meta.installation_id) return { ok: false, error: 'github app not installed on any repository (finish the one-time connect flow)' };
    const jwt = await appJwt(m.meta.app_id, m.secret.pem, now);
    const r = await f(`${API}/app/installations/${m.meta.installation_id}/access_tokens`, { method: 'POST', headers: { authorization: 'Bearer ' + jwt, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-auth' } });
    if (r.status !== 201) return { ok: false, error: `installation token HTTP ${r.status}` };
    const j = await r.json();
    return { ok: true, token: j.token, expiresAt: Date.parse(j.expires_at) };
  },
};
