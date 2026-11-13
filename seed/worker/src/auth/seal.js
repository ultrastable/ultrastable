// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// AUTH-1: seal and open credential material with AES-GCM. The key is CREDENTIAL_KEY (base64, 32 bytes), generated and bound by the deploy, never by a person.
const b64 = u8 => btoa(String.fromCharCode(...u8));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function key(env) {
  if (!env.CREDENTIAL_KEY) throw new Error('CREDENTIAL_KEY is not bound');
  return crypto.subtle.importKey('raw', unb64(env.CREDENTIAL_KEY), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(env), new TextEncoder().encode(JSON.stringify(obj))));
  return b64(iv) + '.' + b64(ct);
}
export async function open(env, sealed) {
  if (!sealed) return null;
  const [iv, ct] = sealed.split('.');
  return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(env), unb64(ct))));
}
export const newKey = () => b64(crypto.getRandomValues(new Uint8Array(32)));
