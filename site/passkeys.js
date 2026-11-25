// PASSKEYS-1: WebAuthn (Level 3) sign-in for the owner, one tap, no password and no pasted code. Email-code login (dashboard worker) stays as the fallback and as the way to enrol the first passkey.
// Shares the owner session with the dashboard: same D1 `sessions` table and the same us_owner cookie, so a passkey sign-in is a dashboard sign-in. Credentials are stored sealed (AES-GCM, CREDENTIAL_KEY, the seed/worker/src/auth/seal.js format).
// Exported for the OAuth consent screens: currentSubject(request, env) -> { sub, method, fresh } | null.
//   GET  /auth/signin                        one-tap screen (?next=/path, same-origin only)
//   POST /auth/passkey/login/options|verify  assertion (discoverable credentials, no username)
//   POST /auth/passkey/register/options|verify   needs an owner session (enrol first via the email code)
//   GET  /auth/passkey/list, POST /auth/passkey/remove, POST /auth/signout
import { say, userJson } from "../seed/worker/src/errors.js";  // USER-BACKEND-1
const COOKIE = "us_owner", SESSION_MS = 30 * 864e5, STEPUP_MS = 15 * 60e3, CHALLENGE_MS = 5 * 60e3, MAX_PASSKEYS = 10;
const enc = new TextEncoder();
const hexOf = u8 => [...u8].map(x => x.toString(16).padStart(2, "0")).join("");
const rnd = n => crypto.getRandomValues(new Uint8Array(n));
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = s => { const t = String(s).replace(/-/g, "+").replace(/_/g, "/"); return Uint8Array.from(atob(t + "=".repeat((4 - t.length % 4) % 4)), c => c.charCodeAt(0)); };
const sha256 = async data => new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? enc.encode(data) : data));
const sha256hex = async s => hexOf(await sha256(s));
const eq = (a, b) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; };
const json = (o, status, extra) => new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...(extra || {}) } });
const cookieOf = (req, name) => { const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)")); return m ? m[1] : ""; };

// ---- seal: the AUTH-1 format (iv.ciphertext, base64, AES-GCM, key CREDENTIAL_KEY) ----
const b64 = u8 => btoa(String.fromCharCode(...u8)), unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function sealKey(env) { if (!env.CREDENTIAL_KEY) throw new Error("CREDENTIAL_KEY is not bound"); return crypto.subtle.importKey("raw", unb64(env.CREDENTIAL_KEY), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function seal(env, obj) { const iv = rnd(12); const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(env), enc.encode(JSON.stringify(obj)))); return b64(iv) + "." + b64(ct); }
async function open(env, sealed) { const [iv, ct] = String(sealed).split("."); return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await sealKey(env), unb64(ct)))); }

// ---- minimal CBOR (RFC 8949): what attestation objects and COSE keys use ----
export const cbor = buf => cborLen(buf).value;
function cborLen(buf) {
  let p = 0; const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = ai => { if (ai < 24) return ai; if (ai === 24) return buf[p++]; if (ai === 25) { const v = dv.getUint16(p); p += 2; return v; } if (ai === 26) { const v = dv.getUint32(p); p += 4; return v; } throw new Error("cbor: length too large"); };
  const item = () => {
    const ib = buf[p++], mt = ib >> 5, ai = ib & 31;
    switch (mt) {
      case 0: return len(ai); case 1: return -1 - len(ai);
      case 2: { const n = len(ai); const v = buf.slice(p, p + n); p += n; return v; }
      case 3: { const n = len(ai); const v = new TextDecoder().decode(buf.slice(p, p + n)); p += n; return v; }
      case 4: { const n = len(ai), a = []; for (let i = 0; i < n; i++) a.push(item()); return a; }
      case 5: { const n = len(ai), m = new Map(); for (let i = 0; i < n; i++) { const k = item(); m.set(k, item()); } return m; }
      case 7: if (ai === 20) return false; if (ai === 21) return true; return null;
      default: throw new Error("cbor: unsupported type " + mt);
    }
  };
  const value = item(); return { value, end: p };
}

