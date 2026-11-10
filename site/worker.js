// ultrastable-site: the public presence of Ultrastable, the self-governing development platform (ULTRASTABLE-SITE-1, 2026-11-10).
// Canonical host ultrastable.io; ultrastable.app and ultrastable.net redirect to it (/pilot and /proof). Live proof comes from
// the platform claims QNFO publishes as customer zero. Positioning: docs/PRODUCT-ULTRASTABLE.md and product/boundary.json.
import { handleAnalytics, record } from "../seed/analytics/analytics.js";
var VERSION = "0.2.0";
const CANON = "ultrastable.io";
const CLAIMS_URL = "https://qnfo.org/api/platform-claims";
const PILOT_MAIL = "pilot@ultrastable.io";

const BASE = ":root{color-scheme:light dark;--bg:#f6f1e7;--sf:#fffdf8;--sf2:#efe8d9;--ink:#14120f;--ink2:#5b574f;--line:#ddd5c5;--ac:#c93d00;--on:#fff;--soft:#fde6d9;--good:#0a7a3d;--bad:#b3261e}@media(prefers-color-scheme:dark){:root{--bg:#0b1a15;--sf:#12342a;--sf2:#0f2b22;--ink:#f6f1e7;--ink2:#c9d4cc;--line:#1f4a3c;--ac:#ff5b1f;--on:#0b1a15;--soft:#1b3d31;--good:#4cc38a;--bad:#ff8a80}}"
+ "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 'IBM Plex Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif}a{color:var(--ac)}h1{font-family:Fraunces,Georgia,serif;font-size:28px;line-height:1.2;margin:0 0 8px}h2{font-size:20px;margin:28px 0 8px}h3{margin:0;font-size:17px}p{margin:0 0 12px}"
+ ".top{position:sticky;top:0;background:var(--sf);border-bottom:1px solid var(--line);z-index:5}.top-in{max-width:960px;margin:0 auto;padding:8px 16px;display:flex;align-items:center;gap:8px;min-height:60px}.brand{font-weight:700;font-size:18px;color:var(--ink);text-decoration:none;margin-right:auto}"
+ ".main{max-width:960px;margin:0 auto;padding:20px 16px 64px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:10px 18px;border-radius:6px;border:1px solid var(--line);background:var(--sf);color:var(--ink);font:600 16px system-ui;text-decoration:none}.btn-primary{background:var(--ac);border-color:var(--ac);color:var(--on)}.btn-quiet{border-color:transparent;background:transparent;color:var(--ac)}"
+ ".skip{position:absolute;left:-9999px}.skip:focus{left:16px;top:8px;background:var(--sf);padding:8px}:focus-visible{outline:3px solid var(--ac);outline-offset:2px}.card{background:var(--sf);border:1px solid var(--line);border-radius:8px;padding:16px;margin:0 0 12px}.meta,small{color:var(--ink2);font-size:14px}.head p{color:var(--ink2)}"
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
    + "<link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\"><meta property=\"og:image\" content=\"https://" + CANON + "/social-card.png\"><meta property=\"og:image:width\" content=\"640\"><meta property=\"og:image:height\" content=\"320\"><meta property=\"og:image:alt\" content=\"Coding agents write code. Ultrastable runs the system.\"><meta property=\"og:site_name\" content=\"Ultrastable\"><meta name=\"twitter:card\" content=\"summary_large_image\"><meta name=\"twitter:title\" content=\"" + esc(opts.title) + "\"><meta name=\"twitter:description\" content=\"" + esc(opts.description) + "\"><meta name=\"twitter:image\" content=\"https://" + CANON + "/social-card.png\"><meta name=\"theme-color\" content=\"#12342A\"><link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\"><link rel=\"canonical\" href=\"" + url + "\"><meta property=\"og:title\" content=\"" + esc(opts.title) + "\"><meta property=\"og:description\" content=\"" + esc(opts.description) + "\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:url\" content=\"" + url + "\">"
    + "</head><body><a class=\"skip\" href=\"#main\">Skip to content</a>"
    + "<header class=\"top\"><div class=\"top-in\"><a class=\"brand\" href=\"/\"><img src=\"/favicon.svg\" alt=\"\" width=\"28\" height=\"28\" style=\"vertical-align:middle;margin-right:8px\">ultrastable</a><a class=\"btn btn-quiet\" href=\"/proof\">Live proof</a><a class=\"btn btn-quiet hide-sm\" href=\"/product\">Product</a><a class=\"btn btn-quiet hide-sm\" href=\"/how\">How it works</a><a class=\"btn btn-quiet hide-sm\" href=\"/team\">Team</a><a class=\"btn btn-quiet hide-sm\" href=\"/faq\">FAQ</a><a class=\"btn btn-quiet hide-sm\" href=\"/contact\">Contact</a></div></header>"
    + "<main class=\"main\" id=\"main\">" + body
    + "<div class=\"us-foot\">Ultrastable is an early-stage product. Every number on this site is read from a live system's own records. <a href=\"/proof\">See the checks</a> · <a href=\"/product\">Product</a> · <a href=\"/team\">Team</a> · <a href=\"/faq\">FAQ</a> · <a href=\"/contact\">Contact</a> · <a href=\"/llms.txt\">llms.txt</a></div></main></body></html>";
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
  if (!d) return "Live checks are loading; reload in a minute.";
  return d.passing + " of " + d.total + " claims pass their live check right now (checked " + esc(String(d.checked_at || "").slice(0, 16).replace("T", " ")) + " UTC).";
}

