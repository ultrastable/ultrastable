// MCP-OAUTH-1: the whole flow an MCP client performs, against a real SQLite database: 401 challenge -> discovery -> registration (DCR and CIMD) -> consent behind the owner session -> PKCE token -> refresh rotation -> submit_work.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";
const mod = (await import(pathToFileURL(fileURLToPath(new URL("./worker.js", import.meta.url))).href)).default;
const oa = await import(pathToFileURL(fileURLToPath(new URL("./oauth.js", import.meta.url))).href);
globalThis.fetch = async () => { throw new Error("offline"); };
const raw = new DatabaseSync(":memory:");
const d1 = { prepare(sql) { let a = []; const st = { bind(...x) { a = x; return st; }, all: async () => ({ results: raw.prepare(sql).all(...a) }), first: async () => raw.prepare(sql).get(...a) || null, run: async () => raw.prepare(sql).run(...a) }; return st; } };
raw.exec("CREATE TABLE sessions(hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL, stepup_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)");
raw.exec("CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'work', project TEXT, owner_role TEXT NOT NULL, trigger_on TEXT, done_check TEXT NOT NULL, closing_probe TEXT, priority INTEGER NOT NULL DEFAULT 50, status TEXT NOT NULL DEFAULT 'open', surface TEXT, disposition TEXT, blocker TEXT)");
const OWNER_TOKEN = "owner-session-token";
raw.prepare("INSERT INTO sessions VALUES (?, ?, ?, 0)").run(await oa.sha256(OWNER_TOKEN), Date.now(), Date.now());
const ENV = { DB: d1, ORG: d1, ASSETS: { get: async () => null, list: async () => ({ keys: [] }) } };
const go = (path, init) => mod.fetch(new Request("https://ultrastable.io" + path, init), ENV);
const b64u = b => Buffer.from(b).toString("base64url");
const verifier = b64u(Buffer.alloc(32, 7)), challenge = b64u(createHash("sha256").update(verifier).digest());
const rpc = (body, auth) => go("/mcp", { method: "POST", headers: { ...(auth ? { authorization: "Bearer " + auth } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }) });
const submit = (auth, args) => rpc({ method: "tools/call", params: { name: "submit_work", arguments: { title: "From OAuth", kind: "idea", ...(args || {}) } } }, auth);

// 1. unauthenticated write: 401 with the RFC 9728 challenge; discovery documents resolve
let r = await submit(null);
assert.equal(r.status, 401); assert.match(r.headers.get("www-authenticate"), /^Bearer resource_metadata="https:\/\/ultrastable\.io\/\.well-known\/oauth-protected-resource"/);
const prm = await (await go("/.well-known/oauth-protected-resource")).json(); assert.equal(prm.resource, "https://ultrastable.io/mcp"); assert.deepEqual(prm.authorization_servers, ["https://ultrastable.io"]);
const as = await (await go("/.well-known/oauth-authorization-server")).json();
assert.deepEqual(as.code_challenge_methods_supported, ["S256"]); assert.equal(as.client_id_metadata_document_supported, true); assert.ok(as.registration_endpoint && as.token_endpoint && as.authorization_endpoint);
assert.equal((await go("/.well-known/oauth-protected-resource/mcp")).status, 200);

// 2. dynamic registration (legacy fallback): bad redirects refused, good one accepted
r = await go("/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["http://evil.example/cb"] }) }); assert.equal(r.status, 400);
r = await go("/oauth/register", { method: "POST", body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }) }); assert.equal(r.status, 400);
r = await go("/oauth/register", { method: "POST", body: JSON.stringify({ client_name: "Visual Studio Code", redirect_uris: ["http://127.0.0.1:33418/", "https://vscode.dev/redirect"] }) }); assert.equal(r.status, 201);
const client = await r.json(); assert.match(client.client_id, /^dcr_/);
const REDIR = "http://127.0.0.1:33418/";
const q = (o) => "?" + new URLSearchParams({ response_type: "code", client_id: client.client_id, redirect_uri: REDIR, code_challenge: challenge, code_challenge_method: "S256", state: "xyz", resource: "https://ultrastable.io/mcp", ...o }).toString();

