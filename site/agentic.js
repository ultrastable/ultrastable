// AGENTIC-1: Ultrastable is machine-readable and reachable by other agents, read-only. Standards (checked against Cloudflare's agent-readiness scan, isitagentready.com):
// API Catalog (RFC 9727, /.well-known/api-catalog), OpenAPI, MCP Server Card + a real read-only MCP endpoint (/mcp, JSON-RPC over HTTP), Agent Skills index with
// checksums, Link headers (RFC 8288), Content Signals in robots.txt. Every tool reads the published snapshot; nothing here can change state.
import { load } from "./live.js";
import { userError } from "../seed/worker/src/errors.js";  // USER-BACKEND-1
import AGENTDATA from "./agentdata.js";
import { directory as wbaDirectory, DIRECTORY_PATH, DIRECTORY_TYPE, verifyRequest, fetchDirectory, directoryCache } from "./webbotauth.js";
const PEER_DIRECTORIES = directoryCache(); // WBA-OUTBOUND-1: one signed directory fetch per peer origin per hour, not one per request
import { SOP_MD } from "./sop.js";
import { oauthRoute, verifyAccess, CHALLENGE } from "./oauth.js";
import { OPENAPI_PATHS, API_VERSION, status as cpStatus, agents as cpAgents, work as cpWork, activity as cpActivity, products as cpProducts, companionBrief, authIntegration, submitIntake, workItem } from "./controlplane.js";
const ORIGIN = "https://ultrastable.io";
const VERSION = "0.1.0";
const CORS = { "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };
const j = (o, type, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { ...CORS, "content-type": type || "application/json; charset=utf-8", "cache-control": "public, max-age=300" } });

export const SKILL_MD = "---\nname: ultrastable-live\ndescription: Read Ultrastable's own live record: scoreboard, loops and managers, shipped-code throughput, changelog, claim checks. Read-only.\n---\n\n# Ultrastable live record\n\nUse the MCP endpoint " + ORIGIN + "/mcp (tools: get_scoreboard, get_throughput, get_changelog, get_loops, get_claims, get_gaps) or GET " + ORIGIN + "/api/live for the whole snapshot (JSON, schema ultrastable-transparency/v1). Everything is read-only; changes require the owner's e-mailed code.\n";

export const TOOLS = [
  ["get_scoreboard", "Headline numbers: loops with recorded runs, components live, wired connections, stories passing, open gaps, PRs", s => s.scoreboard],
  ["get_throughput", "How much code ships: merged PRs by origin (unattended executor vs agent sessions), lines, deploys, backlog, executor attempts", s => s.throughput],
  ["get_changelog", "Merged changes by day with size and origin", s => (s.throughput || {}).changelog],
  ["get_loops", "Every registered loop and manager with trigger, owner and last recorded run", s => s.managers],
  ["get_claims", "What the site claims, checked against code: components, wired edges, user stories, objections", s => s.claims],
  ["get_clocks", "Every loop as a clock: measured status, last beat, beats in 24 hours, jitter", s => s.clocks],
  ["get_growth", "Growth: share of shipped work that adds capability versus repairs, and the measured reach of the product", s => s.growth],
  ["get_stages", "Freshness of every pipeline stage against its own SLA", s => s.stages],
  ["get_settlement", "Every executor change settled under the name of its work item", s => s.settlement],
  ["get_product_manager", "The product manager loop: targets, experiments, knobs, items filed", s => s.product_manager],
  ["get_standards", "Which open agent, identity and interoperability standards Ultrastable supports, partly supports or has planned, with who tracks each", () => AGENTDATA.standards],
  ["get_blind_spots", "What the owner cannot know or has not been asked: the registered unknown-unknowns by domain, so any agent can propose the next improvement", () => AGENTDATA.blind_spots],
  ["get_gaps", "The gap register: what Ultrastable still does through outside tools", s => s.gaps],
].map(([name, description, pick]) => ({ name, description, pick, inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } }));

