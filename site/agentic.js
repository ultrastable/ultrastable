// AGENTIC-1: Ultrastable is machine-readable and reachable by other agents, read-only. Standards (checked against Cloudflare's agent-readiness scan, isitagentready.com):
// API Catalog (RFC 9727, /.well-known/api-catalog), OpenAPI, MCP Server Card + a real read-only MCP endpoint (/mcp, JSON-RPC over HTTP), Agent Skills index with
// checksums, Link headers (RFC 8288), Content Signals in robots.txt. Every tool reads the published snapshot; nothing here can change state.
import { load } from "./live.js";
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
  ["get_gaps", "The gap register: what Ultrastable still does through outside tools", s => s.gaps],
].map(([name, description, pick]) => ({ name, description, pick, inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, openWorldHint: false } }));

async function sha256(text) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }

const OPENAPI = { openapi: "3.1.0", info: { title: "Ultrastable live record", version: VERSION, description: "Read-only record of Ultrastable running on itself." }, servers: [{ url: ORIGIN }],
  paths: { "/api/live": { get: { operationId: "getLiveSnapshot", summary: "Whole snapshot: scoreboard, throughput, changelog, loops, claims, gaps", responses: { "200": { description: "Snapshot (schema ultrastable-transparency/v1)", content: { "application/json": { schema: { type: "object" } } } }, "503": { description: "No snapshot published yet" } } } },
    "/mcp": { post: { operationId: "mcp", summary: "Model Context Protocol endpoint (JSON-RPC 2.0), read-only tools", requestBody: { content: { "application/json": { schema: { type: "object" } } } }, responses: { "200": { description: "JSON-RPC response" } } } } } };

const CARD = { serverInfo: { name: "ultrastable-live", title: "Ultrastable live record", version: VERSION }, description: "Read-only access to Ultrastable's own record of how it runs on itself.",
  transport: { type: "streamable-http", endpoint: ORIGIN + "/mcp" }, capabilities: { tools: { listChanged: false } }, authentication: { required: false }, documentation: ORIGIN + "/llms.txt" };

export const LINKS = "</.well-known/api-catalog>; rel=\"api-catalog\", </openapi.json>; rel=\"service-desc\"; type=\"application/vnd.oai.openapi+json\", </.well-known/mcp/server-card.json>; rel=\"mcp-server-card\", </llms.txt>; rel=\"describedby\"";
export const CONTENT_SIGNAL = "Content-Signal: search=yes, ai-input=yes, ai-train=no\n";

async function mcp(request, env) {
  if (request.method === "GET") return new Response("Use POST with JSON-RPC 2.0", { status: 405, headers: { allow: "POST", ...CORS } });
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { allow: "POST", ...CORS } });
  let m; try { m = await request.json(); } catch (e) { return j({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, null, 400); }
  const id = m && m.id !== undefined ? m.id : null, ok = result => j({ jsonrpc: "2.0", id, result }), err = (code, message) => j({ jsonrpc: "2.0", id, error: { code, message } });
  switch (m && m.method) {
    case "initialize": return ok({ protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: CARD.serverInfo, instructions: "Read-only record of Ultrastable running on itself." });
    case "notifications/initialized": return new Response(null, { status: 202, headers: CORS });
    case "ping": return ok({});
    case "tools/list": return ok({ tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })) });
    case "tools/call": {
      const t = TOOLS.find(x => x.name === (m.params || {}).name); if (!t) return err(-32602, "Unknown tool");
      const r = await load(env); if (!r) return ok({ isError: true, content: [{ type: "text", text: "No snapshot published yet." }] });
      return ok({ content: [{ type: "text", text: JSON.stringify(t.pick(JSON.parse(r.body)) ?? null) }] });
    }
    default: return err(-32601, "Method not found");
  }
}

export async function agentic(request, env) {
  const u = new URL(request.url), p = u.pathname.replace(/\/$/, "");
  if (u.hostname !== "ultrastable.io" && u.hostname !== "www.ultrastable.io" && !u.hostname.endsWith(".workers.dev")) return null;
  switch (p) {
    case "/mcp": return mcp(request, env);
    case "/openapi.json": return j(OPENAPI, "application/vnd.oai.openapi+json; charset=utf-8");
    case "/.well-known/api-catalog": return j({ linkset: [{ anchor: ORIGIN + "/api/live", "service-desc": [{ href: ORIGIN + "/openapi.json", type: "application/vnd.oai.openapi+json" }], "service-doc": [{ href: ORIGIN + "/llms.txt", type: "text/plain" }] }, { anchor: ORIGIN + "/api/v1", "service-desc": [{ href: ORIGIN + "/api/v1/openapi.json", type: "application/vnd.oai.openapi+json" }], "service-doc": [{ href: ORIGIN + "/ops", type: "text/html" }], status: [{ href: ORIGIN + "/api/v1/status", type: "application/json" }] }, { anchor: ORIGIN + "/mcp", "service-desc": [{ href: ORIGIN + "/.well-known/mcp/server-card.json", type: "application/json" }] }] }, "application/linkset+json; profile=\"https://www.rfc-editor.org/info/rfc9727\"");
    case "/.well-known/mcp/server-card.json": case "/.well-known/mcp/server-cards.json": case "/.well-known/mcp.json": return j(p.endsWith("cards.json") ? { servers: [CARD] } : CARD);
    case "/.well-known/agent-skills/index.json": case "/.well-known/skills/index.json":
      return j({ $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json", skills: [{ name: "ultrastable-live", type: "skill-md", description: "Read Ultrastable's own live record (read-only).", url: ORIGIN + "/.well-known/agent-skills/ultrastable-live/SKILL.md", sha256: await sha256(SKILL_MD) }] });
    case "/.well-known/agent-skills/ultrastable-live/SKILL.md": return new Response(SKILL_MD, { headers: { ...CORS, "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } });
    default: return null;
  }
}

export function withLinks(res, request) {
  const u = new URL(request.url);
  if (u.pathname !== "/" || !(res.headers.get("content-type") || "").includes("text/html")) return res;
  const r = new Response(res.body, res); r.headers.set("link", LINKS); return r;
}
