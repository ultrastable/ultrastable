// CONTROL-PLANE-1: /api/v1, /ops, dashboard host, discovery and intake, against a real SQLite database with the live org schema.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL, fileURLToPath } from "node:url";
const mod = (await import(pathToFileURL(fileURLToPath(new URL("./worker.js", import.meta.url))).href)).default;
const cp = await import(pathToFileURL(fileURLToPath(new URL("./controlplane.js", import.meta.url))).href);
globalThis.fetch = async () => { throw new Error("offline"); };

// D1-shaped handle over node:sqlite
function d1(db) {
  return { prepare(sql) { let args = []; const st = { bind(...a) { args = a; return st; },
    all: async () => ({ results: db.prepare(sql).all(...args) }), first: async () => db.prepare(sql).get(...args) || null, run: async () => db.prepare(sql).run(...args) }; return st; } };
}
const db = new DatabaseSync(":memory:");
db.exec(`CREATE TABLE roles (id TEXT PRIMARY KEY, role TEXT NOT NULL, project TEXT, tick_every INTEGER NOT NULL DEFAULT 1, model TEXT NOT NULL, last_tick_at TEXT);
CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'work', project TEXT, owner_role TEXT NOT NULL, trigger_on TEXT, done_check TEXT NOT NULL, closing_probe TEXT, priority INTEGER NOT NULL DEFAULT 50, status TEXT NOT NULL DEFAULT 'open', disposition TEXT, blocker TEXT, surface TEXT, action_class TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE claims (item_id TEXT PRIMARY KEY, agent TEXT NOT NULL, claimed_at TEXT NOT NULL DEFAULT (datetime('now')), heartbeat_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE gate_cards (id TEXT PRIMARY KEY, what TEXT NOT NULL, why_gated TEXT NOT NULL, default_in_effect TEXT NOT NULL, prepared_by_fleet TEXT, closing_probe TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', closed_at TEXT);
CREATE TABLE dispatches (id INTEGER PRIMARY KEY AUTOINCREMENT, tick_id INTEGER NOT NULL, role_id TEXT NOT NULL, item_id TEXT, model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE tick_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT, steps_completed INTEGER NOT NULL DEFAULT 0, steps_total INTEGER NOT NULL, report TEXT, errors TEXT);`);
// Times are relative to the database clock so the test never decays (no wall-clock assertion).
db.exec(`INSERT INTO roles VALUES ('staff-1','staff',NULL,1,'claude-haiku-5-5',datetime('now','-5 minutes')), ('reviewer-1','reviewer',NULL,1,'small',datetime('now','-3 hours')), ('ops-1','operations',NULL,1,'small',NULL);
INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('A','A: top','staff','x',90,'ready'),('B','B: next','staff','x',50,'open'),('C','C: held','staff','x',70,'claimed'),('D','D: stuck','operations','x',50,'blocked'),('E','E: shipped','staff','x',50,'done');
UPDATE items SET blocker='needs token' WHERE id='D';
INSERT INTO claims (item_id,agent) VALUES ('C','staff-1');
INSERT INTO dispatches (tick_id,role_id,item_id,model,status) VALUES (1,'staff-1','C','m','queued'),(2,'staff-1','C','m','queued'),(3,'reviewer-1','E','m','done');
INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G1','sign the licence','identity-bound','unsigned','probe');
INSERT INTO tick_runs (started_at,finished_at,steps_completed,steps_total,report) VALUES (datetime('now','-2 minutes'),datetime('now','-2 minutes'),10,10,'Happened: tick ran 10/10 steps; selfaudit: 7 green, 2 red (k-below-min,qnfo-audit-d1-budget); dispatched 0 item(s)');`);
const ORG = d1(db);
const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("s3cret")))).map(x => x.toString(16).padStart(2, "0")).join("");
const ENV = { ORG, INTEGRATION_TOKENS: "companion:" + tokenHash, ASSETS: { get: async () => null, list: async () => ({ keys: [{ name: "state:abcdef0123" }, { name: "state:bad" }] }) } };
const get = async (u, env = ENV, init) => mod.fetch(new Request(u, init), env);
const J = async (u, env, init) => { const r = await get(u, env, init); return { status: r.status, body: await r.json(), headers: r.headers }; };

let r = await J("https://ultrastable.io/api/v1");
assert.equal(r.status, 200); assert.ok(r.body.endpoints.some(e => e.path === "/api/v1/intake" && e.method === "POST"));
assert.equal(r.headers.get("access-control-allow-origin"), "*");