// CONTROL-PLANE-1: tools answered live from the org database (binding ORG), not from the daily snapshot.
const VIEW = { type: "object", properties: { view: { type: "string", enum: ["on_deck", "in_progress", "blocked", "done", "all"] }, limit: { type: "integer", maximum: 200 } }, additionalProperties: false };
export const LIVE_TOOLS = [
  ["get_status", "Live health verdict with reasons, heartbeat age, work and dispatch counts, open owner steps", (env) => cpStatus(env)],
  ["get_agents", "Every virtual agent: role, model, state, the item it holds, its dispatch record", (env) => cpAgents(env)],
  ["get_work", "The backlog by view: on_deck (ranked), in_progress, blocked, done, all", (env, a) => cpWork(env, a.view || "on_deck", a.limit), VIEW],
  ["get_activity", "Newest dispatches and heartbeat reports", (env) => cpActivity(env)],
  ["get_products", "Hosted products and services with their discovery documents", (env) => cpProducts(env)],
  ["get_brief", "Plain-language digest: state, next up, what needs the owner", (env) => companionBrief(env)],
].map(([name, description, run, schema]) => ({ name, description, run, inputSchema: schema || { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } }));

// AGENT-HARNESS-1: the one MCP write. Any agent in any harness (VS Code Copilot/Claude/Codex, Cursor, CLI) submits work here; bearer token required, agent and harness required.
export const WRITE_TOOLS = [{ name: "submit_work", description: "Submit an idea, request, bug or question to Ultrastable's intake. Requires a bearer integration token. State which agent and harness you are so inputs can be compared.",
  inputSchema: { type: "object", required: ["title"], properties: { title: { type: "string", maxLength: 200 }, detail: { type: "string", maxLength: 4000 }, kind: { type: "string", enum: ["idea", "request", "bug", "question"] }, priority: { type: "integer", minimum: 1, maximum: 90 }, agent: { type: "string", maxLength: 60, description: "Who is sending, e.g. claude-code, codex, copilot, cursor. Optional with OAuth: defaults to the approved client." }, harness: { type: "string", maxLength: 60, description: "Where it runs, e.g. vscode-claude, vscode-copilot, cli, cloud. Optional with OAuth." } }, additionalProperties: false },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } }];

// AGENT-HARNESS-1: one page, one click per agent host. No tokens: hosts that support MCP authorization sign the person in by browser consent.
const CONNECT_CFG = { name: "ultrastable", type: "http", url: ORIGIN + "/mcp" };
const b64 = s => btoa(s);
export const CONNECT_HTML = () => { const cfg = JSON.stringify(CONNECT_CFG);
  const links = [["VS Code", "vscode:mcp/install?" + encodeURIComponent(cfg)], ["VS Code Insiders", "vscode-insiders:mcp/install?" + encodeURIComponent(cfg)], ["Cursor", "cursor://anysphere.cursor-deeplink/mcp/install?name=ultrastable&config=" + encodeURIComponent(b64(JSON.stringify({ url: CONNECT_CFG.url })))]];
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Connect your agent to Ultrastable</title><style>body{font:16px system-ui;max-width:40rem;margin:3rem auto;padding:0 1rem}a.b{display:block;margin:.6rem 0;padding:.9rem 1rem;border:1px solid #888;border-radius:.5rem;text-decoration:none;color:inherit}code,pre{background:#8881;padding:.2rem .4rem;border-radius:.3rem}pre{padding:.8rem;overflow:auto}</style></head><body><h1>Connect your agent</h1><p>Click your tool. You sign in once in the browser; nothing to copy or paste.</p>"
    + links.map(([n, h]) => "<a class=\"b\" href=\"" + h.replace(/"/g, "&quot;") + "\">Add to " + n + "</a>").join("")
    + "<h2>Claude</h2><p>Settings, Connectors, Add custom connector, paste <code>" + CONNECT_CFG.url + "</code> (the one URL; sign-in follows).</p><h2>Claude Code</h2><pre>claude mcp add --transport http ultrastable " + CONNECT_CFG.url + "</pre><h2>Codex</h2><pre>codex mcp add ultrastable --url " + CONNECT_CFG.url + "</pre><h2>Any MCP client</h2><pre>{ \"mcpServers\": { \"ultrastable\": { \"url\": \"" + CONNECT_CFG.url + "\" } } }</pre><p><a href=\"/.well-known/agent-card.json\">A2A agent card</a> · <a href=\"/openapi.json\">OpenAPI</a> · <a href=\"/llms.txt\">llms.txt</a></p></body></html>"; };

async function sha256(text) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }

const OPENAPI = { openapi: "3.1.0", info: { title: "Ultrastable API", version: API_VERSION, description: "Ultrastable's control-plane API (live: agents, backlog, status, products, intake) and its read-only live record." }, servers: [{ url: ORIGIN }],
  components: { securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "Integration token; only POST /api/v1/intake needs one" } } },
  paths: { ...OPENAPI_PATHS, "/api/live": { get: { operationId: "getLiveSnapshot", summary: "Whole snapshot: scoreboard, throughput, changelog, loops, claims, gaps", responses: { "200": { description: "Snapshot (schema ultrastable-transparency/v1)", content: { "application/json": { schema: { type: "object" } } } }, "503": { description: "No snapshot published yet" } } } },
    "/api/v1/ignition": { get: { operationId: "getIgnitionStage", summary: "The stage the system reads for itself (bootstrap to self-sustaining), k_eff, k_self and the time of the reading", responses: { "200": { description: "Fresh reading", content: { "application/json": { schema: { type: "object" } } } }, "503": { description: "No reading: code stale_reading, tick_unreachable or no_binding", content: { "application/json": { schema: { type: "object" } } } } } } },
    "/mcp": { post: { operationId: "mcp", summary: "Model Context Protocol endpoint (JSON-RPC 2.0): read tools, plus submit_work with a bearer token", requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "JSON-RPC response" } } } } } };