function home(d) {
  return shell({ path: "/", title: "Ultrastable: the self-governing development platform", description: "Vibe coding writes the code you ask for. Ultrastable decides what to build next, ships it, proves it live and keeps score of how often it was right." },
    "<section class=\"us-hero\"><h1>Coding agents write code. Ultrastable runs the system.</h1>"
    + "<p class=\"us-lede\">It finds its own work in your metrics and failures, hands each task to the coding agent that fits, proves every change live with an automatic revert, and keeps score of how often its decisions were right.</p>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Join the pilot</a><a class=\"btn\" href=\"/proof\">See the live proof</a></div>"
    + "<p class=\"meta\">Proven on our own organization: we run on it every day, in public. <a href=\"/proof\">See what the checks show</a>.</p>"
    + "<div class=\"us-status\" role=\"status\">" + statusLine(d) + "</div></section>"
    + "<h2>What is different</h2><div class=\"us-grid c3\">"
    + card("It chooses the work", "Metrics breach, a trigger files an issue, a coding agent opens the pull request. A person sets direction and reads reports.")
    + card("It proves every change", "Each deploy declares probes. A probe that passed before and fails after reverts the push on its own.")
    + card("It keeps score", "Every decision logs a prediction first. The outcome is scored later, so you can see how often the system was right.")
    + "</div>"
    + "<h2>Works with the agents you already use</h2><p>Ultrastable is the layer around coding agents, not another one. Open models on its own code loop, GitHub Copilot and Claude Code sessions all take work through one claim ledger, so two agents never edit the same file.</p>"
    + "<h2>Where it fits</h2>" + marketTable()
    + "<h2>Proven in production</h2><p>It has run a live system since August 2026: thousands of merged pull requests, a hundreds-strong set of failure detectors and a scored prediction history. It is one installation, and the <a href=\"/how#gaps\">honest gaps</a> are listed on this site.</p>"
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
    + "<div class=\"card\"><h3 class=\"card-title\">What you are looking at</h3><p>Ultrastable runs <a href=\"https://qnfo.org/\">QNFO</a>, a real research publisher with hundreds of papers, a public audit record and a daily operating loop. We did not build a demo: we run our own organization on the platform and publish the checks. QNFO is customer zero.</p><p>Each row below is a claim from our <a href=\"/product\">product page</a>. The check behind it is a read-only query against QNFO's own records, run live. If a claim stops passing it is fixed or removed. <a href=\"https://qnfo.org/platform\">How QNFO uses Ultrastable</a> · <a href=\"/how\">How it works</a></p></div>"
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

function product() {
  return shell({ path: "/product", title: "Ultrastable product: a control loop around coding agents", description: "What Ultrastable is, who it is for, what a pilot includes and what is not built yet." },
    "<div class=\"head\"><h1>The product</h1><p>A control loop that sits around the coding agents a team already uses.</p></div>"
    + "<h2>What it does</h2><div class=\"us-grid c3\">"
    + card("Chooses the work", "Reads your metrics and failures, files the issues, and orders them so the most valuable work goes first.")
    + card("Hands it to an agent", "Gives each task to one coding agent at a time, so two agents never edit the same thing.")
    + card("Checks the result", "Every change is checked after it ships and rolled back automatically if something that worked before now fails.")
    + "</div>"
    + "<h2>Who it is for</h2><p>Small engineering teams that run many services and want problems found and fixed without a person choosing every task. Teams that need an audit trail of what their agents changed and why.</p>"
    + "<h2>What a pilot includes</h2><ul><li>The loop installed on one repository of yours.</li><li>Issues filed from your own metrics, with a check that proves each fix.</li><li>A written record of every decision and how it turned out.</li><li>A named contact who replies within two working days.</li></ul>"
    + "<h2>Status</h2><p>Early stage. The loop runs in production today on one installation; a second, independent installation and a packaged installer are the next milestones. Pricing is not set; pilots are free. <a href=\"/how#gaps\">Read the honest gaps.</a></p>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Join the pilot</a><a class=\"btn\" href=\"/faq\">Read the FAQ</a></div>");
}

function team() {
  return shell({ path: "/team", title: "About the Ultrastable team", description: "Who builds Ultrastable: a founder and a staff of AI agents with defined roles, run by the product itself." },
    "<div class=\"head\"><h1>About</h1><p>A founder sets the direction. A staff of AI agents does the work, under the same rules the product sells.</p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">Founder</h3><p class=\"meta\">Sets direction and approves the few steps that need a person: signing, payments and legal filings. Everything else is done, verified and reported by the staff.</p></div>"
    + "<h2>The staff</h2><div class=\"us-grid c2\">"
    + card("Portfolio manager", "Decides which projects get capacity and keeps a protected share of it for improvements.")
    + card("Project manager", "Turns the plan into issues, each with an owner, a trigger and a check that proves it is done.")
    + card("Product manager", "Owns the product pages, customer conversations and the pilot programme.")
    + card("Operations and reviewers", "Run deploys and monitoring, and review each change independently of the agent that wrote it.")
    + "</div>"
    + "<h2>How we work</h2><p>Plans, decisions and results are written down in version control, not in chat. Work is claimed before it starts, checked after it ships, and every claim on this site can be traced to a record.</p>"
    + "<h2>Open roles</h2><p>We are looking for an operator or co-founder with commercial and go-to-market experience, and for design partners. <a href=\"/contact\">Get in touch.</a></p>");
}

function faq() {
  const q = [
    ["Is Ultrastable another coding agent?", "No. It is the layer around the agents you already use. It decides what to work on, assigns it, checks the result and keeps score."],
    ["Which agents and platforms does it work with?", "Open models, GitHub Copilot and Claude Code take work through the same ledger. It runs on Cloudflare today and is designed to run on other clouds."],
    ["Who decides what gets built?", "The system proposes work from your metrics and failures. A person sets direction and reads reports, and approves only steps that cannot be undone."],
    ["What if a change breaks something?", "Each change declares checks that must keep passing. If one that passed before now fails, the change is rolled back automatically and an issue is filed."],
    ["Do I have to give it access to everything?", "No. A pilot covers one repository, with the permissions you grant. Secrets are never stored in the repository."],
    ["What does it cost?", "Pilots are free. Pricing is not set yet and will be published here before any paid plan starts."],
    ["Is it production ready?", "It runs in production on one installation today. It is early-stage: there is no packaged installer yet and a second independent installation is the next milestone."],
    ["How do I start?", "Email the pilot team from the pilot page with your team size, repositories and agents in use."]
  ];
  return shell({ path: "/faq", title: "Ultrastable FAQ", description: "Answers about what Ultrastable is, how it works with coding agents, cost, safety and maturity." },
    "<div class=\"head\"><h1>FAQ</h1><p>Short answers, including what is not built yet.</p></div>"
    + q.map(function (x) { return "<div class=\"card\"><h3 class=\"card-title\">" + esc(x[0]) + "</h3><p class=\"meta\">" + esc(x[1]) + "</p></div>"; }).join("")
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Join the pilot</a></div>");
}

function contact() {
  return shell({ path: "/contact", title: "Contact Ultrastable", description: "How to reach the Ultrastable team about pilots, partnerships and press." },
    "<div class=\"head\"><h1>Contact</h1><p>One address; a person replies within two working days.</p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">Pilots, partnerships and press</h3><p class=\"meta\"><a href=\"mailto:" + PILOT_MAIL + "\">" + PILOT_MAIL + "</a></p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">Online</h3><p class=\"meta\">ultrastable.io. Source code is private for now.</p></div>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Join the pilot</a></div>");
}

const ROBOTS = "User-agent: *\nAllow: /\nSitemap: https://" + CANON + "/sitemap.xml\n";
const LLMS = "# Ultrastable\n\n> Ultrastable is a self-governing development platform: a control loop around coding agents that finds its own work in metrics and failures, hands tasks to the agent that fits, proves each change live with automatic revert, and scores its decisions against logged predictions. QNFO runs on it as customer zero.\n\n- [Live proof](https://" + CANON + "/proof): claims checked against QNFO's records\n- [How it works](https://" + CANON + "/how)\n- [Pilot](https://" + CANON + "/pilot)\n";

const FAVICON = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\" role=\"img\" aria-label=\"ultrastable\"><title>ultrastable</title><path d=\"M30 12 L54 56 H6 Z\" fill=\"#FF5B1F\" stroke=\"#FF5B1F\" stroke-width=\"4\" stroke-linejoin=\"round\"/><circle cx=\"50\" cy=\"14\" r=\"6\" fill=\"#FFC857\"/></svg>";
const SOCIAL = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1280 640\" width=\"1280\" height=\"640\"><title>ultrastable</title><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#12342A\"/><stop offset=\"1\" stop-color=\"#0B1A15\"/></linearGradient></defs><rect width=\"1280\" height=\"640\" fill=\"url(#g)\"/><g transform=\"translate(96 96) scale(2)\"><path d=\"M30 12 L54 56 H6 Z\" fill=\"#FF5B1F\" stroke=\"#FF5B1F\" stroke-width=\"4\" stroke-linejoin=\"round\"/><circle cx=\"50\" cy=\"14\" r=\"6\" fill=\"#FFC857\"/></g><text x=\"96\" y=\"340\" font-family=\"Fraunces,Georgia,'Times New Roman',serif\" font-size=\"76\" font-weight=\"700\" letter-spacing=\"-2\" fill=\"#F6F1E7\">Coding agents write code.</text><text x=\"96\" y=\"430\" font-family=\"Fraunces,Georgia,'Times New Roman',serif\" font-size=\"76\" font-weight=\"700\" letter-spacing=\"-2\" fill=\"#FF5B1F\">Ultrastable runs the system.</text><text x=\"96\" y=\"530\" font-family=\"Georgia,serif\" font-size=\"32\" fill=\"#C9D4CC\">From one idea to a business that improves itself.</text><text x=\"1184\" y=\"590\" text-anchor=\"end\" font-family=\"Georgia,serif\" font-size=\"28\" fill=\"#FFC857\">ultrastable.io</text></svg>";
async function png(env, key) { const a = env && env.ASSETS ? await env.ASSETS.get(key, "arrayBuffer") : null; if (!a) return new Response("Not found", { status: 404 }); return new Response(a, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } }); }
const SVG = { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" };

const HTML = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" };

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    const host = u.hostname.replace(/^www\./, "");
    if (u.pathname === "/health") return Response.json({ ok: true, worker: "ultrastable-site", version: VERSION });
    if (u.pathname === "/favicon.svg") return new Response(FAVICON, { headers: SVG });
    if (u.pathname === "/social-card.png") return png(env, "social-card.png");
    if (u.pathname === "/apple-touch-icon.png") return png(env, "apple-touch-icon.png");
    if (u.pathname === "/social-card.svg") return new Response(SOCIAL, { headers: SVG });
    if (host === "ultrastable.app") return Response.redirect("https://" + CANON + "/pilot", 301);
    if (host === "ultrastable.net") return Response.redirect("https://" + CANON + "/proof", 301);
    if (u.hostname === "www." + CANON) return Response.redirect("https://" + CANON + u.pathname, 301);
    const an = env && env.DB ? await handleAnalytics(request, env, { hosts: [CANON] }) : null; if (an) return an;
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const PAGES = ["/", "/how", "/proof", "/product", "/team", "/faq", "/contact", "/pilot"], pth = u.pathname.replace(/\/$/, "") || "/";
    if (env && env.DB && request.method === "GET" && PAGES.includes(pth)) { const w = record(env, request, { host: CANON, path: pth, ref: request.headers.get("referer") }).catch(e => console.error("analytics", e && e.message)); if (ctx && ctx.waitUntil) ctx.waitUntil(w); }
    switch (u.pathname.replace(/\/$/, "") || "/") {
      case "/": return new Response(home(await claims()), { headers: HTML });
      case "/how": return new Response(how(), { headers: HTML });
      case "/proof": return new Response(await proof(), { headers: HTML });
      case "/product": return new Response(product(), { headers: HTML });
      case "/team": return new Response(team(), { headers: HTML });
      case "/faq": return new Response(faq(), { headers: HTML });
      case "/contact": return new Response(contact(), { headers: HTML });
      case "/pilot": return new Response(pilot(), { headers: HTML });
      case "/robots.txt": return new Response(ROBOTS, { headers: { "Content-Type": "text/plain" } });
      case "/llms.txt": return new Response(LLMS, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      case "/sitemap.xml": return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" + ["/", "/product", "/how", "/proof", "/team", "/faq", "/contact", "/pilot"].map(function (p) { return "<url><loc>https://" + CANON + p + "</loc></url>"; }).join("") + "</urlset>", { headers: { "Content-Type": "application/xml" } });
      default: return new Response(shell({ path: u.pathname, title: "Not found - Ultrastable", description: "Page not found." }, "<div class=\"head\"><h1>Not found</h1><p>That page does not exist. <a href=\"/\">Go to the home page</a>.</p></div>"), { status: 404, headers: HTML });
    }
  }
};