r = await J("https://ultrastable.io/api/v1/status");
assert.equal(r.body.verdict, "degraded", "fresh heartbeat but red self-audit");
assert.ok(r.body.heartbeat.age_s < 600); assert.equal(r.body.work.by_status.ready, 1); assert.equal(r.body.dispatch.total, 3); assert.equal(r.body.dispatch.settled, 1);
assert.deepEqual(r.body.self_audit.failing, ["k-below-min", "qnfo-audit-d1-budget"]); assert.equal(r.body.owner.open_gate_cards, 1); assert.equal(r.body.agents.active_last_hour, 1);

r = await J("https://ultrastable.io/api/v1/agents");
const byId = Object.fromEntries(r.body.agents.map(a => [a.id, a]));
assert.equal(byId["staff-1"].state, "working"); assert.equal(byId["staff-1"].working_on[0].item, "C"); assert.equal(byId["staff-1"].dispatches.total, 2); assert.equal(byId["staff-1"].dispatches.settled, 0);
assert.equal(byId["reviewer-1"].state, "idle"); assert.equal(byId["ops-1"].state, "never ran"); assert.equal(byId["staff-1"].on_deck_for_role, 2);

r = await J("https://ultrastable.io/api/v1/work");
assert.deepEqual(r.body.items.map(i => i.id), ["A", "B"], "on deck: ranked by priority, unclaimed only"); assert.equal(r.body.items[0].rank, 1);
assert.deepEqual((await J("https://ultrastable.io/api/v1/work?view=in_progress")).body.items.map(i => [i.id, i.agent]), [["C", "staff-1"]]);
assert.equal((await J("https://ultrastable.io/api/v1/work?view=blocked")).body.items[0].blocker, "needs token");
assert.equal((await J("https://ultrastable.io/api/v1/work?view=nope")).status, 400);
r = await J("https://ultrastable.io/api/v1/work/C"); assert.equal(r.body.claim.agent, "staff-1"); assert.equal(r.body.dispatches.length, 2);
assert.equal((await J("https://ultrastable.io/api/v1/work/ZZZ")).status, 404);
r = await J("https://ultrastable.io/api/v1/activity"); assert.equal(r.body.dispatches[0].id, 3); assert.equal(r.body.ticks.length, 1);

r = await J("https://ultrastable.io/api/v1/products");
assert.ok(r.body.platform.find(p => p.id === "ultrastable-api").discovery.agent_card); assert.deepEqual(r.body.tenants.map(t => t.id), ["abcdef0123"]);

r = await J("https://ultrastable.io/api/v1/companion/brief");
assert.match(r.body.text, /degraded/); assert.match(r.body.text, /Next up: A, B/); assert.match(r.body.text, /sign the licence/); assert.equal(r.body.needs_you[0].id, "G1");