// 3. authorize: no PKCE / wrong resource go back to the client with an error; unknown redirect never redirects
r = await go("/oauth/authorize" + q({ code_challenge_method: "plain" })); assert.equal(r.status, 302); assert.match(r.headers.get("location"), /error=invalid_request/);
r = await go("/oauth/authorize" + q({ resource: "https://evil.example/mcp" })); assert.match(r.headers.get("location"), /error=invalid_target/);
r = await go("/oauth/authorize" + q({ redirect_uri: "http://127.0.0.1:1/other" })); assert.equal(r.status, 400, "unregistered redirect_uri is never followed");
r = await go("/oauth/authorize" + q()); assert.equal(r.status, 302); assert.match(r.headers.get("location"), /^https:\/\/ultrastable\.io\/owner\?next=%2Foauth%2Fauthorize%3F/);
const ck = { cookie: "us_owner=" + OWNER_TOKEN };
r = await go("/oauth/authorize" + q(), { headers: ck }); assert.equal(r.status, 200); const html = await r.text(); assert.match(html, /Connect Visual Studio Code\?/); assert.match(r.headers.get("x-frame-options"), /DENY/);
const form = (o) => ({ method: "POST", headers: { ...ck, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
const qs = q(), t = /name=t value="([0-9a-f]+)"/.exec(html)[1];
assert.equal((await go("/oauth/authorize", form({ q: qs, t: "0".repeat(32), decision: "approve" }))).status, 403, "forged consent is refused");
assert.equal((await go("/oauth/authorize", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ q: qs, t, decision: "approve" }).toString() })).status, 401, "no owner session, no approval");
r = await go("/oauth/authorize", form({ q: qs, t, decision: "deny" })); assert.match(r.headers.get("location"), /error=access_denied/);
r = await go("/oauth/authorize", form({ q: qs, t, decision: "approve" })); assert.equal(r.status, 302);
const back = new URL(r.headers.get("location")); const code = back.searchParams.get("code"); assert.ok(code); assert.equal(back.searchParams.get("state"), "xyz"); assert.equal(back.searchParams.get("iss"), "https://ultrastable.io");

