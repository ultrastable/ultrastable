// CONTROL-PLANE-1: Ultrastable's integration API (/api/v1) and operations dashboard (/ops, dashboard.ultrastable.io).
// Reads the live org database (binding ORG = D1 ultrastable-org: roles, items, claims, dispatches, tick_runs, gate_cards) on every request,
// so "what is going on" is never older than the last tick. Every GET is public and read-only (CORS *). The single write, POST /api/v1/intake,
// needs a bearer token listed in secret INTEGRATION_TOKENS ("name:sha256hex,name2:sha256hex"); tokens are compared by hash, never stored in clear.
// Consumers: the owner's personal companion (/api/v1/companion/brief), other services, MCP clients (site/agentic.js), and the /ops page below.
import { WEBHOOK_OPENAPI_PATHS } from "./webhooks.js";
import { registerHandoff } from "../seed/worker/src/handoff.js";
import { exportBundle, importBundle } from "./portability.js";
import { SOP_VERSION, SOP_STEPS, SERVER_OWNS } from "./sop.js";
export const API_VERSION = "1.1.0";
const ORIGIN = "https://ultrastable.io";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "GET, HEAD, POST, OPTIONS", "x-content-type-options": "nosniff" };
const json = (o, status, extra) => new Response(JSON.stringify(o), { status: status || 200, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(extra || {}) } });
const STALE_TICK_S = 25 * 60;          // cron is every 10 minutes; two missed beats plus slack is "stalled"
const ACTIVE_AGENT_S = 60 * 60;        // an agent that ticked within the hour is "active"
export const DISPATCH_STATES = ["queued", "running", "done", "failed", "parked"];
const WORK_VIEWS = { on_deck: "on deck", in_progress: "in progress", blocked: "blocked", done: "done", all: "all" };

// D1 stores UTC as "YYYY-MM-DD HH:MM:SS"; tolerate ISO too.
export const ts = (s) => { if (!s) return null; const t = Date.parse(String(s).includes("T") ? s : String(s).replace(" ", "T") + "Z"); return Number.isFinite(t) ? t : null; };
const ageS = (s, now) => { const t = ts(s); return t == null ? null : Math.max(0, Math.round((now - t) / 1000)); };
const all = async (db, sql, ...b) => ((await db.prepare(sql).bind(...b).all()).results) || [];
const first = async (db, sql, ...b) => (await db.prepare(sql).bind(...b).first()) || null;

async function sha256(text) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }

// ---- readers (exported so the MCP endpoint and tests use the same code) ----
// READ-BUDGET-4: the public readers below were the top readers of the org database (each /ops load scanned dispatches and items several times).
// One read per isolate per key every 30 s serves every visitor; the key is per env object so tests and tenants never share an entry.
const MEMO_MS = 60e3, EDGE_FRESH_S = 120, EDGE_KEEP_S = 7 * 86400, memos = new WeakMap();
// READ-BUDGET-5: three layers. The isolate map (60 s) and the edge cache (120 s, shared by every isolate in the data centre) keep each reader to
// about one database read per two minutes; a last-known copy kept a week serves when the database refuses (daily free read allowance used
// up), so /ops shows the last data with its age instead of a 503.
const edge = () => (typeof caches !== "undefined" && caches.default) || null;
const edgeKey = (k, tier) => new Request("https://cache.ultrastable.internal/cp/" + tier + "/" + encodeURIComponent(k));
async function edgeGet(k, tier) { try { const c = edge(); const r = c && await c.match(edgeKey(k, tier)); return r ? await r.json() : null; } catch (e) { console.error("cp cache read", e && e.message); return null; } }
async function edgePut(k, tier, v, ttl) { try { const c = edge(); if (c) await c.put(edgeKey(k, tier), new Response(JSON.stringify(v), { headers: { "content-type": "application/json", "cache-control": "max-age=" + ttl } })); } catch (e) { console.error("cp cache write", e && e.message); } }
async function memo(env, key, fn) {
  let m = memos.get(env); if (!m) { m = new Map(); memos.set(env, m); }
  const ttl = env.READ_MEMO_MS !== undefined ? Number(env.READ_MEMO_MS) : MEMO_MS;
  const hit = m.get(key); if (hit && Date.now() - hit.at < ttl) return hit.v;
  const useEdge = ttl > 0;
  if (useEdge) { const e = await edgeGet(key, "fresh"); if (e) { m.set(key, { at: Date.now(), v: e }); return e; } }
  try {
    const v = await fn(); m.set(key, { at: Date.now(), v });
    if (useEdge) { await edgePut(key, "fresh", v, EDGE_FRESH_S); await edgePut(key, "last", v, EDGE_KEEP_S); }
    return v;
  } catch (err) {
    const last = (hit && hit.v) || (useEdge && await edgeGet(key, "last"));
    if (last) { console.error("cp serving last-known data", err && err.message); return last; }
    throw err;
  }
}
export const status = (env, now = Date.now()) => memo(env, "status", () => statusRaw(env, now));
export const agents = (env, now = Date.now()) => memo(env, "agents", () => agentsRaw(env, now));
export const work = (env, view = "on_deck", limit = 50) => memo(env, "work:" + view + ":" + limit, () => workRaw(env, view, limit));
export const activity = (env, limit = 30) => memo(env, "activity:" + limit, () => activityRaw(env, limit));
export const handoffs = (env, state, limit = 50) => memo(env, "handoffs:" + state + ":" + limit, () => handoffsRaw(env, state, limit));


