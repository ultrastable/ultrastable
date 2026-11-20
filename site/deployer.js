// HANDOFF-1: the deploy and rollback hands of the server-side handoff loop. The tick Worker (seed/worker/src/handoff.js) reads the merge commit from GitHub
// and posts the flattened modules here over its SITE service binding; this worker holds the Cloudflare credential (CF_DEPLOY_TOKEN, CF_ACCOUNT_ID) and uploads.
// Guarded by a shared internal key (secret INTERNAL_DEPLOY_KEY on both workers), compared in constant time; without the key the paths answer 404 like any unknown page.
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } });
const ALLOWED = /^ultrastable-[a-z0-9-]{1,40}$/;  // only the platform's own workers; tenant idea workers have their own path (deployIdeaWorker)

function same(a, b) { a = String(a || ""); b = String(b || ""); if (!a || a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; }

// DEPLOY-OIDC-1: a second caller with no stored credential. GitHub Actions presents its per-run OIDC token (audience ultrastable-deploy);
// it is accepted only when GitHub signed it, it is unexpired, and it names this repository's main branch. GitHub mints the token for each
// run; no person mints or stores anything, and the Cloudflare credential still never leaves this worker.
export const OIDC_ISSUER = "https://token.actions.githubusercontent.com", OIDC_AUDIENCE = "ultrastable-deploy";
const b64u = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), c => c.charCodeAt(0));
let jwksCache = null;
export async function verifyGithubOidc(jwt, env, fetcher, now = Date.now()) {
  const parts = String(jwt || "").split(".");
  if (parts.length !== 3) return { ok: false, why: "not a JWT" };
  let head, claims; try { head = JSON.parse(new TextDecoder().decode(b64u(parts[0]))); claims = JSON.parse(new TextDecoder().decode(b64u(parts[1]))); } catch (e) { return { ok: false, why: "unreadable JWT" }; }
  if (head.alg !== "RS256") return { ok: false, why: "alg " + head.alg };
  const repo = env.OIDC_REPO || "ultrastable/ultrastable", t = Math.floor(now / 1000);
  if (claims.iss !== OIDC_ISSUER || claims.aud !== OIDC_AUDIENCE || claims.repository !== repo || claims.ref !== "refs/heads/main") return { ok: false, why: "claims do not name " + repo + " main" };
  if (!(claims.exp > t) || (claims.nbf && claims.nbf > t + 60)) return { ok: false, why: "expired or not yet valid" };
  if (!jwksCache || jwksCache.at < now - 3600e3 || !jwksCache.keys.some(k => k.kid === head.kid)) { const r = await (fetcher || fetch)(OIDC_ISSUER + "/.well-known/jwks"); jwksCache = { at: now, keys: (await r.json()).keys || [] }; }
  const jwk = jwksCache.keys.find(k => k.kid === head.kid); if (!jwk) return { ok: false, why: "unknown key " + head.kid };
  const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const good = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), new TextEncoder().encode(parts[0] + "." + parts[1]));
  return good ? { ok: true, run: claims.run_id, sha: claims.sha } : { ok: false, why: "bad signature" };
}
export const _resetJwks = () => { jwksCache = null; };

// LIVE-FRESH-2: the /live snapshot is written into this worker's own ops database through its binding, authenticated by the same OIDC token as deploys.
// The old route (Cloudflare API token for the retired account) wrote to a database this site no longer reads, so the snapshot froze for days with a green run.
export async function ingestTransparency(request, env) {
  let b; try { b = await request.json(); } catch (e) { return J({ ok: false, error: "bad json" }, 400); }
  const parts = b && b.parts;
  if (!env.DB) return J({ ok: false, error: "no DB binding" }, 503);
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(String(b && b.generated)) || !Array.isArray(parts) || !parts.length || parts.length > 40 || parts.some(x => typeof x !== "string")) return J({ ok: false, error: "generated and parts are required" }, 400);
  const ins = (n) => env.DB.prepare("INSERT OR REPLACE INTO transparency_parts (generated,part,total,body) VALUES (?,?,?,?)").bind(b.generated, n, parts.length, parts[n]);
  const order = [...Array(parts.length).keys()].slice(1).concat([0]);  // part 0 last: the reader serves a generation only once part 0 exists
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS transparency_parts (generated TEXT NOT NULL, part INTEGER NOT NULL, total INTEGER NOT NULL, body TEXT NOT NULL, PRIMARY KEY (generated, part))").run();
    for (const n of order) await ins(n).run();
    await env.DB.prepare("DELETE FROM transparency_parts WHERE generated < ?").bind(b.generated).run();
  } catch (e) { console.error("transparency ingest failed", e && e.message); return J({ ok: false, error: "the snapshot could not be stored; the publisher retries and the tick re-dispatches it" }, 502); }
  return J({ ok: true, generated: b.generated, parts: parts.length });
}