// intake: auth, validation, write
const post = (body, auth) => J("https://ultrastable.io/api/v1/intake", ENV, { method: "POST", headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) });
assert.equal((await post({ title: "x" })).status, 401);
assert.equal((await post({ title: "x" }, "Bearer wrong")).status, 403);
assert.equal((await post({}, "Bearer s3cret")).status, 422);
r = await post({ title: "Add a calendar export", detail: "from the companion", kind: "idea", priority: 99 }, "Bearer s3cret");
assert.equal(r.status, 201); assert.match(r.body.id, /^IN-\d{8}-[0-9a-f]{6}$/);
const row = db.prepare("SELECT * FROM items WHERE id = ?").get(r.body.id);
assert.equal(row.owner_role, "product-manager"); assert.equal(row.priority, 90, "priority capped below the driver band"); assert.equal(row.surface, "integration:companion"); assert.equal(row.kind, "intake-idea");
// AGENT-HARNESS-1: attribution over REST and the MCP write tool
r = await post({ title: "Attributed", agent: "codex", harness: "vscode-codex" }, "Bearer s3cret");
assert.equal(db.prepare("SELECT surface FROM items WHERE id = ?").get(r.body.id).surface, "integration:companion agent:codex harness:vscode-codex"); assert.equal(r.body.attributed_to.agent, "codex");
const rpcw = (args, auth) => J("https://ultrastable.io/mcp", ENV, { method: "POST", headers: { ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "submit_work", arguments: args } }) });
assert.equal((await rpcw({ title: "t", agent: "a", harness: "h" })).status, 401, "MCP write needs a token");
assert.equal((await rpcw({ title: "t", agent: "a" }, "Bearer s3cret")).body.result.isError, true, "agent and harness are required");
const mr = await rpcw({ title: "From MCP", kind: "bug", agent: "claude-code", harness: "vscode-claude" }, "Bearer s3cret");
const mid = JSON.parse(mr.body.result.content[0].text).id; assert.equal(db.prepare("SELECT surface, kind FROM items WHERE id = ?").get(mid).surface, "integration:companion agent:claude-code harness:vscode-claude");
// AGENT-HARNESS-1: A2A v1.0 SendMessage / GetTask
const a2a = (method, params, auth) => J("https://ultrastable.io/a2a", ENV, { method: "POST", headers: { ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id: 9, method, params }) });
assert.equal((await a2a("SendMessage", { message: { parts: [{ text: "x" }] } })).status, 401, "A2A write needs auth");
const sm = await a2a("SendMessage", { message: { parts: [{ text: "Plan the rollout\nwith detail" }] }, metadata: { agent: "gemini", harness: "a2a-peer" } }, "Bearer s3cret");
const atid = sm.body.result.task.id; assert.equal(sm.body.result.task.status.state, "TASK_STATE_SUBMITTED");
assert.equal(db.prepare("SELECT surface FROM items WHERE id = ?").get(atid).surface, "integration:companion agent:gemini harness:a2a-peer");
assert.equal((await a2a("GetTask", { id: atid })).body.result.task.id, atid);
assert.equal((await a2a("GetTask", { id: "nope" })).body.error.message, "TaskNotFoundError");
assert.equal((await J("https://ultrastable.io/.well-known/agent-card.json")).body.supportedInterfaces[0].protocolBinding, "JSONRPC");
// PORTABILITY-1: export then replay into a clean slate is lossless and idempotent
{
  const X = (path, init) => J("https://ultrastable.io" + path, ENV, init), H = { authorization: "Bearer s3cret" };
  assert.equal((await X("/api/v1/export")).status, 401);
  const ex = (await X("/api/v1/export", { headers: H })).body; assert.equal(ex.schema, "ultrastable-export/v1"); assert.ok(ex.count >= 3); assert.ok(ex.items.every(i => i.source.startsWith("integration:companion")));
  assert.ok(!JSON.stringify(ex).includes("s3cret"), "no token in a bundle");
  const imp = () => X("/api/v1/import", { method: "POST", headers: H, body: JSON.stringify(ex) });
  const a1 = (await imp()).body, a2 = (await imp()).body; assert.equal(a1.created, ex.count); assert.equal(a2.created, 0); assert.equal(a2.skipped, ex.count);
  assert.equal((await X("/api/v1/import", { method: "POST", headers: H, body: JSON.stringify({ schema: "x" }) })).status, 422);
}
assert.equal((await J("https://ultrastable.io/api/v1/intake", { ORG })).status, 405, "GET on intake");
assert.equal((await J("https://ultrastable.io/api/v1/intake", { ORG }, { method: "POST", headers: { authorization: "Bearer s3cret" }, body: "{}" })).status, 503, "no tokens configured");
assert.equal((await J("https://ultrastable.io/api/v1/status", {})).status, 503, "no ORG binding is reported, not faked");
assert.equal((await get("https://ultrastable.io/api/v1/status", ENV, { method: "DELETE" })).status, 405);
assert.equal((await get("https://ultrastable.io/api/v1/status", ENV, { method: "OPTIONS" })).status, 204);

