// HANDOFF-1: the deploy and rollback hands of the server-side handoff loop. The tick Worker (seed/worker/src/handoff.js) reads the merge commit from GitHub
// and posts the flattened modules here over its SITE service binding; this worker holds the Cloudflare credential (CF_DEPLOY_TOKEN, CF_ACCOUNT_ID) and uploads.
// Guarded by a shared internal key (secret INTERNAL_DEPLOY_KEY on both workers), compared in constant time; without the key the paths answer 404 like any unknown page.
import { launchesInternal } from "./graduate.js";
const J = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { "content-type": "application/json" } });
const ALLOWED = /^ultrastable-[a-z0-9-]{1,40}$/;  // only the platform's own workers; tenant idea workers have their own path (deployIdeaWorker)

const HOST_REPO = /^[a-z0-9][a-z0-9-]{0,38}\/app-[a-z0-9-]{1,60}$/;
// The one repository a standing seed's Worker may be given a token for: its own, never a core repository and never a visitor's app.
export function seedRepoOf(name) { const m = /^ultrastable-seed-([a-z0-9][a-z0-9-]{1,34})$/.exec(String(name || "")); return m && !/^app-/.test(m[1]) && !/^(ultrastable|workers|spec|seed|license|ops)$/.test(m[1]) ? "ultrastable/" + m[1] : null; }
// The same HMAC the tick Worker checks (seed/worker/src/apprepos.js hostKey); site/launchpath.test.mjs holds the two equal.
export async function hostKey(secret, repo) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(String(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return [...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("app-token:" + repo)))].map(x => x.toString(16).padStart(2, "0")).join("");
}
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

// CF-ROUTE-1: the credential-free way for a workflow to read the account (the credential check) and run the weekly backup drill. The workflow presents its OIDC token; this
// Worker forwards ONE allow-listed request with the credential only it holds and streams the answer back. Nothing it cannot read from the account's own stores is exposed:
// D1 reads (SELECT only), KV reads, and read, write or delete of objects under the backup prefix of the backup bucket. The method and path travel in headers, the body is passed through untouched.
export const CF_BUCKET = "ultrastable-git", CF_PREFIX = "backups/";
const Q = "(\\?[\\w=&.%:/-]*)?";
const CF_RULES = [
  ["GET", /^subscriptions$/],
  ["POST", /^ai\/run\/@cf\/[\w.-]+\/[\w.-]+$/],  // AI-OIDC-1: Workers AI inference for the executor's code-agent ladder (foundation/agents.py), a model under @cf/ only  // LIVE-PLAN-1: read-only plan check for the owner page
  ["GET", new RegExp("^d1/database" + Q + "$")],
  ["POST", /^d1\/database\/[0-9a-f-]{36}\/(export|query)$/],
  ["GET", new RegExp("^storage/kv/namespaces" + Q + "$")],
  ["GET", new RegExp("^storage/kv/namespaces/[0-9a-f]{32}/(keys|values/[^?/]+)" + Q + "$")],
  ["GET", new RegExp("^r2/buckets/" + CF_BUCKET + "/objects" + Q + "$")],
  ["GET", new RegExp("^r2/buckets/" + CF_BUCKET + "/objects/backups/[\\w./%-]+$")],
  ["PUT", new RegExp("^r2/buckets/" + CF_BUCKET + "/objects/backups/[\\w./%-]+$")],
  ["DELETE", new RegExp("^r2/buckets/" + CF_BUCKET + "/objects/backups/[\\w./%-]+$")],
];
export const cfAllowed = (method, path) => !String(path).includes("..") && CF_RULES.some(([m, r]) => m === method && r.test(path));
export const selectOnly = (sql) => /^\s*(select|pragma\s+table_info)\b/i.test(sql) && !/;\s*\S/.test(sql);
export async function cfProxy(request, env, f) {
  const method = String(request.headers.get("x-cf-method") || "GET").toUpperCase(), path = String(request.headers.get("x-cf-path") || "");
  if (!cfAllowed(method, path)) return J({ ok: false, error: "not an allowed Cloudflare request: " + method + " " + path.split("?")[0] }, 403);
  let body = ["GET", "DELETE"].includes(method) ? undefined : request.body;
  if (method === "POST" && /\/query$/.test(path.split("?")[0])) {
    const text = await request.text(); let j; try { j = JSON.parse(text); } catch (e) { return J({ ok: false, error: "bad json" }, 400); }
    if (!selectOnly(String(j.sql || ""))) return J({ ok: false, error: "only read queries are allowed" }, 403);
    body = text;
  }
  const up = await f(`https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/${path}`, { method, headers: { authorization: "Bearer " + env.CF_DEPLOY_TOKEN, "content-type": request.headers.get("content-type") || "application/json" }, body, duplex: body && typeof body !== "string" ? "half" : undefined });
  return new Response(up.body, { status: up.status, headers: { "content-type": up.headers.get("content-type") || "application/json" } });
}

