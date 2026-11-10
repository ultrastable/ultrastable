// ultrastable-site: the public presence of Ultrastable, the self-governing development platform (ULTRASTABLE-SITE-1, 2026-11-10).
// Canonical host ultrastable.io; ultrastable.app and ultrastable.net redirect to it (/pilot and /proof). Live proof comes from
// the platform claims QNFO publishes as customer zero. Positioning: docs/PRODUCT-ULTRASTABLE.md and product/boundary.json.
var VERSION = "0.1.0";
const CANON = "ultrastable.io";
const CLAIMS_URL = "https://qnfo.org/api/platform-claims";
const PILOT_MAIL = "pilot@ultrastable.io";

const BASE = ":root{color-scheme:light dark;--bg:#f7f8fa;--sf:#fff;--sf2:#eef1f5;--ink:#14181f;--ink2:#4a5360;--line:#d9dee6;--ac:#0b5fff;--on:#fff;--soft:#e6efff;--good:#0a7a3d;--bad:#b3261e}@media(prefers-color-scheme:dark){:root{--bg:#0e1116;--sf:#161b22;--sf2:#1d242d;--ink:#eef1f5;--ink2:#a9b3c1;--line:#2c3541;--ac:#6ea0ff;--on:#0e1116;--soft:#1b2a45;--good:#4cc38a;--bad:#ff8a80}}"
+ "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}a{color:var(--ac)}h1{font-size:28px;line-height:1.2;margin:0 0 8px}h2{font-size:20px;margin:28px 0 8px}h3{margin:0;font-size:17px}p{margin:0 0 12px}"
+ ".top{position:sticky;top:0;background:var(--sf);border-bottom:1px solid var(--line);z-index:5}.top-in{max-width:960px;margin:0 auto;padding:8px 16px;display:flex;align-items:center;gap:8px;min-height:60px}.brand{font-weight:700;font-size:18px;color:var(--ink);text-decoration:none;margin-right:auto}"
+ ".main{max-width:960px;margin:0 auto;padding:20px 16px 64px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:10px 18px;border-radius:10px;border:1px solid var(--line);background:var(--sf);color:var(--ink);font:600 16px system-ui;text-decoration:none}.btn-primary{background:var(--ac);border-color:var(--ac);color:var(--on)}.btn-quiet{border-color:transparent;background:transparent;color:var(--ac)}"
+ ".skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:8px;background:var(--sf);padding:8px}:focus-visible{outline:3px solid var(--ac);outline-offset:2px}.card{background:var(--sf);border:1px solid var(--line);border-radius:14px;padding:16px;margin:0 0 12px}.meta,small{color:var(--ink2);font-size:14px}.head p{color:var(--ink2)}"
+ "@media(max-width:640px){.hide-sm{display:none!important}h1{font-size:24px}}";
function dsEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function dsHead(title, description, extraCss) {
  return "<meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + dsEsc(title) + "</title><meta name=\"description\" content=\"" + dsEsc(description) + "\"><style>" + BASE + "\n" + (extraCss || "") + "</style>";
}

const CSS = [
  ".us-hero{padding:28px 0 8px}.us-hero h1{font-size:34px;line-height:1.15;max-width:20ch;margin:0 0 12px}",
  ".us-lede{font-size:18px;color:var(--ink2);max-width:56ch}.us-actions{display:flex;gap:12px;flex-wrap:wrap;margin:16px 0 4px}",
  ".us-status{display:inline-flex;gap:8px;align-items:center;font-size:14px;color:var(--ink2);margin-top:8px}",
  ".us-grid{display:grid;gap:12px}@media(min-width:720px){.us-grid.c3{grid-template-columns:repeat(3,1fr)}.us-grid.c2{grid-template-columns:repeat(2,1fr)}}",
  ".us-table{width:100%;border-collapse:collapse;font-size:15px}.us-table th,.us-table td{text-align:left;padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}",
  ".us-table th{font-size:14px;color:var(--ink2)}.us-wrap{overflow-x:auto}.us-us td{background:var(--soft);font-weight:600}",
  ".us-foot{border-top:1px solid var(--line);margin-top:32px;padding-top:16px;color:var(--ink2);font-size:14px}",
  ".us-pass{color:var(--good);font-weight:700}.us-fail{color:var(--bad);font-weight:700}"
].join("\n");

function esc(s) { return dsEsc(s); }