async function statusRaw(env, now = Date.now()) {
  const db = env.ORG;
  const tick = await first(db, "SELECT id, started_at, finished_at, steps_completed, steps_total, report, errors FROM tick_runs ORDER BY id DESC LIMIT 1");
  const items = await all(db, "SELECT status, count(*) AS n FROM items GROUP BY status");
  const disp = await all(db, "SELECT status, count(*) AS n FROM dispatches GROUP BY status");
  const d24 = await all(db, "SELECT status, count(*) AS n FROM dispatches WHERE at >= datetime(?, 'unixepoch') GROUP BY status", Math.floor(now / 1000) - 86400);
  const roles = await all(db, "SELECT id, last_tick_at FROM roles");
  const gates = await first(db, "SELECT count(*) AS n FROM gate_cards WHERE status = 'open'");
  let ho = []; try { ho = await all(db, "SELECT state, count(*) AS n FROM handoffs GROUP BY state"); } catch (e) { /* table arrives with migration 0010 */ }
  const by = (rows) => Object.fromEntries(rows.map(r => [r.status, r.n]));
  const dispBy = by(disp), total = disp.reduce((a, r) => a + r.n, 0), settled = total - (dispBy.queued || 0) - (dispBy.running || 0);
  const report = tick && tick.report ? String(tick.report) : "";
  const red = (/selfaudit: (\d+) green, (\d+) red(?: \(([^)]*)\))?/.exec(report) || []);
  const tickAge = tick ? ageS(tick.finished_at || tick.started_at, now) : null;
  const active = roles.filter(r => { const a = ageS(r.last_tick_at, now); return a != null && a <= ACTIVE_AGENT_S; }).length;
  const reasons = [];
  if (tickAge == null) reasons.push("no tick has ever run");
  else if (tickAge > STALE_TICK_S) reasons.push(`heartbeat is ${Math.round(tickAge / 60)} min old (expected every 10 min)`);
  if (tick && tick.errors) reasons.push("last tick reported errors");
  if (total > 0 && settled === 0) reasons.push(`none of ${total} agent dispatches has been executed (all still queued)`);
  if (red[2] && Number(red[2]) > 0) reasons.push(`self-audit red: ${red[3] || red[2]}`);
  const verdict = tickAge == null || tickAge > STALE_TICK_S ? "stalled" : reasons.length ? "degraded" : "healthy";
  return {
    api_version: API_VERSION, generated: new Date(now).toISOString(), verdict, reasons,
    heartbeat: tick ? { tick: tick.id, at: tick.finished_at || tick.started_at, age_s: tickAge, steps: `${tick.steps_completed}/${tick.steps_total}`, report: report.split("\n")[0], errors: tick.errors || null } : null,
    work: { by_status: by(items), total: items.reduce((a, r) => a + r.n, 0) },
    dispatch: { by_status: dispBy, total, settled, settled_share: total ? +(settled / total).toFixed(3) : null, last_24h: by(d24) },
    agents: { total: roles.length, active_last_hour: active },
    owner: { open_gate_cards: gates ? gates.n : 0 },
    handoffs: Object.fromEntries(ho.map(r => [r.state, r.n])),
    self_audit: red[1] ? { green: Number(red[1]), red: Number(red[2]), failing: red[3] ? red[3].split(",").map(s => s.trim()) : [] } : null,
  };
}

// MODEL-TRUTH-1: roles.model is a configured tier label from bootstrap (it said claude-haiku-5-5 while no Claude model was ever called);
// the model shown is what the dispatch rows record as having run in the last 24 h. The code executor (worker-native) is listed as an
// agent too: it is the only one that changes code, and its work is the items marked in-pr (CODE-QUEUE-1).
const TICK_S = 600, LINED_UP = 3;
export const CODE_AGENT = { id: "code-executor", role: "code-executor", ticks_every: 1, fallback_model: "Workers AI: @cf/zai-org/glm-5.3-flash, then @cf/meta/llama-3.3-70b-instruct-fp8-fast, then @cf/qwen/qwen2.5-coder-32b-instruct" };
const isoAfter = (s, sec) => { const t = ts(s); return t == null ? null : new Date(t + sec * 1000).toISOString().replace("T", " ").slice(0, 19); };
const prOf = b => { const m = /^in-pr:\s*(\S+)(?:.*?model:\s*(\S+))?/.exec(b || ""); return m ? { url: m[1], model: m[2] || null } : null; };

