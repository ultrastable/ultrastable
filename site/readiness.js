// AGENT-READY-2: the agent-readiness checks Cloudflare's scanner (isitagentready.com, blog.cloudflare.com/agent-readiness) scores and the site
// did not yet pass on 2026-11-14: Markdown for Agents (Accept: text/markdown), explicit AI-bot rules in robots.txt, and WebMCP tools. Pure functions,
// so site/site.test.mjs can prove each one without a Workers runtime.

// ---------- Markdown for Agents ----------
// An agent that sends Accept: text/markdown (preferred over text/html) gets the page as Markdown: fewer tokens, no layout markup.
export function wantsMarkdown(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const a = (request.headers.get("accept") || "").toLowerCase();
  if (!a.includes("text/markdown")) return false;
  const q = t => { const m = new RegExp(t.replace("/", "\\/") + "\\s*(;\\s*q=([0-9.]+))?").exec(a); return m ? (m[2] === undefined ? 1 : Number(m[2])) : -1; };
  return q("text/markdown") >= q("text/html");
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'", nbsp: " ", middot: "·", mdash: "—", ndash: "–", rarr: "→", hellip: "…" };
const decode = s => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (m, e) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const inline = s => decode(s.replace(/<br\s*\/?>/gi, "  \n")
  .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, h, t) => { const x = t.replace(/<[^>]+>/g, "").trim(); return x ? `[${x}](${h})` : ""; })
  .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**").replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
  .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`").replace(/<[^>]+>/g, "")).replace(/[ \t]+/g, " ").trim();

export function htmlToMarkdown(html, url) {
  const title = (/<title>([\s\S]*?)<\/title>/i.exec(html) || [])[1];
  const desc = (/<meta\s+name="description"\s+content="([^"]*)"/i.exec(html) || [])[1];
  let body = (/<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html) || /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html) || [, html])[1];
  body = body.replace(/<(script|style|noscript|svg|template|form|nav|button)\b[\s\S]*?<\/\1>/gi, "").replace(/<!--[\s\S]*?-->/g, "");
  const out = [];
  if (title) out.push("# " + inline(title));
  if (desc) out.push("> " + decode(desc));
  if (url) out.push("Source: " + url);
  const re = /<(h[1-6]|p|li|pre|blockquote|tr|dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(body))) {
    const tag = m[1].toLowerCase(), raw = m[2];
    if (tag === "pre") { out.push("```\n" + decode(raw.replace(/<[^>]+>/g, "")).trim() + "\n```"); continue; }
    if (tag === "tr") { const cells = [...raw.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => inline(c[1]).replace(/\|/g, "\\|")); if (cells.length) out.push("| " + cells.join(" | ") + " |"); continue; }
    const t = inline(raw);
    if (!t) continue;
    if (tag[0] === "h") out.push("#".repeat(Math.min(6, Number(tag[1]) + (title ? 1 : 0))) + " " + t);
    else if (tag === "li" || tag === "dd") out.push("- " + t);
    else if (tag === "blockquote") out.push("> " + t);
    else out.push(t);
  }
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n") + "\n";
}

// Wraps an HTML response: Markdown for an agent that asked for it, and Vary: Accept on every HTML page so caches keep the two apart.
export async function negotiate(res, request) {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;
  if (!wantsMarkdown(request)) { const r = new Response(res.body, res); r.headers.append("vary", "Accept"); return r; }
  const md = htmlToMarkdown(await res.text(), request.url);
  const h = new Headers(res.headers);
  h.set("content-type", "text/markdown; charset=utf-8"); h.append("vary", "Accept"); h.delete("content-length");
  h.set("x-markdown-tokens", String(Math.ceil(md.length / 4)));
  return new Response(request.method === "HEAD" ? null : md, { status: res.status, headers: h });
}

// ---------- robots.txt: explicit AI-bot rules ----------
// Consistent with the site's Content-Signal (search=yes, ai-input=yes, ai-train=no): crawlers that only gather training data are disallowed by name;
// search crawlers and agents acting for a person are allowed by name, so the policy reads the same to a bot that ignores Content-Signal.
export const TRAINING_BOTS = ["GPTBot", "ClaudeBot", "CCBot", "Google-Extended", "Applebot-Extended", "Bytespider", "meta-externalagent", "Amazonbot"];
export const AGENT_BOTS = ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User", "DuckAssistBot", "MistralAI-User"];
export function robots(contentSignal, sitemap) {
  return "User-agent: *\n" + contentSignal + "Allow: /\n\n"
    + AGENT_BOTS.map(b => "User-agent: " + b).join("\n") + "\n" + contentSignal + "Allow: /\n\n"
    + TRAINING_BOTS.map(b => "User-agent: " + b).join("\n") + "\nDisallow: /\n\n"
    + "Sitemap: " + sitemap + "\n";
}

// ---------- WebMCP ----------
// Browser agents (Chrome's navigator.modelContext) get explicit, read-only tools instead of scraping the page. The tools call the public control-plane
// API on the same origin, so an agent inside the person's session sees exactly what /ops shows. Feature-detected: browsers without WebMCP run nothing.
export const WEBMCP_JS = `(()=>{const mc=navigator.modelContext;if(!mc)return;
const get=p=>fetch('/api/v1/'+p,{headers:{accept:'application/json'},cache:'no-store'}).then(r=>r.json());
const text=o=>({content:[{type:'text',text:JSON.stringify(o)}]});
const tools=[
{name:'ultrastable_status',description:'Health verdict, heartbeat and work counts of Ultrastable running on itself (read-only).',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},execute:async()=>text(await get('status'))},
{name:'ultrastable_agents',description:'Every virtual agent: role, model, state and what it is working on (read-only).',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},execute:async()=>text(await get('agents'))},
{name:'ultrastable_work',description:'The backlog by view: on_deck, in_progress, blocked, done or all (read-only).',inputSchema:{type:'object',properties:{view:{type:'string',enum:['on_deck','in_progress','blocked','done','all']},limit:{type:'integer',minimum:1,maximum:200}}},annotations:{readOnlyHint:true},execute:async a=>text(await get('work?view='+encodeURIComponent((a&&a.view)||'on_deck')+'&limit='+((a&&a.limit)||25)))},
{name:'ultrastable_brief',description:'Plain-language digest: state, next up and what needs the owner (read-only).',inputSchema:{type:'object',properties:{}},annotations:{readOnlyHint:true},execute:async()=>text(await get('companion/brief'))}];
try{if(mc.provideContext)mc.provideContext({tools});else if(mc.registerTool)tools.forEach(t=>mc.registerTool(t));}catch(e){console.warn('webmcp',e);}})();`;