function shell(opts, body) {
  const url = "https://" + CANON + opts.path;
  return "<!doctype html><html lang=\"en\"><head>" + dsHead(opts.title, opts.description, CSS)
    + "<link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\"><meta property=\"og:image\" content=\"https://" + CANON + "/social-card.svg\"><link rel=\"canonical\" href=\"" + url + "\"><meta property=\"og:title\" content=\"" + esc(opts.title) + "\"><meta property=\"og:description\" content=\"" + esc(opts.description) + "\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:url\" content=\"" + url + "\">"
    + "</head><body><a class=\"skip\" href=\"#main\">Skip to content</a>"
    + "<header class=\"top\"><div class=\"top-in\"><a class=\"brand\" href=\"/\"><img src=\"/favicon.svg\" alt=\"\" width=\"28\" height=\"28\" style=\"vertical-align:middle;margin-right:8px\">Ultrastable</a><a class=\"btn btn-quiet\" href=\"/proof\">Live proof</a><a class=\"btn btn-quiet hide-sm\" href=\"/how\">How it works</a></div></header>"
    + "<main class=\"main\" id=\"main\">" + body
    + "<div class=\"us-foot\">Ultrastable runs QNFO, its first customer, in production. Every number on this site is read from that system's own records. <a href=\"/proof\">See the checks</a> · <a href=\"/llms.txt\">llms.txt</a></div></main></body></html>";
}