async function agentsRaw(env, now = Date.now()) {
  const db = env.ORG, since = Math.floor(now / 1000) - 86400;
  const roles = await all(db, "SELECT id, role, project, tick_every, last_tick_at FROM roles ORDER BY role, id");
  const claims = await all(db, "SELECT c.agent, c.item_id, c.claimed_at, c.heartbeat_at, i.title, i.status FROM claims c LEFT JOIN items i ON i.id = c.item_id");
  const stats = await all(db, "SELECT role_id, count(*) AS total, sum(CASE WHEN status NOT IN ('queued','running') THEN 1 ELSE 0 END) AS settled, sum(CASE WHEN at >= datetime(?, 'unixepoch') THEN 1 ELSE 0 END) AS last_24h, max(at) AS last_at FROM dispatches GROUP BY role_id", since);
  const used = await all(db, "SELECT role_id, model, count(*) AS n FROM dispatches WHERE at >= datetime(?, 'unixepoch') AND model IS NOT NULL AND model <> 'pending' GROUP BY role_id, model ORDER BY n DESC", since);
  const last = await all(db, "SELECT d.role_id, d.item_id, d.status, d.model, d.at, i.title, i.blocker FROM dispatches d LEFT JOIN items i ON i.id = d.item_id WHERE d.id IN (SELECT max(id) FROM dispatches GROUP BY role_id)");
  const queue = await all(db, "SELECT i.id, i.title, i.owner_role, i.priority FROM items i LEFT JOIN claims c ON c.item_id = i.id WHERE i.status IN ('ready','open') AND c.item_id IS NULL ORDER BY i.priority DESC, CASE i.status WHEN 'ready' THEN 0 ELSE 1 END, i.created_at ASC LIMIT 400");
  const inPr = await all(db, "SELECT id, title, blocker, updated_at FROM items WHERE status = 'blocked' AND blocker LIKE 'in-pr:%' ORDER BY updated_at DESC LIMIT 20");
  const codeQ = await all(db, "SELECT id, title, priority FROM items WHERE status = 'blocked' AND blocker LIKE 'needs-code:%' ORDER BY priority DESC, updated_at ASC LIMIT ?", LINED_UP);
  const codeN = await first(db, "SELECT count(*) AS n FROM items WHERE status = 'blocked' AND blocker LIKE 'needs-code:%'");
  const tick = await first(db, "SELECT started_at FROM tick_runs ORDER BY id DESC LIMIT 1");
  const S = Object.fromEntries(stats.map(s => [s.role_id, s])), L = Object.fromEntries(last.map(l => [l.role_id, l]));
  const U = {}; for (const u of used) (U[u.role_id] = U[u.role_id] || []).push({ model: u.model, dispatches: u.n });
  const Q = {}; for (const q of queue) (Q[q.owner_role] = Q[q.owner_role] || []).push(q);
  const list = roles.map(r => {
    const mine = claims.filter(c => c.agent === r.id), s = S[r.id] || {}, l = L[r.id], a = ageS(r.last_tick_at, now), q = Q[r.role] || [];
    const models = U[r.id] || [];
    return {
      id: r.id, role: r.role, project: r.project || null, ticks_every: r.tick_every,
      model: models.length ? models.map(m => m.model).join(", ") : "none in 24 h", models_24h: models,
      state: a == null ? "never ran" : a > ACTIVE_AGENT_S ? "idle" : mine.length ? "working" : "waiting",
      last_tick_at: r.last_tick_at, last_tick_age_s: a, next_tick_at: isoAfter(r.last_tick_at, (r.tick_every || 1) * TICK_S),
      working_on: mine.map(c => ({ item: c.item_id, title: c.title, item_status: c.status, since: c.claimed_at, heartbeat_age_s: ageS(c.heartbeat_at, now) })),
      lined_up: q.slice(0, LINED_UP).map(x => ({ item: x.id, title: x.title, priority: x.priority })),
      last_dispatch: l ? { item: l.item_id, title: l.title, status: l.status, model: l.model, at: l.at, result: l.blocker ? String(l.blocker).slice(0, 200) : null } : null,
      dispatches: { total: s.total || 0, settled: s.settled || 0, last_24h: s.last_24h || 0 },
      on_deck_for_role: q.length,
    };
  });
  const prModels = [...new Set(inPr.map(i => (prOf(i.blocker) || {}).model).filter(Boolean))];
  list.push({
    id: CODE_AGENT.id, role: CODE_AGENT.role, project: null, ticks_every: 1,
    model: prModels.length ? prModels.join(", ") : CODE_AGENT.fallback_model, models_24h: prModels.map(m => ({ model: m })),
    state: inPr.length ? "working" : (codeN && codeN.n) ? "waiting" : "idle",
    last_tick_at: tick ? tick.started_at : null, last_tick_age_s: tick ? ageS(tick.started_at, now) : null, next_tick_at: tick ? isoAfter(tick.started_at, TICK_S) : null,
    working_on: inPr.map(i => ({ item: i.id, title: i.title, item_status: "in PR", pr: (prOf(i.blocker) || {}).url || null, since: i.updated_at })),
    lined_up: codeQ.map(x => ({ item: x.id, title: x.title, priority: x.priority })),
    last_dispatch: null, dispatches: { total: inPr.length, settled: 0, last_24h: inPr.length }, on_deck_for_role: codeN ? codeN.n : 0,
  });
  return { api_version: API_VERSION, generated: new Date(now).toISOString(), agents: list };
}

// OPS-QUEUE-1: one owner view, every item says which org/app it belongs to. Ultrastable is the platform; a tenant (Practical Solutions, QNFO) is an app on it,
// so its items live in the same queue and carry a tenant label derived from the id and surface, never a second dashboard.
export function tenantOf(r) {
  const t = String((r && r.id) || "") + " " + String((r && r.surface) || "") + " " + String((r && r.title) || "");
  if (/\bQNFO\b/i.test(t)) return "QNFO";
  if (/practical[- ]solutions|\bPS-/i.test(t)) return "Practical Solutions";
  return "Ultrastable";
}

async function workRaw(env, view = "on_deck", limit = 50) {
  const db = env.ORG, lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const where = { on_deck: "i.status IN ('ready','open') AND c.item_id IS NULL", in_progress: "((i.status = 'claimed' OR c.item_id IS NOT NULL) AND i.status NOT IN ('done') OR (i.status = 'blocked' AND i.blocker LIKE 'in-pr:%'))", blocked: "i.status = 'blocked' AND coalesce(i.blocker, '') NOT LIKE 'in-pr:%'", done: "i.status = 'done'", all: "1=1" }[view];
  if (!where) return null;
  const order = view === "done" ? "i.updated_at DESC" : "i.priority DESC, CASE i.status WHEN 'ready' THEN 0 ELSE 1 END, i.created_at ASC";
  const rows = await all(db, `SELECT i.id, i.title, i.kind, i.owner_role, i.priority, i.status, i.blocker, i.disposition, i.action_class, i.done_check, i.surface, i.created_at, i.updated_at, c.agent, c.claimed_at,
      (SELECT count(*) FROM dispatches d WHERE d.item_id = i.id) AS dispatch_count
    FROM items i LEFT JOIN claims c ON c.item_id = i.id WHERE ${where} ORDER BY ${order} LIMIT ?`, lim);
  const count = await first(db, `SELECT count(*) AS n FROM items i LEFT JOIN claims c ON c.item_id = i.id WHERE ${where}`);
  return { api_version: API_VERSION, view, label: WORK_VIEWS[view], count: count ? count.n : rows.length, items: rows.map((r, i) => ({ rank: i + 1, tenant: tenantOf(r), ...r })) };
}