const CARD = { serverInfo: { name: "ultrastable-live", title: "Ultrastable live record", version: VERSION }, description: "Ultrastable's own record of how it runs on itself (read tools open), plus one authenticated write: submit_work.",
  transport: { type: "streamable-http", endpoint: ORIGIN + "/mcp" }, capabilities: { tools: { listChanged: false } }, authentication: { required: false, requiredFor: ["submit_work"], scheme: "oauth2.1", protected_resource_metadata: ORIGIN + "/.well-known/oauth-protected-resource", authorization_server: ORIGIN + "/.well-known/oauth-authorization-server", legacy: "bearer integration token" }, documentation: ORIGIN + "/llms.txt" };

// A2A Agent Card (Agent2Agent protocol discovery document): what this agent can be asked, over which interfaces.
export const AGENT_CARD = { protocolVersion: "1.0", supportedInterfaces: [{ url: ORIGIN + "/a2a", protocolBinding: "JSONRPC", protocolVersion: "1.0" }], name: "Ultrastable", description: "A self-governing development platform. Ask it what it is working on, what is next, what is blocked, which products it hosts; submit work with an integration token.",
  url: ORIGIN + "/a2a", preferredTransport: "JSONRPC", version: API_VERSION, provider: { organization: "Ultrastable", url: ORIGIN }, documentationUrl: ORIGIN + "/openapi.json",
  capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false, stateTransitionHistory: false }, defaultInputModes: ["application/json"], defaultOutputModes: ["application/json", "text/plain"],
  additionalInterfaces: [{ url: ORIGIN + "/a2a", transport: "JSONRPC" }, { url: ORIGIN + "/mcp", transport: "MCP" }, { url: ORIGIN + "/api/v1", transport: "HTTP+JSON" }],
  securitySchemes: { bearer: { type: "http", scheme: "bearer" }, oauth2: { type: "oauth2", flows: { authorizationCode: { authorizationUrl: ORIGIN + "/oauth/authorize", tokenUrl: ORIGIN + "/oauth/token", scopes: { "mcp:submit": "Submit work to intake" } } }, oauth2MetadataUrl: ORIGIN + "/.well-known/oauth-authorization-server" } },
  skills: [
    { id: "status", name: "Status", description: "Health verdict and reasons, heartbeat, counts", tags: ["ops", "status"], examples: ["Is Ultrastable healthy?"] },
    { id: "agents", name: "Agents", description: "Which virtual agents exist and what each is working on", tags: ["agents"], examples: ["What are the agents working on?"] },
    { id: "backlog", name: "Backlog", description: "On deck, in progress, blocked, done", tags: ["backlog", "roadmap"], examples: ["What is on deck?"] },
    { id: "products", name: "Products", description: "Hosted products and their discovery documents", tags: ["discovery"] },
    { id: "brief", name: "Brief", description: "Plain-language digest for a personal assistant", tags: ["companion"], examples: ["Give me the Ultrastable brief"] },
    { id: "handoff", name: "Handoff", description: "Code agents: take a work order, build, hand the PR to the server, stop (SOP at /api/v1/sop)", tags: ["code-agent", "sop"] },
    { id: "intake", name: "Intake", description: "Submit an idea, request, bug or question (OAuth consent in the browser; no token to paste)", tags: ["write"] } ] };
