// CONNECTIONS-1: one screen at ultrastable.io/connections where the signed-in owner sees every linked service and every agent with access, and revokes either with a click.
// Services (Google, Microsoft, GitHub, remote MCP servers) live in the tick Worker's sealed credential store (reached over the TICK service binding, never duplicated here);
// agents are the OAuth clients holding live tokens from this site's own authorization server (site/oauth.js). Nothing on this page asks for a token.
// /connect/<provider>[/start|/disconnect] is the same owner-only consent flow, now reachable from ultrastable.io: the provider's callback carries its own signed state, so only /callback skips the session.
import { currentSubject } from "./passkeys.js";
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const HOSTS = h => h === "ultrastable.io" || h === "www.ultrastable.io" || h.endsWith(".workers.dev") || h === "localhost"; // server-side only: the hosts this route answers on; localhost is the Worker runtime's own test origin and the system hosts nothing there
const CSS = ":root{color-scheme:light dark}body{font:16px system-ui;max-width:42rem;margin:2.5rem auto;padding:0 1rem}.card{border:1px solid #8886;border-radius:.6rem;padding:.8rem 1rem;margin:.6rem 0}.mut{opacity:.7}button,.btn{font:inherit;padding:.5rem .9rem;border-radius:.4rem;border:1px solid #888;background:transparent;color:inherit;cursor:pointer;text-decoration:none;display:inline-block;margin:.2rem .2rem .2rem 0}input{font:inherit;padding:.5rem;width:70%}";
const page = (body, status) => new Response("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Connections</title><style>" + CSS + "</style></head><body>" + body + "</body></html>", { status: status || 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });

export async function listAgents(env, now = Date.now()) {
  const r = await env.DB.prepare("SELECT t.client_id AS client_id, c.name AS name, c.kind AS kind, COUNT(*) AS live FROM oauth_tokens t LEFT JOIN oauth_clients c ON c.client_id = t.client_id WHERE t.revoked = 0 AND t.expires_at > ?1 GROUP BY t.client_id ORDER BY live DESC LIMIT 100").bind(now).all();
  return (r.results || []).map(x => ({ client_id: x.client_id, name: x.name || x.client_id, kind: x.kind || "metadata-document", live_tokens: x.live }));
}
export async function revokeAgent(env, clientId) {
  const r = await env.DB.prepare("UPDATE oauth_tokens SET revoked = 1 WHERE client_id = ?1 AND revoked = 0").bind(String(clientId)).run();
  return (r.meta && r.meta.changes) ?? (r.changes ?? 0);
}
const disconnectPath = l => l.kind === "mcp" ? "/connect/mcp/disconnect?provider=" + encodeURIComponent(l.provider) : String(l.provider).startsWith("oauth:") ? "/connect/" + String(l.provider).slice(6) + "/disconnect" : null;

export function renderConnections(status, agents) {
  const services = (status.linked || []).map(l => {
    const dp = disconnectPath(l);
    return `<div class="card"><b>${esc(l.server || l.provider)}</b> <span class="mut">${esc(l.status || "")}${l.expires_at ? " · renews before " + esc(String(l.expires_at).slice(0, 16).replace("T", " ")) : ""}</span>${l.last_error ? `<p class="mut">Last problem: ${esc(l.last_error)}</p>` : ""}${dp ? `<form method="POST" action="/connections/service/disconnect"><input type="hidden" name="provider" value="${esc(l.provider)}"><input type="hidden" name="kind" value="${esc(l.kind || "")}"><button>Disconnect</button></form>` : ""}</div>`;
  }).join("") || `<p class="mut">No services linked yet.</p>`;
  const adds = (status.available || []).filter(a => !a.linked && a.id !== "mcp").map(a => a.ready ? `<a class="btn" href="${esc(a.connect)}">Connect ${esc(a.title)}</a>` : `<span class="mut">${esc(a.title)}: waiting for its one-time app registration</span>`).join(" ");
  const ag = (agents || []).map(a => `<div class="card"><b>${esc(a.name)}</b> <span class="mut">${esc(a.kind)} · ${a.live_tokens} active sign-in${a.live_tokens === 1 ? "" : "s"}</span><form method="POST" action="/connections/agent/revoke"><input type="hidden" name="client_id" value="${esc(a.client_id)}"><button>Revoke access</button></form></div>`).join("") || `<p class="mut">No agent has access.</p>`;
  return `<h1>Connections</h1><h2>Services</h2>${services}<p>${adds}</p><form method="GET" action="/connect/mcp"><p>Connect any MCP server by its address:</p><input name="server" type="url" placeholder="https://example.com/mcp" required> <button>Connect</button></form><h2>Agents with access</h2>${ag}<p class="mut">Disconnecting or revoking takes effect immediately. Nothing here asks for a token.</p>`;
}