export async function workItem(env, id) {
  const db = env.ORG;
  const item = await first(db, "SELECT * FROM items WHERE id = ?", id);
  if (!item) return null;
  const claim = await first(db, "SELECT agent, claimed_at, heartbeat_at FROM claims WHERE item_id = ?", id);
  const history = await all(db, "SELECT id, tick_id, role_id, model, status, at FROM dispatches WHERE item_id = ? ORDER BY id DESC LIMIT 50", id);
  return { api_version: API_VERSION, item, claim, dispatches: history };
}

async function activityRaw(env, limit = 30) {
  const db = env.ORG, lim = Math.max(1, Math.min(100, Number(limit) || 30));
  const dispatches = await all(db, "SELECT d.id, d.role_id AS agent, d.item_id AS item, i.title, d.status, d.model, d.at FROM dispatches d LEFT JOIN items i ON i.id = d.item_id ORDER BY d.id DESC LIMIT ?", lim);
  const ticks = await all(db, "SELECT id, started_at, steps_completed, steps_total, report, errors FROM tick_runs ORDER BY id DESC LIMIT 10");
  return { api_version: API_VERSION, dispatches, ticks: ticks.map(t => ({ id: t.id, at: t.started_at, steps: `${t.steps_completed}/${t.steps_total}`, summary: String(t.report || "").split("\n")[0], errors: t.errors || null })) };
}

// Hosted products: Ultrastable's own services, plus every tenant site it built (BUILD-2: <id>.ultrastable.io). Each lists its discovery documents.
export const PLATFORM_SERVICES = [
  { id: "ultrastable-api", kind: "api", name: "Ultrastable control-plane API", url: ORIGIN + "/api/v1", health: ORIGIN + "/health", discovery: { openapi: ORIGIN + "/openapi.json", api_catalog: ORIGIN + "/.well-known/api-catalog", agent_card: ORIGIN + "/.well-known/agent-card.json", mcp: ORIGIN + "/.well-known/mcp/server-card.json", llms: ORIGIN + "/llms.txt" } },
  { id: "ultrastable-mcp", kind: "mcp", name: "Ultrastable MCP server", url: ORIGIN + "/mcp", health: ORIGIN + "/health", discovery: { mcp: ORIGIN + "/.well-known/mcp/server-card.json" } },
  { id: "ultrastable-ops", kind: "dashboard", name: "Operations dashboard", url: "https://dashboard.ultrastable.io/", health: ORIGIN + "/health", discovery: { api: ORIGIN + "/api/v1" } },
  { id: "ultrastable-live", kind: "record", name: "Live record (daily snapshot)", url: ORIGIN + "/live", health: ORIGIN + "/health", discovery: { openapi: ORIGIN + "/openapi.json" } },
];
export const tenantDiscovery = (id) => { const o = "https://" + id + ".ultrastable.io"; return { id, kind: "tenant-site", name: "Tenant site " + id, url: o + "/", health: o + "/health", discovery: { api_catalog: o + "/.well-known/api-catalog", api: o + "/s/" + id + "/api" } }; };

export async function products(env) {
  const ids = new Set();
  try { if (env.DB) for (const r of await all(env.DB, "SELECT DISTINCT site FROM site_data LIMIT 200")) if (/^[a-f0-9]{10}$/.test(r.site)) ids.add(r.site); } catch (e) { /* table absent on a fresh account */ }
  try { if (env.ASSETS && env.ASSETS.list) { const l = await env.ASSETS.list({ prefix: "state:", limit: 200 }); for (const k of l.keys || []) { const id = k.name.slice(6); if (/^[a-f0-9]{10}$/.test(id)) ids.add(id); } } } catch (e) { /* KV list unavailable */ }
  return { api_version: API_VERSION, platform: PLATFORM_SERVICES, tenants: [...ids].sort().map(tenantDiscovery) };
}

// Plain-language digest for the owner's personal companion: what is happening, what is next, what needs the owner.
export async function companionBrief(env, now = Date.now()) {
  const [s, a, deck, gates] = await Promise.all([status(env, now), agents(env, now), work(env, "on_deck", 3), all(env.ORG, "SELECT id, what, why_gated, default_in_effect FROM gate_cards WHERE status = 'open' LIMIT 5")]);
  const working = a.agents.filter(x => x.working_on.length);
  const w = s.work.by_status, mins = s.heartbeat ? Math.round(s.heartbeat.age_s / 60) : null;
  const lines = [
    s.heartbeat ? `Ultrastable is ${s.verdict}; its last heartbeat was ${mins} minute${mins === 1 ? "" : "s"} ago.` : "Ultrastable has not run yet.",
    `${working.length} of ${s.agents.total} agents hold work; ${w.ready || 0} items are ready, ${w.blocked || 0} blocked, ${w.done || 0} done.`,
    deck.items.length ? `Next up: ${deck.items.map(i => i.id).join(", ")}.` : "Nothing is on deck.",
    s.reasons.length ? `Watch: ${s.reasons[0]}.` : "",
    gates.length ? `${gates.length} step${gates.length === 1 ? "" : "s"} need${gates.length === 1 ? "s" : ""} you: ${gates.map(g => g.what).join("; ")}.` : "Nothing needs you.",
  ].filter(Boolean);
  return {
    api_version: API_VERSION, generated: new Date(now).toISOString(), headline: lines[0], text: lines.join(" "), verdict: s.verdict,
    needs_you: gates, next_up: deck.items.map(i => ({ id: i.id, title: i.title, owner_role: i.owner_role })),
    working: working.map(x => ({ agent: x.id, items: x.working_on.map(i => i.item) })),
    links: { dashboard: "https://dashboard.ultrastable.io/", status: ORIGIN + "/api/v1/status" },
  };
}

// ---- the one write: intake from an authenticated integration ----
export async function authIntegration(request, env) {
  const cfg = String(env.INTEGRATION_TOKENS || "").split(",").map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf(":"); return { name: s.slice(0, i), hash: s.slice(i + 1).toLowerCase() }; }).filter(x => x.name && /^[0-9a-f]{64}$/.test(x.hash));
  if (!cfg.length) return { ok: false, status: 503, error: "intake is not configured (secret INTEGRATION_TOKENS unset)" };
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get("authorization") || "");
  if (!m) return { ok: false, status: 401, error: "missing bearer token" };
  const h = await sha256(m[1]), hit = cfg.find(c => c.hash === h);
  return hit ? { ok: true, name: hit.name } : { ok: false, status: 403, error: "unknown token" };
}