export const LINKS = "</.well-known/api-catalog>; rel=\"api-catalog\", </.well-known/agent-card.json>; rel=\"agent-card\", </openapi.json>; rel=\"service-desc\"; type=\"application/vnd.oai.openapi+json\", </.well-known/mcp/server-card.json>; rel=\"mcp-server-card\", </llms.txt>; rel=\"describedby\"";
export const CONTENT_SIGNAL = "Content-Signal: search=yes, ai-input=yes, ai-train=no\n";

// MCP-STATELESS-1: the versions /mcp speaks, newest first. 2026-07-28 is the stateless revision: no session id is issued or required, every request stands
// alone, and a client asks server/discover instead of opening a session. Older clients keep initialize; a client that names no version gets 2025-06-18.
export const MCP_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18"];
async function mcp(request, env) {
  { const pv = request.headers.get("mcp-protocol-version"); if (pv && !MCP_VERSIONS.includes(pv)) return j({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `unsupported protocol version ${pv}; supported: ${MCP_VERSIONS.join(", ")}` } }, null, 400); }
  if (request.method === "GET") return new Response("Use POST with JSON-RPC 2.0", { status: 405, headers: { allow: "POST", ...CORS } });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST", ...CORS } });
  let m; try { m = await request.json(); } catch (e) { return j({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, null, 400); }
  // A message with a method and no id is a notification, whatever the method: it is acknowledged with 202 and no body, never answered and never run (as the seed's server does).
  if (m && typeof m === "object" && !Array.isArray(m) && typeof m.method === "string" && m.id === undefined) return new Response(null, { status: 202, headers: CORS });
  const id = m && m.id !== undefined ? m.id : null, ok = result => j({ jsonrpc: "2.0", id, result }), err = (code, message) => j({ jsonrpc: "2.0", id, error: { code, message } });
  switch (m && m.method) {
    case "server/discover": return ok({ supportedVersions: MCP_VERSIONS, capabilities: { tools: { listChanged: false } }, serverInfo: CARD.serverInfo });
    case "initialize": return ok({ protocolVersion: MCP_VERSIONS.includes((m.params || {}).protocolVersion) ? m.params.protocolVersion : "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: CARD.serverInfo, instructions: "Ultrastable running on itself. Read tools are open; submit_work asks you to sign in once in the browser (OAuth 2.1, no token to paste)." });
    case "notifications/initialized": return new Response(null, { status: 202, headers: CORS });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: [...LIVE_TOOLS, ...TOOLS, ...WRITE_TOOLS].map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) });
    case "tools/call": {
      if ((m.params || {}).name === "submit_work") {
        // MCP-OAUTH-1: an OAuth access token (browser consent, no pasted token) is the normal path; the integration bearer token stays as the legacy path.
        let auth = await verifyAccess(request, env);
        // RFC 6750 section 3.1: a bearer token that was presented and is neither one of our OAuth tokens nor an integration token is invalid_token (401), like a revoked one;
        // only a request with no bearer token gets the bare challenge. A valid token of ours that lacks the scope is insufficient_scope (403).
        if (!auth) { const legacy = await authIntegration(request, env), presented = /^Bearer\s+\S+$/i.test(request.headers.get("authorization") || "");
          auth = legacy.ok ? { ok: true, name: legacy.name, via: "token" } : presented ? { ok: false, status: 401, error: "invalid_token" } : { ok: false, status: legacy.status === 503 ? 401 : legacy.status, error: legacy.error }; }
        if (!auth.ok) { const e = auth.error === "invalid_token" || auth.error === "insufficient_scope" ? auth.error : undefined;
          return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32001, message: auth.error || "unauthorized" } }), { status: auth.status || (e === "insufficient_scope" ? 403 : 401), headers: { ...CORS, "content-type": "application/json; charset=utf-8", "www-authenticate": CHALLENGE(e) } }); }
        if (!env.ORG) return ok({ isError: true, content: [{ type: "text", text: "Org database not bound." }] });
        let a = { ...((m.params || {}).arguments || {}) };
        if (auth.via === "oauth") { a.agent = a.agent || auth.agent; a.harness = a.harness || auth.harness; }  // identity comes from the client the owner approved
        if (!String(a.agent || "").trim() || !String(a.harness || "").trim()) return ok({ isError: true, content: [{ type: "text", text: "agent and harness are required" }] });
        const wb = await verifyRequest(request, o => PEER_DIRECTORIES(o, x => fetchDirectory(x, fetch, env))).catch(() => ({ ok: false })); // WEB-BOT-AUTH-1: a verified signature adds the agent origin to the harness record
        const r = await submitIntake(env, auth.name, wb.ok ? { ...a, harness: String(a.harness) + "+wba-" + new URL(wb.agent).hostname } : a);
        return ok({ isError: r.status >= 400, content: [{ type: "text", text: JSON.stringify(r.body) }] });
      }
      const lt = LIVE_TOOLS.find(x => x.name === (m.params || {}).name);
      if (lt) { if (!env || !env.ORG) return ok({ isError: true, content: [{ type: "text", text: "Org database not bound." }] }); try { return ok({ content: [{ type: "text", text: JSON.stringify(await lt.run(env, (m.params || {}).arguments || {})) }] }); } catch (e) { return ok({ isError: true, content: [{ type: "text", text: userError(e, "mcp-tool").error }] }); } }
      const t = TOOLS.find(x => x.name === (m.params || {}).name); if (!t) return err(-32602, "Unknown tool");
      const r = await load(env); if (!r) return ok({ isError: true, content: [{ type: "text", text: "No snapshot published yet." }] });
      return ok({ content: [{ type: "text", text: JSON.stringify(t.pick(JSON.parse(r.body)) ?? null) }] });
    }
    default: return err(-32601, "Method not found");
  }
}