// /ops page and the dashboard host
let t = await (await get("https://ultrastable.io/ops")).text(); assert.match(t, /Operations/); assert.match(t, /fetch\('\/api\/v1\/'/);
const dh = await get("https://dashboard.ultrastable.io/"); assert.equal(dh.status, 200); assert.match(await dh.text(), /id="ops"/);
assert.equal((await J("https://dashboard.ultrastable.io/api/v1/status")).body.verdict, "degraded");
const red = await get("https://dashboard.ultrastable.io/proof"); assert.equal(red.status, 302); assert.equal(red.headers.get("location"), "https://ultrastable.io/proof");

// discovery: OpenAPI, catalog, A2A card, live MCP tools, tenant catalog, llms.txt
const oa = (await J("https://ultrastable.io/openapi.json")).body;
for (const p of Object.keys(cp.OPENAPI_PATHS)) assert.ok(oa.paths[p], "openapi lists " + p);
assert.ok(oa.paths["/api/live"] && oa.paths["/mcp"], "existing paths kept");
const cat = (await J("https://ultrastable.io/.well-known/api-catalog")).body; assert.ok(cat.linkset.some(l => l.anchor.endsWith("/api/v1")));
const card = (await J("https://ultrastable.io/.well-known/agent-card.json")).body; assert.equal(card.name, "Ultrastable"); assert.ok(card.skills.find(s => s.id === "intake"));
const rpc = async (m, params) => (await J("https://ultrastable.io/mcp", ENV, { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params }) })).body;
assert.ok((await rpc("tools/list")).result.tools.find(x => x.name === "get_agents"));
assert.equal(JSON.parse((await rpc("tools/call", { name: "get_work", arguments: { view: "blocked" } })).result.content[0].text).items[0].id, "D");
const tc = await J("https://abcdef0123.ultrastable.io/.well-known/api-catalog"); assert.match(tc.headers.get("content-type"), /linkset/); assert.match(tc.body.linkset[0].anchor, /\/s\/abcdef0123\/api$/);
assert.match(await (await get("https://ultrastable.io/llms.txt")).text(), /Control-plane API \(live\)/);
assert.match((await get("https://ultrastable.io/")).headers.get("link") || "", /agent-card/);
// HANDOFF-1 / CODE-AGENT-SOP-1: SOP, skill, claim, handoff registration, the handoff table on /api/v1, and the internal deploy endpoint
{
  const { readFileSync } = await import("node:fs");
  db.exec(readFileSync(new URL("../seed/worker/migrations/0010_handoffs.sql", import.meta.url), "utf8"));
  const sop = (await J("https://ultrastable.io/api/v1/sop")).body; assert.equal(sop.steps.map(s => s.id).join(","), "take,build,verify,handoff,stop");
  const sk = (await J("https://ultrastable.io/.well-known/agent-skills/index.json")).body.skills.find(s => s.name === "ultrastable-code-agent");
  const md = await (await get("https://ultrastable.io/.well-known/agent-skills/ultrastable-code-agent/SKILL.md")).text();
  const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(md)))).map(x => x.toString(16).padStart(2, "0")).join("");
  assert.equal(h, sk.sha256); assert.match(md, /Your work ends at the open PR/);
  const authed = (path, body, tok = "s3cret") => J("https://ultrastable.io" + path, ENV, { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + tok }, body: JSON.stringify(body) });
  db.exec("INSERT INTO items (id,title,owner_role,done_check,priority,status) VALUES ('F','F: free','staff','x',40,'ready')");
  let c = await authed("/api/v1/work/F/claim", { agent: "codex cli" }); assert.equal(c.status, 201); assert.equal(c.body.agent, "ext:companion:codex-cli");
  assert.equal((await authed("/api/v1/work/F/claim", {})).status, 409, "a claimed item is not claimable twice");
  assert.equal((await authed("/api/v1/work/D/claim", {})).status, 409, "blocked items are not claimable");
  assert.equal((await authed("/api/v1/work/F/claim", {}, "bad")).status, 403);
  assert.equal((await authed("/api/v1/handoff", { repo: "evil/repo", pr: 1 })).status, 422, "only managed repositories");
  c = await authed("/api/v1/handoff", { repo: "ultrastable/ultrastable", pr: 341, item: "F", verify: "GET https://ultrastable.io/health", deploy: "ultrastable-site", agent: "codex" });
  assert.equal(c.status, 201); assert.equal(c.body.id, "ultrastable/ultrastable#341");
  const hl = (await J("https://ultrastable.io/api/v1/handoffs")).body; assert.equal(hl.handoffs[0].state, "open"); assert.equal(hl.handoffs[0].events[0].state, "open"); assert.match(hl.handoffs[0].url, /pull\/341$/);
  assert.equal((await J("https://ultrastable.io/api/v1/status")).body.handoffs.open, 1);
  assert.ok((await J("https://ultrastable.io/openapi.json")).body.paths["/api/v1/handoff"]);
  // internal deploy: unknown without the key, uploads with it, refuses non-platform names
  const calls = []; const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => { calls.push([o && o.method, String(u)]); return new Response(JSON.stringify({ success: true, result: { id: "ver1" } }), { headers: { "content-type": "application/json" } }); };
  const DENV = { ...ENV, INTERNAL_DEPLOY_KEY: "k".repeat(32), CF_DEPLOY_TOKEN: "cf", CF_ACCOUNT_ID: "acct" };
  const dep = (key, body) => get("https://ultrastable.io/__internal/deploy", DENV, { method: "POST", headers: { "x-internal-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await dep("wrong", {})).status, 404); assert.equal((await get("https://ultrastable.io/__internal/deploy", ENV, { method: "POST" })).status, 404, "no key configured: not found");
  assert.equal((await dep("k".repeat(32), { name: "us-idea-x", modules: [{ name: "worker.js", src: "" }], main: "worker.js" })).status, 400);
  const ok = await dep("k".repeat(32), { name: "ultrastable-tick", modules: [{ name: "worker.js", src: "export default {}" }], main: "worker.js", bindings: [], crons: ["*/10 * * * *"] });
  assert.equal(ok.status, 200); assert.deepEqual(await ok.json(), { ok: true, version: "ver1" });
  assert.deepEqual(calls.map(c => c[0] + " " + c[1].replace("https://api.cloudflare.com/client/v4", "")), ["PUT /accounts/acct/workers/scripts/ultrastable-tick", "PUT /accounts/acct/workers/scripts/ultrastable-tick/schedules"]);
  globalThis.fetch = realFetch;
}
console.log("controlplane ok");
