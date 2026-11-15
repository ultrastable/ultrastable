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
// WBA-OUTBOUND-1: outbound fetches are signed, and a signed request verifies against our own directory.
let seen = null;
const capture = async (url, init) => { seen = { url: String(url), headers: new Headers(init.headers) }; return new Response(JSON.stringify(dir), { headers: { "content-type": wba.DIRECTORY_TYPE } }); };
await wba.signedFetch(env, target, { headers: { accept: "application/json" } }, capture, NOW);
assert.equal(seen.headers.get("accept"), "application/json", "caller headers are kept");
assert.match(seen.headers.get("signature-input") || "", /tag="web-bot-auth"/, "outbound fetch carries a signature");
assert.equal((await wba.verifyRequest(new Request(target, { headers: seen.headers }), get, NOW + 1000)).ok, true, "the outbound signature verifies");
await wba.signedFetch({}, target, {}, capture, NOW);
assert.equal(seen.headers.get("signature"), null, "no key store: the fetch still goes out, unsigned");
const fetched = await wba.fetchDirectory("https://peer.example", capture, env);
assert.equal(seen.url, "https://peer.example" + wba.DIRECTORY_PATH); assert.ok(seen.headers.get("signature"), "the directory fetch itself is signed");
assert.equal(fetched.keys[0].kid, dir.keys[0].kid);
assert.equal(await wba.fetchDirectory("https://peer.example", async () => new Response("{}"), null), null, "a body without keys is not a directory");

// directoryCache: one fetch per origin per TTL, misses cached shorter, concurrent lookups share one fetch, bounded size.
let t = 0, calls = 0;
const cache = wba.directoryCache({ ttlMs: 1000, missTtlMs: 100, max: 2, clock: () => t });
const fetcher = async (o) => { calls++; await new Promise(r => setTimeout(r, 5)); return o.includes("dead") ? null : { keys: [{ kid: o }] }; };
const [a1, a2] = await Promise.all([cache("https://a.example", fetcher), cache("https://a.example", fetcher)]);
assert.equal(calls, 1, "concurrent lookups share one fetch"); assert.deepEqual(a1, a2);
t = 999; await cache("https://a.example", fetcher); assert.equal(calls, 1, "a hit inside the TTL does not refetch");
t = 1000; await cache("https://a.example", fetcher); assert.equal(calls, 2, "past the TTL it refetches");
assert.equal(await cache("https://dead.example", fetcher), null); t = 1050; await cache("https://dead.example", fetcher); assert.equal(calls, 3, "a miss is cached");
t = 1200; await cache("https://dead.example", fetcher); assert.equal(calls, 4, "a miss is cached only missTtlMs");
assert.equal(await cache("https://b.example", async () => { throw new Error("boom"); }), null, "a throwing fetcher is a miss, never an error");
assert.ok(cache.size() <= 2, "bounded to max origins");
console.log("webbotauth: sign, verify and publish directory ok");