// AGENT-HARNESS-1: A2A JSON-RPC binding. SendMessage files the message as an intake item (bearer required, attributed to the sending agent); GetTask reads it back.
const A2A_STATE = { open: "TASK_STATE_SUBMITTED", ready: "TASK_STATE_SUBMITTED", claimed: "TASK_STATE_WORKING", in_progress: "TASK_STATE_WORKING", blocked: "TASK_STATE_INPUT_REQUIRED", done: "TASK_STATE_COMPLETED" };
async function a2a(request, env) {
  if (request.method !== "POST") return new Response("Use POST with JSON-RPC 2.0", { status: 405, headers: { allow: "POST", ...CORS } });
  let m; try { m = await request.json(); } catch (e) { return j({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, null, 400); }
  const id = m && m.id !== undefined ? m.id : null, ok = result => j({ jsonrpc: "2.0", id, result }), err = (code, message) => j({ jsonrpc: "2.0", id, error: { code, message } });
  const task = (tid, state, text) => ({ id: tid, contextId: tid, status: { state: A2A_STATE[state] || "TASK_STATE_SUBMITTED" }, artifacts: text ? [{ artifactId: "status", parts: [{ text }] }] : [] });
  // A2A-V1-1: clients written against A2A 0.3 call message/send and tasks/get; both are served as aliases of the 1.0 methods so either generation can hand over a task and poll it.
  const method = { "message/send": "SendMessage", "tasks/get": "GetTask" }[m && m.method] || (m && m.method);
  if (method === "SendMessage") {
    const auth = await authIntegration(request, env);
    if (!auth.ok) return new Response(JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32001, message: auth.error } }), { status: auth.status, headers: { ...CORS, "content-type": "application/json; charset=utf-8", ...(auth.status === 401 ? { "www-authenticate": "Bearer" } : {}) } });
    if (!env.ORG) return err(-32603, "Org database not bound");
    const msg = ((m.params || {}).message) || {}, text = (msg.parts || []).map(x => x && x.text).filter(Boolean).join("\n").trim();
    if (!text) return err(-32602, "message.parts needs a text part");
    const meta = (m.params || {}).metadata || {};
    const r = await submitIntake(env, auth.name, { title: text.split("\n")[0], detail: text, kind: meta.kind, agent: meta.agent || auth.name, harness: meta.harness || "a2a" });
    return r.status >= 400 ? err(-32602, JSON.stringify(r.body)) : ok({ task: task(r.body.id, "open") });
  }
  if (method === "GetTask") {
    const tid = String(((m.params || {}).id) || ""); if (!tid || !env.ORG) return err(-32602, "id required");
    const w = await workItem(env, tid); if (!w || w.error || w.status === 404) return err(-32001, "TaskNotFoundError");
    const it = w.item || w; return ok({ task: task(tid, it.status, it.title) });
  }
  return err(-32601, "Method not found");
}

