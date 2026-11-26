// MCP-OAUTH-1: Ultrastable is its own OAuth 2.1 authorization server for MCP clients (VS Code, Claude, Codex, Cursor, anything that follows the MCP authorization spec).
// Nobody copies a token: the client discovers us from a 401 (RFC 9728 -> RFC 8414), identifies itself by a Client ID Metadata Document URL (MCP 2026-07-28 direction) or by
// dynamic registration (RFC 7591, legacy fallback), and the owner approves on one consent screen behind the existing email-code owner sign-in. PKCE S256 is mandatory.
// Standards touched (anti-corruption layer: every protocol shape lives in this file): RFC 6749/6750, OAuth 2.1 draft, RFC 7636, 7591, 8414, 8707, 9728, CIMD draft.
// Storage: the shared ops database (env.DB): oauth_clients, oauth_codes, oauth_tokens. Only hashes of codes and tokens are stored.
const ORIGIN = "https://ultrastable.io";
export const RESOURCE = ORIGIN + "/mcp";
export const SCOPE = "mcp:submit";
export const PRM_URL = ORIGIN + "/.well-known/oauth-protected-resource";
const CODE_MS = 5 * 60e3, ACCESS_MS = 3600e3, REFRESH_MS = 30 * 864e5, OWNER_COOKIE = "us_owner", OWNER_SESSION_MS = 30 * 864e5;
const CORS = { "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };
const j = (o, status, extra) => new Response(JSON.stringify(o), { status: status || 200, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(extra || {}) } });
const oerr = (error, description, status) => j({ error, error_description: description }, status || 400);
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
export const sha256 = async s => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const b64url = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const rnd = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ctEq = (a, b) => { a = String(a); b = String(b); if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

export async function ensureSchema(db) {
  await db.prepare("CREATE TABLE IF NOT EXISTS oauth_clients (client_id TEXT PRIMARY KEY, name TEXT NOT NULL, redirect_uris TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS oauth_codes (hash TEXT PRIMARY KEY, client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS oauth_tokens (hash TEXT PRIMARY KEY, kind TEXT NOT NULL, family TEXT NOT NULL, client_id TEXT NOT NULL, scope TEXT NOT NULL, resource TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, used INTEGER NOT NULL DEFAULT 0)").run();
}

// ---- discovery documents ----
export const PROTECTED_RESOURCE = () => ({ resource: RESOURCE, authorization_servers: [ORIGIN], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "Ultrastable MCP", resource_documentation: ORIGIN + "/llms.txt" });
export const AUTH_SERVER = () => ({ issuer: ORIGIN, authorization_endpoint: ORIGIN + "/oauth/authorize", token_endpoint: ORIGIN + "/oauth/token", registration_endpoint: ORIGIN + "/oauth/register",
  scopes_supported: [SCOPE], response_types_supported: ["code"], response_modes_supported: ["query"], grant_types_supported: ["authorization_code", "refresh_token"],
  token_endpoint_auth_methods_supported: ["none"], code_challenge_methods_supported: ["S256"], client_id_metadata_document_supported: true, authorization_response_iss_parameter_supported: true });
export const CHALLENGE = (error) => 'Bearer resource_metadata="' + PRM_URL + '", scope="' + SCOPE + '"' + (error ? ', error="' + error + '"' : "");

// ---- clients ----
// redirect URIs: https, loopback http (any port), or a custom app scheme such as vscode: / cursor: (native clients). Never javascript:, data:, file:, or plain http on a real host.
export function redirectOk(u) {
  let x; try { x = new URL(u); } catch (e) { return false; }
  if (x.hash) return false;
  if (x.protocol === "https:") return true;
  if (x.protocol === "http:") return ["localhost", "127.0.0.1", "[::1]"].includes(x.hostname); // server-side only: an http redirect is accepted for a native OAuth client's loopback address alone (RFC 8252); the system runs nothing there
  return /^[a-z][a-z0-9+.-]*:$/.test(x.protocol) && !["javascript:", "data:", "file:", "blob:", "about:", "vbscript:", "ftp:", "ws:", "wss:"].includes(x.protocol);
}
const privateHost = h => h === "localhost" || /^\[/.test(h) || /^\d+\.\d+\.\d+\.\d+$/.test(h) || !h.includes(".") || /\.(local|internal|localhost)$/.test(h); // server-side only: SSRF guard, a loopback, private or bare host is refused as a fetch target

export async function register(request, env, now = Date.now()) {
  let b; try { b = await request.json(); } catch (e) { return oerr("invalid_client_metadata", "body must be JSON"); }
  const uris = Array.isArray(b && b.redirect_uris) ? b.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10 || !uris.every(redirectOk)) return oerr("invalid_redirect_uri", "redirect_uris must be https, loopback http, or an app scheme");
  const name = String(b.client_name || "").replace(/[^\w .@/:+-]/g, "").trim().slice(0, 80) || "MCP client";
  const id = "dcr_" + rnd(18);
  await ensureSchema(env.DB);
  await env.DB.prepare("INSERT INTO oauth_clients (client_id, name, redirect_uris, kind, created_at) VALUES (?, ?, ?, 'dcr', ?)").bind(id, name, JSON.stringify(uris), now).run();
  return j({ client_id: id, client_id_issued_at: Math.floor(now / 1000), client_name: name, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }, 201);
}

// Client ID Metadata Document: client_id is an https URL whose JSON names the client and its redirect URIs. The document is fetched (size and time capped, no private hosts) and must name itself.
export async function loadClient(env, clientId, fetchFn = fetch) {
  await ensureSchema(env.DB);
  if (/^https:\/\//.test(clientId)) {
    let u; try { u = new URL(clientId); } catch (e) { return null; }
    if (u.username || u.password || u.hash || privateHost(u.hostname) || u.pathname === "/") return null;
    let doc;
    try {
      const r = await fetchFn(clientId, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(4000) });
      if (!r.ok) return null; const t = await r.text(); if (t.length > 8192) return null; doc = JSON.parse(t);
    } catch (e) { return null; }
    if (!doc || doc.client_id !== clientId || !Array.isArray(doc.redirect_uris) || !doc.redirect_uris.length || !doc.redirect_uris.every(x => typeof x === "string" && redirectOk(x))) return null;
    if (doc.token_endpoint_auth_method && doc.token_endpoint_auth_method !== "none") return null;  // public clients only
    return { client_id: clientId, name: String(doc.client_name || u.hostname).replace(/[^\w .@/:+-]/g, "").trim().slice(0, 80) || u.hostname, redirect_uris: doc.redirect_uris, kind: "cimd" };
  }
  const row = await env.DB.prepare("SELECT client_id, name, redirect_uris, kind FROM oauth_clients WHERE client_id = ?").bind(clientId).first();
  return row ? { client_id: row.client_id, name: row.name, redirect_uris: JSON.parse(row.redirect_uris), kind: row.kind } : null;
}

