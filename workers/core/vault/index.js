// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The vault: where a secret a person pastes into the console lives, so no one has to open a terminal to set a Worker
// secret. It is a door (self/doors.json), not the strongest store. It (1) never returns a value through any API,
// (2) lets modules read a value only through `withVault`/`read` at call time, (3) accepts only names on an allowlist,
// and (4) offers `redact` so a value cannot reach a log or a stored row. With a `key` (32 bytes in base64, bound by the
// deploy and never written to the database, like CREDENTIAL_KEY) every value is sealed with AES-GCM before it is stored,
// so a copy of the database alone opens nothing. Each sealed value is bound to its name (the name is the AES-GCM additional data), so a value
// moved to another row does not open. A value stored before a key was given is still read as it was and is sealed the first time it is read or
// written with the key; a deployment whose rows are all sealed passes `legacy: false`, and then an unsealed row reads as absent. Without a key a value is stored as given: then anyone who can read the database can
// read it, exactly as anyone with account access can read Worker secrets. Migrate to the platform secret store when the
// adapter offers one (the port is the same).

const NAME = /^[A-Z][A-Z0-9_]{2,63}$/;
export const DEFAULT_ALLOWED = ['ANTHROPIC_API_KEY', 'VCS_TOKEN', 'CONSOLE_TOKEN', 'GITHUB_APP_ID', 'GITHUB_APP_PRIVATE_KEY', 'GITHUB_APP_WEBHOOK_SECRET', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_CLIENT_ID', 'GITHUB_APP_CLIENT_SECRET', 'SESSION_KEY', 'OPENAI_API_KEY', 'EMAIL_API_TOKEN', 'SOCIAL_API_TOKEN',
  // OWNERLINK-1: written by the owner-link callbacks, never typed
  'MASTODON_TOKEN', 'MASTODON_CLIENT_ID', 'MASTODON_CLIENT_SECRET', 'MASTODON_INSTANCE', 'BLUESKY_OAUTH'];

const SEALED = 'enc:v1:';
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const aad = name => new TextEncoder().encode(String(name));

/** The sealer for one key: seal(text, name) -> 'enc:v1:<iv>:<ciphertext>' (AES-GCM, a fresh 12-byte iv per value, the name as additional data),
 *  open(stored, name) -> text, or null when the stored value is sealed and this key and name do not open it. A value without the prefix was stored
 *  before a key was given and is returned as it is. */
export function sealer(key) {
  if (key == null || key === '') return null;
  let raw;
  try { raw = unb64(String(key)); } catch { raw = null; }
  if (!raw || raw.length !== 32) throw new Error('vault key must be 32 bytes in base64');
  let imported = null;
  const k = () => (imported ||= crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
  return {
    async seal(text, name = '') {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(name) }, await k(), new TextEncoder().encode(text)));
      return `${SEALED}${b64(iv)}:${b64(ct)}`;
    },
    async open(stored, name = '') {
      const s = String(stored ?? '');
      if (!s.startsWith(SEALED)) return s;
      const [iv, ct] = s.slice(SEALED.length).split(':');
      try { return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: aad(name) }, await k(), unb64(ct))); } catch { return null; }
    },
  };
}

export function createVault({ db, allowed = DEFAULT_ALLOWED, key = null, legacy = true } = {}) {
  const ok = n => NAME.test(String(n)) && allowed.includes(String(n));
  const box = sealer(key);
  const isSealed = stored => String(stored ?? '').startsWith(SEALED);
  // A sealed value with no key, or with a key or name that does not open it, reads as absent (null), never as its sealed text. With a key and
  // `legacy: false`, an unsealed row reads as absent too, so a value planted in the database as plain text is not accepted.
  const open = async (stored, name) => (box ? (isSealed(stored) ? box.open(stored, name) : legacy ? stored : null) : isSealed(stored) ? null : stored);
  const seal = async (v, name) => (box ? box.seal(v, String(name)) : v);
  const values = async () => {
    const out = [];
    for (const row of (await db.prepare(`SELECT name, value FROM vault_secrets`).all()).results || []) { const v = await open(row.value, row.name); if (v) out.push({ name: row.name, value: v }); }
    return out;
  };
  return {
    sealed: () => Boolean(box),
    allowed: () => [...allowed],
    /** Store or replace a secret. Returns { name, stored: true } and never the value. */
    async put(name, value, { by = 'console' } = {}) {
      if (!ok(name)) return { error: 'name not allowed' };
      const v = String(value ?? '').trim();
      if (v.length < 8 || v.length > 8192) return { error: 'value length not accepted' };
      await db.prepare(`INSERT INTO vault_secrets (name, value, set_by, set_at) VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(name) DO UPDATE SET value=excluded.value, set_by=excluded.set_by, set_at=datetime('now')`).bind(String(name), await seal(v, name), String(by)).run();
      return { name: String(name), stored: true };
    },
    /** Whether a value this vault can read is stored under the name: it agrees with read(), so a sealed value this key does not open is absent. */
    async has(name) {
      const r = await db.prepare(`SELECT value FROM vault_secrets WHERE name=?`).bind(String(name)).first();
      return Boolean(r) && (await open(r.value, String(name))) !== null;
    },
    /** Names and when they were set. Never values. */
    async names() { return (await db.prepare(`SELECT name, set_by, set_at, last_used_at FROM vault_secrets ORDER BY name`).all()).results || []; },
    async remove(name) { await db.prepare(`DELETE FROM vault_secrets WHERE name=?`).bind(String(name)).run(); return { removed: true }; },
    /** Internal read for a module that must call a provider. Records last use. Do not log the result. */
    async read(name) {
      const r = await db.prepare(`SELECT value FROM vault_secrets WHERE name=?`).bind(String(name)).first();
      if (!r) return null;
      const v = await open(r.value, String(name));
      if (v === null) return null;
      // a value stored before the key is sealed the first time it is read with the key, so the plain copy does not outlive its first use
      if (box && !isSealed(r.value)) await db.prepare(`UPDATE vault_secrets SET value=?, last_used_at=datetime('now') WHERE name=?`).bind(await seal(v, name), String(name)).run();
      else await db.prepare(`UPDATE vault_secrets SET last_used_at=datetime('now') WHERE name=?`).bind(String(name)).run();
      return v;
    },
    /** env with vault values filled in for names the env lacks. Real env values win. The result must not be logged or stored. */
    async withVault(env = {}) {
      const out = { ...env };
      for (const row of await values()) if (!out[row.name]) out[row.name] = row.value;
      return out;
    },
    /** Replace every stored value in a string with [redacted]. */
    async redact(text) {
      let t = String(text);
      for (const row of await values()) t = t.split(row.value).join('[redacted]');
      return t;
    },
  };
}
