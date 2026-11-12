// AGENT-INTEROP-1 (owner directive 2026-11-12): the site and API are legible to agents. What is implemented, declined or pending, with the source and
// date for each standard, is data in doctrine/agent-standards.json and checked by `python3 -m foundation agentstd --check`.
// Implemented here: Markdown for agents (Accept: text/markdown and .md suffix), Link headers (RFC 8288), robots.txt with a Content-Signal line,
// llms.txt in the llmstxt.org shape, an OpenAPI 3.1 description of the public API, an RFC 9727 API catalog, and a read-only MCP server
// (Streamable HTTP, stateless JSON-RPC) with its server card. No write tool is exposed over MCP: building a site stays on the rate-limited form API.
// Consumers: site/worker.js (withAgent wraps every response); tests in site/site.test.mjs.
export const ORIGIN = "https://ultrastable.io";
export const MD_PAGES = ["/", "/engineers", "/org", "/how", "/proof", "/product", "/team", "/faq", "/contact", "/pilot", "/start", "/setup"];
const MCP_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, accept, mcp-protocol-version" };
const J = (o, status, type) => new Response(JSON.stringify(o), { status: status || 200, headers: { "content-type": (type || "application/json") + "; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff", ...CORS } });

export const robots = () => "User-agent: *\nAllow: /\nContent-Signal: search=yes, ai-input=yes, ai-train=no\nSitemap: " + ORIGIN + "/sitemap.xml\n";

export function llmsTxt() {
  const md = (p, t, d) => "- [" + t + "](" + ORIGIN + (p === "/" ? "/index.md" : p + ".md") + "): " + d;
  return "# Ultrastable\n\n> Ultrastable is the foundation for any autonomous system: a control loop around coding agents that finds its own work, hands each task to the agent that fits, proves every change live with automatic revert, and scores its own decisions against logged predictions. It runs on itself.\n\n"
    + "Every page below has a Markdown version at the same address with .md appended, or send Accept: text/markdown.\n\n## Pages\n\n"
    + [md("/", "Home", "what Ultrastable is"), md("/how", "How it works", "the loop in plain words"), md("/proof", "Live proof", "claims checked against live records"), md("/product", "Product", "what it builds and keeps running"), md("/pilot", "Pilot", "how to apply for the pilot program"), md("/engineers", "For engineers", "capabilities listed as Live, Testing or Pinned")].join("\n")
    + "\n\n## API\n\n- [OpenAPI description](" + ORIGIN + "/openapi.json): the public read endpoints and the idea, change and pilot forms\n- [API catalog](" + ORIGIN + "/.well-known/api-catalog): RFC 9727 linkset\n- [MCP server](" + ORIGIN + "/mcp): read-only tools over Streamable HTTP; card at /.well-known/mcp/server-card.json\n- [Live view](" + ORIGIN + "/api/live): the system's own work, read-only JSON\n\n"
    + "## Optional\n\n- [FAQ](" + ORIGIN + "/faq.md): short answers, including what is not built yet\n- [Team](" + ORIGIN + "/team.md)\n- [Organization](" + ORIGIN + "/org.md)\n";
}

export function linkHeader() {
  return ['</llms.txt>; rel="describedby"; type="text/plain"', '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"', '</.well-known/api-catalog>; rel="api-catalog"', '</sitemap.xml>; rel="sitemap"; type="application/xml"'].join(", ");
}

