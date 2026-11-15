// CONNECTIONS-1: the owner-only screen that lists linked services and agents with access, and revokes either.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL, fileURLToPath } from "node:url";
const { connectionsRoute, listAgents, revokeAgent, renderConnections } = await import(pathToFileURL(fileURLToPath(new URL("./connections.js", import.meta.url))).href);

function d1(db) {
  return { prepare(sql) { let args = []; const st = { bind(...a) { args = a; return st; },
    all: async () => ({ results: db.prepare(sql).all(...args) }), first: async () => db.prepare(sql).get(...args) || null,
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; } }; return st; } };
}
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE oauth_clients (client_id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE oauth_tokens (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, family TEXT NOT NULL, client_id TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0);
INSERT INTO oauth_clients VALUES ('c1','VS Code <b>Copilot</b>','[]','dcr',1);
INSERT INTO oauth_tokens VALUES ('h1','access','f','c1','mcp:submit','r',9999999999999,0,0),('h2','refresh','f','c1','mcp:submit','r',9999999999999,0,0),('h3','access','g','https://cimd.example/c','mcp:submit','r',9999999999999,0,0),('h4','access','x','old','mcp:submit','r',1,0,0);`);
const calls = [];
const TICK = { fetch: async (req) => { const u = new URL(req.url); calls.push(req.method + " " + u.pathname + u.search);
  if (u.pathname === "/auth/connectors") return Response.json({ linked: [{ provider: "oauth:google", kind: "oauth", status: "ok", expires_at: "2026-11-15T10:00:00Z" }, { provider: "oauth:mcp:ex.com", kind: "mcp", server: "https://ex.com/mcp", status: "ok" }, { provider: "github-app", kind: "github-app", status: "ok" }], available: [{ id: "google", title: "Google", connect: "/connect/google", ready: true, linked: true }, { id: "microsoft", title: "Microsoft", connect: "/connect/microsoft", ready: false, linked: false }, { id: "mcp", title: "MCP", connect: "/connect/mcp", ready: true, linked: false }] });
  return new Response("tick:" + u.pathname, { status: 200 }); } };
const env = { DB: d1(db), TICK };
const NOW = 1000;
const R = (path, init) => new Request("https://ultrastable.io" + path, init);
const signedIn = async () => ({ sub: "owner", method: "session", fresh: true }), anon = async () => null;
const form = o => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o).toString() });

// unrelated paths and foreign hosts are not ours
assert.equal(await connectionsRoute(R("/pricing"), env, { subject: signedIn }), null);
assert.equal(await connectionsRoute(new Request("https://evil.example/connections"), env, { subject: signedIn }), null);

// anonymous visitors are sent to sign in, never shown or proxied anything
let r = await connectionsRoute(R("/connections"), env, { subject: anon, now: NOW }); assert.equal(r.status, 302); assert.match(r.headers.get("location"), /\/auth\/signin\?next=/);
r = await connectionsRoute(R("/connect/google/start"), env, { subject: anon }); assert.equal(r.status, 302); assert.equal(calls.length, 0, "no tick call without a session");
r = await connectionsRoute(R("/connections/agent/revoke", form({ client_id: "c1" })), env, { subject: anon }); assert.equal(r.status, 302);
assert.equal(db.prepare("SELECT COUNT(*) n FROM oauth_tokens WHERE revoked=1").get().n, 0, "anonymous revoke changed nothing");

// the page lists services and agents; HTML is escaped; nothing asks for a token
r = await connectionsRoute(R("/connections"), env, { subject: signedIn, now: NOW }); assert.equal(r.status, 200);
const html = await r.text();
assert.match(html, /oauth:google/); assert.match(html, /https:\/\/ex\.com\/mcp/); assert.match(html, /Connect any MCP server/); assert.match(html, /waiting for its one-time app registration/);
assert.match(html, /VS Code &lt;b&gt;Copilot&lt;\/b&gt;/); assert.doesNotMatch(html, /<b>Copilot/); assert.match(html, /2 active sign-ins/); assert.match(html, /https:\/\/cimd\.example\/c/);
assert.doesNotMatch(html, /\bpaste\b/i); assert.doesNotMatch(html, /name="provider" value="github-app"/, "github-app has no disconnect here");
assert.equal((await listAgents(env, NOW)).find(a => a.client_id === "old"), undefined, "expired tokens are not active access");

// revoke an agent: only its tokens, same-origin only
r = await connectionsRoute(R("/connections/agent/revoke", { ...form({ client_id: "c1" }), headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example" } }), env, { subject: signedIn }); assert.equal(r.status, 403);
assert.equal(db.prepare("SELECT COUNT(*) n FROM oauth_tokens WHERE revoked=1").get().n, 0);
r = await connectionsRoute(R("/connections/agent/revoke", form({ client_id: "c1" })), env, { subject: signedIn }); assert.equal(r.status, 303);
assert.equal(db.prepare("SELECT COUNT(*) n FROM oauth_tokens WHERE client_id='c1' AND revoked=1").get().n, 2);
assert.equal(db.prepare("SELECT COUNT(*) n FROM oauth_tokens WHERE client_id<>'c1' AND revoked=1").get().n, 0, "other agents untouched");
assert.equal(await revokeAgent(env, "c1"), 0, "idempotent");

// disconnect a service goes to the tick Worker's own disconnect route
calls.length = 0;
r = await connectionsRoute(R("/connections/service/disconnect", form({ provider: "oauth:google", kind: "oauth" })), env, { subject: signedIn }); assert.equal(r.status, 303); assert.deepEqual(calls, ["POST /connect/google/disconnect"]);
calls.length = 0;
r = await connectionsRoute(R("/connections/service/disconnect", form({ provider: "oauth:mcp:ex.com", kind: "mcp" })), env, { subject: signedIn }); assert.equal(r.status, 303); assert.deepEqual(calls, ["POST /connect/mcp/disconnect?provider=oauth%3Amcp%3Aex.com"]);
r = await connectionsRoute(R("/connections/service/disconnect", form({ provider: "github-app", kind: "github-app" })), env, { subject: signedIn }); assert.equal(r.status, 400);

// the consent flow is proxied for the signed-in owner; the provider callback (own signed state, cookie-less cross-site return) is proxied without a session
calls.length = 0;
r = await connectionsRoute(R("/connect/google/start"), env, { subject: signedIn }); assert.equal(await r.text(), "tick:/connect/google/start");
r = await connectionsRoute(R("/connect/google/callback?code=x&state=y"), env, { subject: anon }); assert.equal(await r.text(), "tick:/connect/google/callback");
assert.equal(renderConnections({ linked: [], available: [] }, []).includes("No services linked yet"), true);
console.log("connections ok");