// ---- owner session (the dashboard's email-code sign-in; same ops database, same cookie) ----
const cookieOf = (req, name) => { const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)")); return m ? m[1] : ""; };
async function ownerSession(env, req, now = Date.now()) {
  const tok = cookieOf(req, OWNER_COOKIE); if (!tok || !env.DB) return null;
  let r; try { r = await env.DB.prepare("SELECT hash, created_at, revoked FROM sessions WHERE hash = ?").bind(await sha256(tok)).first(); } catch (e) { return null; }
  return r && !r.revoked && now - r.created_at <= OWNER_SESSION_MS ? { tok } : null;
}
const csrf = async (tok, q) => (await sha256("oauth-consent|" + tok + "|" + q)).slice(0, 32);

// ---- authorization endpoint ----
function authParams(u) {
  const g = k => u.searchParams.get(k) || "";
  return { client_id: g("client_id"), redirect_uri: g("redirect_uri"), response_type: g("response_type"), state: g("state"), code_challenge: g("code_challenge"), code_challenge_method: g("code_challenge_method"), scope: g("scope") || SCOPE, resource: g("resource") || RESOURCE };
}
const page = (title, body, status) => new Response("<!doctype html><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\"><meta name=robots content=noindex><title>" + esc(title) + "</title><body style=\"font:16px/1.5 system-ui;max-width:30rem;margin:3rem auto;padding:0 1rem\">" + body + "</body>",
  { status: status || 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https: http: *; frame-ancestors 'none'", "referrer-policy": "no-referrer" } });
const back = (redirect, params) => { const u = new URL(redirect); for (const k in params) if (params[k]) u.searchParams.set(k, params[k]); u.searchParams.set("iss", ORIGIN); return new Response(null, { status: 302, headers: { location: u.toString(), "cache-control": "no-store" } }); };

export async function authorize(request, env, opts = {}) {
  const u = new URL(request.url), now = opts.now || Date.now(), p = authParams(u);
  if (!p.client_id || !p.redirect_uri) return page("Cannot connect", "<h1>Cannot connect</h1><p>The app did not say who it is or where to return. Nothing was approved.</p>", 400);
  const client = await loadClient(env, p.client_id, opts.fetch || fetch);
  if (!client) return page("Cannot connect", "<h1>Cannot connect</h1><p>That app could not be verified. Nothing was approved.</p>", 400);
  if (!client.redirect_uris.includes(p.redirect_uri)) return page("Cannot connect", "<h1>Cannot connect</h1><p>The return address does not match what the app registered. Nothing was approved.</p>", 400);
  // From here on errors go back to the client's redirect URI, as RFC 6749 section 4.1.2.1 requires.
  if (p.response_type !== "code") return back(p.redirect_uri, { error: "unsupported_response_type", state: p.state });
  if (p.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge)) return back(p.redirect_uri, { error: "invalid_request", error_description: "PKCE with S256 is required", state: p.state });
  if (p.resource !== RESOURCE) return back(p.redirect_uri, { error: "invalid_target", error_description: "resource must be " + RESOURCE, state: p.state });
  const sess = await ownerSession(env, request, now);
  if (!sess) return new Response(null, { status: 302, headers: { location: ORIGIN + "/owner?next=" + encodeURIComponent(u.pathname + u.search), "cache-control": "no-store" } });
  const q = u.search, tok = await csrf(sess.tok, q);
  const hidden = '<input type=hidden name=q value="' + esc(q) + '"><input type=hidden name=t value="' + tok + '">';
  return page("Connect " + client.name, "<h1>Connect " + esc(client.name) + "?</h1><p><b>" + esc(client.name) + "</b> wants to send work to Ultrastable (ideas, requests, bugs, questions) on your behalf. It can read the public record and submit work; it cannot change settings, spend money or see your private data.</p>"
    + "<p style=\"color:#555\">Returns to: " + esc(new URL(p.redirect_uri).host || new URL(p.redirect_uri).protocol) + "</p>"
    + "<form method=post action=/oauth/authorize style=\"display:flex;gap:.75rem\">" + hidden + "<button name=decision value=approve style=\"font:inherit;padding:.6rem 1.2rem\">Approve</button><button name=decision value=deny style=\"font:inherit;padding:.6rem 1.2rem\">Deny</button></form>");
}

export async function authorizeDecision(request, env, opts = {}) {
  const now = opts.now || Date.now(); let f; try { f = await request.formData(); } catch (e) { return page("Cannot connect", "<p>Bad form.</p>", 400); }
  const q = String(f.get("q") || ""), sess = await ownerSession(env, request, now);
  if (!sess) return page("Sign in first", "<h1>Sign in first</h1><p>Your sign-in expired. <a href=\"/owner\">Sign in</a>, then start the connection again from your app.</p>", 401);
  if (!ctEq(await csrf(sess.tok, q), String(f.get("t") || ""))) return page("Cannot connect", "<h1>Cannot connect</h1><p>That approval did not come from this screen. Nothing was approved.</p>", 403);
  const p = authParams(new URL(ORIGIN + "/oauth/authorize" + q));
  const client = await loadClient(env, p.client_id, opts.fetch || fetch);
  if (!client || !client.redirect_uris.includes(p.redirect_uri) || p.code_challenge_method !== "S256" || p.resource !== RESOURCE) return page("Cannot connect", "<h1>Cannot connect</h1><p>The request is no longer valid.</p>", 400);
  if (f.get("decision") !== "approve") return back(p.redirect_uri, { error: "access_denied", state: p.state });
  const code = rnd(32);
  await env.DB.prepare("INSERT INTO oauth_codes (hash, client_id, redirect_uri, challenge, scope, resource, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, ?, 0)").bind(await sha256(code), client.client_id, p.redirect_uri, p.code_challenge, SCOPE, RESOURCE, now + CODE_MS).run();
  return back(p.redirect_uri, { code, state: p.state });
}

// ---- token endpoint ----
async function issue(env, clientId, scope, family, now) {
  const access = rnd(32), refresh = rnd(32);
  await env.DB.prepare("INSERT INTO oauth_tokens (hash, kind, family, client_id, scope, resource, expires_at, revoked, used) VALUES (?, 'access', ?, ?, ?, ?, ?, 0, 0)").bind(await sha256(access), family, clientId, scope, RESOURCE, now + ACCESS_MS).run();
  await env.DB.prepare("INSERT INTO oauth_tokens (hash, kind, family, client_id, scope, resource, expires_at, revoked, used) VALUES (?, 'refresh', ?, ?, ?, ?, ?, 0, 0)").bind(await sha256(refresh), family, clientId, scope, RESOURCE, now + REFRESH_MS).run();
  return j({ access_token: access, token_type: "Bearer", expires_in: ACCESS_MS / 1000, refresh_token: refresh, scope });
}
export async function token(request, env, now = Date.now()) {
  await ensureSchema(env.DB);
  let f; try { f = new URLSearchParams(await request.text()); } catch (e) { return oerr("invalid_request", "form body required"); }
  const grant = f.get("grant_type"), clientId = f.get("client_id") || "";
  if (grant === "authorization_code") {
    const code = f.get("code") || "", verifier = f.get("code_verifier") || "";
    const row = code ? await env.DB.prepare("SELECT hash, client_id, redirect_uri, challenge, scope, resource, expires_at, used FROM oauth_codes WHERE hash = ?").bind(await sha256(code)).first() : null;
    if (!row) return oerr("invalid_grant", "unknown code");
    await env.DB.prepare("UPDATE oauth_codes SET used = 1 WHERE hash = ?").bind(row.hash).run();  // single use, burned before any check so a replay can never succeed
    if (row.used) { await env.DB.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE family = ?").bind("c:" + row.hash).run(); return oerr("invalid_grant", "code already used"); }
    if (now > row.expires_at) return oerr("invalid_grant", "code expired");
    if (row.client_id !== clientId || row.redirect_uri !== (f.get("redirect_uri") || "")) return oerr("invalid_grant", "client or redirect_uri mismatch");
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !ctEq(b64url(await crypto.subtle.digest("SHA-256", enc.encode(verifier))), row.challenge)) return oerr("invalid_grant", "PKCE verification failed");
    if (f.get("resource") && f.get("resource") !== row.resource) return oerr("invalid_target", "resource mismatch");
    return issue(env, row.client_id, row.scope, "c:" + row.hash, now);
  }
  if (grant === "refresh_token") {
    const rt = f.get("refresh_token") || "";
    const row = rt ? await env.DB.prepare("SELECT hash, family, client_id, scope, expires_at, revoked, used FROM oauth_tokens WHERE hash = ? AND kind = 'refresh'").bind(await sha256(rt)).first() : null;
    if (!row || row.client_id !== clientId) return oerr("invalid_grant", "unknown refresh token");
    if (row.revoked || row.used) { await env.DB.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE family = ?").bind(row.family).run(); return oerr("invalid_grant", "refresh token reuse; the whole grant was revoked"); }  // OAuth 2.1 rotation with reuse detection
    if (now > row.expires_at) return oerr("invalid_grant", "refresh token expired");
    await env.DB.prepare("UPDATE oauth_tokens SET used = 1 WHERE hash = ?").bind(row.hash).run();
    return issue(env, row.client_id, row.scope, row.family, now);
  }
  return oerr("unsupported_grant_type", "authorization_code or refresh_token");
}

// ---- resource side: what /mcp calls ----
// Returns { ok, name, agent, harness, via } for a valid OAuth access token, null when none was presented, { ok:false } when presented but wrong.
export async function verifyAccess(request, env, now = Date.now()) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || ""); if (!m || !env.DB) return null;
  let row; try { await ensureSchema(env.DB); row = await env.DB.prepare("SELECT t.client_id, t.scope, t.resource, t.expires_at, t.revoked, c.name, c.redirect_uris FROM oauth_tokens t LEFT JOIN oauth_clients c ON c.client_id = t.client_id WHERE t.hash = ? AND t.kind = 'access'").bind(await sha256(m[1])).first(); } catch (e) { return null; }
  if (!row) return null;  // not one of ours: the caller may still try the legacy integration token
  if (row.revoked || now > row.expires_at || row.resource !== RESOURCE) return { ok: false, error: "invalid_token" };
  if (!row.scope.split(" ").includes(SCOPE)) return { ok: false, error: "insufficient_scope" };
  let name = row.name, host = "";
  if (!name && /^https:\/\//.test(row.client_id)) { try { host = new URL(row.client_id).hostname; name = host; } catch (e) { name = "mcp-client"; } }  // CIMD clients are not stored: identity is the URL
  if (!host) { try { const ru = JSON.parse(row.redirect_uris || "[]")[0]; if (ru) { const x = new URL(ru); host = x.hostname || x.protocol.replace(":", ""); } } catch (e) { } }
  const slug = String(name || "mcp-client").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "mcp-client";
  return { ok: true, name: "oauth:" + slug, agent: slug, harness: "oauth:" + (host || "app").replace(/[^a-z0-9.-]/gi, "").slice(0, 40), via: "oauth" };
}

// ---- routes ----
export async function oauthRoute(request, env, opts = {}) {
  const u = new URL(request.url), p = u.pathname.replace(/\/$/, ""), m = request.method;
  if (p === "/.well-known/oauth-protected-resource" || p === "/.well-known/oauth-protected-resource/mcp") return j(PROTECTED_RESOURCE(), 200, { "cache-control": "public, max-age=300" });
  if (p === "/.well-known/oauth-authorization-server" || p === "/.well-known/oauth-authorization-server/mcp" || p === "/.well-known/openid-configuration") return j(AUTH_SERVER(), 200, { "cache-control": "public, max-age=300" });
  if (!p.startsWith("/oauth/")) return null;
  if (m === "OPTIONS") return new Response(null, { status: 204, headers: { ...CORS, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, authorization, mcp-protocol-version" } });
  if (!env.DB) return oerr("server_error", "ops database not bound", 503);
  if (p === "/oauth/register" && m === "POST") return register(request, env, opts.now);
  if (p === "/oauth/token" && m === "POST") return token(request, env, opts.now);
  if (p === "/oauth/authorize" && m === "GET") return authorize(request, env, opts);
  if (p === "/oauth/authorize" && m === "POST") return authorizeDecision(request, env, opts);
  return j({ error: "not_found" }, 404);
}
