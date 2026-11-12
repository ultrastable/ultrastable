// ultrastable-site: the public presence of Ultrastable, the self-governing development platform (ULTRASTABLE-SITE-1, 2026-11-10).
// Canonical host ultrastable.io; ultrastable.app and ultrastable.net redirect to it (/pilot and /proof). Live proof comes from
// the platform claims QNFO publishes as customer zero. Positioning: docs/PRODUCT-ULTRASTABLE.md and product/boundary.json.
import { handleAnalytics, record } from "../seed/analytics/analytics.js";
import USER_PATH from "./userpath.js";
import BRIEF from "./platformbrief.js";
import IV from "./interview.js";
import SG from "./suggest.js";
var VERSION = "0.11.0";
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
].join("\n") + "\n" + IV.CSS;

function esc(s) { return dsEsc(s); }

function shell(opts, body) {
  const url = "https://" + CANON + opts.path;
  return "<!doctype html><html lang=\"en\"><head>" + dsHead(opts.title, opts.description, CSS)
    + "<link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\"><meta property=\"og:image\" content=\"https://" + CANON + "/social-card.png\"><meta property=\"og:image:width\" content=\"640\"><meta property=\"og:image:height\" content=\"320\"><meta property=\"og:image:alt\" content=\"Coding agents write code. Ultrastable runs the system.\"><meta property=\"og:site_name\" content=\"Ultrastable\"><meta name=\"twitter:card\" content=\"summary_large_image\"><meta name=\"twitter:title\" content=\"" + esc(opts.title) + "\"><meta name=\"twitter:description\" content=\"" + esc(opts.description) + "\"><meta name=\"twitter:image\" content=\"https://" + CANON + "/social-card.png\"><meta name=\"theme-color\" content=\"#12342A\"><link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\"><link rel=\"canonical\" href=\"" + url + "\"><meta property=\"og:title\" content=\"" + esc(opts.title) + "\"><meta property=\"og:description\" content=\"" + esc(opts.description) + "\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:url\" content=\"" + url + "\">"
    + "</head><body><a class=\"skip\" href=\"#main\">Skip to content</a>"
    + "<header class=\"top\"><div class=\"top-in\"><a class=\"brand\" href=\"/\"><img src=\"/favicon.svg\" alt=\"\" width=\"28\" height=\"28\" style=\"vertical-align:middle;margin-right:8px\">ultrastable</a><a class=\"btn btn-quiet\" href=\"/proof\">Live proof</a><a class=\"btn btn-quiet hide-sm\" href=\"/product\">Product</a><a class=\"btn btn-quiet hide-sm\" href=\"/engineers\">Engineers</a><a class=\"btn btn-quiet hide-sm\" href=\"/how\">How it works</a><a class=\"btn btn-quiet hide-sm\" href=\"/team\">Team</a><a class=\"btn btn-quiet hide-sm\" href=\"/faq\">FAQ</a><a class=\"btn btn-quiet hide-sm\" href=\"/contact\">Contact</a></div></header>"
    + "<main class=\"main\" id=\"main\">" + body
    + "<div class=\"us-foot\">Ultrastable is an early-stage product. Every number on this site is read from a live system's own records. <a href=\"/proof\">See the checks</a> · <a href=\"/product\">Product</a> · <a href=\"/team\">Team</a> · <a href=\"/faq\">FAQ</a> · <a href=\"/contact\">Contact</a> · <a href=\"/llms.txt\">llms.txt</a></div>"
    + "<div class=\"us-foot\" id=\"credit\">Directed by <a href=\"https://rwnq8.github.io/ultrastable/\">Rowan Brad Quni-Gudzinas</a>, founder and director of Ultrastable. <a href=\"https://rwnq8.github.io\">Website</a> · <a href=\"https://orcid.org/0009-0002-4317-5604\">ORCID</a> · <a href=\"https://github.com/rwnq8\">GitHub</a> · <a href=\"https://www.linkedin.com/in/rowan-quni\">LinkedIn</a></div>"
    + "<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@type\":\"WebSite\",\"name\":\"Ultrastable\",\"url\":\"https://ultrastable.io\",\"creator\":{\"@type\":\"Person\",\"name\":\"Rowan Brad Quni-Gudzinas\",\"jobTitle\":\"Founder and Director, Ultrastable\",\"url\":\"https://rwnq8.github.io\",\"sameAs\":[\"https://orcid.org/0009-0002-4317-5604\",\"https://github.com/rwnq8\",\"https://www.linkedin.com/in/rowan-quni\"]}}</script></main></body></html>";
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
  return shell({ path: "/", title: "Ultrastable: the foundation for any autonomous system", description: "Ultrastable is the foundation for any autonomous system. Vibe coding writes the code you ask for. Ultrastable decides what to build next, ships it, proves it live and keeps score of how often it was right." },
    "<section class=\"us-hero\"><h1>Tell us what you need. We build it and keep it running.</h1><p class=\"us-lede\">Speak or type a few words. We ask a couple of quick questions, then build it, host it and look after it. Ultrastable is the foundation for any autonomous system.</p>"
    + IV.askBar("Tell me what is on your mind…")
    + "<div class=\"us-actions\"><a class=\"btn\" href=\"/setup\">Set up my own</a><a class=\"btn\" href=\"/proof\">See the live proof</a></div>"
    + "<div class=\"us-status\" role=\"status\">" + statusLine(d) + "</div></section>"
    + "<div class=\"us-lane\"><h2>Already comfortable with code?</h2><p class=\"us-tagline\">A system is autonomous if it has self-referential loops and the ability to close them. Coding agents write code. Ultrastable runs the system. Ultrastable runs on itself.</p><p class=\"us-lede\">It finds its own work in your metrics and failures, hands each task to the coding agent that fits, proves every change live with an automatic revert, and keeps score of how often its decisions were right.</p><p>You do not have to answer questions. The loops, virtual managers, agents and plussing budget are all there to use, with an honest list of what is live, in testing, and not built yet.</p><div class=\"us-actions\"><a class=\"btn\" href=\"/engineers\">Go straight to the engine</a></div></div>"
    + "<h2>What it is not for</h2><div class=\"us-grid c2\">"
    + card("Not for one-off pages or trips", "A booking page, a packing list or a weekend project does not need loops, probes or a paid back end. Use a site builder.")
    + card("Not for prompt-by-prompt vibe coding", "Ultrastable needs setup and commitment: a named objective, metrics, and a short list of steps a person always decides.")
    + "</div>"
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

function org() {
  return shell({ path: "/org", title: "Ultrastable organization", description: "How the Ultrastable organization is laid out: four repositories, each with one purpose." },
    "<div class=\"head\"><h1>Organization</h1><p>Four repositories, each with one purpose. Ultrastable runs on itself, so this layout is itself checked by code.</p></div>"
    + "<div class=\"us-grid c2\">"
    + card("System of record", "Roadmap, doctrine, agents, operations and the self-hosting proof.")
    + card("Code", "The portable core, platform adapters and the bootstrapper that turns an idea file into a running organization.")
    + card("Specifications", "Architectural specifications, product documentation and the license: free for non-commercial use, revenue share for commercial use.")
    + card("Profile", "The public face of the organization on GitHub.")
    + "</div><p class=\"meta\">Repositories are private until the license is released. Superseded early splits are archived, never deleted.</p>");
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

// FRONT-DOOR-1: one prompt bar. A person types an idea in plain words; the system takes it from there. No account, key, repo or terminal.
// The idea is stored under idea:<time>:<id> in the ASSETS KV; the executor tick is its consumer (instances/ultrastable/loop-registry.json).
function start(note) {
  const body = "<div class=\"head\"><h1>Tell me what is on your mind</h1><p>" + (typeof note === "string" ? note : "A word or two is plenty. Speak it or type it, then answer a few quick either/or questions. We build it, host it and keep it running.") + "</p></div>" + IV.askBar("Say or type a few words…");
  return shell({ path: "/start", title: "Start - Ultrastable", description: "Say or type a few words and Ultrastable interviews you, then builds, hosts and runs it." }, body);
}
// BUILD-1: idea -> live site with no account, key or terminal. Workers AI (binding AI) writes one self-contained page, KV (ASSETS) hosts it at
// /s/<id>, and a plain "change something" form regenerates it. Served under a sandbox CSP so a generated page can never touch ultrastable.io.
// RECALL-1 (borrowed from QNFO PROMPTED-RECALL-1): before building, the system looks for what it does not know about the idea and asks 3 tap-only
// questions (Yes / No / Not sure); every answer changes the brief at once. AUDIT-1: after building, a second model checks the page against the brief,
// revises once if it finds a real gap, and publishes an honest "what I checked / what I could not do" list at /s/<id>/review.
// Model ids are deprecated without notice (a hard-coded one silently broke the audit), so every call walks a list until one answers.
const BUILDERS = ["@cf/qwen/qwen2.5-coder-32b-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"], ASKERS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/meta/llama-3.1-8b-instruct-fp8", "@cf/mistralai/mistral-small-3.1-24b-instruct"], SYS = "You build small, beautiful, working web pages. Output exactly one complete self-contained HTML file (inline CSS and JS, no external libraries, mobile friendly, accessible, real content not lorem ipsum, any saved data kept in localStorage wrapped in try/catch with an in-memory fallback, because the page runs sandboxed). No explanation, no markdown.";
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const okId = (x) => /^[a-f0-9]{10}$/.test(x || "");
const jget = async (env, k) => { const v = await env.ASSETS.get(k); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const jput = (env, k, v) => env.ASSETS.put(k, JSON.stringify(v));
const FALLBACK_QS = [
  { q: "Should visitors be able to add or save their own information?", cue: "For example a sign-up list, notes or favourites." },
  { q: "Will most people open this on a phone?", cue: "We will make the layout fit small screens first." },
  { q: "Should it look calm and simple rather than bold and colourful?", cue: "You can change this later with one sentence." }];
async function runAny(env, models, body) {
  let last; for (const m of models) { try { return await env.AI.run(m, body); } catch (e) { last = e; console.error("model failed", m, String(e).slice(0, 160)); } } throw last;
}
async function aiJson(env, models, system, user, tokens) {
  const r = await runAny(env, models, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: tokens });
  // Workers AI returns either a string, an already-parsed object in r.response, or OpenAI-style choices; accept all three.
  if (r && r.response && typeof r.response === "object") return r.response;
  const t = String((r && (r.response || r.result || (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content))) || ""), m = /[\[{][\s\S]*[\]}]/.exec(t);
  return m ? JSON.parse(m[0]) : null;
}
async function questionsFor(env, idea) {
  try {
    const a = await aiJson(env, ASKERS, "You find what is unknown about a new web idea. Reply with only a JSON array of exactly 3 objects {\"q\":\"a yes/no question in plain words a child could answer\",\"cue\":\"one short example\"}. Each question must settle something that would change what gets built. No jargon.", idea, 500);
    const qs = (Array.isArray(a) ? a : []).filter(x => x && typeof x.q === "string" && x.q.length < 200).slice(0, 3).map(x => ({ q: x.q, cue: String(x.cue || "").slice(0, 160) }));
    return qs.length === 3 ? qs : FALLBACK_QS;
  } catch (e) { console.error("questions failed", String(e)); return FALLBACK_QS; }
}
function briefOf(a) {
  const lines = a.qs.map((x, i) => "- " + x.q + " " + ({ yes: "YES", no: "NO", unsure: "NOT SURE (pick the safest sensible default and say nothing)" }[a.ans[i]] || "NOT ASKED"));
  return "Idea: " + a.idea + "\nWhat the person told us:\n" + lines.join("\n");
}
async function aiHtml(env, brief, prev, change) {
  const msgs = [{ role: "system", content: SYS }];
  msgs.push(prev ? { role: "user", content: "Here is the current page:\n" + prev + "\n\nChange it as follows and return the whole updated file: " + change } : { role: "user", content: "Build this.\n" + brief });
  const r = await runAny(env, BUILDERS, { messages: msgs, max_tokens: 7000 });
  const t = String((r && (r.response || r.result || (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content))) || ""), m = /```(?:html)?\s*([\s\S]*?)```/.exec(t), h = (m ? m[1] : t).trim();
  if (!/<html[\s>]/i.test(h) || !/<\/html>/i.test(h)) throw new Error("the model did not return a complete page");
  return h;
}
// AUDIT-1: a different model than the builder grades the page against the brief; the limits that no page-only build can meet are always declared.
const ALWAYS_LIMITS = ["Information people enter is kept only in their own browser, not shared with other visitors yet.", "The site lives at a shared Ultrastable address, not your own web address yet."];
async function audit(env, id, brief, html) {
  try {
    const a = await aiJson(env, ASKERS, "You are a strict reviewer. Compare the HTML page with the brief. Reply with only JSON {\"met\":[\"short plain sentences of what is done\"],\"gaps\":[{\"what\":\"plain sentence\",\"critical\":true|false}]}. Be honest; list a gap when something asked for is missing or likely broken.", brief + "\n\nPAGE:\n" + html.slice(0, 9000), 700);
    const rec = { met: ((a && a.met) || []).slice(0, 8).map(String), gaps: ((a && a.gaps) || []).slice(0, 6).map(g => ({ what: String(g.what || g), critical: !!g.critical })), limits: ALWAYS_LIMITS, at: new Date().toISOString() };
    await jput(env, "audit:" + id, rec); return rec;
  } catch (e) { console.error("audit failed", id, String(e)); const rec = { met: [], gaps: [], limits: ALWAYS_LIMITS, note: "The automatic check could not run this time.", error: String(e).slice(0, 300), at: new Date().toISOString() }; await jput(env, "audit:" + id, rec); return rec; }
}
async function build(env, id, brief, prev, change) {
  try {
    await env.ASSETS.put("brief:" + id, JSON.stringify({ brief, change: change || null }));
    await env.ASSETS.put("site:" + id, await aiHtml(env, brief, prev, change)); await env.ASSETS.put("state:" + id, "ready");
    await env.ASSETS.delete("audit:" + id);
  } catch (e) { console.error("build failed", id, String(e)); await env.ASSETS.put("state:" + id, "failed"); }
}
// Each stage runs in its own request so it gets its own time budget (waitUntil is capped at about 30 s): build, then audit and at most one fix.
async function ensureAudit(env, ctx, id) {
  if (await env.ASSETS.get("audit:" + id) || await env.ASSETS.get("auditing:" + id)) return;
  await env.ASSETS.put("auditing:" + id, "1", { expirationTtl: 120 });
  const job = (async () => {
    const b = await jget(env, "brief:" + id), html = await env.ASSETS.get("site:" + id);
    if (!b || !html) return;
    const rec = await audit(env, id, b.brief + (b.change ? "\nLatest change asked: " + b.change : ""), html);
    const crit = rec.gaps.filter(g => g.critical).map(g => g.what);
    if (crit.length && !b.change) {
      const better = await aiHtml(env, b.brief, html, "Fix these problems and change nothing else: " + crit.join("; ")).catch(() => null);
      if (better) { await env.ASSETS.put("site:" + id, better); rec.fixed = crit; await jput(env, "audit:" + id, rec); }
    }
  })().catch(e => console.error("audit stage failed", id, String(e)));
  if (ctx && ctx.waitUntil) ctx.waitUntil(job); else await job;
}
async function limited(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "x", key = "rl:" + ip + ":" + new Date().toISOString().slice(0, 13);
  const n = Number(await env.ASSETS.get(key) || 0);
  if (n >= 6) return new Response(start("Lots of builds from your connection this hour. Please try again a little later."), { status: 429, headers: HTML });
  await env.ASSETS.put(key, String(n + 1), { expirationTtl: 7200 }); return null;
}
const goto = (id, tail) => Response.redirect("https://" + CANON + "/s/" + id + tail, 303);
// BUILD-2 (kept): the build runs inside the /make request (awaited), never in waitUntil, which is cut off about 30 s after the response. The job
// is stored so any later /make poll resumes it after an eviction; a claim with a TTL stops two polls building at once; tries are capped at 3.
const json = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
async function launch(env, ctx, id, brief, prev, change) { await store(env, id, brief, prev, change); return goto(id, "/make"); }
async function store(env, id, brief, prev, change) {
  await env.ASSETS.put("job:" + id, JSON.stringify({ brief: brief, change: change, base: prev ? true : false }), { expirationTtl: 86400 });
  await env.ASSETS.put("tries:" + id, "0", { expirationTtl: 86400 });
  await env.ASSETS.put("state:" + id, "building"); await env.ASSETS.put("since:" + id, String(Date.now()));
}
async function resume(env, id) {
  if (await env.ASSETS.get("claim:" + id)) return "claimed";
  const tries = Number(await env.ASSETS.get("tries:" + id) || 0), job = JSON.parse((await env.ASSETS.get("job:" + id)) || "null");
  if (!job || tries >= 3) { await env.ASSETS.put("state:" + id, "failed"); return "failed"; }
  await env.ASSETS.put("claim:" + id, "1", { expirationTtl: 120 });
  await env.ASSETS.put("tries:" + id, String(tries + 1), { expirationTtl: 86400 });
  await build(env, id, job.brief, job.base ? await env.ASSETS.get("site:" + id) : null, job.change);
  await env.ASSETS.delete("claim:" + id);
  return await env.ASSETS.get("state:" + id);
}
// SUGGEST-1: ideas that rotate and respond to what is typed. A bound model proposes follow-ups first; the bank in suggest.js is the floor.
async function suggestions(u, env) {
  const q = (u.searchParams.get("q") || "").slice(0, 200), seen = (u.searchParams.get("seen") || "").split("|").filter(Boolean).slice(0, 12), n = Math.min(6, Number(u.searchParams.get("n")) || 4), seed = Number(u.searchParams.get("seed")) || Date.now();
  let out = [];
  if (env && env.AI && q.trim().split(/\s+/).length >= 3) {
    try {
      const a = await aiJson(env, ASKERS, "You suggest follow-on ideas for someone who is describing a project in a few words. Reply with only a JSON array of 4 short plain-language idea strings, each under 60 characters, each a different useful direction related to what they said. No jargon.", q, 200);
      out = (Array.isArray(a) ? a : []).filter(x => typeof x === "string" && x.length < 80).slice(0, n);
    } catch (e) { console.error("suggest model failed", String(e)); }
  }
  for (const t of SG.suggest(q, seen.concat(out), seed, n)) if (out.length < n) out.push(t);
  return json({ s: out, q });
}
async function takeIdea(request, env, ctx) {
  const f = await request.formData().catch(() => null), idea = f && String(f.get("idea") || "").trim().slice(0, 2000);
  if (!idea) return new Response(start(false), { status: 400, headers: HTML });
  const lim = await limited(request, env); if (lim) return lim;
  const id = newId(); await env.ASSETS.put("idea:" + new Date().toISOString() + ":" + id, idea);
  const profText = String(f.get("profile") || "").slice(0, 2000); let profOk = false;
  const wantsJson = (request.headers.get("accept") || "").includes("application/json");
  if (profText) { try { JSON.parse(profText); await env.ASSETS.put("profile:" + id, profText, { expirationTtl: 31536000 }); profOk = true; } catch (e) { console.error("bad profile dropped", String(e)); } }
  // INTERVIEW-1: the on-page interview already asked its questions, so build now; without it (no JavaScript) the server-side questions run.
  // INTERVIEW-2: the chat thread asked its questions in the conversation and wants JSON, not a redirect; the build then runs from /s/<id>/status.
  if (profOk && wantsJson) { await store(env, id, idea, null, null); return json({ id, state: "building" }); }
  if (profOk) return launch(env, ctx, id, idea, null, null);
  await jput(env, "ask:" + id, { idea, qs: await questionsFor(env, idea), ans: [] });
  await env.ASSETS.put("state:" + id, "asking");
  return goto(id, "/ask");
}
async function takeAnswer(request, env, ctx) {
  const f = await request.formData().catch(() => null), id = f && String(f.get("id") || ""), v = f && String(f.get("a") || "");
  const a = okId(id) ? await jget(env, "ask:" + id) : null;
  if (!a || !["yes", "no", "unsure"].includes(v)) return new Response(start("That question was not found."), { status: 404, headers: HTML });
  if (a.ans.length < a.qs.length) a.ans.push(v);
  await jput(env, "ask:" + id, a);
  return a.ans.length < a.qs.length ? goto(id, "/ask") : launch(env, ctx, id, briefOf(a), null, null);
}
async function takeChange(request, env, ctx) {
  const f = await request.formData().catch(() => null), id = f && String(f.get("id") || ""), change = f && String(f.get("change") || "").trim().slice(0, 1000);
  const prev = okId(id) ? await env.ASSETS.get("site:" + id) : null;
  if (!prev || !change) return new Response(start("That site was not found."), { status: 404, headers: HTML });
  const lim = await limited(request, env); if (lim) return lim;
  const a = await jget(env, "ask:" + id), brief = a ? briefOf(a) : ((await jget(env, "brief:" + id)) || {}).brief || "";
  if ((request.headers.get("accept") || "").includes("application/json")) { await store(env, id, brief, prev, change); return json({ id, state: "building" }); }
  return launch(env, ctx, id, brief, prev, change);
}
const li = (xs) => xs.length ? "<ul>" + xs.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "<p class=\"meta\">Nothing to list.</p>";
async function siteRoutes(u, env, ctx) {
  const m = /^\/s\/([a-f0-9]{10})(\/make|\/change|\/ask|\/review|\/status)?$/.exec(u.pathname);
  if (!m || !env || !env.ASSETS) return null;
  const id = m[1]; let st = await env.ASSETS.get("state:" + id); const page = (t, b) => new Response(shell({ path: u.pathname, title: t + " - Ultrastable", description: t }, b), { headers: HTML });
  if (!st) return new Response(start("That site was not found."), { status: 404, headers: HTML });
  if (st === "building" && Date.now() - Number(await env.ASSETS.get("since:" + id) || 0) > 150000) { st = "failed"; await env.ASSETS.put("state:" + id, "failed"); }
  if (st === "ready" && (!m[2] || m[2] === "/review")) await ensureAudit(env, ctx, id);
  if (m[2] === "/ask") {
    const a = await jget(env, "ask:" + id);
    if (!a || a.ans.length >= a.qs.length) return Response.redirect("https://" + CANON + "/s/" + id + "/make", 302);
    const n = a.ans.length, q = a.qs[n], b = (v, t, p) => "<button class=\"btn" + (p ? " btn-primary" : "") + "\" name=\"a\" value=\"" + v + "\" type=\"submit\" style=\"margin-right:.6rem\">" + t + "</button>";
    return page("A quick question", "<div class=\"head\"><p class=\"meta\">Question " + (n + 1) + " of " + a.qs.length + "</p><h1>" + esc(q.q) + "</h1><p class=\"meta\">" + esc(q.cue) + "</p></div><form method=\"post\" action=\"/api/answer\"><input type=\"hidden\" name=\"id\" value=\"" + id + "\"><div class=\"us-actions\">" + b("yes", "Yes", 1) + b("no", "No") + b("unsure", "Not sure") + "</div></form>");
  }
  if (m[2] === "/status") {
    // INTERVIEW-2: the thread polls here. Each poll advances the same stages the pages do, so a status call is the build and the audit.
    let cur = st; if (cur === "building") cur = await resume(env, id);
    const out = { state: cur === "claimed" ? "building" : cur };
    if (cur === "ready" && u.searchParams.get("audit")) { await ensureAudit(env, ctx, id); const r = await jget(env, "audit:" + id); if (r) out.audit = { met: r.met, gaps: r.gaps, fixed: r.fixed || [], limits: r.limits }; }
    return json(out);
  }
  if (m[2] === "/review") {
    const r = await jget(env, "audit:" + id);
    if (!r) return page("What I checked", "<div class=\"head\"><h1>Still checking</h1><p>Give it a few seconds, then refresh.</p></div><meta http-equiv=\"refresh\" content=\"5\">");
    return page("What I checked", "<div class=\"head\"><h1>What I checked</h1><p>An independent check of your site against what you asked for.</p></div><div class=\"card\"><h3 class=\"card-title\">Done</h3>" + li(r.met) + "</div><div class=\"card\"><h3 class=\"card-title\">Not right yet</h3>" + li(r.gaps.map(g => g.what + (r.fixed && r.fixed.includes(g.what) ? " (fixed automatically)" : ""))) + "</div><div class=\"card\"><h3 class=\"card-title\">What I cannot do yet</h3>" + li(r.limits) + (r.note ? "<p class=\"meta\">" + esc(r.note) + "</p>" : "") + "</div><div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/s/" + id + "\">Back to my site</a> <a class=\"btn\" href=\"/s/" + id + "/change\">Change something</a></div>");
  }
  if (m[2] === "/change") return page("Change your site", "<div class=\"head\"><h1>What should change?</h1><p>Say it in plain words.</p></div><form method=\"post\" action=\"/api/change\"><input type=\"hidden\" name=\"id\" value=\"" + id + "\"><div class=\"us-ask\"><input name=\"change\" type=\"text\" maxlength=\"1000\" required autocomplete=\"off\" aria-label=\"What should change\" placeholder=\"Make it green and add a contact button\"><button type=\"submit\" class=\"us-rb go\" aria-label=\"Update\" title=\"Update\"><svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 12l16-8-6 16-3-7-7-1z\"/></svg></button></div><div class=\"us-chips\"><a class=\"us-chip quiet\" href=\"/s/" + id + "\">Cancel</a></div></form>");
  if (m[2] === "/make") {
    if (st === "asking") return Response.redirect("https://" + CANON + "/s/" + id + "/ask", 302);
    let cur = st;
    if (cur === "building") cur = await resume(env, id);
    if (cur === "ready") return Response.redirect("https://" + CANON + "/s/" + id, 302);
    const msg = cur === "failed" ? "<p>That did not work this time. <a href=\"/start\">Try again</a>.</p>" : "<p>Building your site. This takes about half a minute. This page updates by itself.</p><meta http-equiv=\"refresh\" content=\"4\">";
    return page("Building", "<div class=\"head\"><h1>" + (cur === "failed" ? "Something went wrong" : "Building...") + "</h1></div>" + msg);
  }
  if (st === "asking") return Response.redirect("https://" + CANON + "/s/" + id + "/ask", 302);
  if (st !== "ready") return Response.redirect("https://" + CANON + "/s/" + id + "/make", 302);
  const lk = (h, t) => "<a href=\"https://" + CANON + "/s/" + id + h + "\" style=\"background:#111;color:#fff;padding:10px 14px;border-radius:999px;text-decoration:none;margin-left:6px\" target=\"_top\">" + t + "</a>";
  const bar = "<div style=\"position:fixed;right:12px;bottom:12px;z-index:99999;font:14px system-ui\">" + lk("/review", "What I checked") + lk("/change", "Change something") + "</div>";
  const html = (await env.ASSETS.get("site:" + id) || "").replace(/<\/body>/i, bar + "</body>");
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation; default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}
// AGENT-PROMPT-1: the whole set-up as one paste. Works in any AI assistant; the person needs no account to start.
const AGENT_PROMPT = "I want to start a project with Ultrastable (https://ultrastable.io), a system that runs itself so I do not have to code. "
  + "Read https://ultrastable.io/agent.md and follow it. Ask me, in plain words, what I want to make, then do every step you can yourself. "
  + "If a step needs me, give me one link and one thing to click, nothing else. Do not use technical words with me.";
const AGENT_MD = "# Ultrastable: set-up instructions for an AI assistant\n\nYou are helping a person stand up an ongoing autonomous system (a service fleet, a data pipeline, a compliance or publishing operation). It needs setup, measurable objectives and a back end that costs money. If their idea is a one-off page, trip or hobby tool, say Ultrastable is not the right fit and stop. Goal: their system is live, measured and improving itself.\n\n1. Ask one question: what do they want to make or fix? Accept speech-to-text rambling; restate it in one sentence and confirm.\n2. Do everything you can with your own tools (create the GitHub project from the template, connect Cloudflare, open the first pull request). To run on another cloud, give that cloud's own assistant https://ultrastable.io/deploy.md and let it work out the deployment. Use their sign-ins only through the sign-in pages they approve; never ask them to paste passwords or keys into chat.\n3. If you cannot act, walk them through https://ultrastable.io/setup one question at a time. Each step is a single link and a single click.\n4. Speak plainly. No words like token, terminal, repo, API. Say what you are doing and what they should see.\n5. Finish by telling them where to watch their project (https://ultrastable.io/proof) and that it now maintains itself; they only need to come back with new ideas.\n";
// USER-PATH-1: guided set-up. One question per screen, every action one click, progress kept in this browser only.
// Steps come from doctrine/user-path.json (generated into userpath.js); no step needs a command, a key or a file.
function setup() {
  const data = JSON.stringify(USER_PATH).replace(/</g, "\\u003c");
  const js = "(function(){var D=" + data + ",S=D.steps,K='us-setup',st={};try{st=JSON.parse(localStorage.getItem(K)||'{}')}catch(e){}"
    + "st.i=st.i||0;st.v=st.v||{};var el=document.getElementById('us-wiz');"
    + "function save(){try{localStorage.setItem(K,JSON.stringify(st))}catch(e){}}"
    + "function fill(t){return String(t||'').replace('{template}',D.template).replace('{user}',st.v.user||'your-name').replace('{project}',st.v.project||'your-project')}"
    + "function h(tag,txt,cls){var n=document.createElement(tag);if(txt!=null)n.textContent=txt;if(cls)n.className=cls;return n}"
    + "function btn(txt,fn,primary){var b=h('button',txt,'btn'+(primary?' btn-primary':''));b.type='button';b.onclick=fn;b.style.marginRight='.6rem';return b}"
    + "function go(n){st.i=n;st.p=null;save();draw()}"
    + "function open(a){window.open(fill(a.url),'_blank','noopener')}"
    + "function draw(){el.textContent='';if(st.i>=S.length){el.appendChild(h('h2',D.done.title));el.appendChild(h('p',D.done.text));el.appendChild(btn('Start again',function(){st={i:0,v:st.v};save();draw()}));return}"
    + "var s=S[st.i];el.appendChild(h('p','Step '+(st.i+1)+' of '+S.length+(s.optional?' (optional)':'')+' - '+s.service,'meta'));"
    + "el.appendChild(h('h2',s.ask));el.appendChild(h('p',s.why,'meta'));var row=h('div');row.className='us-actions';"
    + "if(s.input){var f=h('input');f.type='text';f.placeholder=s.input.placeholder;f.value=st.v[s.input.field]||'';f.style.cssText='font-size:1.1rem;padding:.8rem 1.2rem;width:100%;max-width:24rem;display:block;margin:.6rem 0;border-radius:999px;border:1.5px solid var(--line);background:var(--sf);color:var(--ink)';el.appendChild(f);"
    + "row.appendChild(btn('Continue',function(){var v=f.value.trim().replace(/[^A-Za-z0-9._-]/g,'');if(!v){f.focus();return}st.v[s.input.field]=v;go(st.i+1)},true))}"
    + "else if(st.p){var a=s[st.p];el.appendChild(h('p',fill(a.then||'')));row.appendChild(btn(s.confirm?'Yes':'Continue',function(){go(st.i+1)},true));row.appendChild(btn('Open it again',function(){open(a)}))}"
    + "else{row.appendChild(btn('Yes',function(){var a=s.yes;if(a.url){open(a);st.p='yes';save();draw()}else go(st.i+1)},true));"
    + "row.appendChild(btn(s.optional?'Not now':'No',function(){var a=s.no;if(!a||a.next){if(s.optional||(a&&a.next))go(st.i+1);else{el.appendChild(h('p','No problem. Come back to this page whenever you are ready.'))}}else{open(a);st.p='no';save();draw()}}))}"
    + "el.appendChild(row);if(st.i>0){var b=h('p');var l=h('a','Back');l.href='#';l.onclick=function(e){e.preventDefault();go(st.i-1)};b.appendChild(l);el.appendChild(b)}}"
    + "draw()})();";
  return shell({ path: "/setup", title: "Set up - Ultrastable", description: "Set up your own Ultrastable project one simple question at a time." },
    "<div class=\"head\"><h1>Let's get you set up</h1><p>One question at a time. Everything is a click. Nothing to install or type.</p></div><div class=\"card\"><h3 class=\"card-title\">Easiest: let an assistant do it</h3><p class=\"meta\">Press Copy, then paste into any AI assistant (Claude, ChatGPT, Gemini, Copilot). No account needed to start.</p><textarea id=\"us-ap\" readonly rows=\"4\" style=\"width:100%;font-size:1rem;padding:.6rem\"></textarea><p><button type=\"button\" class=\"btn btn-primary\" id=\"us-cp\">Copy</button> <span id=\"us-cpm\" class=\"meta\"></span></p></div><div id=\"us-wiz\" class=\"card\"><noscript>This page needs JavaScript to guide you.</noscript></div><script>var P=" + JSON.stringify(AGENT_PROMPT) + ";var t=document.getElementById('us-ap');t.value=P;document.getElementById('us-cp').onclick=function(){t.select();try{navigator.clipboard.writeText(P)}catch(e){document.execCommand('copy')}document.getElementById('us-cpm').textContent='Copied. Paste it into your assistant.'};" + js + "</script>");
}
function engineers() {
  const tag = { Live: "us-pass", Testing: "meta", Pinned: "us-fail" };
  const rows = IV.PINS.map(function (p) { return "<tr><td class=\"" + tag[p[0]] + "\">" + esc(p[0]) + "</td><td><strong>" + esc(p[1]) + "</strong><br><small>" + esc(p[2]) + "</small></td><td><small><code>" + esc(p[3]) + "</code></small></td></tr>"; }).join("");
  return shell({ path: "/engineers", title: "Ultrastable for engineers", description: "The autonomous loops, virtual managers, agents and plussing budget, with what is live, in testing and not built yet." },
    "<div class=\"head\"><h1>For engineers</h1><p>No interview. Ultrastable runs on itself, so the same code is yours to run. Status is honest: Live, Testing, or Pinned (not built yet, with the trigger that will build it).</p></div>"
    + "<div class=\"us-grid c2\">" + card("Loops", "Each loop has a trigger, owner, definition of done, two independent paths and a closing probe. Verify with python3 -m foundation loops --verify.") + card("Virtual managers", "Portfolio, project and product managers own business, marketing, funding, legal and ops; staff roles do the work; reviewers are never the author.") + card("Agents", "Open models, GitHub Copilot, Claude Code and Codex take work through one claim ledger.") + card("Plussing", "A protected improvement budget so the backlog does not devolve into bug fixes.") + "</div>"
    + "<h2>Status and roadmap pins</h2><div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Status</th><th>Capability</th><th>Where / trigger</th></tr></thead><tbody>" + rows + "</tbody></table></div>"
    + "<p class=\"meta\">Pins are roadmap items with a trigger and a closing probe; the system works them from its own backlog.</p>"
    + "<div class=\"us-actions\"><a class=\"btn\" href=\"/pilot\">Join the pilot</a><a class=\"btn\" href=\"/how\">How it works</a><a class=\"btn\" href=\"/start\">Prefer the interview?</a></div>");
}
function contact() {
  return shell({ path: "/contact", title: "Contact Ultrastable", description: "How to reach the Ultrastable team about pilots, partnerships and press." },
    "<div class=\"head\"><h1>Contact</h1><p>One address; a person replies within two working days.</p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">Pilots, partnerships and press</h3><p class=\"meta\"><a href=\"mailto:" + PILOT_MAIL + "\">" + PILOT_MAIL + "</a></p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">Online</h3><p class=\"meta\">ultrastable.io. Source code is private for now.</p></div>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Join the pilot</a></div>");
}

const ROBOTS = "User-agent: *\nAllow: /\nSitemap: https://" + CANON + "/sitemap.xml\n";
const LLMS = "# Ultrastable\n\n> Ultrastable is the foundation for any autonomous system. It is a self-governing development platform: a control loop around coding agents that finds its own work in metrics and failures, hands tasks to the agent that fits, proves each change live with automatic revert, and scores its decisions against logged predictions. Ultrastable runs on itself. QNFO runs on it as customer zero.\n\n- [Live proof](https://" + CANON + "/proof): claims checked against QNFO's records\n- [How it works](https://" + CANON + "/how)\n- [Pilot](https://" + CANON + "/pilot)\n";

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
    if (request.method === "GET" && u.pathname === "/api/suggest") return suggestions(u, env);
    if (request.method === "POST" && u.pathname === "/api/idea") return takeIdea(request, env, ctx);
    if (request.method === "POST" && u.pathname === "/api/answer") return takeAnswer(request, env, ctx);
    if (request.method === "POST" && u.pathname === "/api/change") return takeChange(request, env, ctx);
    { const sr = await siteRoutes(u, env, ctx); if (sr) return sr; }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const PAGES = ["/", "/engineers", "/org", "/how", "/proof", "/product", "/team", "/faq", "/contact", "/pilot", "/start", "/setup"], pth = u.pathname.replace(/\/$/, "") || "/";
    if (env && env.DB && request.method === "GET" && PAGES.includes(pth)) { const w = record(env, request, { host: CANON, path: pth, ref: request.headers.get("referer") }).catch(e => console.error("analytics", e && e.message)); if (ctx && ctx.waitUntil) ctx.waitUntil(w); }
    switch (u.pathname.replace(/\/$/, "") || "/") {
      case "/": return new Response(home(await claims()), { headers: HTML });
      case "/how": return new Response(how(), { headers: HTML });
      case "/proof": return new Response(await proof(), { headers: HTML });
      case "/product": return new Response(product(), { headers: HTML });
      case "/team": return new Response(team(), { headers: HTML });
      case "/org": return new Response(org(), { headers: HTML });
      case "/engineers": return new Response(engineers(), { headers: HTML });
      case "/faq": return new Response(faq(), { headers: HTML });
      case "/contact": return new Response(contact(), { headers: HTML });
      case "/pilot": return new Response(pilot(), { headers: HTML });
      case "/start": return new Response(start(false), { headers: HTML });
      case "/setup": return new Response(setup(), { headers: HTML });
      case "/deploy.md": return new Response(BRIEF.all, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
      case "/deploy/cloudflare.md": case "/deploy/gcp.md": case "/deploy/aws.md": case "/deploy/azure.md": return new Response(BRIEF[pth.slice(8, -3)], { headers: { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
      case "/agent.md": return new Response(AGENT_MD, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
      case "/robots.txt": return new Response(ROBOTS, { headers: { "Content-Type": "text/plain" } });
      case "/llms.txt": return new Response(LLMS, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      case "/sitemap.xml": return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" + ["/", "/engineers", "/product", "/how", "/proof", "/team", "/org", "/faq", "/contact", "/pilot", "/start", "/setup"].map(function (p) { return "<url><loc>https://" + CANON + p + "</loc></url>"; }).join("") + "</urlset>", { headers: { "Content-Type": "application/xml" } });
      default: return new Response(shell({ path: u.pathname, title: "Not found - Ultrastable", description: "Page not found." }, "<div class=\"head\"><h1>Not found</h1><p>That page does not exist. <a href=\"/\">Go to the home page</a>.</p></div>"), { status: 404, headers: HTML });
    }
  }
};