let CACHE = { at: 0, data: null };
async function claims() {
  const now = Date.now();
  if (CACHE.data && now - CACHE.at < 300000) return CACHE.data;
  try {
    const r = await fetch(CLAIMS_URL, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error("status " + r.status);
    const d = await r.json();
    if (!Array.isArray(d.claims)) throw new Error("no claims");
    CACHE = { at: now, data: d };
    return d;
  } catch (e) { return CACHE.data; }
}

function statusLine(d) {
  if (!d) return "Live checks are loading from QNFO's records; reload in a minute.";
  return d.passing + " of " + d.total + " claims pass their live check right now (checked " + esc(String(d.checked_at || "").slice(0, 16).replace("T", " ")) + " UTC).";
}

function home(d) {
  return shell({ path: "/", title: "Ultrastable: the self-governing development platform", description: "Vibe coding writes the code you ask for. Ultrastable decides what to build next, ships it, proves it live and keeps score of how often it was right." },
    "<section class=\"us-hero\"><h1>Coding agents write code. Ultrastable runs the system.</h1>"
    + "<p class=\"us-lede\">It finds its own work in your metrics and failures, hands each task to the coding agent that fits, proves every change live with an automatic revert, and keeps score of how often its decisions were right.</p>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Join the pilot</a><a class=\"btn\" href=\"/proof\">See the live proof</a></div>"
    + "<div class=\"us-status\" role=\"status\">" + statusLine(d) + "</div></section>"
    + "<h2>What is different</h2><div class=\"us-grid c3\">"
    + card("It chooses the work", "Metrics breach, a trigger files an issue, a coding agent opens the pull request. A person sets direction and reads reports.")
    + card("It proves every change", "Each deploy declares probes. A probe that passed before and fails after reverts the push on its own.")
    + card("It keeps score", "Every decision logs a prediction first. The outcome is scored later, so you can see how often the system was right.")
    + "</div>"
    + "<h2>Works with the agents you already use</h2><p>Ultrastable is the layer around coding agents, not another one. Open models on its own code loop, GitHub Copilot and Claude Code sessions all take work through one claim ledger, so two agents never edit the same file.</p>"
    + "<h2>Where it fits</h2>" + marketTable()
    + "<h2>Proven on one customer</h2><p>QNFO has run on it since August 2026: thousands of merged pull requests, a hundreds-strong set of failure detectors and a scored prediction history. It is one installation, and the <a href=\"/how#gaps\">honest gaps</a> are listed on this site.</p>"
    + "<div class=\"us-actions\"><a class=\"btn\" href=\"/pilot\">Join the pilot</a></div>");
}

function card(t, p) { return "<div class=\"card\"><h3 class=\"card-title\">" + esc(t) + "</h3><p class=\"meta\">" + esc(p) + "</p></div>"; }

function marketTable() {
  const rows = [
    ["Vibe coding builders", "A person, prompt by prompt", "The person, if at all"],
    ["Coding assistants (Cursor, Claude Code, Codex CLI)", "A person; the agent multiplies effort", "The person reviews"],
    ["Cloud coding agents (Devin, Codex cloud, Copilot agent)", "A person assigns a task", "CI and a reviewer"],
    ["Agent governance and gateways", "Not their job", "Policy, cost and access logs"],
    ["Ultrastable", "The system, from its own metrics and failures", "Live probes, automatic revert, a two-family review and scored predictions"]
  ];
  return "<div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Approach</th><th>Who chooses the work</th><th>Who checks it</th></tr></thead><tbody>"
    + rows.map(function (r, i) { return "<tr" + (i === 4 ? " class=\"us-us\"" : "") + "><td>" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td><td>" + esc(r[2]) + "</td></tr>"; }).join("")
    + "</tbody></table></div>";
}

function how() {
  return shell({ path: "/how", title: "How Ultrastable works", description: "The loop, the ledgers, and the honest gaps of the self-governing development platform." },
    "<div class=\"head\"><h1>How it works</h1><p>One loop, five ledgers, and what it does not do yet.</p></div>"
    + "<div class=\"us-grid c2\">"
    + card("1. Find work", "Metric triggers and failure detectors file issues that carry a code task and a closing probe.")
    + card("2. Hand it to an agent", "A work-claim ledger gives each file to one agent at a time: an open-model code loop, Copilot or Claude Code.")
    + card("3. Prove it live", "Probes declared per service run after each deploy. A regression reverts the push and files its own issue.")
    + card("4. Score the decision", "Each decision logs a prediction before it acts; the outcome is scored later and feeds a trust score per kind of action.")
    + "</div>"
    + "<h2>Why the name</h2><p>W. Ross Ashby's ultrastable system (1952) changes its own settings when an essential variable leaves its limits, so it stays viable without an operator. The trust ledger, doctrine amendments and probe-and-revert loops do that for software.</p>"
    + "<h2 id=\"gaps\">Honest gaps</h2><ul><li>One installation and one customer. There is no installer and no second tenant yet.</li><li>The core still shares a database with QNFO's research applications; separating it is the first pilot milestone.</li><li>The prediction match rate is scored by the system itself. An outside audit is a pilot goal.</li><li>A buyer needs a short default policy pack; today the policy is long and written as owner directives.</li></ul>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Join the pilot</a></div>");
}

async function proof() {
  const d = await claims();
  const rows = d ? d.claims.map(function (c) { return "<tr><td class=\"" + (c.pass ? "us-pass" : "us-fail") + "\">" + (c.pass ? "Pass" : "Fail") + "</td><td>" + esc(c.claim) + (c.detail ? "<br><small>" + esc(c.detail) + "</small>" : "") + "</td></tr>"; }).join("") : "";
  return shell({ path: "/proof", title: "Live proof: Ultrastable claims checked now", description: "Every claim Ultrastable makes is a query against QNFO's own records, run live." },
    "<div class=\"head\"><h1>Live proof</h1><p id=\"st\" role=\"status\">" + statusLine(d) + "</p></div>"
    + "<div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Check</th><th>Claim and what the check saw</th></tr></thead><tbody id=\"rows\">" + (rows || "<tr><td colspan=\"2\">Loading the checks from QNFO's records.</td></tr>") + "</tbody></table></div>"
    + "<p class=\"meta\">Source: <a href=\"" + CLAIMS_URL + "\">qnfo.org/api/platform-claims</a>. A claim that stops passing is fixed or removed from this site.</p>"
    + (d ? "" : "<script>fetch(" + JSON.stringify(CLAIMS_URL) + ").then(function(r){return r.json()}).then(function(d){var e=function(s){return String(s==null?'':s).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]})};document.getElementById('st').textContent=d.passing+' of '+d.total+' claims pass their live check right now.';document.getElementById('rows').innerHTML=d.claims.map(function(c){return '<tr><td class=\"'+(c.pass?'us-pass':'us-fail')+'\">'+(c.pass?'Pass':'Fail')+'</td><td>'+e(c.claim)+(c.detail?'<br><small>'+e(c.detail)+'</small>':'')+'</td></tr>'}).join('')}).catch(function(){document.getElementById('st').textContent='The checks could not be read just now; reload in a minute.'})</script>"));
}

function pilot() {
  const href = "mailto:" + PILOT_MAIL + "?subject=" + encodeURIComponent("Ultrastable pilot") + "&body=" + encodeURIComponent("Team size:\nRepositories or services:\nCoding agents in use:\n");
  return shell({ path: "/pilot", title: "Join the Ultrastable pilot", description: "Design-partner pilot for teams that run many services and want coding agents to keep them healthy, with an audit trail." },
    "<div class=\"head\"><h1>Join the pilot</h1><p>Three design partners, free, one repository each.</p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">Who it is for</h3><p class=\"meta\">Small engineering teams running many services who want agents to find and fix problems without a person choosing every task, and teams that must show auditors what their coding agents did and why.</p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">What you get</h3><p class=\"meta\">The loop installed on one repository: issues from your metrics, agent hand-off, probes with automatic revert, and the ledgers. In return: monthly feedback and permission to cite results.</p></div>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"" + href + "\">Email the pilot team</a></div>"
    + "<p class=\"meta\">The email opens with three short lines to fill in. Replies come from a person within two working days.</p>");
}

const ROBOTS = "User-agent: *\nAllow: /\nSitemap: https://" + CANON + "/sitemap.xml\n";
const LLMS = "# Ultrastable\n\n> Ultrastable is a self-governing development platform: a control loop around coding agents that finds its own work in metrics and failures, hands tasks to the agent that fits, proves each change live with automatic revert, and scores its decisions against logged predictions. QNFO runs on it as customer zero.\n\n- [Live proof](https://" + CANON + "/proof): claims checked against QNFO's records\n- [How it works](https://" + CANON + "/how)\n- [Pilot](https://" + CANON + "/pilot)\n";

const FAVICON = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect width=\"64\" height=\"64\" rx=\"14\" fill=\"#0B5FFF\"/><path d=\"M20 13v21a12 12 0 0 0 24 0V13\" fill=\"none\" stroke=\"#fff\" stroke-width=\"7\" stroke-linecap=\"round\"/><circle cx=\"32\" cy=\"27\" r=\"4.5\" fill=\"#9DC1FF\"/></svg>";
const SOCIAL = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1280 640\" width=\"1280\" height=\"640\"><title>Ultrastable</title><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#0E1116\"/><stop offset=\"1\" stop-color=\"#14264D\"/></linearGradient></defs><rect width=\"1280\" height=\"640\" fill=\"url(#g)\"/><g transform=\"translate(96 190) scale(2.5)\"><rect width=\"64\" height=\"64\" rx=\"14\" fill=\"#0B5FFF\"/><path d=\"M20 13v21a12 12 0 0 0 24 0V13\" fill=\"none\" stroke=\"#fff\" stroke-width=\"7\" stroke-linecap=\"round\"/><circle cx=\"32\" cy=\"27\" r=\"4.5\" fill=\"#9DC1FF\"/></g><text x=\"96\" y=\"470\" font-family=\"Inter,'Segoe UI',system-ui,sans-serif\" font-size=\"96\" font-weight=\"700\" letter-spacing=\"-2\" fill=\"#EEF1F5\">Ultrastable</text><text x=\"96\" y=\"530\" font-family=\"Inter,'Segoe UI',system-ui,sans-serif\" font-size=\"38\" fill=\"#A9B3C1\">Software that stays up.</text><text x=\"1184\" y=\"580\" text-anchor=\"end\" font-family=\"Inter,'Segoe UI',system-ui,sans-serif\" font-size=\"26\" fill=\"#6EA0FF\">ultrastable.io</text></svg>";
const SVG = { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" };

const HTML = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" };

export default {
  async fetch(request) {
    const u = new URL(request.url);
    const host = u.hostname.replace(/^www\./, "");
    if (u.pathname === "/health") return Response.json({ ok: true, worker: "ultrastable-site", version: VERSION });
    if (u.pathname === "/favicon.svg") return new Response(FAVICON, { headers: SVG });
    if (u.pathname === "/social-card.svg") return new Response(SOCIAL, { headers: SVG });
    if (host === "ultrastable.app") return Response.redirect("https://" + CANON + "/pilot", 301);
    if (host === "ultrastable.net") return Response.redirect("https://" + CANON + "/proof", 301);
    if (u.hostname === "www." + CANON) return Response.redirect("https://" + CANON + u.pathname, 301);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    switch (u.pathname.replace(/\/$/, "") || "/") {
      case "/": return new Response(home(await claims()), { headers: HTML });
      case "/how": return new Response(how(), { headers: HTML });
      case "/proof": return new Response(await proof(), { headers: HTML });
      case "/pilot": return new Response(pilot(), { headers: HTML });
      case "/robots.txt": return new Response(ROBOTS, { headers: { "Content-Type": "text/plain" } });
      case "/llms.txt": return new Response(LLMS, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      case "/sitemap.xml": return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" + ["/", "/how", "/proof", "/pilot"].map(function (p) { return "<url><loc>https://" + CANON + p + "</loc></url>"; }).join("") + "</urlset>", { headers: { "Content-Type": "application/xml" } });
      default: return new Response(shell({ path: u.pathname, title: "Not found - Ultrastable", description: "Page not found." }, "<div class=\"head\"><h1>Not found</h1><p>That page does not exist. <a href=\"/\">Go to the home page</a>.</p></div>"), { status: 404, headers: HTML });
    }
  }
};