// ---- WebAuthn parsing and verification ----
function parseAuthData(ad) {
  if (ad.length < 37) throw new Error("authData too short");
  const flags = ad[32], out = { rpIdHash: ad.slice(0, 32), up: !!(flags & 1), uv: !!(flags & 4), be: !!(flags & 8), bs: !!(flags & 16), at: !!(flags & 64), signCount: new DataView(ad.buffer, ad.byteOffset + 33, 4).getUint32(0) };
  if (out.at) {
    if (ad.length < 55) throw new Error("attested credential data too short");
    const idLen = (ad[53] << 8) | ad[54]; out.credId = ad.slice(55, 55 + idLen);
    const { value } = cborLen(ad.slice(55 + idLen)); out.cose = value;
  }
  return out;
}
const COSE = { kty: 1, alg: 3, crv: -1, x: -2, y: -3 };
function coseToJwk(m) {
  if (!(m instanceof Map) || m.get(COSE.kty) !== 2 || m.get(COSE.alg) !== -7 || m.get(COSE.crv) !== 1) throw new Error("unsupported credential key: need ES256 (P-256)");
  const x = m.get(COSE.x), y = m.get(COSE.y); if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array) || x.length !== 32 || y.length !== 32) throw new Error("bad EC2 key");
  return { kty: "EC", crv: "P-256", x: b64u(x), y: b64u(y), ext: true };
}
function derToRaw(sig) { // ECDSA DER -> r||s (64 bytes), what WebCrypto verifies
  if (sig[0] !== 0x30) throw new Error("bad signature"); let p = 2; if (sig[1] & 0x80) p = 2 + (sig[1] & 0x7f);
  const rd = () => { if (sig[p++] !== 0x02) throw new Error("bad signature"); let n = sig[p++]; let v = sig.slice(p, p + n); p += n; while (v.length > 32 && v[0] === 0) v = v.slice(1); const o = new Uint8Array(32); if (v.length > 32) throw new Error("bad signature"); o.set(v, 32 - v.length); return o; };
  const r = rd(), s = rd(); const out = new Uint8Array(64); out.set(r, 0); out.set(s, 32); return out;
}
function rpOf(request, env) { const u = new URL(request.url); return { id: env.PASSKEY_RP_ID || u.hostname, origin: env.PASSKEY_ORIGIN || u.origin, name: "Ultrastable" }; }
function checkClient(clientDataJSON, type, challengeB64u, rp) {
  const cd = JSON.parse(new TextDecoder().decode(clientDataJSON));
  if (cd.type !== type) throw new Error("wrong ceremony type");
  if (cd.challenge !== challengeB64u) throw new Error("challenge mismatch");
  if (cd.origin !== rp.origin) throw new Error("origin mismatch");
  if (cd.crossOrigin === true) throw new Error("cross-origin ceremony refused");
  return cd;
}

// ---- storage ----
let schemaDone = new WeakSet();
async function ensure(env) {
  if (schemaDone.has(env.DB)) return; await env.DB.prepare("CREATE TABLE IF NOT EXISTS passkeys(id TEXT PRIMARY KEY, sealed TEXT NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, label TEXT, created_at INTEGER NOT NULL, last_used_at INTEGER)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS passkey_challenges(id TEXT PRIMARY KEY, kind TEXT NOT NULL, expires_at INTEGER NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, stepup_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)").run();
  schemaDone.add(env.DB);
}
async function newChallenge(env, kind, now) {
  const n = (await env.DB.prepare("SELECT COUNT(*) c FROM passkey_challenges WHERE expires_at>?1").bind(now).first()).c;
  if (n >= 50) throw say("too many sign-in attempts; wait a few minutes", 429, "limit");
  await env.DB.prepare("DELETE FROM passkey_challenges WHERE expires_at<=?1").bind(now).run();
  const c = b64u(rnd(32)); await env.DB.prepare("INSERT INTO passkey_challenges(id,kind,expires_at) VALUES(?1,?2,?3)").bind(c, kind, now + CHALLENGE_MS).run(); return c;
}
async function takeChallenge(env, id, kind, now) { // single use
  const r = await env.DB.prepare("SELECT kind,expires_at FROM passkey_challenges WHERE id=?1").bind(id).first();
  await env.DB.prepare("DELETE FROM passkey_challenges WHERE id=?1").bind(id).run();
  if (!r || r.kind !== kind || r.expires_at <= now) throw say("that sign-in expired; try again");
}

