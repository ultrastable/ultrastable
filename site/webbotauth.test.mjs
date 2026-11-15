// WEB-BOT-AUTH-1: sign outbound, verify inbound, publish the key directory; real Ed25519 over a real SQLite handle.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL, fileURLToPath } from "node:url";
const wba = await import(pathToFileURL(fileURLToPath(new URL("./webbotauth.js", import.meta.url))).href);
const agentic = await import(pathToFileURL(fileURLToPath(new URL("./agentic.js", import.meta.url))).href);
const db = new DatabaseSync(":memory:");
const ORG = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; }, all: async () => ({ results: db.prepare(sql).all(...a) }), first: async () => db.prepare(sql).get(...a) || null, run: async () => db.prepare(sql).run(...a) }; return st; } };
const env = { ORG };

const dirRes = await agentic.agentic(new Request("https://ultrastable.io" + wba.DIRECTORY_PATH), env);
assert.equal(dirRes.headers.get("content-type"), wba.DIRECTORY_TYPE);
const dir = await dirRes.json(); assert.equal(dir.keys.length, 1); assert.equal(dir.keys[0].kid, await wba.thumbprint(dir.keys[0]));
assert.equal(dir.keys[0].d, undefined, "the private key never leaves the database");
assert.deepEqual((await wba.directory(env)).keys[0], dir.keys[0], "the key is stable across calls");

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0), target = "https://peer.example/api";
const hdrs = await wba.signRequest(env, target, NOW);
assert.match(hdrs["signature-input"], /tag="web-bot-auth"/);
const req = (h, url = target) => new Request(url, { headers: h });
const get = async () => dir;
let r = await wba.verifyRequest(req(hdrs), get, NOW + 1000); assert.equal(r.ok, true); assert.equal(r.agent, "https://ultrastable.io"); assert.equal(r.keyid, dir.keys[0].kid);
assert.equal((await wba.verifyRequest(req(hdrs, "https://other.example/api"), get, NOW + 1000)).ok, false, "bound to the authority it was signed for");
assert.equal((await wba.verifyRequest(req(hdrs), get, NOW + 400e3)).reason, "signature outside its validity window");
assert.equal((await wba.verifyRequest(req({ ...hdrs, signature: "sig1=:" + btoa("x".repeat(64)) + ":" }), get, NOW + 1000)).reason, "signature does not verify");
assert.equal((await wba.verifyRequest(req({ ...hdrs, "signature-agent": '"https://evil.example"' }), get, NOW + 1000)).ok, false, "tampered signature-agent");
assert.equal((await wba.verifyRequest(req({}), get, NOW)).reason, "unsigned");
assert.equal((await wba.verifyRequest(req(hdrs), async () => ({ keys: [] }), NOW + 1000)).reason, "key not in the agent's directory");
assert.equal((await wba.verifyRequest(req({ ...hdrs, "signature-agent": '"http://plain.example"' }), get, NOW + 1000)).reason, "signature-agent must be an https origin");
console.log("webbotauth: sign, verify and publish directory ok");