const tickJson = async (env, path) => {
  try { const r = await env.TICK.fetch(new Request("https://ultrastable.io" + path)); return r.ok ? await r.json() : { linked: [], available: [] }; } catch (e) { return { linked: [], available: [] }; }
};
// OWNER-LINKS-4: the tick Worker serves /connect/<provider> only to requests that passed this Worker's owner sign-in. This Worker proves it with the shared internal key (a client-sent copy is overwritten), so a direct hit that skipped the gate gets the sign-in page from the tick.
export function gatedForward(request, u, env) {
  const h = new Headers(request.headers); h.delete("x-internal-key"); if (env.INTERNAL_DEPLOY_KEY) h.set("x-internal-key", env.INTERNAL_DEPLOY_KEY);
  return new Request("https://ultrastable.io" + u.pathname + u.search, { method: request.method, headers: h, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, redirect: "manual" });
}
const sameOrigin = (request, u) => { const o = request.headers.get("origin"); return !o || o === u.origin; };

export async function connectionsRoute(request, env, { subject = currentSubject, now = Date.now() } = {}) {
  const u = new URL(request.url), p = u.pathname.replace(/\/$/, "");
  const wk = p === "/.well-known/oauth-client/bluesky.json" || p === "/.well-known/oauth-client/bluesky-c.json" || p === "/.well-known/oauth-client/bluesky-jwks.json"; /* REACH-1: atproto client metadata, public */
  const mine = wk || p === "/connections" || p.startsWith("/connections/") || p === "/connect" || p.startsWith("/connect/");
  if (!mine || !HOSTS(u.hostname)) return null;
  const isCallback = wk || /^\/connect\/[a-z0-9-]+\/callback$/.test(p);
  if (!isCallback) {
    const s = await subject(request, env);
    if (!s) return Response.redirect(/* SIGNIN-NEXT-1 */ new URL("/auth/signin?next=" + encodeURIComponent(p === "/connections" ? "/connections" : u.pathname + u.search), u).toString(), 302);
  }
  if (p === "/connections" && request.method === "GET") return page(renderConnections(await tickJson(env, "/auth/connectors"), await listAgents(env, now).catch(() => [])));
  if (request.method === "POST" && p.startsWith("/connections/")) {
    if (!sameOrigin(request, u)) return page("<h1>Refused</h1><p>That request came from another site.</p>", 403);
    const f = await request.formData().catch(() => null);
    if (!f) return page("<h1>Bad request</h1>", 400);
    if (p === "/connections/agent/revoke") { const n = await revokeAgent(env, f.get("client_id")); return Response.redirect(new URL("/connections?revoked=" + n, u).toString(), 303); }
    if (p === "/connections/service/disconnect") {
      const dp = disconnectPath({ provider: String(f.get("provider") || ""), kind: String(f.get("kind") || "") });
      if (!dp) return page("<h1>Cannot disconnect that here</h1>", 400);
      const r = await env.TICK.fetch(new Request("https://ultrastable.io" + dp, { method: "POST" }));
      return Response.redirect(new URL("/connections?disconnected=" + (r.ok ? 1 : 0), u).toString(), 303);
    }
    return page("<h1>Not found</h1>", 404);
  }
  if (wk || p === "/connect" || p.startsWith("/connect/")) return env.TICK ? env.TICK.fetch(gatedForward(request, u, env))  /* REACH-1: the consent flow builds redirect_uri and client_id from the request origin; behind the gateway that is a workers.dev host, so it sees the canonical one */ : page("<h1>Connections are not available on this deployment</h1>", 503);  // the consent flow itself lives in the tick Worker
  return null;
}