export function openapi() {
  const idea = { type: "object", properties: { idea: { type: "string", maxLength: 2000 }, profile: { type: "string", description: "JSON text of answers already given" } }, required: ["idea"] };
  const ok = (d) => ({ 200: { description: d, content: { "application/json": { schema: { type: "object" } } } } });
  return {
    openapi: "3.1.0", info: { title: "Ultrastable public API", version: "1.0.0", description: "Read endpoints are open to everyone. Forms that start work are rate limited. Nothing here changes the platform's own repositories." },
    servers: [{ url: ORIGIN }],
    paths: {
      "/api/live": { get: { operationId: "getLive", summary: "The system's own work: managers, loops, change feed, throughput. Read-only.", responses: ok("Snapshot") } },
      "/api/suggest": { get: { operationId: "suggestIdeas", summary: "Ideas that respond to what was typed and rotate with the seed.", parameters: [{ name: "q", in: "query", schema: { type: "string" } }, { name: "seed", in: "query", schema: { type: "integer" } }, { name: "n", in: "query", schema: { type: "integer", maximum: 6 } }, { name: "seen", in: "query", schema: { type: "string", description: "pipe-separated ideas already shown" } }], responses: ok("A list of idea strings in s") } },
      "/api/idea": { post: { operationId: "startIdea", summary: "Start a build from an idea. Send Accept: application/json for {id,state}. Rate limited.", requestBody: { content: { "multipart/form-data": { schema: idea }, "application/x-www-form-urlencoded": { schema: idea } } }, responses: { 200: { description: "Build started (JSON)" }, 303: { description: "Redirect (form)" }, 422: { description: "Not a fit for the program" }, 429: { description: "Rate limited" } } } },
      "/s/{id}/status": { get: { operationId: "getBuildStatus", summary: "Advance and read a build: state building, ready or failed; audit when asked.", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", pattern: "^[a-f0-9]{10}$" } }, { name: "audit", in: "query", schema: { type: "integer" } }], responses: ok("State") } },
      "/api/change": { post: { operationId: "requestChange", summary: "Ask for a change to a built site. Rate limited.", responses: { 200: { description: "Change started (JSON)" }, 303: { description: "Redirect (form)" } } } },
      "/api/pilot": { post: { operationId: "applyForPilot", summary: "Apply to the pilot program with the five application fields.", responses: ok("Application received and scored") } },
      "/mcp": { post: { operationId: "mcp", summary: "Model Context Protocol, Streamable HTTP, stateless JSON-RPC, read-only tools.", responses: { 200: { description: "JSON-RPC response" }, 202: { description: "Notification accepted" } } } }
    }
  };
}

export function apiCatalog() {
  return { linkset: [{ anchor: ORIGIN + "/api", "service-desc": [{ href: ORIGIN + "/openapi.json", type: "application/vnd.oai.openapi+json" }], "service-doc": [{ href: ORIGIN + "/llms.txt", type: "text/plain" }], status: [{ href: ORIGIN + "/health", type: "application/json" }] }] };
}

export function serverCard() {
  return { name: "ultrastable", title: "Ultrastable", description: "Read-only tools: what Ultrastable can do and its honest status, ideas to start from, and its live record of its own work.", version: "1.0.0", serverInfo: { name: "ultrastable", version: "1.0.0" }, transport: { type: "streamable-http", endpoint: ORIGIN + "/mcp" }, capabilities: { tools: { listChanged: false } }, documentationUrl: ORIGIN + "/llms.txt" };
}

export const TOOLS = [
  { name: "ultrastable_capabilities", description: "Everything Ultrastable can do, each marked Live, Testing or Pinned (not built yet) with its trigger.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "ultrastable_suggest_ideas", description: "Ideas a person could start from, ranked by overlap with the words given; a new seed rotates the list.", inputSchema: { type: "object", properties: { q: { type: "string" }, seed: { type: "integer" }, n: { type: "integer", maximum: 6 } }, additionalProperties: false } },
  { name: "ultrastable_live_status", description: "The system's own recent work: managers, loops, change feed and throughput, read-only.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }
];

const rpcErr = (id, code, message) => ({ jsonrpc: "2.0", id: id == null ? null : id, error: { code, message } });
async function rpc(msg, deps) {
  if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return rpcErr(msg && msg.id, -32600, "Invalid request");
  const id = msg.id, p = msg.params || {};
  if (id === undefined) return null; // notification: no response body
  switch (msg.method) {
    case "initialize": return { jsonrpc: "2.0", id, result: { protocolVersion: MCP_VERSIONS.includes(p.protocolVersion) ? p.protocolVersion : MCP_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "ultrastable", version: "1.0.0" }, instructions: "Read-only. Building a site or applying to the pilot uses the forms listed in /openapi.json." } };
    case "ping": return { jsonrpc: "2.0", id, result: {} };
    case "tools/list": return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
    case "tools/call": {
      const a = p.arguments || {}; let out;
      if (p.name === "ultrastable_capabilities") out = deps.capabilities();
      else if (p.name === "ultrastable_suggest_ideas") out = deps.suggest(String(a.q || "").slice(0, 200), Number(a.seed) || Date.now(), Math.min(6, Number(a.n) || 4));
      else if (p.name === "ultrastable_live_status") out = await deps.live();
      else return rpcErr(id, -32602, "Unknown tool " + String(p.name).slice(0, 60));
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out) }], structuredContent: { result: out }, isError: false } };
    }
    default: return rpcErr(id, -32601, "Method not found");
  }
}
export async function mcp(request, deps) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return new Response("Use POST with a JSON-RPC body", { status: 405, headers: { allow: "POST, OPTIONS", ...CORS } });
  let body; try { body = await request.json(); } catch (e) { return J(rpcErr(null, -32700, "Parse error"), 400); }
  const list = Array.isArray(body) ? body : [body], outs = [];
  for (const m of list.slice(0, 10)) { const r = await rpc(m, deps); if (r) outs.push(r); }
  if (!outs.length) return new Response(null, { status: 202, headers: CORS });
  return J(Array.isArray(body) ? outs : outs[0], 200);
}

