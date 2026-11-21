// PASSKEYS-1: a software authenticator drives the real WebAuthn ceremonies against site/passkeys.js and the real worker route, on a real SQLite database.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL, fileURLToPath } from "node:url";
const here = p => pathToFileURL(fileURLToPath(new URL(p, import.meta.url))).href;
const mod = (await import(here("./worker.js"))).default;
const pk = await import(here("./passkeys.js"));
globalThis.fetch = async () => { throw new Error("offline"); };

function d1(db) { return { prepare(sql) { let args = []; const st = { bind(...a) { args = a; return st; }, all: async () => ({ results: db.prepare(sql).all(...args) }), first: async () => db.prepare(sql).get(...args) || null, run: async () => db.prepare(sql).run(...args) }; return st; } }; }
const db = new DatabaseSync(":memory:"); const DB = d1(db);
const KEY = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
const ENV = { DB, CREDENTIAL_KEY: KEY, ASSETS: { get: async () => null, list: async () => ({ keys: [] }) } };
const ORIGIN = "https://ultrastable.io", RP = "ultrastable.io";
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = pk._test.unb64u, sha = pk._test.sha256, enc = new TextEncoder();
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };
// tiny CBOR encoder (the authenticator's side)
const head = (mt, n) => n < 24 ? [mt << 5 | n] : n < 256 ? [mt << 5 | 24, n] : [mt << 5 | 25, n >> 8, n & 255];
const C = v => v instanceof Uint8Array ? cat(Uint8Array.from(head(2, v.length)), v) : typeof v === "string" ? cat(Uint8Array.from(head(3, enc.encode(v).length)), enc.encode(v)) : typeof v === "number" ? Uint8Array.from(v >= 0 ? head(0, v) : head(1, -1 - v))
  : v instanceof Map ? cat(Uint8Array.from(head(5, v.size)), ...[...v].flatMap(([k, x]) => [C(k), C(x)])) : (() => { throw new Error("enc"); })();
// DER-encode r||s like a real authenticator
const der = raw => { const t = x => { let i = 0; while (i < x.length - 1 && x[i] === 0) i++; let v = x.slice(i); if (v[0] & 0x80) v = cat(Uint8Array.of(0), v); return cat(Uint8Array.of(2, v.length), v); }; const r = t(raw.slice(0, 32)), s = t(raw.slice(32)); return cat(Uint8Array.of(0x30, r.length + s.length), r, s); };