export async function internalDeploy(request, env, fetcher) {
  const u = new URL(request.url);
  if (!u.pathname.startsWith("/__internal/")) return null;
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("authorization") || "");
  const byKey = env.INTERNAL_DEPLOY_KEY && same(request.headers.get("x-internal-key"), env.INTERNAL_DEPLOY_KEY);
  const byOidc = !byKey && bearer ? (await verifyGithubOidc(bearer[1], env, fetcher).catch(e => ({ ok: false, why: String(e && e.message) }))).ok : false;
  if (request.method !== "POST" || !(byKey || byOidc)) return new Response("Not found", { status: 404 });
  if (u.pathname === "/__internal/transparency") return ingestTransparency(request, env);
  const f = fetcher || fetch, T = env.CF_DEPLOY_TOKEN, A = env.CF_ACCOUNT_ID;
  if (!T || !A) return J({ ok: false, error: "site has no CF_DEPLOY_TOKEN / CF_ACCOUNT_ID" }, 503);
  const api = (m, p, body, h) => f("https://api.cloudflare.com/client/v4" + p, { method: m, headers: { authorization: "Bearer " + T, ...(h || {}) }, body }).then(r => r.json());
  let b; try { b = await request.json(); } catch (e) { return J({ ok: false, error: "bad json" }, 400); }
  if (!ALLOWED.test(String(b.name || ""))) return J({ ok: false, error: "worker name not allowed: " + b.name }, 400);
  if (u.pathname === "/__internal/deploy") {
    if (!Array.isArray(b.modules) || !b.modules.length || !b.main) return J({ ok: false, error: "modules and main are required" }, 400);
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({ main_module: b.main, compatibility_date: b.compatibility_date || "2026-11-12", bindings: b.bindings || [], keep_bindings: ["secret_text", "secret_key"], observability: { enabled: true, head_sampling_rate: 1 }, annotations: b.tag ? { "workers/tag": b.tag, "workers/message": "HANDOFF-1 deploy of " + b.tag } : undefined })], { type: "application/json" }));
    for (const m of b.modules) form.append(m.name, new Blob([m.src], { type: m.type || "application/javascript+module" }), m.name);
    const up = await api("PUT", `/accounts/${A}/workers/scripts/${b.name}`, form);
    if (!up.success) return J({ ok: false, error: "upload: " + JSON.stringify(up.errors || []).slice(0, 400) }, 502);
    if (Array.isArray(b.crons)) { const cr = await api("PUT", `/accounts/${A}/workers/scripts/${b.name}/schedules`, JSON.stringify(b.crons.map(cron => ({ cron }))), { "content-type": "application/json" }); if (!cr.success) return J({ ok: false, error: "schedules: " + JSON.stringify(cr.errors || []).slice(0, 300) }, 502); }
    return J({ ok: true, version: (up.result && (up.result.deployment_id || up.result.etag || up.result.id)) || "" });
  }
  if (u.pathname === "/__internal/version") {  // DEPLOY-VERSION-1: the live deployment of a worker, read after a handoff deploy to prove the code changed
    const d = await api("GET", `/accounts/${A}/workers/scripts/${b.name}/deployments`);
    const dep = d.success && d.result && (d.result.deployments || [])[0];
    return J(dep ? { ok: true, version: dep.id, version_ids: (dep.versions || []).map(v => v.version_id), created_on: dep.created_on || null } : { ok: false, detail: "no deployment: " + JSON.stringify(d.errors || []).slice(0, 300) });
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
