// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable
// OWNER-IDENTITY-1 (Rowan 2026-11-17): identity, not email, is the root of trust. The owner is whoever controls the GitHub owner account of the org.
// Sign-in is GitHub OAuth; the callback proves the GitHub login is an owner (org admin, or listed in OWNER_GITHUB_LOGINS) and then mints the session.
// Email addresses of any provider are verified contact identifiers LINKED to that identity (owner_links); every link and sign-in is appended to owner_audit.
const enc = new TextEncoder();
const hexOf = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
async function sha(s) { return hexOf(await crypto.subtle.digest("SHA-256", enc.encode(s))); }
const rnd = n => hexOf(crypto.getRandomValues(new Uint8Array(n)));
export const mask = a => { const p = String(a).split("@"); return (p[0] || "").slice(0, 2) + "…@" + (p[1] || ""); };
export async function ensure(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS owner_links(hash TEXT PRIMARY KEY, kind TEXT NOT NULL, label TEXT NOT NULL, github_login TEXT NOT NULL, linked_at INTEGER NOT NULL, method TEXT NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS owner_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, event TEXT NOT NULL, actor TEXT NOT NULL, detail TEXT)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS owner_oauth_app(id INTEGER PRIMARY KEY CHECK(id=1), client_id TEXT NOT NULL, secret_sealed TEXT NOT NULL, slug TEXT, created_at INTEGER NOT NULL)").run();
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS oauth_state(id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)").run();
}
export async function audit(env, event, actor, detail) {
  try { await ensure(env); await env.DB.prepare("INSERT INTO owner_audit(at,event,actor,detail) VALUES(?1,?2,?3,?4)").bind(Date.now(), event, String(actor).slice(0, 60), String(detail || "").slice(0, 300)).run(); }
  catch (e) { console.error("owner_audit", e && e.message); }
}
// The one-click app (manifest flow below) stores its client secret sealed with a key from a worker secret, never in plain text in D1.
async function sealKey(env) { const m = env.OWNER_SEAL_KEY || env.MAIL_RELAY_TOKEN; if (!m) return null; return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode("owner-oauth:" + m)), "AES-GCM", false, ["encrypt", "decrypt"]); }
async function sealText(env, t) { const k = await sealKey(env); if (!k) throw new Error("no seal key bound"); const iv = crypto.getRandomValues(new Uint8Array(12)); return hexOf(iv) + ":" + hexOf(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, k, enc.encode(t))); }
async function openText(env, s) { const k = await sealKey(env); const [i, c] = String(s).split(":"); const bytes = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16))); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(i) }, k, bytes(c))); }
export async function creds(env) {
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) return { id: env.GITHUB_CLIENT_ID, secret: env.GITHUB_CLIENT_SECRET };
  try { await ensure(env); const r = await env.DB.prepare("SELECT client_id,secret_sealed FROM owner_oauth_app WHERE id=1").first(); if (r) return { id: r.client_id, secret: await openText(env, r.secret_sealed) }; } catch (e) { console.error("owner_oauth_app", e && e.message); }
  return null;
}
export const configured = async env => !!(await creds(env));
export function manifest(origin, rnd = () => rand6()) { return { name: ("ultrastable-signin-" + rnd()).slice(0, 34), url: origin, redirect_url: origin + "/auth/github-signin/callback", callback_urls: [origin + "/api/owner/github/callback"], public: false, default_permissions: { emails: "read" } }; }
const rand6 = () => rnd(3);
const hold = (title, body) => new Response("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + title + "</title><style>body{font:16px system-ui;margin:0;padding:24px 16px;max-width:560px;margin-inline:auto}a,button{min-height:48px;padding:12px 18px;font:600 16px system-ui}</style></head><body><h1>" + title + "</h1>" + body + "</body></html>", { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
const jsq = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/** One click: GitHub shows its own approval page, creates the app, and the callback below stores the client id and sealed secret. */
export async function connectPage(env, origin, signedIn) {
  await ensure(env);
  if (await configured(env)) return Response.redirect(origin + "/api/owner/github", 302);
  const state = rnd(16); await env.DB.prepare("INSERT INTO oauth_state(id,created_at) VALUES(?1,?2)").bind(await sha("app:" + state), Date.now()).run();
  const org = String(env.GITHUB_REPO || "ultrastable/ultrastable").split("/")[0];
  return hold("Turn on GitHub sign-in", "<p>One approval on GitHub creates a private sign-in app for this system. Nothing to copy or paste.</p><form method=\"post\" action=\"https://github.com/organizations/" + jsq(org) + "/settings/apps/new?state=" + state + "\"><input type=\"hidden\" name=\"manifest\" value=\"" + jsq(JSON.stringify(manifest(origin))) + "\"><button type=\"submit\">Approve on GitHub</button></form>");
}
export async function appCallback(env, url) {
  const f = env.FETCH || fetch; await ensure(env);
  const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  const row = state ? await env.DB.prepare("SELECT created_at FROM oauth_state WHERE id=?1").bind(await sha("app:" + state)).first() : null;
  if (!row || Date.now() - row.created_at > 3600000 || !code) { await audit(env, "signin_app_denied", "unknown", "bad or expired state"); return hold("That link expired", "<p><a href=\"/connect/github-signin\">Start again</a></p>"); }
  await env.DB.prepare("DELETE FROM oauth_state WHERE id=?1").bind(await sha("app:" + state)).run();
  if (await configured(env)) return Response.redirect(url.origin + "/api/owner/github", 302);
  const r = await f("https://api.github.com/app-manifests/" + encodeURIComponent(code) + "/conversions", { method: "POST", headers: { accept: "application/vnd.github+json", "user-agent": "ultrastable-dashboard" } });
  if (r.status !== 201) { await audit(env, "signin_app_failed", "system", "manifest conversion HTTP " + r.status); return hold("GitHub did not finish", "<p><a href=\"/connect/github-signin\">Try again</a></p>"); }
  const j = await r.json();
  await env.DB.prepare("INSERT OR REPLACE INTO owner_oauth_app(id,client_id,secret_sealed,slug,created_at) VALUES(1,?1,?2,?3,?4)").bind(j.client_id, await sealText(env, j.client_secret), j.slug || "", Date.now()).run();
  await audit(env, "signin_app_registered", "system", "GitHub sign-in app " + (j.slug || "") + " registered; secret sealed");
  return Response.redirect(url.origin + "/api/owner/github", 302);
}
export async function start(env, origin) {
  const cr = await creds(env);
  if (!cr) { await audit(env, "github_signin_unconfigured", "system", "GITHUB_CLIENT_ID/SECRET not bound"); return { status: 302, location: origin + "/connect/github-signin" }; }
  await ensure(env);
  const state = rnd(16);
  await env.DB.prepare("INSERT INTO oauth_state(id,created_at) VALUES(?1,?2)").bind(await sha(state), Date.now()).run();
  const q = new URLSearchParams({ client_id: cr.id, redirect_uri: origin + "/api/owner/github/callback", scope: "read:org user:email", state });
  return { status: 302, location: "https://github.com/login/oauth/authorize?" + q };
}
export function ownerLogins(env) { return String(env.OWNER_GITHUB_LOGINS || "rwnq8").split(",").map(x => x.trim().toLowerCase()).filter(Boolean); }
export async function callback(env, url, mint) {
  const f = env.FETCH || fetch;
  const fail = async (why, status = 401) => { await audit(env, "github_signin_denied", "unknown", why); return { status, body: { error: "Sign-in did not go through. Try again, or use the emailed code or a passkey." } }; };
  const cr = await creds(env); if (!cr) return fail("not configured", 503);
  await ensure(env);
  const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  const row = state ? await env.DB.prepare("SELECT created_at FROM oauth_state WHERE id=?1").bind(await sha(state)).first() : null;
  if (!row || Date.now() - row.created_at > 600000 || !code) return fail("bad or expired state");
  await env.DB.prepare("DELETE FROM oauth_state WHERE id=?1").bind(await sha(state)).run();
  const tr = await f("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: cr.id, client_secret: cr.secret, code }) });
  const tok = (await tr.json().catch(() => ({}))).access_token; if (!tok) return fail("token exchange failed");
  const H = { authorization: "Bearer " + tok, accept: "application/vnd.github+json", "user-agent": "ultrastable-dashboard" };
  const me = await (await f("https://api.github.com/user", { headers: H })).json().catch(() => ({}));
  const login = String(me.login || "").toLowerCase(); if (!login) return fail("no login");
  const org = String(env.GITHUB_REPO || "ultrastable/ultrastable").split("/")[0];
  let isOwner = ownerLogins(env).includes(login);
  if (!isOwner) { const m = await (await f("https://api.github.com/orgs/" + org + "/memberships/" + login, { headers: H })).json().catch(() => ({})); isOwner = m.role === "admin" && m.state === "active"; }
  if (!isOwner) return fail("login " + login + " is not an owner");
  const em = await (await f("https://api.github.com/user/emails", { headers: H })).json().catch(() => []);
  let linked = 0;
  for (const e of Array.isArray(em) ? em : []) {
    if (!e.verified || /noreply\.github\.com$/.test(e.email)) continue;
    const h = await sha("email:" + String(e.email).toLowerCase());
    const r = await env.DB.prepare("INSERT OR IGNORE INTO owner_links(hash,kind,label,github_login,linked_at,method) VALUES(?1,'email',?2,?3,?4,'github-verified')").bind(h, mask(e.email), login, Date.now()).run();
    if (r.meta && r.meta.changes) { linked++; await audit(env, "identifier_linked", login, "email " + mask(e.email) + " verified by GitHub"); }
  }
  await audit(env, "github_signin", login, "owner session minted; " + linked + " new identifier(s) linked");
  return { status: 302, location: "/owner", cookie: await mint(env) };
}
export async function linkCount(env) { try { await ensure(env); return (await env.DB.prepare("SELECT COUNT(*) c FROM owner_links").first()).c; } catch (e) { return 0; } }
export async function auditTail(env, limit = 100) { await ensure(env); return (await env.DB.prepare("SELECT at,event,actor,detail FROM owner_audit ORDER BY id DESC LIMIT ?1").bind(limit).all()).results || []; }
