// PORTABILITY-2: "My data", one click. A signed-in owner (passkey session) downloads or restores everything Ultrastable holds, with no token to
// mint, copy or paste. The bundle is the open ultrastable-export/v1 JSON (items are restorable; connected apps, webhooks and passkey labels are
// included for the person's records and never carry secrets: no tokens, salts, signing keys or credential material).
import { currentSubject } from "./passkeys.js";
import { EXPORT_SCHEMA, importBundle } from "./portability.js";
const j = (o, s, h) => new Response(JSON.stringify(o, null, 2), { status: s || 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...(h || {}) } });
const safe = async (p, d) => { try { return (await p).results || []; } catch (e) { return d; } };

export async function ownerBundle(env, now = Date.now()) {
  const items = await safe(env.ORG.prepare("SELECT id, title, kind, priority, status, surface, disposition, created_at FROM items WHERE surface LIKE 'integration:%' ORDER BY id").all(), []);
  const apps = env.DB ? await safe(env.DB.prepare("SELECT name, kind, created_at FROM oauth_clients ORDER BY created_at").all(), []) : [];
  const hooks = env.DB ? await safe(env.DB.prepare("SELECT id, url, events, description, active, created_at FROM webhook_subscriptions ORDER BY created_at").all(), []) : [];
  const keys = env.DB ? await safe(env.DB.prepare("SELECT label, created_at, last_used_at FROM passkeys ORDER BY created_at").all(), []) : [];
  return { schema: EXPORT_SCHEMA, exported_at: new Date(now).toISOString(), owner: "owner", count: items.length,
    items: items.map(i => ({ id: i.id, title: String(i.title).replace(/^(IN|IM)-[^:]*:\s*/, ""), kind: String(i.kind).replace(/^intake-/, ""), priority: i.priority, status: i.status, detail: i.disposition || null, source: i.surface, created_at: i.created_at || null })),
    connected_apps: apps, webhooks: hooks, passkeys: keys };
}

const page = signedIn => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My data</title>
<style>body{font:16px system-ui;max-width:560px;margin:3rem auto;padding:0 1rem}a.b,button{display:block;width:100%;margin:.6rem 0;padding:1rem;font:inherit;border:1px solid #888;border-radius:8px;background:#fff;text-align:center;text-decoration:none;color:#111;cursor:pointer}small{color:#555}</style>
<h1>My data</h1>` + (signedIn
  ? `<p>Everything Ultrastable holds for you, as one open JSON file. No tokens, no secrets.</p><a class="b" href="/my-data/export" download="ultrastable-export.json">Download my data</a>
<button id="r">Restore from a file</button><input id="f" type="file" accept="application/json" hidden><p id="m"><small>Restoring twice never duplicates anything.</small></p>
<script>const f=document.getElementById('f'),m=document.getElementById('m');document.getElementById('r').onclick=()=>f.click();
f.onchange=async()=>{try{const t=await f.files[0].text();const r=await fetch('/my-data/import',{method:'POST',headers:{'content-type':'application/json'},body:t});const o=await r.json();m.textContent=r.ok?('Restored '+o.created+' new, '+o.skipped+' already there.'):('Could not restore: '+(o.error||r.status));}catch(e){m.textContent='That file is not an export.'}}</script>`
  : `<p>Sign in once with your passkey to download or restore your data.</p><a class="b" href="/auth/signin?next=/my-data">Sign in</a>`);

export async function mydata(request, env, subject = currentSubject) {
  const u = new URL(request.url), p = u.pathname.replace(/\/$/, "");
  if (p !== "/my-data" && p !== "/my-data/export" && p !== "/my-data/import") return null;
  if (u.hostname !== "ultrastable.io" && u.hostname !== "www.ultrastable.io" && !u.hostname.endsWith(".workers.dev") && u.hostname !== "localhost") return null; // server-side only: the hosts this route answers on; localhost is the Worker runtime's own test origin and the system hosts nothing there
  const s = await subject(request, env);
  if (p === "/my-data") { if (request.method !== "GET") return j({ error: "use GET" }, 405); return new Response(page(!!s), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }); }
  if (!s) return j({ error: "sign in first" }, 401);
  if (!env.ORG) return j({ error: "org database not bound (ORG)" }, 503);
  if (p === "/my-data/export") return request.method === "GET" ? j(await ownerBundle(env), 200, { "content-disposition": 'attachment; filename="ultrastable-export.json"' }) : j({ error: "use GET" }, 405);
  if (request.method !== "POST") return j({ error: "use POST" }, 405);
  if (!/^application\/json/i.test(request.headers.get("content-type") || "")) return j({ error: "content-type must be application/json" }, 415);
  let b; try { b = await request.json(); } catch (e) { return j({ error: "body must be JSON" }, 400); }
  const r = await importBundle(env, "owner", b); return j(r.body, r.status);
}

export async function restoreWebhooks(request, env, subject = currentSubject) {
  const s = await subject(request, env);
  if (!s) return j({ error: "sign in first" }, 401);
  // Additional logic for restoring webhooks can be added here
}