// AGENT-HARNESS-1: one intake path for every client (REST and MCP). Attribution (which agent, in which harness) is recorded on the item's surface so inputs from different agents can be compared.
const attr = v => String(v || "").trim().replace(/[^A-Za-z0-9._:\/-]/g, "").slice(0, 60);
export async function submitIntake(env, authName, b, now = Date.now()) {
  const title = String((b && b.title) || "").trim().slice(0, 200), detail = String((b && b.detail) || "").trim().slice(0, 4000);
  if (!title) return { status: 422, body: { error: "title is required" } };
  const kind = ["idea", "request", "bug", "question"].includes(b.kind) ? b.kind : "request";
  const pr = Math.max(1, Math.min(90, Number(b.priority) || 50));  // above 90 is reserved for the org's own driver
  const agent = attr(b.agent), harness = attr(b.harness);
  const surface = "integration:" + authName + (agent ? " agent:" + agent : "") + (harness ? " harness:" + harness : "");
  const id = "IN-" + new Date(now).toISOString().slice(0, 10).replace(/-/g, "") + "-" + (await sha256(authName + title + now)).slice(0, 6);
  await env.ORG.prepare("INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, surface, disposition) VALUES (?, ?, ?, 'product-manager', ?, ?, ?, 'open', ?, ?)")
    .bind(id, `${id}: ${title}`, "intake-" + kind, "product-manager triaged it: accepted with a plan, merged into an existing item, or declined with a reason", "GET /api/v1/work/" + id, pr, surface, detail || null).run();
  return { status: 201, body: { ok: true, id, status: "open", owner_role: "product-manager", url: ORIGIN + "/api/v1/work/" + id, attributed_to: { agent: agent || null, harness: harness || null } } };
}

export async function intake(request, env, now = Date.now()) {
  const auth = await authIntegration(request, env);
  if (!auth.ok) return json({ error: auth.error }, auth.status, auth.status === 401 ? { "www-authenticate": "Bearer" } : undefined);
  let b; try { b = await request.json(); } catch (e) { return json({ error: "body must be JSON" }, 400); }
  const r = await submitIntake(env, auth.name, b || {}, now);
  return json(r.body, r.status);
}

// ---- HANDOFF-1 / CODE-AGENT-SOP-1: the server's record of handed-off work, and the two writes a code agent may make ----
async function handoffsRaw(env, state, limit = 50) {
  const db = env.ORG, lim = Math.max(1, Math.min(200, Number(limit) || 50));
  const rows = state ? await all(db, "SELECT * FROM handoffs WHERE state = ? ORDER BY updated_at DESC LIMIT ?", state, lim) : await all(db, "SELECT * FROM handoffs ORDER BY updated_at DESC LIMIT ?", lim);
  const ev = rows.length ? await all(db, `SELECT handoff_id, at, state, detail FROM handoff_events WHERE handoff_id IN (${rows.map(() => "?").join(",")}) ORDER BY id DESC`, ...rows.map(r => r.id)) : [];
  return { api_version: API_VERSION, count: rows.length, handoffs: rows.map(r => ({ ...r, url: "https://github.com/" + r.repo + "/pull/" + r.pr, events: ev.filter(e => e.handoff_id === r.id).slice(0, 10) })) };
}
export function sop() { return { api_version: API_VERSION, sop_version: SOP_VERSION, steps: SOP_STEPS, server_owns: SERVER_OWNS, skill: ORIGIN + "/.well-known/agent-skills/ultrastable-code-agent/SKILL.md" }; }
async function bodyJson(request) { try { return await request.json(); } catch (e) { return null; } }
export async function postHandoff(request, env) {
  const auth = await authIntegration(request, env); if (!auth.ok) return json({ error: auth.error }, auth.status);
  const b = await bodyJson(request); if (!b) return json({ error: "body must be JSON" }, 400);
  const repo = String(b.repo || ""), pr = Number(b.pr);
  if (!/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo) || !Number.isInteger(pr) || pr < 1) return json({ error: "repo (owner/name) and pr (number) are required" }, 422);
  const allowed = String(env.GITHUB_REPOS || "ultrastable/ultrastable").split(",").map(x => x.trim());
  if (!allowed.includes(repo)) return json({ error: "repo is not one the server manages: " + allowed.join(", ") }, 422);
  const id = await registerHandoff(env.ORG, { repo, pr, title: b.title ? String(b.title).slice(0, 200) : null, item: b.item ? String(b.item).slice(0, 120) : null, agent: String(b.agent || "integration:" + auth.name).slice(0, 80), verify: b.verify ? String(b.verify).slice(0, 400) : null, deploy: b.deploy ? String(b.deploy).slice(0, 200) : null });
  await env.ORG.prepare("INSERT INTO handoff_events (handoff_id, state, detail) VALUES (?, 'open', ?)").bind(id, "registered through the API by " + auth.name).run();
  return json({ ok: true, id, state: "open", track: ORIGIN + "/api/v1/handoffs" }, 201);
}
export async function claimItem(request, env, itemId) {
  const auth = await authIntegration(request, env); if (!auth.ok) return json({ error: auth.error }, auth.status);
  const b = (await bodyJson(request)) || {}, agent = ("ext:" + auth.name + ":" + String(b.agent || "agent")).slice(0, 80).replace(/[^A-Za-z0-9:._-]/g, "-");
  const it = await first(env.ORG, "SELECT id, status FROM items WHERE id = ?", itemId); if (!it) return json({ error: "no such item" }, 404);
  if (!["ready", "open"].includes(it.status)) return json({ error: "item is " + it.status + ", not claimable" }, 409);
  const held = await first(env.ORG, "SELECT agent FROM claims WHERE item_id = ?", itemId); if (held) return json({ error: "already claimed by " + held.agent }, 409);
  await env.ORG.prepare("INSERT INTO claims (item_id, agent) VALUES (?, ?)").bind(itemId, agent).run();
  await env.ORG.prepare("UPDATE items SET status = 'claimed', updated_at = datetime('now') WHERE id = ?").bind(itemId).run();
  return json({ ok: true, item: itemId, agent, next: "build, verify, open a PR with a ## Handoff block (item: " + itemId + "), then stop. SOP: " + ORIGIN + "/api/v1/sop" }, 201);
}