// 4. token: PKCE enforced, code single use, mismatches refused
const tok = (o) => go("/oauth/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });
r = await tok({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIR, code_verifier: b64u(Buffer.alloc(32, 9)) }); assert.equal(r.status, 400); assert.match((await r.json()).error_description, /PKCE/);
r = await tok({ grant_type: "authorization_code", code, client_id: client.client_id, redirect_uri: REDIR, code_verifier: verifier }); assert.equal(r.status, 400, "a failed attempt burns the code");
r = await go("/oauth/authorize", form({ q: qs, t, decision: "approve" })); const code2 = new URL(r.headers.get("location")).searchParams.get("code");
r = await tok({ grant_type: "authorization_code", code: code2, client_id: client.client_id, redirect_uri: "http://127.0.0.1:1/x", code_verifier: verifier }); assert.equal(r.status, 400, "redirect_uri must match");
r = await go("/oauth/authorize", form({ q: qs, t, decision: "approve" })); const code3 = new URL(r.headers.get("location")).searchParams.get("code");
r = await tok({ grant_type: "authorization_code", code: code3, client_id: client.client_id, redirect_uri: REDIR, code_verifier: verifier }); assert.equal(r.status, 200);
const tk = await r.json(); assert.equal(tk.token_type, "Bearer"); assert.equal(tk.expires_in, 3600); assert.ok(tk.access_token && tk.refresh_token);

// 5. submit_work with the OAuth token: identity comes from the approved client, no agent/harness typed
r = await submit(tk.access_token); assert.equal(r.status, 200); const res = JSON.parse((await r.json()).result.content[0].text);
assert.match(res.id, /^IN-/); const row = raw.prepare("SELECT surface, kind FROM items WHERE id = ?").get(res.id);
assert.equal(row.surface, "integration:oauth:visual-studio-code agent:visual-studio-code harness:oauth:127.0.0.1"); assert.equal(row.kind, "intake-idea");
r = await submit("not-a-token"); assert.ok([401, 403].includes(r.status)); assert.ok(r.headers.get("www-authenticate"));

// 6. refresh rotation with reuse detection
r = await tok({ grant_type: "refresh_token", refresh_token: tk.refresh_token, client_id: client.client_id }); assert.equal(r.status, 200); const tk2 = await r.json(); assert.notEqual(tk2.refresh_token, tk.refresh_token);
assert.equal((await submit(tk2.access_token)).status, 200);
r = await tok({ grant_type: "refresh_token", refresh_token: tk.refresh_token, client_id: client.client_id }); assert.equal(r.status, 400, "old refresh token is dead");
r = await submit(tk2.access_token); assert.equal(r.status, 401, "reuse revoked the whole grant"); assert.match(r.headers.get("www-authenticate"), /invalid_token/);

// 7. expiry
raw.prepare("INSERT INTO oauth_tokens (hash, kind, family, client_id, scope, resource, expires_at) VALUES (?, 'access', 'f', ?, 'mcp:submit', 'https://ultrastable.io/mcp', ?)").run(await oa.sha256("old"), client.client_id, Date.now() - 1);
assert.equal((await submit("old")).status, 401);

// 8. Client ID Metadata Document: fetched, must name itself, public clients only, no private hosts
const CID = "https://client.example.com/oauth/metadata.json", doc = { client_id: CID, client_name: "Cursor", redirect_uris: ["cursor://anysphere.cursor-mcp/oauth/callback"], token_endpoint_auth_method: "none" };
const mk = (d) => async () => ({ ok: true, text: async () => JSON.stringify(d) });
assert.equal((await oa.loadClient(ENV, CID, mk(doc))).name, "Cursor");
assert.equal(await oa.loadClient(ENV, CID, mk({ ...doc, client_id: "https://other.example.com/x" })), null, "document must name itself");
assert.equal(await oa.loadClient(ENV, CID, mk({ ...doc, redirect_uris: ["http://evil.example/cb"] })), null);
assert.equal(await oa.loadClient(ENV, CID, mk({ ...doc, token_endpoint_auth_method: "client_secret_basic" })), null);
for (const bad of ["https://localhost/x.json", "https://10.0.0.1/x.json", "https://intranet/x.json", "https://client.example.com/"]) assert.equal(await oa.loadClient(ENV, bad, mk(doc)), null, bad); // server-side only: SSRF guard, loopback is rejected, never a host
assert.equal(await oa.loadClient(ENV, CID, async () => { throw new Error("net"); }), null);
{ const rr = await oa.oauthRoute(new Request("https://ultrastable.io/oauth/authorize" + q({ client_id: CID, redirect_uri: doc.redirect_uris[0] }), { headers: ck }), ENV, { fetch: mk(doc) }); assert.equal(rr.status, 200); assert.match(await rr.text(), /Connect Cursor\?/); }

// 9. the legacy integration token still works for non-interactive callers
{ const h = createHash("sha256").update("legacy").digest("hex"); const E2 = { ...ENV, INTEGRATION_TOKENS: "bot:" + h };
  const rr = await mod.fetch(new Request("https://ultrastable.io/mcp", { method: "POST", headers: { authorization: "Bearer legacy" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_work", arguments: { title: "legacy", agent: "ci", harness: "cli" } } }) }), E2);
  assert.equal(rr.status, 200); assert.equal(raw.prepare("SELECT surface FROM items WHERE title LIKE '%legacy'").get().surface, "integration:bot agent:ci harness:cli"); }
console.log("mcp-oauth ok");