// CARD-SIGNED-1: the agent card is served with a JWS signature (RFC 7515, ES256) over its RFC 8785 canonical JSON. The Worker generates the
// P-256 key itself, keeps it in its own KV namespace, publishes the public half at /.well-known/jwks.json and replaces it lazily after
// CARD_KEY_TTL_MS on the first request that sees it aged (no cron). The previous public key stays in the key set for one more period, so a
// card cached before the rotation still verifies. No person creates, copies or stores a key.
export const CARD_KEY_TTL_MS = 90 * 864e5, JWKS_PATH = "/.well-known/jwks.json";
const CARD_KEY_KV = "agent-card-key:v1", b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uText = t => b64u(new TextEncoder().encode(t));
export const jcs = v => Array.isArray(v) ? "[" + v.map(jcs).join(",") + "]" : v && typeof v === "object" ? "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}" : JSON.stringify(v);
let cardKeyMemo = null;
export const _resetCardKey = () => { cardKeyMemo = null; };
export async function cardKeys(env, now = Date.now()) {
  if (cardKeyMemo && now - cardKeyMemo.created < CARD_KEY_TTL_MS && now - cardKeyMemo.read < 3600e3) return cardKeyMemo;
  const kv = env && env.ASSETS && typeof env.ASSETS.put === "function" ? env.ASSETS : null;
  let rec = kv ? JSON.parse((await kv.get(CARD_KEY_KV)) || "null") : (cardKeyMemo || null);
  if (!rec || now - rec.created >= CARD_KEY_TTL_MS) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = await crypto.subtle.exportKey("jwk", pair.publicKey), priv = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const kid = "card-" + new Date(now).toISOString().slice(0, 10) + "-" + b64u(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pub.x + pub.y))).slice(0, 8);
    const next = { kid, created: now, priv, pub: { kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, kid, use: "sig", alg: "ES256" }, previous: rec ? rec.pub : null };
    if (kv) { await kv.put(CARD_KEY_KV, JSON.stringify(next)); rec = JSON.parse((await kv.get(CARD_KEY_KV)) || "null") || next; }  // read back: when two isolates rotate at once, both sign with the stored key
    else rec = next;
  }
  cardKeyMemo = { ...rec, read: now };
  return cardKeyMemo;
}
export async function signedCard(env, now = Date.now()) {
  const k = await cardKeys(env, now);
  const key = await crypto.subtle.importKey("jwk", k.priv, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const prot = b64uText(JSON.stringify({ alg: "ES256", typ: "JOSE", kid: k.kid, jku: ORIGIN + JWKS_PATH }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(prot + "." + b64uText(jcs(AGENT_CARD))));
  return { ...AGENT_CARD, signatures: [{ protected: prot, signature: b64u(sig) }] };
}
export async function cardJwks(env, now = Date.now()) { const k = await cardKeys(env, now); return { keys: [k.pub, ...(k.previous ? [k.previous] : [])] }; }

export async function agentic(request, env) {
  const u = new URL(request.url), p = u.pathname.replace(/\/$/, "");
  if (u.hostname !== "ultrastable.io" && u.hostname !== "www.ultrastable.io" && !u.hostname.endsWith(".workers.dev")) return null;
  { const o = await oauthRoute(request, env); if (o) return o; }  // MCP-OAUTH-1: protected-resource and authorization-server metadata, /oauth/*
  switch (p) {
    case DIRECTORY_PATH: { if (!env || !env.ORG) return new Response("Org database not bound", { status: 503, headers: CORS }); return new Response(JSON.stringify(await wbaDirectory(env)), { headers: { ...CORS, "content-type": DIRECTORY_TYPE, "cache-control": "public, max-age=3600" } }); }
    case "/mcp": return mcp(request, env);
    case "/a2a": return a2a(request, env);
    case "/connect-agent": return new Response(CONNECT_HTML(), { headers: { ...CORS, "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
    case "/openapi.json": return j(OPENAPI, "application/vnd.oai.openapi+json; charset=utf-8");
    case "/.well-known/agent-card.json": case "/.well-known/agent.json": return j(await signedCard(env));
    case JWKS_PATH: return j(await cardJwks(env), "application/jwk-set+json");  // /.well-known/jwks.json
    case "/.well-known/api-catalog": return j({ linkset: [{ anchor: ORIGIN + "/api/v1", "service-desc": [{ href: ORIGIN + "/openapi.json", type: "application/vnd.oai.openapi+json" }], "service-doc": [{ href: ORIGIN + "/llms.txt", type: "text/plain" }], status: [{ href: ORIGIN + "/api/v1/status", type: "application/json" }] }, { anchor: ORIGIN + "/api/live", "service-desc": [{ href: ORIGIN + "/openapi.json", type: "application/vnd.oai.openapi+json" }], "service-doc": [{ href: ORIGIN + "/llms.txt", type: "text/plain" }] }, { anchor: ORIGIN + "/changelog.json", alternate: [{ href: ORIGIN + "/changelog.xml", type: "application/rss+xml" }], "service-doc": [{ href: ORIGIN + "/llms.txt", type: "text/plain" }] }, { anchor: ORIGIN + "/mcp", "service-desc": [{ href: ORIGIN + "/.well-known/mcp/server-card.json", type: "application/json" }] }] }, "application/linkset+json; profile=\"https://www.rfc-editor.org/info/rfc9727\"");
    case "/.well-known/mcp": case "/.well-known/mcp/server-card.json": case "/.well-known/mcp/server-cards.json": case "/.well-known/mcp.json": return j(p.endsWith("cards.json") ? { servers: [CARD] } : CARD);
    case "/.well-known/agent-skills/index.json": case "/.well-known/skills/index.json":
      return j({ $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json", skills: [{ name: "ultrastable-live", type: "skill-md", description: "Read Ultrastable's own live record (read-only).", url: ORIGIN + "/.well-known/agent-skills/ultrastable-live/SKILL.md", sha256: await sha256(SKILL_MD) },
        { name: "ultrastable-code-agent", type: "skill-md", description: "SOP for any code agent: take a work order, build, verify, hand off a PR, stop; the server owns the rest.", url: ORIGIN + "/.well-known/agent-skills/ultrastable-code-agent/SKILL.md", sha256: await sha256(SOP_MD) }] });
    case "/.well-known/agent-skills/ultrastable-code-agent/SKILL.md": return new Response(SOP_MD, { headers: { ...CORS, "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
    case "/.well-known/agent-skills/ultrastable-live/SKILL.md": return new Response(SKILL_MD, { headers: { ...CORS, "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
    default: return null;
  }
}

export function withLinks(res, request) {
  const u = new URL(request.url);
  if (u.pathname !== "/" || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const r = new Response(res.body, res); r.headers.set("link", LINKS); return r;
}