// ---- router ----
export const OPENAPI_PATHS = {
  ...WEBHOOK_OPENAPI_PATHS, // WEBHOOKS-1
  "/api/v1": { get: { operationId: "apiIndex", summary: "Index of the control-plane API", responses: { "200": { description: "Links" } } } },
  "/api/v1/status": { get: { operationId: "getStatus", summary: "Health verdict, heartbeat, work and dispatch counts, live from the org database", responses: { "200": { description: "Status" }, "503": { description: "Org database not bound" } } } },
  "/api/v1/agents": { get: { operationId: "listAgents", summary: "Every virtual agent: role, model, state, what it is working on, dispatch record", responses: { "200": { description: "Agents" } } } },
  "/api/v1/work": { get: { operationId: "listWork", summary: "Backlog by view: on_deck (ranked), in_progress, blocked, done, all", parameters: [{ name: "view", in: "query", schema: { type: "string", enum: Object.keys(WORK_VIEWS) } }, { name: "limit", in: "query", schema: { type: "integer", maximum: 200 } }], responses: { "200": { description: "Items" } } } },
  "/api/v1/work/{id}": { get: { operationId: "getWorkItem", summary: "One item with its claim and dispatch history", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Item" }, "404": { description: "No such item" } } } },
  "/api/v1/activity": { get: { operationId: "getActivity", summary: "Recent dispatches and tick reports", responses: { "200": { description: "Activity" } } } },
  "/api/v1/products": { get: { operationId: "listProducts", summary: "Hosted products and services with their discovery documents", responses: { "200": { description: "Products" } } } },
  "/api/v1/companion/brief": { get: { operationId: "getCompanionBrief", summary: "Plain-language digest for a personal assistant: state, next up, what needs the owner", responses: { "200": { description: "Brief" } } } },
  "/api/v1/sop": { get: { operationId: "getSop", summary: "The code-agent standard operating procedure: take, build, verify, hand off, stop", responses: { "200": { description: "SOP" } } } },
  "/api/v1/handoffs": { get: { operationId: "listHandoffs", summary: "Work handed to the server and each state it moved through (open, merged, deployed, verified, rolled_back ...)", parameters: [{ name: "state", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Handoffs" } } } },
  "/api/v1/handoff": { post: { operationId: "submitHandoff", summary: "Hand a PR to the server (bearer token); the server merges, deploys, probes and closes", security: [{ bearer: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["repo", "pr"], properties: { repo: { type: "string" }, pr: { type: "integer" }, item: { type: "string" }, agent: { type: "string" }, verify: { type: "string" }, deploy: { type: "string" } } } } } }, responses: { "201": { description: "Registered" }, "401": { description: "No token" }, "422": { description: "Invalid" } } } },
  "/api/v1/work/{id}/claim": { post: { operationId: "claimWork", summary: "Claim a work order for a code agent (bearer token)", security: [{ bearer: [] }], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "201": { description: "Claimed" }, "409": { description: "Not claimable" } } } },
  "/api/v1/export": { get: { operationId: "exportData", summary: "Everything this integration submitted, as portable JSON (schema ultrastable-export/v1)", security: [{ bearer: [] }], responses: { "200": { description: "Bundle" } } } },
  "/api/v1/import": { post: { operationId: "importData", summary: "Replay an export bundle; idempotent", security: [{ bearer: [] }], responses: { "200": { description: "Counts" }, "422": { description: "Not an export bundle" } } } },
  "/api/v1/intake": { post: { operationId: "submitIntake", summary: "Submit an idea, request, bug or question as a backlog item (bearer token)", security: [{ bearer: [] }], requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["title"], properties: { title: { type: "string", maxLength: 200 }, detail: { type: "string", maxLength: 4000 }, kind: { type: "string", enum: ["idea", "request", "bug", "question"] }, priority: { type: "integer", minimum: 1, maximum: 90 } } } } } }, responses: { "201": { description: "Created" }, "401": { description: "No token" }, "403": { description: "Unknown token" }, "503": { description: "Intake not configured" } } } },
};

