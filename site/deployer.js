// HANDOFF-1: the deploy and rollback hands of the server-side handoff loop. The tick Worker (seed/worker/src/handoff.js) reads the merge commit from GitHub
// and posts the flattened modules here over its SITE service binding; this worker holds the Cloudflare credential (CF_DEPLOY_TOKEN, CF_ACCOUNT_ID) and uploads.
// Guarded by a shared internal key (secret INTERNAL_DEPLOY_KEY on both workers), compared in constant time; without the key the paths answer 404 like any unknown page.
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } });
const ALLOWED = /^ultrastable-[a-z0-9-]{1,40}$/;  // only the platform's own workers; tenant idea workers have their own path (deployIdeaWorker)

function same(a, b) { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }

export async function internalDeploy(request, env, fetcher) {
  const u = new URL(request.url);
  if (!u.pathname.startsWith("/__internal/")) return null;
  if (request.method !== "POST" || !env.INTERNAL_DEPLOY_KEY || !same(request.headers.get("x-internal-key"), env.INTERNAL_DEPLOY_KEY)) return new Response("Not found", { status: 404 });
  const f = fetcher || fetch, T = env.CF_DEPLOY_TOKEN, A = env.CF_ACCOUNT_ID;
  if (!T || !A) return J({ ok: false, error: "site has no CF_DEPLOY_TOKEN / CF_ACCOUNT_ID" }, 503);
  const api = (m, p, body, h) => f("https://api.cloudflare.com/client/v4" + p, { method: m, headers: { authorization: "Bearer " + T, ...(h || {}) }, body }).then(r => r.json());
  let b; try { b = await request.json(); } catch (e) { return J({ ok: false, error: "bad json" }, 400); }
  if (!ALLOWED.test(String(b.name || ""))) return J({ ok: false, error: "worker name not allowed: " + b.name }, 400);
  if (u.pathname === "/__internal/deploy") {
    if (!Array.isArray(b.modules) || !b.modules.length || !b.main) return J({ ok: false, error: "modules and main are required" }, 400);
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({ main_module: b.main, compatibility_date: b.compatibility_date || "2026-11-12", bindings: b.bindings || [], keep_bindings: ["secret_text", "secret_key"], annotations: b.tag ? { "workers/tag": b.tag, "workers/message": "HANDOFF-1 deploy of " + b.tag } : undefined })], { type: "application/json" }));
    for (const m of b.modules) form.append(m.name, new Blob([m.src], { type: m.type || "application/javascript+module" }), m.name);
    const up = await api("PUT", `/accounts/${A}/workers/scripts/${b.name}`, form);
    if (!up.success) return J({ ok: false, error: "upload: " + JSON.stringify(up.errors || []).slice(0, 400) }, 502);
    if (Array.isArray(b.crons)) { const cr = await api("PUT", `/accounts/${A}/workers/scripts/${b.name}/schedules`, JSON.stringify(b.crons.map(cron => ({ cron }))), { "content-type": "application/json" }); if (!cr.success) return J({ ok: false, error: "schedules: " + JSON.stringify(cr.errors || []).slice(0, 300) }, 502); }
    return J({ ok: true, version: (up.result && (up.result.deployment_id || up.result.etag || up.result.id)) || "" });
  }
  if (u.pathname === "/__internal/rollback") {
    const v = await api("GET", `/accounts/${A}/workers/scripts/${b.name}/versions?per_page=5`);
    const items = (v.result && (v.result.items || v.result)) || [];
    if (!v.success || items.length < 2) return J({ ok: false, detail: "no previous version to roll back to" });
    const prev = items[1].id;
    const d = await api("POST", `/accounts/${A}/workers/scripts/${b.name}/deployments`, JSON.stringify({ strategy: "percentage", versions: [{ version_id: prev, percentage: 100 }], annotations: { "workers/message": "HANDOFF-1 rollback after a failed live probe" } }), { "content-type": "application/json" });
    return J({ ok: !!d.success, detail: d.success ? "rolled back to " + prev : "rollback: " + JSON.stringify(d.errors || []).slice(0, 300) });
  }
  return new Response("Not found", { status: 404 });
}