// Markdown for agents: the main content of a page as Markdown. Deterministic, no network.
export function htmlToMarkdown(html) {
  let t = String(html), m = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(t); t = m ? m[1] : t;
  const title = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1];
  t = t.replace(/<(script|style|noscript|svg|form|button)[\s\S]*?<\/\1>/gi, "")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n\n# $1\n\n").replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n\n## $1\n\n").replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n\n### $1\n\n")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (x, h, l) => "[" + l.replace(/<[^>]+>/g, "").trim() + "](" + (h.startsWith("/") ? ORIGIN + h : h) + ")")
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, "**$2**").replace(/<li[^>]*>/gi, "\n- ").replace(/<\/(p|div|section|tr|ul|ol|table)>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&middot;/g, "-")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return (title && !/^#\s/.test(t) ? "# " + title.replace(/<[^>]+>/g, "").trim() + "\n\n" : "") + t + "\n";
}
export const wantsMarkdown = (request) => /text\/markdown/.test(request.headers.get("accept") || "") && !/text\/html/.test((request.headers.get("accept") || "").split("text/markdown")[0]);

// Wrap the site's router. route(request) is the original handler.
export async function withAgent(request, env, ctx, route, deps) {
  const u = new URL(request.url), p = u.pathname;
  if (request.method === "OPTIONS" && (p === "/mcp" || p === "/openapi.json")) return new Response(null, { status: 204, headers: CORS });
  if (p === "/mcp") return mcp(request, deps);
  if (request.method === "GET" || request.method === "HEAD") {
    if (p === "/openapi.json") return J(openapi(), 200, "application/vnd.oai.openapi+json");
    if (p === "/.well-known/api-catalog") return J(apiCatalog(), 200, "application/linkset+json");
    if (p === "/.well-known/mcp/server-card.json") return J(serverCard());
    if (p === "/llms.txt") return new Response(llmsTxt(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300", ...CORS } });
    if (p === "/robots.txt") return new Response(robots(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" } });
    const mdPath = p === "/index.md" ? "/" : p.endsWith(".md") ? p.slice(0, -3) : null;
    const asMd = mdPath !== null && MD_PAGES.includes(mdPath), want = wantsMarkdown(request) && MD_PAGES.includes(p.replace(/\/$/, "") || "/");
    if (asMd || want) {
      const target = asMd ? mdPath : (p.replace(/\/$/, "") || "/"), r = await route(new Request(ORIGIN + target, { headers: { accept: "text/html" } }), env, ctx);
      if (!r.ok) return r;
      return new Response(htmlToMarkdown(await r.text()), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300", vary: "Accept", "x-content-type-options": "nosniff", link: linkHeader() } });
    }
  }
  const r = await route(request, env, ctx);
  if ((r.headers.get("content-type") || "").includes("text/html")) { const h = new Headers(r.headers); h.append("link", linkHeader()); h.append("vary", "Accept"); return new Response(r.body, { status: r.status, headers: h }); }
  return r;
}

export default { ORIGIN, MD_PAGES, TOOLS, robots, llmsTxt, linkHeader, openapi, apiCatalog, serverCard, mcp, htmlToMarkdown, wantsMarkdown, withAgent };