export async function controlPlane(request, env, ctx) {
  const u = new URL(request.url), p = u.pathname.replace(/\/$/, "");
  if (!p.startsWith("/api/v1")) return null;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const cm = /^\/api\/v1\/work\/([A-Za-z0-9._:-]{1,120})\/claim$/.exec(p);
  if (p === "/api/v1/handoff" || cm) {
    if (request.method !== "POST") return json({ error: "use POST" }, 405, { allow: "POST, OPTIONS" });
    if (!env || !env.ORG) return json({ error: "org database not bound (ORG)" }, 503);
    return cm ? claimItem(request, env, decodeURIComponent(cm[1])) : postHandoff(request, env);
  }
  if (p === "/api/v1/export" || p === "/api/v1/import") {  // PORTABILITY-1
    if (!env || !env.ORG) return json({ error: "org database not bound (ORG)" }, 503);
    const auth = await authIntegration(request, env);
    if (!auth.ok) return json({ error: auth.error }, auth.status, auth.status === 401 ? { "www-authenticate": "Bearer" } : undefined);
    if (p === "/api/v1/export") return request.method === "GET" ? json(await exportBundle(env, auth.name)) : json({ error: "use GET" }, 405, { allow: "GET, OPTIONS" });
    if (request.method !== "POST") return json({ error: "use POST" }, 405, { allow: "POST, OPTIONS" });
    let b; try { b = await request.json(); } catch (e) { return json({ error: "body must be JSON" }, 400); }
    const r = await importBundle(env, auth.name, b); return json(r.body, r.status);
  }
  if (p === "/api/v1/intake") {
    if (request.method !== "POST") return json({ error: "use POST" }, 405, { allow: "POST, OPTIONS" });
    if (!env || !env.ORG) return json({ error: "org database not bound (ORG)" }, 503);
    return intake(request, env);
  }
  if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "read-only" }, 405, { allow: "GET, HEAD, OPTIONS" });
  if (p === "/api/v1") return json({ api_version: API_VERSION, name: "Ultrastable control-plane API", docs: ORIGIN + "/openapi.json", dashboard: "https://dashboard.ultrastable.io/", endpoints: Object.keys(OPENAPI_PATHS).map(k => ({ path: k, method: Object.keys(OPENAPI_PATHS[k])[0].toUpperCase(), summary: Object.values(OPENAPI_PATHS[k])[0].summary })) });
  if (p === "/api/v1/products") return json(await products(env || {}));
  if (p === "/api/v1/sop") return json(sop());
  if (!env || !env.ORG) return json({ error: "org database not bound (ORG)" }, 503);
  try {
    if (p === "/api/v1/status") return json(await status(env));
    if (p === "/api/v1/agents") return json(await agents(env));
    if (p === "/api/v1/handoffs") return json(await handoffs(env, u.searchParams.get("state"), u.searchParams.get("limit")));
    if (p === "/api/v1/activity") return json(await activity(env, u.searchParams.get("limit")));
    if (p === "/api/v1/companion/brief") return json(await companionBrief(env));
    if (p === "/api/v1/work") { const r = await work(env, u.searchParams.get("view") || "on_deck", u.searchParams.get("limit")); return r ? json(r) : json({ error: "view must be one of " + Object.keys(WORK_VIEWS).join(", ") }, 400); }
    const m = /^\/api\/v1\/work\/([A-Za-z0-9._:-]{1,120})$/.exec(p);
    if (m) { const r = await workItem(env, decodeURIComponent(m[1])); return r ? json(r) : json({ error: "no such item" }, 404); }
  } catch (e) { console.error("control-plane", String(e && e.stack || e)); const msg = String(e && e.message || e); if (/row read limit|free tier/i.test(msg)) { const r = json({ error: "the daily database read allowance is used up; live data returns at 00:00 UTC", code: "d1_read_limit" }, 503); r.headers.set("retry-after", "3600"); return r; } return json({ error: "query failed", detail: msg }, 500); }
  return json({ error: "not found", index: ORIGIN + "/api/v1" }, 404);
}