// ---- sessions (shared with the dashboard worker) ----
export async function currentSubject(request, env) {
  const tok = cookieOf(request, COOKIE); if (!tok || !env || !env.DB) return null;
  let r; try { r = await env.DB.prepare("SELECT created_at,stepup_at,revoked FROM sessions WHERE hash=?1").bind(await sha256hex(tok)).first(); } catch (e) { return null; }
  if (!r || r.revoked || Date.now() - r.created_at > SESSION_MS) return null;
  return { sub: "owner", method: "session", fresh: Date.now() - r.stepup_at < STEPUP_MS };
}
async function mintSession(env, now) {
  const tok = hexOf(rnd(32)); await env.DB.prepare("INSERT INTO sessions(hash,created_at,stepup_at,revoked) VALUES(?1,?2,?2,0)").bind(await sha256hex(tok), now).run();
  return COOKIE + "=" + tok + "; Path=/; Max-Age=" + (SESSION_MS / 1000) + "; HttpOnly; Secure; SameSite=Strict";
}
const safeNext = n => { try { const u = new URL(String(n || "/owner"), "https://x.invalid"); return u.origin === "https://x.invalid" && String(n || "").startsWith("/") && !String(n).startsWith("//") ? u.pathname + u.search : "/owner"; } catch (e) { return "/owner"; } };