class Authenticator {
  async init() { this.kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]); this.id = crypto.getRandomValues(new Uint8Array(16)); this.counter = 0; return this; }
  async create(opts, origin = ORIGIN, flags = 0x45) {
    const jwk = await crypto.subtle.exportKey("jwk", this.kp.publicKey);
    const cose = C(new Map([[1, 2], [3, -7], [-1, 1], [-2, unb64u(jwk.x)], [-3, unb64u(jwk.y)]]));
    const authData = cat(await sha(opts.rp.id), Uint8Array.of(flags), new Uint8Array(4), new Uint8Array(16), Uint8Array.of(0, this.id.length), this.id, cose);
    const cdj = enc.encode(JSON.stringify({ type: "webauthn.create", challenge: opts.challenge, origin }));
    return { id: b64u(this.id), response: { clientDataJSON: b64u(cdj), attestationObject: b64u(C(new Map([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]))) } };
  }
  async get(opts, { origin = ORIGIN, counter = ++this.counter, flags = 0x05, type = "webauthn.get" } = {}) {
    const authData = cat(await sha(opts.rpId), Uint8Array.of(flags), Uint8Array.of(counter >>> 24, counter >>> 16 & 255, counter >>> 8 & 255, counter & 255));
    const cdj = enc.encode(JSON.stringify({ type, challenge: opts.challenge, origin }));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, this.kp.privateKey, cat(authData, await sha(cdj))));
    return { id: b64u(this.id), response: { clientDataJSON: b64u(cdj), authenticatorData: b64u(authData), signature: b64u(der(sig)) } };
  }
}
const call = (path, body, cookie, method) => mod.fetch(new Request(ORIGIN + path, { method: method || (body === undefined ? "GET" : "POST"), headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), ENV);
const J = async r => ({ s: r.status, j: await r.json().catch(() => ({})), h: r.headers });

// the email-code login (dashboard worker) writes this row and cookie; here we stand in for it
const hex = async s => [...await sha(s)].map(x => x.toString(16).padStart(2, "0")).join("");
db.exec("CREATE TABLE sessions(hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, stepup_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)");
const ownerCookie = async (stepupAgeMs = 0) => { const tok = "t" + Math.random().toString(16).slice(2).padEnd(30, "0"); db.prepare("INSERT INTO sessions VALUES (?,?,?,0)").run(await hex(tok), Date.now(), Date.now() - stepupAgeMs); return "us_owner=" + tok; };

// 1. no session: sign-in page loads, credential routes refuse
let r = await call("/auth/signin"); assert.equal(r.status, 200); assert.match(await r.text(), /Email me a sign-in link[\s\S]*Use a passkey instead/);
assert.equal((await J(await call("/auth/passkey/register/options", {}))).s, 401, "enrolment needs the email-code session");
assert.equal((await J(await call("/auth/passkey/list"))).s, 401);
assert.equal(await pk.currentSubject(new Request(ORIGIN + "/x"), ENV), null);

// 2. enrol a passkey from an owner session
const auth = await new Authenticator().init(), ck = await ownerCookie();
let o = await J(await call("/auth/passkey/register/options", {}, ck)); assert.equal(o.s, 200);
assert.equal(o.j.publicKey.rp.id, RP); assert.equal(o.j.publicKey.authenticatorSelection.userVerification, "required"); assert.equal(o.j.publicKey.attestation, "none");
let reg = await auth.create(o.j.publicKey);
assert.equal((await J(await call("/auth/passkey/register/verify", reg, ck))).s, 200);
const stored = db.prepare("SELECT sealed FROM passkeys").get().sealed; assert.match(stored, /^[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/); assert.ok(!stored.includes(reg.id), "credential material is sealed");
assert.equal((await J(await call("/auth/passkey/register/verify", reg, ck))).s, 400, "a challenge is single use");
o = await J(await call("/auth/passkey/register/options", {}, ck)); assert.equal(o.j.publicKey.excludeCredentials.length, 1, "already-registered devices are excluded");
// refusals: wrong origin, no user verification
for (const [bad, why] of [[{ origin: "https://evil.example" }, "origin"], [{ flags: 0x41 }, "uv"]]) {
  const a2 = await new Authenticator().init(); const o2 = await J(await call("/auth/passkey/register/options", {}, ck));
  assert.equal((await J(await call("/auth/passkey/register/verify", await a2.create(o2.j.publicKey, bad.origin || ORIGIN, bad.flags || 0x45), ck))).s, 400, "register refused: " + why);
}

// 3. one-tap sign-in: no cookie in, session cookie out, usable as the OAuth subject
const lo = await J(await call("/auth/passkey/login/options", {})); assert.equal(lo.j.publicKey.rpId, RP); assert.deepEqual(lo.j.publicKey.allowCredentials, []);
const assertion = await auth.get(lo.j.publicKey);
const lv = await J(await call("/auth/passkey/login/verify", { ...assertion, next: "/oauth/authorize?x=1" }));
assert.equal(lv.s, 200); assert.equal(lv.j.next, "/oauth/authorize?x=1");
const sc = lv.h.get("set-cookie"); assert.match(sc, /^us_owner=[0-9a-f]{64}; .*HttpOnly; Secure; SameSite=Strict/);
const subj = await pk.currentSubject(new Request(ORIGIN + "/x", { headers: { cookie: sc.split(";")[0] } }), ENV); assert.equal(subj.sub, "owner"); assert.equal(subj.fresh, true);
assert.equal((await J(await call("/auth/passkey/login/verify", assertion))).s, 400, "replayed assertion is refused (challenge consumed)");
assert.equal((await call("/auth/signin", undefined, sc.split(";")[0])).status, 302, "signed in: the sign-in page forwards");

// 4. attacks
const bad = async (mut, opts) => { const x = await J(await call("/auth/passkey/login/options", {})); const a = await auth.get(x.j.publicKey, opts); return (await J(await call("/auth/passkey/login/verify", mut ? mut(a) : a))).s; };
assert.equal(await bad(null, { origin: "https://evil.example" }), 400, "wrong origin");
assert.equal(await bad(null, { type: "webauthn.create" }), 400, "wrong ceremony");
assert.equal(await bad(null, { flags: 0x01 }), 400, "no user verification");
assert.equal(await bad(null, { counter: 1 }), 400, "counter did not advance (cloned authenticator)");
assert.equal(await bad(a => ({ ...a, id: b64u(crypto.getRandomValues(new Uint8Array(16))) })), 400, "unknown credential");
assert.equal(await bad(a => { const s = unb64u(a.response.signature).slice(); s[s.length - 1] ^= 1; return { ...a, response: { ...a.response, signature: b64u(s) } }; }), 400, "tampered signature");
const other = await new Authenticator().init(); other.id = auth.id; // someone else's key under our credential id
const lo2 = await J(await call("/auth/passkey/login/options", {})); assert.equal((await J(await call("/auth/passkey/login/verify", await other.get(lo2.j.publicKey, { counter: 99 })))).s, 400, "foreign key");
assert.equal((await J(await call("/auth/passkey/login/verify", await auth.get((await J(await call("/auth/passkey/login/options", {}))).j.publicKey, { counter: 50 })))).s, 200, "a later valid sign-in still works");

// 5. sealed storage needs its key; open redirect is closed; removal needs a fresh sign-in
const noKey = { ...ENV, CREDENTIAL_KEY: undefined }; const a3 = await new Authenticator().init();
const o3 = await (await mod.fetch(new Request(ORIGIN + "/auth/passkey/register/options", { method: "POST", headers: { cookie: ck } }), noKey)).json();
assert.equal((await mod.fetch(new Request(ORIGIN + "/auth/passkey/register/verify", { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: JSON.stringify(await a3.create(o3.publicKey)) }), noKey)).status, 400, "no CREDENTIAL_KEY, no storage");
const lo3 = await J(await call("/auth/passkey/login/options", {})); const ev = await J(await call("/auth/passkey/login/verify", { ...(await auth.get(lo3.j.publicKey, { counter: 60 })), next: "//evil.example/x" })); assert.equal(ev.j.next, "/owner");
const stale = await ownerCookie(3600e3); const ls = await J(await call("/auth/passkey/list", undefined, stale)); assert.equal(ls.j.passkeys.length, 1);
assert.equal((await J(await call("/auth/passkey/remove", { id: reg.id }, stale))).s, 403, "removal needs a fresh sign-in");
assert.equal((await J(await call("/auth/passkey/remove", { id: reg.id }, ck))).s, 200); assert.equal(db.prepare("SELECT COUNT(*) c FROM passkeys").get().c, 0);
assert.equal((await J(await call("/auth/signout", {}, sc.split(";")[0]))).s, 200); assert.equal(await pk.currentSubject(new Request(ORIGIN + "/x", { headers: { cookie: sc.split(";")[0] } }), ENV), null, "signed out");
assert.equal((await mod.fetch(new Request("https://example.com/auth/signin"), ENV)).status !== 500, true);
console.log("passkeys ok");