// COST-ROUTE-1: usage analytics for the cost probe. GitHub holds no Cloudflare credential (the secret there is refused by the account), so the probe sends its
// GraphQL read here with its OIDC token. Only the two analytics datasets the probe reads are forwarded, for the pinned account, never a mutation.
export const GQL_OK = /^\s*query\s*\(\s*\$account:\s*String!(?:,\s*\$\w+:\s*\w+!?)*\s*\)\s*\{\s*viewer\s*\{\s*accounts\(filter:\s*\{\s*accountTag:\s*\$account\s*\}\)\s*\{\s*(?:aiInferenceAdaptiveGroups|d1AnalyticsAdaptiveGroups)\b/;
export async function cfGraphql(request, env, f) {
  let j; try { j = await request.json(); } catch (e) { return J({ ok: false, error: "bad json" }, 400); }
  const q = String(j.query || "");
  if (!GQL_OK.test(q) || /mutation|subscription/i.test(q)) return J({ ok: false, error: "only the cost probe's analytics reads are allowed" }, 403);
  const up = await f("https://api.cloudflare.com/client/v4/graphql", { method: "POST", headers: { authorization: "Bearer " + (env.CF_ANALYTICS_TOKEN || env.CF_DEPLOY_TOKEN), "content-type": "application/json" }, body: JSON.stringify({ query: q, variables: { ...(j.variables || {}), account: env.CF_ACCOUNT_ID } }) });
  return new Response(up.body, { status: up.status, headers: { "content-type": "application/json" } });
}

// SEED-DEPLOY-1: the one database write the OIDC route may make. A generated seed (SEED-ADMIT-1) needs its own D1 database before its Worker can start. This creates
// a database only under the name prefix ultrastable-seed- (never a platform database such as ultrastable-org) and applies the given migration files to it once each,
// through a ledger table. The caller is the same main-branch OIDC token as a deploy; nothing outside a seed database is reachable.
export const SEED_DB = /^ultrastable-seed-[a-z0-9]+(-[a-z0-9]+){0,8}$/;
export async function seedD1(b, api, A) {
  const name = String(b.name || ""), ms = Array.isArray(b.migrations) ? b.migrations : [];
  if (!SEED_DB.test(name)) return J({ ok: false, error: "a seed database name must be ultrastable-seed-<slug>" }, 400);
  if (ms.length > 80 || ms.some(m => !m || !/^[\w.-]{1,80}\.sql$/.test(String(m.file)) || !/^[0-9a-f]{64}$/.test(String(m.sha256)) || typeof m.sql !== "string" || m.sql.length > 200000)) return J({ ok: false, error: "migrations must be {file, sha256, sql} (at most 80 files of 200 KB)" }, 400);
  const found = ((await api("GET", `/accounts/${A}/d1/database?name=${encodeURIComponent(name)}&per_page=100`)).result || []).find(d => d.name === name);
  const made = found ? null : await api("POST", `/accounts/${A}/d1/database`, JSON.stringify({ name }), { "content-type": "application/json" });
  const id = found ? found.uuid : made && made.success && made.result && made.result.uuid;
  if (!id) return J({ ok: false, error: "create database: " + JSON.stringify((made && made.errors) || []).slice(0, 300) }, 502);
  const q = (sql) => api("POST", `/accounts/${A}/d1/database/${id}/query`, JSON.stringify({ sql }), { "content-type": "application/json" });
  const mk = await q("CREATE TABLE IF NOT EXISTS _migrations (file TEXT PRIMARY KEY, sha256 TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))");
  if (!mk.success) return J({ ok: false, error: "ledger: " + JSON.stringify(mk.errors || []).slice(0, 300) }, 502);
  const done = new Set(((((await q("SELECT file FROM _migrations")).result || [])[0] || {}).results || []).map(r => r.file)), applied = [];
  for (const m of ms) {
    if (done.has(m.file)) continue;
    const r = await q(m.sql);
    if (!r.success) return J({ ok: false, error: "migration " + m.file + ": " + JSON.stringify(r.errors || []).slice(0, 300), applied }, 502);
    await q(`INSERT INTO _migrations (file, sha256) VALUES ('${m.file}', '${m.sha256}')`); applied.push(m.file);
  }
  return J({ ok: true, uuid: id, created: !found, applied });
}

export async function internalDeploy(request, env, fetcher) {
  const u = new URL(request.url);
  if (!u.pathname.startsWith("/__internal/")) return null;
  const bearer = /^Bearer (.+)$/.exec(request.headers.get("authorization") || "");
  const byKey = env.INTERNAL_DEPLOY_KEY && same(request.headers.get("x-internal-key"), env.INTERNAL_DEPLOY_KEY);
  const byOidc = !byKey && bearer ? (await verifyGithubOidc(bearer[1], env, fetcher).catch(e => ({ ok: false, why: String(e && e.message) }))).ok : false;
  if (request.method !== "POST" || !(byKey || byOidc)) return new Response("Not found", { status: 404 });
  if (u.pathname === "/__internal/transparency") return ingestTransparency(request, env);
  if (u.pathname === "/__internal/launches") return launchesInternal(request, env);  // LAUNCH-PATH-1: the launch queue, read and marked by deploy/launch-apps.mjs
  const f = fetcher || fetch, T = env.CF_DEPLOY_TOKEN, A = env.CF_ACCOUNT_ID;
  if (!T || !A) return J({ ok: false, error: "site has no CF_DEPLOY_TOKEN / CF_ACCOUNT_ID" }, 503);
  if (u.pathname === "/__internal/cf") return cfProxy(request, env, f);
  if (u.pathname === "/__internal/cf-graphql") return cfGraphql(request, env, f);  // COST-ROUTE-1
  const api = (m, p, body, h) => f("https://api.cloudflare.com/client/v4" + p, { method: m, headers: { authorization: "Bearer " + T, ...(h || {}) }, body }).then(r => r.json());
  let b; try { b = await request.json(); } catch (e) { return J({ ok: false, error: "bad json" }, 400); }
  if (!ALLOWED.test(String(b.name || ""))) return J({ ok: false, error: "worker name not allowed: " + b.name }, 400);
  if (u.pathname === "/__internal/seed-d1") return seedD1(b, api, A);  // SEED-DEPLOY-1
  if (u.pathname === "/__internal/deploy") {
    if (!Array.isArray(b.modules) || !b.modules.length || !b.main) return J({ ok: false, error: "modules and main are required" }, 400);
    // HOSTED-1: an app this platform hosts gets the address of its host's token route and a key that opens its one repository there. The key is
    // made here from a secret the caller never sees, so the workflow that asks for the deploy cannot mint one.
    if (b.host_repo) {
      // SEED-HOST-1: a standing seed gets the same route to its own repository and no other: ultrastable-seed-<slug> may name only ultrastable/<slug>.
      const app = /^ultrastable-seed-app-[a-f0-9]{10}$/.test(b.name) && HOST_REPO.test(String(b.host_repo)), seed = seedRepoOf(b.name) === String(b.host_repo);
      if (!(app || seed) || !env.INTERNAL_DEPLOY_KEY) return J({ ok: false, error: "host_repo is only for a hosted app or a seed's own repository" }, 400);
      b.bindings = (b.bindings || []).filter(x => !/^HOST_/.test(x.name)).concat([{ type: "plain_text", name: "HOST_REPO", text: b.host_repo }, { type: "plain_text", name: "HOST_TOKEN_URL", text: (env.TICK_ORIGIN || "https://ultrastable-tick.ultrastable.workers.dev") + "/host/app-token" }, { type: "secret_text", name: "HOST_APP_KEY", text: await hostKey(env.INTERNAL_DEPLOY_KEY, b.host_repo) }]);
    }
    const form = new FormData();
    form.append("metadata", new Blob([JSON.stringify({ main_module: b.main, compatibility_date: b.compatibility_date || "2026-11-12", bindings: b.bindings || [], keep_bindings: ["secret_text", "secret_key"], observability: { enabled: true, head_sampling_rate: 1 }, annotations: b.tag ? { "workers/tag": b.tag, "workers/message": "HANDOFF-1 deploy of " + b.tag } : undefined })], { type: "application/json" }));
    for (const m of b.modules) form.append(m.name, new Blob([m.src], { type: m.type || "application/javascript+module" }), m.name);
    const up = await api("PUT", `/accounts/${A}/workers/scripts/${b.name}`, form);
    if (!up.success) return J({ ok: false, error: "upload: " + JSON.stringify(up.errors || []).slice(0, 400) }, 502);
    // WORKERS-DEV-1: a new script uploaded by API has no workers.dev route until it is turned on; a non-public topology worker is served there.
    if (b.workers_dev === true) { const sd = await api("POST", `/accounts/${A}/workers/scripts/${b.name}/subdomain`, JSON.stringify({ enabled: true, previews_enabled: false }), { "content-type": "application/json" }); if (!sd.success) return J({ ok: false, error: "workers.dev: " + JSON.stringify(sd.errors || []).slice(0, 300) }, 502); }
    // TENANT-DOMAIN-1: a tenant app's custom domains (topology `routes`) are attached on every deploy; idempotent, zone found from the hostname.
    const warnings = [];
    for (const host of Array.isArray(b.domains) ? b.domains : []) {
      const zones = await api("GET", `/zones?account.id=${A}&per_page=50`);
      const zone = ((zones && zones.result) || []).find(z => host === z.name || host.endsWith("." + z.name));
      if (!zone) return J({ ok: false, error: "custom domain: no zone in this account for " + host }, 502);
      const dm = await api("PUT", `/accounts/${A}/workers/domains`, JSON.stringify({ hostname: host, service: b.name, zone_id: zone.id, environment: "production" }), { "content-type": "application/json" });
      if (!dm.success) return J({ ok: false, error: "custom domain " + host + ": " + JSON.stringify(dm.errors || []).slice(0, 300) }, 502);
      // TENANT-ROUTE-1: a zone route such as *.ultrastable.app/* (the spinoffs worker) catches the hostname ahead of the custom domain,
      // so the live host answered "Not found" from another worker. A route for exactly this host is more specific than the wildcard and wins.
      const rl = await api("GET", `/zones/${zone.id}/workers/routes`);
      if (!rl || !rl.success) warnings.push("routes " + zone.name + " unreadable: " + JSON.stringify((rl && rl.errors) || []).slice(0, 200));  // an unknown route list is reported as a warning, not read as "no wildcard"
      const routes = rl && Array.isArray(rl.result) ? rl.result : [];
      const covered = routes.some(r => r.script !== b.name && r.pattern.startsWith("*.") && host.endsWith(r.pattern.slice(1).replace(/\/\*$/, "")));
      const own = routes.find(r => r.pattern === host + "/*");
      if (covered && (!own || own.script !== b.name)) {
        const rr = own ? await api("PUT", `/zones/${zone.id}/workers/routes/${own.id}`, JSON.stringify({ pattern: host + "/*", script: b.name }), { "content-type": "application/json" })
                       : await api("POST", `/zones/${zone.id}/workers/routes`, JSON.stringify({ pattern: host + "/*", script: b.name }), { "content-type": "application/json" });
        if (!rr.success) warnings.push("route " + host + "/*: " + JSON.stringify(rr.errors || []).slice(0, 300));  // the upload stands; the deploy log records the warning
      }
    }
    if (Array.isArray(b.crons)) { const cr = await api("PUT", `/accounts/${A}/workers/scripts/${b.name}/schedules`, JSON.stringify(b.crons.map(cron => ({ cron }))), { "content-type": "application/json" }); if (!cr.success) return J({ ok: false, error: "schedules: " + JSON.stringify(cr.errors || []).slice(0, 300) }, 502); }
    return J({ ok: true, version: (up.result && (up.result.deployment_id || up.result.etag || up.result.id)) || "", ...(warnings.length ? { warnings } : {}) });
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