// ---- ceremonies ----
async function registerOptions(request, env, now) {
  const rp = rpOf(request, env); const have = (await env.DB.prepare("SELECT id FROM passkeys").all()).results || [];
  if (have.length >= MAX_PASSKEYS) return json({ error: "ten passkeys is the limit; remove one first" }, 409);
  const challenge = await newChallenge(env, "register", now);
  return json({ publicKey: { rp: { id: rp.id, name: rp.name }, user: { id: b64u(enc.encode("owner")), name: "owner", displayName: "Ultrastable owner" }, challenge, pubKeyCredParams: [{ type: "public-key", alg: -7 }], timeout: 60000,
    excludeCredentials: have.map(x => ({ type: "public-key", id: x.id })), authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" }, attestation: "none" } });
}
async function registerVerify(request, env, now) {
  const rp = rpOf(request, env); const b = await request.json(); const cdj = unb64u(b.response.clientDataJSON);
  const cd = JSON.parse(new TextDecoder().decode(cdj)); await takeChallenge(env, cd.challenge, "register", now);
  checkClient(cdj, "webauthn.create", cd.challenge, rp);
  const att = cbor(unb64u(b.response.attestationObject)); const ad = parseAuthData(att.get("authData"));
  if (!eq(ad.rpIdHash, await sha256(rp.id))) throw new Error("rp id mismatch");
  if (!ad.up || !ad.uv || !ad.at) throw new Error("user verification is required");
  const jwk = coseToJwk(ad.cose); const id = b64u(ad.credId);
  if (b.id && b.id !== id) throw new Error("credential id mismatch");
  if (await env.DB.prepare("SELECT id FROM passkeys WHERE id=?1").bind(id).first()) throw say("that passkey is already registered");
  await env.DB.prepare("INSERT INTO passkeys(id,sealed,sign_count,label,created_at) VALUES(?1,?2,?3,?4,?5)").bind(id, await seal(env, { jwk, bs: ad.bs }), ad.signCount, String(b.label || "passkey").slice(0, 60), now).run();
  return json({ ok: true, id });
}
async function loginOptions(request, env, now) {
  const rp = rpOf(request, env); const challenge = await newChallenge(env, "login", now);
  const registered = (await env.DB.prepare("SELECT COUNT(*) c FROM passkeys").first()).c;  // SIGNIN-PATHS-1: the page says plainly when no passkey was ever added, instead of a prompt that cannot succeed
  return json({ registered, publicKey: { rpId: rp.id, challenge, timeout: 60000, userVerification: "required", allowCredentials: [] } });
}
async function loginVerify(request, env, now) {
  const rp = rpOf(request, env); const b = await request.json(); const cdj = unb64u(b.response.clientDataJSON);
  const cd = JSON.parse(new TextDecoder().decode(cdj)); await takeChallenge(env, cd.challenge, "login", now);
  checkClient(cdj, "webauthn.get", cd.challenge, rp);
  const row = await env.DB.prepare("SELECT id,sealed,sign_count FROM passkeys WHERE id=?1").bind(String(b.id || "")).first(); if (!row) throw say("this passkey is not registered here");
  const authData = unb64u(b.response.authenticatorData), ad = parseAuthData(authData);
  if (!eq(ad.rpIdHash, await sha256(rp.id))) throw new Error("rp id mismatch");
  if (!ad.up || !ad.uv) throw new Error("user verification is required");
  const { jwk } = await open(env, row.sealed); const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const signed = new Uint8Array(authData.length + 32); signed.set(authData, 0); signed.set(await sha256(cdj), authData.length);
  if (!await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(unb64u(b.response.signature)), signed)) throw new Error("signature check failed");
  if ((ad.signCount || row.sign_count) && ad.signCount <= row.sign_count) throw new Error("this passkey looks cloned (counter went backwards); it was not accepted");
  await env.DB.prepare("UPDATE passkeys SET sign_count=?2,last_used_at=?3 WHERE id=?1").bind(row.id, ad.signCount, now).run();
  return json({ ok: true, next: safeNext(b.next) }, 200, { "set-cookie": await mintSession(env, now) });
}

const PAGE = (title, body) => new Response("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>" + title + "</title><style>body{font:16px system-ui;max-width:26rem;margin:5rem auto;padding:0 1rem;text-align:center}button{font:inherit;padding:.8rem 1.4rem;border-radius:.6rem;border:0;background:#111;color:#fff;cursor:pointer;width:100%}a{color:inherit}#m{min-height:1.5em;margin-top:1rem}</style><body>" + body, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'" } });
const CLIENT = "const B=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));const U=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');const $=i=>document.getElementById(i);const say=t=>$('m').textContent=t;const post=async(p,b)=>{const r=await fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{})});return{s:r.status,j:await r.json().catch(()=>({}))}};";
function signinPage(next) {
  const n = safeNext(next), q = n === "/owner" ? "" : "?next=" + encodeURIComponent(n);
  return PAGE("Sign in", "<h1>Sign in</h1><button id=mail>Email me a sign-in link</button><p id=mm></p><p id=pk><button id=go style='background:transparent;color:inherit;border:1px solid #8886'>Use a passkey instead</button></p><p id=m></p><p><a href=\"/owner" + q + "\">Type an emailed code</a></p><script>" + CLIENT + "const NEXT=" + JSON.stringify(n) +
    ";$('mail').onclick=async()=>{$('mm').textContent='Sending...';const r=await fetch('/api/owner/code',{method:'POST',headers:{'content-type':'application/json','x-us-ui':'1'},body:JSON.stringify({next:NEXT})});const j=await r.json().catch(()=>({}));$('mm').textContent=r.status==200?'Sent. Open the email and tap the link; you will land where you were going.':(j.error||'Could not send. Try again.')};" +
    "async function go(){say('');try{const o=await post('/auth/passkey/login/options');if(o.s!=200)return say(o.j.error||'Try again.');if(!o.j.registered)return say('No passkey has been added yet. Use the emailed link, then add one from the owner page.');const p=o.j.publicKey;const c=await navigator.credentials.get({publicKey:{...p,challenge:B(p.challenge)}});" +
    "const r=await post('/auth/passkey/login/verify',{id:c.id,next:NEXT,response:{clientDataJSON:U(c.response.clientDataJSON),authenticatorData:U(c.response.authenticatorData),signature:U(c.response.signature)}});if(r.s==200)location.href=r.j.next;else say(r.j.error||'That did not work. Use the emailed link.')}catch(e){say('No passkey was used. Use the emailed link instead.')}}" +
    "$('go').onclick=go;if(!window.PublicKeyCredential){$('pk').hidden=true}</script>");
}
function addPage() {
  return PAGE("Add a passkey", "<h1>Add this device</h1><p>Next time, one tap signs you in.</p><button id=go>Create a passkey</button><p id=m></p><p><a href=/owner>Back</a></p><script>" + CLIENT +
    "$('go').onclick=async()=>{say('');try{const o=await post('/auth/passkey/register/options');if(o.s!=200)return say(o.j.error||'Sign in first.');const p=o.j.publicKey;const c=await navigator.credentials.create({publicKey:{...p,challenge:B(p.challenge),user:{...p.user,id:B(p.user.id)},excludeCredentials:p.excludeCredentials.map(x=>({...x,id:B(x.id)}))}});" +
    "const r=await post('/auth/passkey/register/verify',{id:c.id,label:navigator.platform||'device',response:{clientDataJSON:U(c.response.clientDataJSON),attestationObject:U(c.response.attestationObject)}});say(r.s==200?'Done. This device now signs you in with one tap.':(r.j.error||'That did not work.'))}catch(e){say('Cancelled.')}}</script>");
}

export async function passkeys(request, env) {
  const u = new URL(request.url), p = u.pathname.replace(/\/$/, "");
  if (p !== "/auth/signin" && p !== "/auth/signout" && !p.startsWith("/auth/passkey")) return null;
  if (u.hostname !== "ultrastable.io" && u.hostname !== "www.ultrastable.io" && !u.hostname.endsWith(".workers.dev") && u.hostname !== "localhost") return null; // server-side only: the hosts this route answers on; localhost is the Worker runtime's own test origin and the system hosts nothing there
  if (!env || !env.DB) return json({ error: "database not bound" }, 503);
  const now = Date.now();
  try {
    await ensure(env);
    if (p === "/auth/signin" && request.method === "GET") return (await currentSubject(request, env)) ? Response.redirect(new URL(safeNext(u.searchParams.get("next")), u).toString(), 302) : signinPage(u.searchParams.get("next"));
    if (p === "/auth/passkey/add" && request.method === "GET") return (await currentSubject(request, env)) ? addPage() : Response.redirect(new URL("/owner", u).toString(), 302);
    if (p === "/auth/passkey/login/options" && request.method === "POST") return await loginOptions(request, env, now);
    if (p === "/auth/passkey/login/verify" && request.method === "POST") return await loginVerify(request, env, now);
    if (p === "/auth/signout" && request.method === "POST") { const tok = cookieOf(request, COOKIE); if (tok) await env.DB.prepare("UPDATE sessions SET revoked=1 WHERE hash=?1").bind(await sha256hex(tok)).run(); return json({ ok: true }, 200, { "set-cookie": COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict" }); }
    // everything below changes or lists credentials: owner session required, and a first passkey is enrolled through the email-code session
    const s = await currentSubject(request, env); if (!s) return json({ error: "sign in first" }, 401);
    if (p === "/auth/passkey/register/options" && request.method === "POST") return await registerOptions(request, env, now);
    if (p === "/auth/passkey/register/verify" && request.method === "POST") return await registerVerify(request, env, now);
    if (p === "/auth/passkey/list" && request.method === "GET") return json({ passkeys: ((await env.DB.prepare("SELECT id,label,created_at,last_used_at FROM passkeys ORDER BY created_at").all()).results || []) });
    if (p === "/auth/passkey/remove" && request.method === "POST") {
      if (!s.fresh) return json({ error: "confirm with a fresh sign-in before removing a passkey" }, 403);
      const b = await request.json(); await env.DB.prepare("DELETE FROM passkeys WHERE id=?1").bind(String(b.id || "")).run(); return json({ ok: true });
    }
    return json({ error: "not found" }, 404);
  } catch (e) { return userJson(e, "passkeys", { fallback: { code: "not_verified", status: 400, message: "That sign-in could not be verified. Please try again." } }); }  // USER-BACKEND-1: backend detail goes to the log, the person gets plain words
}
export const _test = { b64u, unb64u, cbor, sha256 };
