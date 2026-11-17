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
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS oauth_state(id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)").run();
}
export async function audit(env, event, actor, detail) {
  try { await ensure(env); await env.DB.prepare("INSERT INTO owner_audit(at,event,actor,detail) VALUES(?1,?2,?3,?4)").bind(Date.now(), event, String(actor).slice(0, 60), String(detail || "").slice(0, 300)).run(); }
  catch (e) { console.error("owner_audit", e && e.message); }
}
export const configured = env => !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
export async function start(env, origin) {
  if (!configured(env)) { await audit(env, "github_signin_unconfigured", "system", "GITHUB_CLIENT_ID/SECRET not bound"); return { status: 503, body: { error: "GitHub sign-in is not set up yet. Use the emailed code or a passkey." } }; }
  await ensure(env);
  const state = rnd(16);
  await env.DB.prepare("INSERT INTO oauth_state(id,created_at) VALUES(?1,?2)").bind(await sha(state), Date.now()).run();
  const q = new URLSearchParams({ client_id: env.GITHUB_CLIENT_ID, redirect_uri: origin + "/api/owner/github/callback", scope: "read:org user:email", state });
  return { status: 302, location: "https://github.com/login/oauth/authorize?" + q };
}
export function ownerLogins(env) { return String(env.OWNER_GITHUB_LOGINS || "rwnq8").split(",").map(x => x.trim().toLowerCase()).filter(Boolean); }
export async function callback(env, url, mint) {
  const f = env.FETCH || fetch;
  const fail = async (why, status = 401) => { await audit(env, "github_signin_denied", "unknown", why); return { status, body: { error: "Sign-in did not go through. Try again, or use the emailed code or a passkey." } }; };
  if (!configured(env)) return fail("not configured", 503);
  await ensure(env);
  const state = url.searchParams.get("state") || "", code = url.searchParams.get("code") || "";
  const row = state ? await env.DB.prepare("SELECT created_at FROM oauth_state WHERE id=?1").bind(await sha(state)).first() : null;
  if (!row || Date.now() - row.created_at > 600000 || !code) return fail("bad or expired state");
  await env.DB.prepare("DELETE FROM oauth_state WHERE id=?1").bind(await sha(state)).run();
  const tr = await f("https://github.com/login/oauth/access_token", { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: env.GITHUB_CLIENT_ID, client_secret: env.GITHUB_CLIENT_SECRET, code }) });
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