// ---- /ops: the operations dashboard (also the root of dashboard.ultrastable.io). Client-side render of /api/v1, refreshed every 30 s. ----
const OPS_JS = `
const $=s=>document.querySelector(s),api=p=>fetch('/api/v1/'+p,{cache:'no-store'}).then(r=>r.json().then(j=>{if(!r.ok)throw new Error(j.error||r.status);return j}));
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function ago(s){if(s==null)return'never';if(s<90)return s+' s ago';if(s<5400)return Math.round(s/60)+' min ago';if(s<172800)return Math.round(s/3600)+' h ago';return Math.round(s/86400)+' d ago'}
function table(head,rows){const w=el('div','us-wrap'),t=el('table','us-table'),h=el('tr');head.forEach(x=>h.appendChild(el('th',null,x)));t.appendChild(h);
 if(!rows.length){const tr=el('tr'),td=el('td',null,'none');td.colSpan=head.length;tr.appendChild(td);t.appendChild(tr)}
 rows.forEach(r=>{const tr=el('tr');r.forEach(c=>{const td=el('td');if(c&&c.href){const a=el('a',null,c.t);a.href=c.href;td.appendChild(a)}else if(c&&c.pill){td.appendChild(el('span','pill '+c.pill,c.t))}else td.textContent=c==null?'':String(c);tr.appendChild(td)});t.appendChild(tr)});w.appendChild(t);return w}
function card(id,title,sub){let s=document.getElementById(id);if(!s){s=el('section','card');s.id=id;$('#ops').appendChild(s)}s.textContent='';s.appendChild(el('h2',null,title));if(sub)s.appendChild(el('p','meta',sub));return s}
let TEN=(function(){try{return localStorage.getItem('ten')||'all'}catch(e){return'all'}})();const tf=l=>TEN==='all'?l:l.filter(i=>i.tenant===TEN);
const it=i=>({t:i,href:'/api/v1/work/'+encodeURIComponent(i)});
async function draw(){try{
 const [s,a,prog,deck,blk,act,done,ho]=await Promise.all([api('status'),api('agents'),api('work?view=in_progress'),api('work?view=on_deck&limit=25'),api('work?view=blocked&limit=25'),api('activity?limit=20'),api('work?view=done&limit=10'),api('handoffs?limit=20')]);
 if(s.error){$('#ops').textContent=s.error;return}
 const v=$('#verdict');v.textContent=s.verdict.toUpperCase();v.className='pill '+(s.verdict==='healthy'?'good':s.verdict==='degraded'?'warn':'bad');
 $('#asof').textContent='Live from the org database. Last heartbeat: tick '+(s.heartbeat?s.heartbeat.tick+', '+ago(s.heartbeat.age_s):'none')+'. Refreshed '+new Date().toLocaleTimeString()+'.';
 const k=card('c-now','Right now'),w=s.work.by_status,d=s.dispatch;
 const g=el('div','kpis');[['Agents active (1 h)',s.agents.active_last_hour+' / '+s.agents.total],['In progress',prog.count],['On deck',deck.count],['Blocked',w.blocked||0],['Done',w.done||0],['Dispatches executed',d.settled+' / '+d.total],['Needs you',s.owner.open_gate_cards],['Handoffs verified',(s.handoffs&&s.handoffs.verified||0)+' / '+Object.values(s.handoffs||{}).reduce((x,y)=>x+y,0)]].forEach(([l,n])=>{const b=el('div','kpi');b.appendChild(el('div','n',String(n)));b.appendChild(el('div','l',l));g.appendChild(b)});k.appendChild(g);
 if(s.reasons.length){const ul=el('ul','reasons');s.reasons.forEach(r=>ul.appendChild(el('li',null,r)));k.appendChild(ul)}
 if(s.heartbeat)k.appendChild(el('p','meta',s.heartbeat.report));
 card('c-agents','Agents','Each role picks the top item for its role on its tick. One in-tick doer settles every pick: rules first, then Workers AI when a rule cannot. Items that need a code change go to the code executor, which opens a pull request. Model is what actually ran in the last 24 hours, read from the dispatch records.').appendChild(table(['Agent','Model (actually ran, 24 h)','State','Working on','Lined up next','Last result','Dispatches (executed / total, 24 h)','Last tick','Next tick'],a.agents.map(x=>[x.id,x.model,{t:x.state,pill:x.state==='working'?'good':x.state==='waiting'?'warn':'bad'},x.working_on.map(i=>i.item+(i.pr?' ('+i.pr.split('github.com/').pop()+')':'')).join(', ')||'-',(x.lined_up||[]).map(i=>i.item).join(', ')||'-',x.last_dispatch?x.last_dispatch.item+' ('+x.last_dispatch.status+(x.last_dispatch.model?', '+x.last_dispatch.model:'')+')':'-',x.dispatches.settled+' / '+x.dispatches.total+' ('+x.dispatches.last_24h+')',x.last_tick_at?ago(x.last_tick_age_s):'never',x.next_tick_at||'-'])));
 card('c-prog','In progress','Claimed items and the agent that holds each.').appendChild(table(['Item','App','Title','Agent','Since','Dispatches'],tf(prog.items).map(i=>[it(i.id),i.tenant,i.title,i.agent||'-',i.claimed_at||'-',i.dispatch_count])));
 card('c-deck','On deck','Ranked: priority, then ready before open, then oldest first. '+deck.count+' items.').appendChild(table(['#','Item','App','Title','Owner','Priority','Status'],tf(deck.items).map(i=>[i.rank,it(i.id),i.tenant,i.title,i.owner_role,i.priority,i.status])));
 card('c-blk','Blocked',blk.count+' items waiting on something.').appendChild(table(['Item','App','Title','Owner','Blocker'],tf(blk.items).map(i=>[it(i.id),i.tenant,i.title,i.owner_role,i.blocker||i.disposition||'-'])));
 card('c-act','Activity','Newest dispatches and heartbeat reports.').appendChild(table(['When','Agent','Item','Status'],act.dispatches.map(x=>[x.at,x.agent,x.item||'-',{t:x.status,pill:x.status==='done'?'good':x.status==='queued'?'warn':x.status==='failed'?'bad':''}])));
 document.getElementById('c-act').appendChild(table(['Tick','When','Steps','Summary'],act.ticks.map(t=>[t.id,t.at,t.steps,t.summary])));
 card('c-ho','Handoffs','Work code agents handed to the server. The server merges, deploys, probes and closes; no agent comes back.').appendChild(table(['PR','Agent','Item','State','Last step','Updated'],(ho.handoffs||[]).map(h=>[{t:h.repo.split('/')[1]+'#'+h.pr,href:h.url},h.agent||'-',h.item||'-',{t:h.state,pill:h.state==='verified'?'good':/fail|rolled|conflict/.test(h.state)?'bad':'warn'},h.detail||'-',h.updated_at])));
 card('c-done','Recently done').appendChild(table(['Item','App','Title','Updated'],tf(done.items).map(i=>[it(i.id),i.tenant,i.title,i.updated_at])));
}catch(e){$('#asof').textContent='Live data is unavailable right now. It refreshes by itself.'}}
const sel=document.getElementById('tenant');if(sel){sel.value=TEN;sel.onchange=()=>{TEN=sel.value;try{localStorage.setItem('ten',TEN)}catch(e){}draw()}}
draw();setInterval(draw,30000);`;
const OPS_CSS = "<style>.pill{display:inline-block;padding:2px 8px;border-radius:99px;font:600 13px system-ui;border:1px solid var(--line)}.pill.good{color:var(--good);border-color:var(--good)}.pill.warn{color:var(--ac);border-color:var(--ac)}.pill.bad{color:var(--bad);border-color:var(--bad)}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin:8px 0}.kpi{background:var(--sf2);border-radius:6px;padding:10px}.kpi .n{font:700 24px system-ui}.kpi .l{color:var(--ink2);font-size:13px}.reasons{margin:8px 0;padding-left:20px;color:var(--bad)}.us-wrap{overflow-x:auto}</style>";

export function opsPage(shell) {
  const body = OPS_CSS + "<div class=\"head\"><h1>Operations <span id=\"verdict\" class=\"pill\">...</span></h1><p>What Ultrastable is doing on itself: the agents, what each holds, what is on deck, what is blocked. One queue for the platform and every app on it: each item names its app (Ultrastable, Practical Solutions, QNFO) and the filter narrows to one. Owner-only audit log and sign-in: <a href=\"https://dashboard.ultrastable.io/\">owner view</a>. Read-only; the same data is at <a href=\"/api/v1\">/api/v1</a>.</p><p><label>App <select id=\"tenant\"><option value=\"all\">All</option><option>Ultrastable</option><option>Practical Solutions</option><option>QNFO</option></select></label></p><p class=\"meta\" id=\"asof\">Loading...</p></div><div id=\"ops\"></div><script>" + OPS_JS + "</script>";
  return shell({ path: "/ops", title: "Operations: Ultrastable running on Ultrastable", description: "Live operations dashboard: virtual agents, work in progress, the ranked backlog and blockers." }, body);
}
