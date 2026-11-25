// ultrastable-site: the public presence of Ultrastable, the self-governing development platform (ULTRASTABLE-SITE-1, 2026-11-10).
// Canonical host ultrastable.io; ultrastable.app and ultrastable.net redirect to it (/pilot and /live). Live proof (/live) shows only
// Ultrastable's own records; /proof is a 301 to /live (PROOF-OWN-1). Positioning: docs/PRODUCT-ULTRASTABLE.md and product/boundary.json.
import { handleAnalytics, record } from "../seed/analytics/analytics.js";
import { routeChat } from "../seed/worker/src/airoute.js"; // AI-ROUTER-1: cache, dedupe, free-first, learned routing for every site model call
import { budgetEnv, SHARES, halted } from "../seed/worker/src/budget.js";  // SPEND-GOVERNOR-1: site model calls spend from the owner's budget
import USER_PATH from "./userpath.js";
import SH from "./stakeholders.js"; // STAKEHOLDERS-1
import BRIEF from "./platformbrief.js";
import IV from "./interview.js";
import { liveResponse, ignitionResponse } from "./live.js";
import { feedResponse, jsonFeedResponse } from "./feed.js"; // REACH-1, STICKY-1
import { demoResponse } from "./demo.js"; // DEMO-DASHBOARD-1
import { caseResponse } from "./casestudy.js"; // CASE-STUDY-1
import { examplesSection } from "./examples.js"; // EXAMPLE-SYSTEMS-1
import { pilotOffer } from "./pilotoffer.js"; // PILOT-OFFER-1
import { connectAgentPage } from "./connectagent.js";
import { agentic, withLinks, CONTENT_SIGNAL, TOOLS, LIVE_TOOLS, WRITE_TOOLS } from "./agentic.js";
import VERIFIED from "./claims-data.js";
import ULTRA from "./ultrastability-data.js";
import { verificationBody, verificationJson } from "./verification.js";
import { experimentFor, slotText, exposureName } from "./uiux.js"; // UIUX-1: A/B experiments on path steps
import SELF from "./self-data.js";
import { passkeys } from "./passkeys.js";
import { mydata } from "./mydata.js";
import { authzen } from "./authzen.js";
import { indexNow, keyFile, SITEMAP_PATHS, webSub, archiveEvidence, reachRows } from "./promote.js";
import { PRIVACY, ACCESSIBILITY, SECURITY_TXT } from "./legalpages.js";
import { negotiate, robots, WEBMCP_JS } from "./readiness.js";
import { register as registerDirectory, recheck as recheckDirectory, listing as directoryListing, CORE as DIR_CORE } from "./directory.js";  // DISCOVER-1  // AGENT-READY-2
import ROAD from "./roadmap-data.js";
import DEC from "./decisions-data.js";  // DECISIONS-1: generated from ops/decisions/*.jsonl
import { leftAloneRoutes } from "./leftalone.js";  // ATTENTION-1
import { yearFailRoutes } from "./yearfail.js";  // YEARFAIL-1
import { failMineRoutes } from "./failmine.js";  // FAILMINE-1
import { trendsRoutes } from "./temporal.js";  // TEMPORAL-1: how the system changes over time
import { yieldRoutes } from "./intentyield.js";  // INTENT-YIELD-1: owner directives kept per unit of attention
import { balanceRoutes } from "./balance.js";  // FLOW-BALANCE-1: issue inflow against closures and SLA
import { progressRoutes } from "./progress.js";  // PROGRESS-1: what every system shipped, daily, weekly and monthly
import { yearRoutes } from "./year.js";  // YEAR-SIM-1, SAY-DO-1: measured unattended horizon and say-do gaps
import { researchRoutes } from "./research.js";  // RESEARCH-1: own R&D and white papers, generated from the system's ledgers
import SPIN from "./spinoff-roadmap-data.js";  // SPINOFF-IDEAS-1: generated from the idea queue and the free-tier headroom
import ORGMAP from "./orgmap.js"; // ORGMAP-1: generated from brand/brand.json
import SG from "./suggest.js";
import DASH from "./dashboard-data.js";
import { controlPlane, opsPage, tenantDiscovery, authIntegration } from "./controlplane.js";
import { webhooksRoute, tickWebhooks } from "./webhooks.js"; // WEBHOOKS-1
import { siteFeed, siteBadge, insights as siteInsights, insightsBody, viewedRecently, upkeepRound, recordVersion, restore as restoreVersion, versions as siteVersions, historyBody } from "./upkeep.js"; // SITE-UPKEEP-1
import { connectionsRoute } from "./connections.js"; // CONNECTIONS-1
import { internalDeploy } from "./deployer.js";
import * as GRAD from "./graduate.js";  // LAUNCH-PATH-1
import { zoneCutover } from "./zonecutover.js"; // ZONE-CUTOVER-1: attaches domains the tick a moved zone turns active
var VERSION = "0.15.1";
const CANON = "ultrastable.io";
const PILOT_MAIL = "pilot@ultrastable.io";

const BASE = ":root{color-scheme:light dark;--bg:#f6f1e7;--sf:#fffdf8;--sf2:#efe8d9;--ink:#14120f;--ink2:#5b574f;--line:#ddd5c5;--ac:#b83800;--on:#fff;--soft:#fde6d9;--good:#0a7a3d;--bad:#b3261e}@media(prefers-color-scheme:dark){:root{--bg:#0b1a15;--sf:#12342a;--sf2:#0f2b22;--ink:#f6f1e7;--ink2:#c9d4cc;--line:#1f4a3c;--ac:#ff7f4d;--on:#0b1a15;--soft:#1b3d31;--good:#4cc38a;--bad:#ff8a80}}"
+ "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 'IBM Plex Sans',system-ui,-apple-system,Segoe UI,Roboto,sans-serif}a{color:var(--ac)}h1{font-family:Fraunces,Georgia,serif;font-size:28px;line-height:1.2;margin:0 0 8px}h2{font-size:20px;margin:28px 0 8px}h3{margin:0;font-size:17px}p{margin:0 0 12px}"
+ ".top{position:sticky;top:0;background:var(--sf);border-bottom:1px solid var(--line);z-index:5}.top-in{max-width:960px;margin:0 auto;padding:8px 16px;display:flex;align-items:center;gap:8px;min-height:60px}.brand{font-weight:700;font-size:18px;color:var(--ink);text-decoration:none;margin-right:auto}"
+ ".main{max-width:960px;margin:0 auto;padding:20px 16px 64px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;padding:10px 18px;border-radius:6px;border:1px solid var(--line);background:var(--sf);color:var(--ink);font:600 16px system-ui;text-decoration:none}.btn-primary{background:var(--ac);border-color:var(--ac);color:var(--on)}.btn-quiet{border-color:transparent;background:transparent;color:var(--ac)}"
+ ".skip-link{position:absolute;left:-9999px}.skip-link:focus{left:16px;top:8px;background:var(--sf);padding:8px}:focus-visible{outline:3px solid var(--ac);outline-offset:2px}.card{background:var(--sf);border:1px solid var(--line);border-radius:8px;padding:16px;margin:0 0 12px}.meta,small{color:var(--ink2);font-size:14px}.head p{color:var(--ink2)}"
+ "@media(max-width:640px){.hide-sm{display:none!important}h1{font-size:24px}}";
function atCommit() { const c = String(VERIFIED.commit || ""); return /^[0-9a-f]{7,40}$/.test(c) ? " at commit " + esc(c) : " on every merge"; }
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
  ".us-table th{font-size:14px;color:var(--ink2)}.us-wrap{overflow-x:auto;max-width:100%}.us-table td,.us-table th{overflow-wrap:anywhere;word-break:break-word;min-width:56px}@media(max-width:640px){.us-table td,.us-table th{padding:8px 6px;font-size:14px}}.us-us td{background:var(--soft);font-weight:600}",
  ".us-foot{border-top:1px solid var(--line);margin-top:32px;padding-top:16px;color:var(--ink2);font-size:14px}",
  ".us-case{display:block;text-decoration:none;color:inherit}.us-case:hover,.us-case:focus-visible{border-color:var(--accent,currentColor)}.us-tag{display:inline-block;font-size:14px;color:var(--ink2);border:1px solid var(--line);border-radius:999px;padding:2px 10px;margin-bottom:6px}.us-more{display:inline-block;margin-top:8px;font-weight:600;min-height:44px;line-height:44px}.us-note{border-left:4px solid var(--ac);background:var(--sf);padding:10px 14px;border-radius:6px}.crumbs{font-size:14px;color:var(--ink2);margin:8px 0}.us-stories li,.us-path li{margin:8px 0}.us-path a{display:inline-block;min-height:44px;line-height:44px}",
  ".us-pass{color:var(--good);font-weight:700}.us-fail{color:var(--bad);font-weight:700}",
  ".us-q{display:block;width:100%;min-height:44px;font:16px system-ui;padding:8px;margin:8px 0}"
].join("\n") + "\n" + IV.CSS;

function esc(s) { return dsEsc(s); }

function shell(opts, body) {
  const url = "https://" + CANON + opts.path;
  return "<!doctype html><html lang=\"en\"><head>" + dsHead(opts.title, opts.description, CSS)
    + "<link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\"><link rel=\"search\" type=\"application/opensearchdescription+xml\" title=\"Ultrastable\" href=\"/opensearch.xml\"><meta property=\"og:image\" content=\"https://" + CANON + "/social-card.png\"><meta property=\"og:image:width\" content=\"640\"><meta property=\"og:image:height\" content=\"320\"><meta property=\"og:image:alt\" content=\"Coding agents write code. Ultrastable runs the system.\"><meta property=\"og:site_name\" content=\"Ultrastable\"><meta name=\"twitter:card\" content=\"summary_large_image\"><meta name=\"twitter:title\" content=\"" + esc(opts.title) + "\"><meta name=\"twitter:description\" content=\"" + esc(opts.description) + "\"><meta name=\"twitter:image\" content=\"https://" + CANON + "/social-card.png\"><meta name=\"theme-color\" content=\"#12342A\"><link rel=\"apple-touch-icon\" href=\"/apple-touch-icon.png\"><link rel=\"canonical\" href=\"" + url + "\"><meta property=\"og:title\" content=\"" + esc(opts.title) + "\"><meta property=\"og:description\" content=\"" + esc(opts.description) + "\"><meta property=\"og:type\" content=\"website\"><meta property=\"og:url\" content=\"" + url + "\">"
    + "</head><body><a class=\"skip-link\" href=\"#main\">Skip to content</a>"
    + "<header class=\"top\"><div class=\"top-in\"><a class=\"brand\" href=\"/\"><img src=\"/favicon.svg\" alt=\"\" width=\"28\" height=\"28\" style=\"vertical-align:middle;margin-right:8px\">ultrastable</a><a class=\"btn btn-quiet hide-sm\" href=\"/for\">Find your path</a><a class=\"btn btn-quiet\" href=\"/showcase\">Test cases</a><a class=\"btn btn-quiet hide-sm\" href=\"/product\">Product</a><a class=\"btn btn-quiet hide-sm\" href=\"/how\">How it works</a><a class=\"btn btn-quiet\" href=\"/research\">Research</a><a class=\"btn btn-quiet\" href=\"/live\">Live proof</a><a class=\"btn btn-quiet\" href=\"/progress\">What's new</a><a class=\"btn btn-quiet hide-sm\" href=\"/engineers\">Engineers</a><a class=\"btn btn-quiet hide-sm\" href=\"/contact\">Contact</a></div></header>"
    + "<main class=\"main\" id=\"main\">" + body
    + "<div class=\"us-foot\">Ultrastable is an early-stage product. Figures on this site come from a live system's own records. <a href=\"/live\">See the checks</a> · <a href=\"/progress\">What shipped</a> · <a href=\"/research\">White papers</a> · <a href=\"/research.atom\">Papers feed</a> · <a href=\"/product\">Product</a> · <a href=\"/team\">Team</a> · <a href=\"/faq\">FAQ</a> · <a href=\"/privacy\">Privacy</a> · <a href=\"/accessibility\">Accessibility</a> · <a href=\"/contact\">Contact</a> · <a href=\"/llms.txt\">llms.txt</a></div>"
    + "<div class=\"us-foot\" id=\"family\">The Ultrastable family: <a href=\"https://" + CANON + "/\">" + esc(SH.domains.io.host) + "</a> (platform and product) · <a href=\"/showcase/practical-solutions\">" + esc(SH.domains.org.host) + "</a> (public-benefit demos) · <a href=\"/family.json\">family.json</a></div>"
    + "<div class=\"us-foot\" id=\"credit\">Directed by <a href=\"https://rwnq8.github.io/ultrastable/\">Rowan Brad Quni-Gudzinas</a>, founder and director of Ultrastable. <a href=\"https://rwnq8.github.io\">Website</a> · <a href=\"https://github.com/rwnq8\">GitHub</a> · <a href=\"https://www.linkedin.com/in/rowan-quni\">LinkedIn</a></div>"
    + "<script type=\"application/ld+json\">{\"@context\":\"https://schema.org\",\"@type\":\"WebSite\",\"name\":\"Ultrastable\",\"url\":\"https://ultrastable.io\",\"creator\":{\"@type\":\"Person\",\"name\":\"Rowan Brad Quni-Gudzinas\",\"jobTitle\":\"Founder and Director, Ultrastable\",\"url\":\"https://rwnq8.github.io\",\"sameAs\":[\"https://orcid.org/0009-0002-4317-5604\",\"https://github.com/rwnq8\",\"https://www.linkedin.com/in/rowan-quni\"]}}</script></main><script src=\"/webmcp.js\" defer></script></body></html>";
}

function statusLine() {
  // Own records only (PROOF-OWN-1): the count comes from Ultrastable's verified-claims register, never from another system.
  const t = VERIFIED.summary;
  return t.pass + " of " + t.total + " claims verified against code" + atCommit() + ".";
}

function home(ux) {
  return shell({ path: "/", title: "Ultrastable: the foundation for any autonomous system", description: "Ultrastable is the foundation for any autonomous system. Vibe coding writes the code you ask for. Ultrastable decides what to build next, ships it, proves it live and keeps score of how often it was right." },
    "<section class=\"us-hero\"><h1>Start with a bare idea. We keep improving it.</h1><p class=\"us-lede\">Vibe coding stops at a thin first draft and a coding agent waits to be told what to do. Behind the scenes, Ultrastable's portfolio, program and product managers measure what you run, decide what to improve next and keep shipping it, on a back end you budget for. Ultrastable is the foundation for any autonomous system.</p>"
    + IV.askBar("Tell me what is on your mind…")
    + "<div class=\"us-actions\"><a class=\"btn\" href=\"/setup\">" + esc(slotText("home.setup_label", "primary_label", "Set up my own", ux)) + "</a><a class=\"btn\" href=\"/live\">See the live proof</a><a class=\"btn btn-quiet\" href=\"/research\">Read the white papers</a></div>"
    + "<div class=\"us-status\" role=\"status\">" + statusLine() + "</div></section>"
    + "<div class=\"us-lane\"><h2>Already comfortable with code?</h2><p class=\"us-tagline\">A system is autonomous if it has self-referential loops and the ability to close them. Coding agents write code. Ultrastable runs the system. Ultrastable runs on itself.</p><p class=\"us-lede\">It finds its own work in your metrics and failures, hands each task to the coding agent that fits, proves every change live with an automatic revert, and keeps score of how often its decisions were right.</p><p>You do not have to answer questions. The loops, virtual managers, agents and the share of work kept for improvements are all there to use, with an honest list of what is live, in testing, and not built yet.</p><div class=\"us-actions\"><a class=\"btn\" href=\"/engineers\">Go straight to the engine</a></div></div>"
    + examplesSection()
    + "<h2>Who are you?</h2><div class=\"us-grid c3\">" + SH.audiences.map(audienceCard).join("") + "</div>"
    + "<h2>Test cases</h2><div class=\"us-grid c2\">" + SH.showcases.filter(function (c) { return c.status !== "sunsetting"; }).map(caseCard).join("") + "</div><p><a href=\"/showcase\">All test cases, including the earlier testbed</a></p>"
    + directoryBlock()
    + "<h2>What it is not for</h2><div class=\"us-grid c2\">"
    + card("Not for things you build once and forget", "An invitation, a packing list or a weekend page does not need managers, probes or a paid back end. Use a site builder.")
    + card("Not a substitute for a goal", "It needs setup and commitment: a named objective, a budget and a short list of steps a person always decides. From a bare skeleton it works out the next improvement; it does not invent your purpose.")
    + "</div>"
    + "<h2>What is different</h2><div class=\"us-grid c3\">"
    + card("It chooses the work", "Metrics breach, a trigger files an issue, a coding agent opens the pull request. A person sets direction. Nobody has to review each change; checks do that.")
    + card("It proves every change", "Each deploy declares probes. A probe that passed before and fails after reverts the push on its own.")
    + card("It keeps score", "Every decision logs a prediction first. The outcome is scored later, so you can see how often the system was right.")
    + "</div>"
    + "<h2>It questions what it does not know</h2><p>Improving only what is known makes the solution space smaller each time. So the managers also audit their own ignorance: every loop is asked inverted questions (what if the opposite were true, what would a world look like where this was false, what are we pretending not to know) drawn from the Universal Ignorance Audit, pre-mortems and red teaming. Each answer, including 'we cannot know', is recorded, and a gap found becomes a new objective. Coverage and findings are on the <a href=\"/live\">live page</a>.</p>"
    + "<h2>Works with the agents you already use</h2><p>Ultrastable is the layer around coding agents, not another one. Open models on its own code loop, GitHub Copilot and Claude Code sessions all take work through one claim ledger, so two agents never work the same item.</p>"
    + "<h2>Where it fits</h2>" + marketTable()
    + "<h2>Proven in production</h2><p>It has run a live system since August 2026, with merged pull requests, failure detectors and a scored prediction history that you can check on the <a href=\"/live\">live proof page</a>. It is one installation, and the <a href=\"/how#gaps\">honest gaps</a> are listed on this site.</p>"
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

function orgSection() {
  const rows = ORGMAP.repos.map(function (r) { return "<tr><td><a href=\"https://github.com/" + ORGMAP.org + "/" + esc(r.name) + "\">" + esc(r.name) + "</a></td><td>" + esc(r.visibility) + "</td><td>" + esc(r.holds) + "</td></tr>"; }).join("");
  const gone = ORGMAP.retired.map(function (r) { return "<code>" + esc(r.name) + "</code> is now in <code>" + esc(r.moved_to) + "</code>"; }).join("; ");
  return "<h2 id=\"organized\">How Ultrastable is organized</h2><p>" + esc(ORGMAP.rule) + "</p>"
    + "<div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Repository</th><th>Visibility</th><th>What it holds</th></tr></thead><tbody>" + rows + "</tbody></table></div>"
    + "<p class=\"meta\">Retired, kept only so old links work: " + gone + ".</p>";
}

function how() {
  return shell({ path: "/how", title: "How Ultrastable works", description: "The loop, the ledgers, and the honest gaps of the self-governing development platform." },
    "<div class=\"head\"><h1>How it works</h1><p>One loop, " + VERIFIED.ledgers.length + " ledgers (" + VERIFIED.ledgers.map(function (l) { return esc(l.name); }).join(", ") + "), and what it does not do yet. <a href=\"/claims\">Every claim here is probed</a>.</p></div>"
    + "<div class=\"us-grid c2\">"
    + card("1. Find work", "Metric triggers and failure detectors file issues that carry a code task and a closing probe.")
    + card("2. Hand it to an agent", "A work-claim ledger gives each file to one agent at a time: an open-model code loop, Copilot or Claude Code.")
    + card("3. Prove it live", "Probes declared per service run after each deploy. A regression reverts the push and files its own issue.")
    + card("4. Score the decision", "Each decision logs a prediction before it acts; the outcome is scored later and feeds a trust score per kind of action.")
    + "</div>"
    + "<h2>The platform and the product are one loop</h2><p>What Ultrastable develops (code, practical solutions) and how it develops itself run on the same process, so the two improve each other. See the <a href=\"/showcase\">test cases</a>: the earlier testbed and Practical Solutions.</p>"
    + orgSection()
    + ultrastability()
    + "<h2 id=\"gaps\">Honest gaps</h2>" + "<ul>" + ROAD.gaps.map(function (g) { return "<li>" + esc(g.text) + " <a href=\"/roadmap#" + esc(g.issue) + "\">" + esc(g.issue) + "</a></li>"; }).join("") + "</ul>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Join the pilot</a></div>");
}

function bound(v) { return v.min !== null && v.max !== null ? (v.min === v.max ? "exactly " + v.min : v.min + " to " + v.max) : v.min !== null ? v.min + " or more" : v.max !== null ? "at most " + v.max : "its own declared target"; }

function ultrastability() {
  const P = ULTRA.scopes.platform, T = ULTRA.scopes.tenant;
  const now = ULTRA.now || {}, R = ULTRA.readiness;
  const reads = function (v) { const n = now[v.id]; return n ? (n.value === null ? "unmeasured" : esc(String(n.value)) + (n.ok ? " (in bounds)" : " (out of bounds)")) : "no reading yet"; };
  const row = function (v) { return "<tr><td>" + esc(v.name) + "</td><td>" + esc(bound(v)) + " " + esc(v.unit) + "</td><td>" + reads(v) + "</td><td>" + esc(v.steps.join("; ")) + "</td></tr>"; };
  return "<h2 id=\"why-ultrastable\">Why ultrastable</h2>"
    + "<p>A system is ultrastable, in W. Ross Ashby's sense, when two loops keep its essential variables inside bounds: a fast loop that corrects disturbance, and a slow loop that changes the system itself when the fast loop cannot.</p>"
    + "<p>The fast loop is the probes, the cost check, the claims check and the executor. The slow loop reads the same variables every tick, and when one has been out of bounds for two ticks in a row it takes one discrete step on that variable's ladder, keeps the step only if the variable comes back, and otherwise undoes it and takes the next.</p>"
    + (R ? "<p id=\"one-year\"><strong>One-year readiness: " + esc(String(R.score)) + " of 100.</strong> It multiplies three parts: the simulated unattended horizon against a year (" + esc(String(R.horizon)) + "), the share of essential variables in bounds at the last tick (" + esc(String(R.bounds)) + "), and how often the slow loop's own changes worked (" + esc(String(R.learning)) + "). A person stepping in to redirect the system counts against it.</p>" : "")
    + "<p>The essential variables of " + esc(P.what) + " (" + esc(P.status) + "):</p>"
    + "<div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Variable</th><th>Bounds</th><th>Last reading</th><th>Second-order steps, in order</th></tr></thead><tbody>" + P.variables.map(row).join("") + "</tbody></table></div>"
    + "<p>" + esc(T.what) + " (" + esc(T.status) + "): " + T.variables.map(function (v) { return esc(v.name.toLowerCase()); }).join(", ") + ".</p>"
    + "<p>The system describes itself in code: what it is, its regulators, its variables and bounds, its clocks and its boundary are served as JSON at <a href=\"/self\">/self</a>.</p>"
    + (ULTRA.self_changes && ULTRA.self_changes.length ? "<h3 id=\"self-changes\">Changes the slow loop made to itself</h3><div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>When</th><th>Variable</th><th>Change</th><th>Before</th><th>After</th><th>Verdict</th></tr></thead><tbody>"
      + ULTRA.self_changes.map(function (c) { return "<tr><td>" + esc(c.at) + "</td><td>" + esc(c.var) + "</td><td>" + esc(c.what) + "</td><td>" + esc(String(c.before)) + "</td><td>" + esc(String(c.after)) + "</td><td>" + esc(c.verdict) + "</td></tr>"; }).join("") + "</tbody></table></div>" : "")
    + "<p class=\"meta\">Every reading above is the last row for that variable in <a href=\"https://github.com/ultrastable/ultrastable/blob/main/ops/ultrastability.jsonl\">ops/ultrastability.jsonl</a>, computed by <a href=\"https://github.com/ultrastable/ultrastable/blob/main/foundation/ultrastability.py\">foundation/ultrastability.py</a>. Nothing on this page is typed by hand.</p>"
    + "<p class=\"meta\">After " + esc(ULTRA.credit) + ". Every reading, step and verdict is a row in the ultrastability ledger and a provenance row.</p>";
}

function claimsPage() {
  // REDTEAM-1: a stranger read internal agent rules as public promises. Statements on public pages come first; operating rules are their own section.
  const internal = function (c) { return /^(agents|doctrine|docs|seed\/agents|seed\/doctrine|\.github)\//.test(String(c.surface || "")); };
  const row = function (c) { return "<tr><td class=\"" + (c.pass ? "us-pass" : "us-fail") + "\">" + (c.pass ? "Verified" : "Drift") + "</td><td>" + esc(c.claim) + "<br><small>" + esc(c.surface) + " · " + esc(c.how) + (c.detail ? " · " + esc(c.detail) : "") + "</small></td></tr>"; };
  const table = function (list) { return "<div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Status</th><th>Claim, surface and probe</th></tr></thead><tbody>" + list.map(row).join("") + "</tbody></table></div>"; };
  const pub = VERIFIED.claims.filter(function (c) { return !internal(c); }), ops = VERIFIED.claims.filter(internal);
  return shell({ path: "/claims", title: "Verified claims: Ultrastable words matched to code", description: "Every statement on the Ultrastable surfaces is bound to a probe in the code, checked on every change and daily against the live site." },
    "<div class=\"head\"><h1>Verified claims</h1><p id=\"st\" role=\"status\">" + VERIFIED.summary.pass + " of " + VERIFIED.summary.total + " claims verified against code" + atCommit() + ". Words must match code; a claim that stops matching fails the build and files its own fix item.</p></div>"
    + "<h2>What the public pages say (" + pub.length + ")</h2>" + table(pub)
    + "<h2>Internal operating rules the agents follow (" + ops.length + ")</h2><p class=\"meta\">These are instructions to the system's own agents, not promises to visitors. They are checked the same way.</p>" + table(ops)
    + "<p class=\"meta\">Machine form: <a href=\"/api/claims\">/api/claims</a>. Registry: doctrine/claims.json; checker: python3 -m foundation claims --check. Generated copy (counts, tool lists) is rewritten from code, so it cannot drift; the reverse direction (shipped behaviour that no surface describes) is checked too.</p>");
}

function pilot() {
  const P = DASH.pilot, g = P.program;
  const href = "mailto:" + PILOT_MAIL + "?subject=" + encodeURIComponent("Ultrastable pilot application") + "&body=" + encodeURIComponent(g.apply_fields.map(function (f) { return f + ":\n"; }).join(""));
  const list = function (a) { return "<ul>" + a.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>"; };
  return shell({ path: "/pilot", title: "Apply for an Ultrastable pilot", description: g.pitch },
    "<div class=\"head\"><h1>" + esc(g.title) + "</h1><p>" + esc(g.pitch) + "</p><p class=\"meta\">New here? <a href=\"/demo\">See the system running right now</a>.</p></div>"
    + (DASH.pilot_offer ? pilotOffer(DASH.pilot_offer) : "")
    + "<div class=\"card\"><h3 class=\"card-title\">What we look for</h3>" + list(g.selection) + "</div>"
    + "<div class=\"card\"><h3 class=\"card-title\">What you get</h3><p class=\"meta\">" + esc(g.you_get) + " In return: " + esc(g.we_get) + ".</p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">What to tell us</h3>" + list(g.apply_fields) + "<p class=\"meta\">Price: " + esc(g.price) + ".</p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">Where it runs</h3><p class=\"meta\">" + esc(P.why) + "</p></div>"
    + "<h2 id=\"apply\">Apply</h2><form id=\"pf\" class=\"card\" method=\"post\" action=\"/api/pilot\">" + [["system", g.apply_fields[0]], ["keeps_doing", g.apply_fields[1]], ["measure", g.apply_fields[2]], ["budget", g.apply_fields[3]], ["runs_on", g.apply_fields[4]], ["contact", "How we reach you (email)"]].map(function (x) { return "<p><label>" + esc(x[1]) + "<br><textarea name=\"" + x[0] + "\" rows=\"2\" maxlength=\"1500\" style=\"width:100%\"" + (x[0] === "contact" ? "" : " required") + "></textarea></label></p>"; }).join("") + "<p><button class=\"btn btn-primary\" type=\"submit\">Send application</button></p><p id=\"pr\" class=\"meta\" role=\"status\"></p></form>"
    + "<script>document.getElementById('pf').addEventListener('submit',function(e){e.preventDefault();var f=e.target;fetch('/api/pilot',{method:'POST',body:new FormData(f),headers:{accept:'application/json'}}).then(function(r){return r.json()}).then(function(j){document.getElementById('pr').textContent=j.message||j.error||'Something went wrong.'}).catch(function(){document.getElementById('pr').textContent='Could not send; use the email link.'})})</script>"
    + "<div class=\"us-actions\"><a class=\"btn\" href=\"" + href + "\">Or apply by email</a><a class=\"btn\" href=\"/dashboard\">See the dashboard</a></div>"
    + "<p class=\"meta\">Replies come from a person within two working days. The form above is the interview: it scores your answers against the four system-test questions.</p>");
}

function lis(a) { return "<ul>" + a.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>"; }
function crumbs(items) { return "<nav class=\"crumbs\" aria-label=\"Breadcrumb\">" + items.map(function (i, k) { return k < items.length - 1 ? "<a href=\"" + i[1] + "\">" + esc(i[0]) + "</a> / " : "<span aria-current=\"page\">" + esc(i[0]) + "</span>"; }).join("") + "</nav>"; }
function domLabel(k) { const x = SH.domains[k]; return x ? x.host : ""; }
// DISCOVER-1: every system built on Ultrastable, generated from the tenant registry; each links the others through /directory.
function directoryBlock() { return "<h2>Every system running on Ultrastable</h2><ul class=\"us-dir\">" + DIR_CORE.map(function (c) { return "<li><a href=\"" + esc(c.url) + "\">" + esc(c.name) + "</a>" + (c.repo ? " · <a href=\"" + esc(c.repo) + "\">source</a>" : "") + "</li>"; }).join("") + "</ul><p><a href=\"/directory\">The full directory</a>, including systems other people run on Ultrastable in their own accounts.</p>"; }
function directoryPage(d) {
  const row = function (c) { return "<li><a href=\"" + esc(c.url) + "\">" + esc(c.name) + "</a>" + (c.repo ? " · <a href=\"" + esc(c.repo) + "\">source</a>" : "") + (c.summary ? "<br><small>" + esc(c.summary) + "</small>" : "") + "</li>"; };
  return shell({ path: "/directory", title: "Directory: every system built on Ultrastable", description: "Every public system running on Ultrastable, here and in other people's accounts, with links to each and its source." },
    crumbs([["Home", "/"], ["Directory", "/directory"]])
    + "<h1>Every system built on Ultrastable</h1><p>Each system runs its own loops and links back here. Systems are public unless their owner opts out.</p>"
    + "<h2>Running in this account</h2><ul>" + d.core.map(row).join("") + "</ul>"
    + "<h2>Running elsewhere</h2>" + (d.external.length ? "<ul>" + d.external.map(row).join("") + "</ul>" : "<p>None listed yet.</p>")
    + "<h2>Get listed</h2><p>A system started from the Ultrastable seed lists itself: it serves <code>/.well-known/ultrastable.json</code> and checks in once a day. This page reads that file before listing a site and rechecks it daily. Turn it off with <code>ULTRASTABLE_DIRECTORY=off</code>; a site that says noindex is never listed.</p>"
    + "<script type=\"application/ld+json\">" + JSON.stringify({ "@context": "https://schema.org", "@type": "ItemList", name: "Systems built on Ultrastable", itemListElement: d.core.concat(d.external).map(function (c, i) { return { "@type": "ListItem", position: i + 1, item: { "@type": "SoftwareApplication", name: c.name, url: c.url, applicationCategory: "WebApplication", license: c.license || undefined } }; }) }).replace(/</g, "\\u003c") + "</script>");
}
function caseCard(c) { return "<a class=\"card us-case\" href=\"/showcase/" + esc(c.id) + "\"><span class=\"us-tag\">" + esc(c.tag) + "</span> <span class=\"us-tag\">" + esc(domLabel(c.domain)) + "</span><h3 class=\"card-title\">" + esc(c.name) + "</h3><p class=\"meta\">" + esc(c.summary) + "</p><span class=\"us-more\">Read the case</span></a>"; }

function showcase() {
  return shell({ path: "/showcase", title: "Test cases: " + SH.showcases.map(function (c) { return c.name; }).join(", "), description: "Ultrastable develops its own platform and the products on it with one closed loop. QNFO was the testbed; " + SH.showcases.filter(function (c) { return c.status === "live"; }).map(function (c) { return c.name; }).join(" and ") + " run on it now." },
    crumbs([["Home", "/"], ["Test cases", "/showcase"]])
    + "<div class=\"head\"><h1>Test cases</h1><p>Ultrastable is an autonomous development platform. What it develops (code, practical solutions) and how it develops itself are one loop.</p></div>"
    + "<div class=\"us-grid c2\">" + SH.showcases.map(caseCard).join("") + "</div>"
    + "<h2>One loop, not two</h2><p>The loop that finds a failing probe in a product, files the work, hands it to an agent, proves the change live and scores its own prediction is the same loop that improves Ultrastable. Each fix to the loop improves every system, and each system's problems improve the loop. It keeps closing its own loops, including the loop that watches the loops (a strange loop, in Hofstadter's sense).</p>"
    + "<h2>How we test it</h2>" + lis(["Every claim on this site is a query against a live record: see Live proof.", "Each decision logs a prediction first (metric, comparison, number, hours) and is scored later.", "Changes are proven live after deploy and revert on regression.", "The same checks run on the platform and on each product, so a pass means the same thing everywhere."])
    + "<p class=\"meta\">Early stage. Estimates are labelled as estimates. The code is source-available under the Ultrastable License: free for non-commercial use, a commercial licence for commercial use. <a href=\"/how#gaps\">Read the gaps.</a></p>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/for\">Find your path</a><a class=\"btn\" href=\"/how\">How it works</a></div>");
}

function showcaseCase(id) {
  const c = SH.showcases.find(function (x) { return x.id === id; });
  if (!c) return null;
  return shell({ path: "/showcase/" + c.id, title: c.name + ": test case", description: c.summary },
    crumbs([["Home", "/"], ["Test cases", "/showcase"], [c.name, "/showcase/" + c.id]])
    + "<div class=\"head\"><span class=\"us-tag\">" + esc(c.tag) + "</span><h1>" + esc(c.name) + "</h1><p>" + esc(c.summary) + "</p></div>"
    + (c.separate ? "<p class=\"us-note\" role=\"note\">" + esc(c.separate) + "</p>" : "")
    + "<h2>The problem</h2><p>" + esc(c.problem) + "</p><h2>What the loop did</h2><p>" + esc(c.loop) + "</p><h2>Results</h2>" + lis(c.results)
    + "<h2>What we learned</h2><p>" + esc(c.learned) + "</p>"
    + "<div class=\"us-actions\">" + (c.home ? "<a class=\"btn btn-primary\" href=\"" + esc(c.home) + "\" rel=\"noopener\">" + esc(c.homeLabel || "Open it") + "</a>" : "") + c.links.map(function (l, k) { return "<a class=\"btn" + (k === 0 && !c.home ? " btn-primary" : "") + "\" href=\"" + esc(l.href) + "\">" + esc(l.label) + "</a>"; }).join("") + "</div>"
    + "<p class=\"meta\">Part of the Ultrastable family: " + (c.domain === "org" ? "a public-benefit demo, homed on " + esc(domLabel("org")) + " and described here on " + esc(domLabel("io")) + "." : "a case study on " + esc(domLabel("io")) + ".") + " <a href=\"/for\">Find your path</a></p>");
}

function audienceCard(a) { return "<a class=\"card us-case\" href=\"/for/" + esc(a.id) + "\"><h3 class=\"card-title\">" + esc(a.name) + "</h3><p class=\"meta\">" + esc(a.promise) + "</p><span class=\"us-more\">" + esc(a.nav) + "</span></a>"; }

function forIndex() {
  return shell({ path: "/for", title: "Find your path: who Ultrastable is for", description: "Pick who you are and see what Ultrastable offers you, with the steps to take." },
    crumbs([["Home", "/"], ["Find your path", "/for"]])
    + "<div class=\"head\"><h1>Who are you?</h1><p>Pick the closest match. Each page shows what you get, what you need to do and how to check it.</p></div>"
    + "<div class=\"us-grid c2\">" + SH.audiences.map(audienceCard).join("") + "</div>"
    + "<h2>Two homes, one system</h2><p>Like WordPress.com and WordPress.org, Ultrastable has two homes that suit different audiences and share one design and one way of working.</p><div class=\"us-grid c2\">"
    + Object.keys(SH.domains).map(function (k) { const x = SH.domains[k]; return card(x.host + ": " + x.name, x.role); }).join("") + "</div>");
}

function forAudience(id) {
  const a = SH.audiences.find(function (x) { return x.id === id; });
  if (!a) return null;
  return shell({ path: "/for/" + a.id, title: a.name + ": Ultrastable", description: a.promise },
    crumbs([["Home", "/"], ["Find your path", "/for"], [a.name, "/for/" + a.id]])
    + "<div class=\"head\"><span class=\"us-tag\">" + esc(domLabel(a.domain)) + "</span><h1>" + esc(a.name) + "</h1><p>" + esc(a.promise) + "</p></div>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"" + esc(a.cta.href) + "\">" + esc(a.cta.label) + "</a></div>"
    + "<h2>What you probably need</h2><p>" + esc(a.needs) + "</p>"
    + "<h2>What you can do here</h2><ul class=\"us-stories\">" + a.stories.map(function (t) { return "<li>As " + esc(t.as) + ", I want " + esc(t.want) + ", so " + esc(t.so) + ".</li>"; }).join("") + "</ul>"
    + "<h2>Your path</h2><ol class=\"us-path\">" + a.path.map(function (st) { return "<li><a href=\"" + esc(st.href) + "\">" + esc(st.label) + "</a></li>"; }).join("") + "</ol>"
    + "<h2>Other paths</h2><p>" + SH.audiences.filter(function (x) { return x.id !== a.id; }).map(function (x) { return "<a href=\"/for/" + esc(x.id) + "\">" + esc(x.name) + "</a>"; }).join(" · ") + "</p>");
}

function product() {
  return shell({ path: "/product", title: "Ultrastable product: a control loop around coding agents", description: "What Ultrastable is, who it is for, what a pilot includes and what is not built yet." },
    "<div class=\"head\"><h1>The product</h1><p>A control loop that sits around the coding agents a team already uses.</p></div>"
    + "<h2>What it does</h2><div class=\"us-grid c3\">"
    + card("Chooses the work", "Reads your metrics and failures, files the issues, and orders them so the most valuable work goes first.")
    + card("Hands it to an agent", "Gives each task to one coding agent at a time, so two agents never work the same item.")
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
    + "<div class=\"card\"><h3 class=\"card-title\">Founder</h3><p class=\"meta\">Sets direction and approves the few steps that need a person: signing and payments. Everything else is done, verified and reported by the staff.</p></div>"
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
  return shell({ path: "/org", title: "Ultrastable organization", description: "How the Ultrastable organization is laid out: a few repositories, each with one purpose." },
    "<div class=\"head\"><h1>Organization</h1><p>A few repositories, each with one purpose. Ultrastable runs on itself, so this layout is itself checked by code.</p></div>"
    + "<div class=\"us-grid c2\">"
    + card("System of record", "Roadmap, doctrine, agents, operations and the self-hosting proof.")
    + card("Code", "The portable core, platform adapters and the bootstrapper that turns an idea file into a running organization.")
    + card("Specifications", "The numbered specifications, product documentation and the Ultrastable License: free for non-commercial use, a commercial license with revenue share for commercial use.")
    + card("Bootstrapper", "One idea file in, a running organization of virtual managers and staff out.")
    + card("Profile", "The public face of the organization on GitHub.")
    + "</div><p class=\"meta\">The repositories are open and the Ultrastable License governs use. Superseded early splits are archived, never deleted.</p>");
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
const BUILDERS = ["@cf/qwen/qwen2.5-coder-32b-instruct", "@cf/meta/llama-3.3-70b-instruct-fp8-fast"], ASKERS = ["@cf/meta/llama-3.3-70b-instruct-fp8-fast", "@cf/openai/gpt-oss-20b", "@cf/mistralai/mistral-small-3.1-24b-instruct"], SYS = [
  "You are a senior product designer and front-end engineer. Build ONE complete self-contained HTML file (inline CSS and JS, no external libraries or fonts) that is a small but genuinely working product for the brief, not a mockup.",
  "SCOPE: a single page cannot run server jobs or act on its own. Build the real, useful part that works in the browser today (the person operates it), make every control do something real, and never fake the rest. Put one calm line near the bottom saying what needs the full Ultrastable build (for example, running on its own on a schedule).",
  "WORKING: every button, form and link must have a handler that visibly changes the screen (a list grows, a status updates, a draft is saved and shown). No dead buttons, no empty grey bars or boxes: if an area has no data yet, show a friendly empty state with an example. Pre-fill realistic sample content for the person's topic so the first screen already looks alive. Persist data in localStorage inside try/catch with an in-memory fallback. SHARED DATA: when visitors add things other visitors should see (sign-ups, messages, votes, a guest list), use the preloaded global `US` (do not define it): `await US.list('signups')` resolves to an array of {id, at, data} newest first, `await US.add('signups', {name, email})` stores one record (data is a small JSON object) and resolves to the saved record; render the list from US.list on load and after each add, and fall back to localStorage only if a call throws.",
  "DESIGN: warm and modern, not default-browser or Bootstrap-blue. Use `*{box-sizing:border-box}`, a system font stack, a 4px spacing scale, a max content width near 720px centred, 16px minimum text, line-height 1.5, one accent colour (a deep warm orange or teal) on a soft off-white background, cards with 16px radius and a faint shadow, buttons 48px tall with hover, focus-visible and disabled states, inputs and textareas width:100% with the same radius. Nothing may overflow its card. Mobile first, works at 360px wide. Include <meta name=viewport>, a <title>, a clear heading naming the thing, and one-sentence helper text.",
  "OUTPUT: only the HTML file, starting with <!doctype html>. No explanation, no markdown."
].join(" ");
const newId = () => crypto.randomUUID().replace(/-/g, "").slice(0, 10);
const okId = (x) => /^[a-f0-9]{10}$/.test(x || "");
const DAY_MS_REACH = 20 * 3600e3; // ATTENTION-1
const jget = async (env, k) => { const v = await env.ASSETS.get(k); try { return v ? JSON.parse(v) : null; } catch (e) { return null; } };
const jput = (env, k, v) => env.ASSETS.put(k, JSON.stringify(v));
const FALLBACK_QS = [
  { q: "Should visitors be able to add or save their own information?", cue: "For example a sign-up list, notes or favourites." },
  { q: "Will most people open this on a phone?", cue: "We will make the layout fit small screens first." }];
// BUILD-2: each site gets a shared database. D1 table site_data (keyed by site id) in the org database (binding DB), reached by the page through a
// same-origin /s/<id>/api and served on <id>.ultrastable.io (wildcard route). The table is created on first use so a missing migration cannot break a site.
// Closing probe: two browsers GET /s/<id>/api?coll=signups and see the same list (site/site.test.mjs).
const SITEDB_MAX_ROWS = 500, SITEDB_MAX_BYTES = 2000, SUBHOST = /^([a-f0-9]{10})\.ultrastable\.io$/;
let siteTable = null;
const ensureSiteTable = (env) => siteTable || (siteTable = env.DB.batch([env.DB.prepare("CREATE TABLE IF NOT EXISTS site_data (id INTEGER PRIMARY KEY AUTOINCREMENT, site TEXT NOT NULL, coll TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL)"), env.DB.prepare("CREATE INDEX IF NOT EXISTS site_data_site ON site_data (site, coll, id)")]).catch(e => { siteTable = null; throw e; }));
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const apiJson = (o, status) => new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, CORS) });
const SITEDB_POSTS_PER_MIN = 20;  // BUILD-2b
async function siteApi(request, env, id) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (!env || !env.DB || !env.ASSETS) return apiJson({ error: "the site database is not connected", code: "no_database" }, 503);
  if (!(await env.ASSETS.get("state:" + id))) return apiJson({ error: "site not found", code: "no_site" }, 404);
  const u = new URL(request.url), body = request.method === "POST" ? await request.json().catch(() => null) : null;
  const c = String((request.method === "POST" && body && body.coll) || u.searchParams.get("coll") || "").toLowerCase();
  if (!/^[a-z0-9_-]{1,40}$/.test(c)) return apiJson({ error: "coll must be 1-40 letters, digits, - or _", code: "bad_collection" }, 400);
  await ensureSiteTable(env);
  if (request.method === "GET") {
    const r = await env.DB.prepare("SELECT id, at, data FROM site_data WHERE site = ?1 AND coll = ?2 ORDER BY id DESC LIMIT 200").bind(id, c).all();
    return apiJson({ site: id, coll: c, items: (r.results || []).map(x => { let d = null; try { d = JSON.parse(x.data); } catch (e) { d = null; } return { id: x.id, at: x.at, data: d }; }) });
  }
  if (request.method !== "POST") return apiJson({ error: "method not allowed", code: "method" }, 405);
  { // BUILD-2b: one client cannot fill a site. Per client address and site, SITEDB_POSTS_PER_MIN writes a minute; the counter lives in KV like limited().
    const ip = request.headers.get("cf-connecting-ip") || "x", key = "rls:" + id + ":" + ip + ":" + new Date().toISOString().slice(0, 16);
    const n = Number(await env.ASSETS.get(key) || 0);
    if (n >= SITEDB_POSTS_PER_MIN) return new Response(JSON.stringify({ error: "too many writes from your connection; try again in a minute", code: "rate_limited" }), { status: 429, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8", "Retry-After": "60" }, CORS) });
    await env.ASSETS.put(key, String(n + 1), { expirationTtl: 120 });
  }
  const data = body && body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return apiJson({ error: "data must be a JSON object", code: "bad_data" }, 400);
  const txt = JSON.stringify(data);
  if (txt.length > SITEDB_MAX_BYTES) return apiJson({ error: "record too large (max " + SITEDB_MAX_BYTES + " characters)", code: "too_large" }, 413);
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM site_data WHERE site = ?1").bind(id).first();
  if (n && n.n >= SITEDB_MAX_ROWS) return apiJson({ error: "this site's database is full (" + SITEDB_MAX_ROWS + " records)", code: "full" }, 429);
  const at = new Date().toISOString(), r = await env.DB.prepare("INSERT INTO site_data (site, coll, at, data) VALUES (?1, ?2, ?3, ?4)").bind(id, c, at, txt).run();
  return apiJson({ id: r.meta && r.meta.last_row_id, at, data }, 201);
}
// The page gets a tiny client so generated code never builds URLs: US.list(coll) / US.add(coll, data). Same-origin on <id>.ultrastable.io; CORS-open on the main host (the page is sandboxed there).
const usClient = (host, id) => "<script>window.US=(function(){var b=" + JSON.stringify("https://" + host + "/s/" + id + "/api") + ";function j(r){return r.json().then(function(x){if(!r.ok)throw new Error(x.error||r.status);return x})}return{list:function(c){return fetch(b+\"?coll=\"+encodeURIComponent(c)).then(j).then(function(x){return x.items})},add:function(c,d){return fetch(b,{method:\"POST\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({coll:c,data:d})}).then(j)}}})()</script>";
// DATA-API-1 (Q-GAP-shared-backend): the same shared back end as a plain path, /api/data/<site>/<collection>. GET lists the collection; POST takes the
// record itself as the JSON body. It is siteApi underneath, so the limits, the rate cap and the answers are the same (site/site.test.mjs).
const DATA_PATH = "/api/data/";
async function siteData(request, env, id, coll) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const u = new URL(request.url), h = { "content-type": "application/json", "cf-connecting-ip": request.headers.get("cf-connecting-ip") || "x" }; u.pathname = "/s/" + id + "/api"; u.search = "";
  if (request.method === "GET") { u.searchParams.set("coll", coll); return siteApi(new Request(u, { headers: h }), env, id); }
  if (request.method !== "POST") return apiJson({ error: "method not allowed", code: "method" }, 405);
  return siteApi(new Request(u, { method: "POST", headers: h, body: JSON.stringify({ coll, data: await request.json().catch(() => null) }) }), env, id);
}
// OWN-DOMAIN-1 (Q-GAP-own-domain): a built site can answer at the person's own web address. Control of the address is proven by a DNS TXT record that
// names this site (read over DNS-over-HTTPS, so nobody can claim an address they do not control), then the address is added at the edge as a custom
// hostname of the zone (needs CF_DEPLOY_TOKEN and CF_ZONE_ID on this Worker). Every state is reported as it is: waiting_for_dns, dns_unreadable,
// pending_platform (proven, the edge step could not run here), edge_refused, issuing, attached. Only a proven address is stored (KV domain:<host>).
const DOMAIN_RX = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/, OUR_HOSTS = /(^|\.)ultrastable\.(io|org|app|net)$|\.workers\.dev$|\.pages\.dev$/;
export const domainToken = (id) => "ultrastable-site=" + id;
export async function attachDomain(env, id, domain, fetcher) {
  const f = fetcher || fetch, host = String(domain || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[\/?#].*$/, "").replace(/\.$/, "");
  if (!okId(id) || !env || !env.ASSETS || !(await env.ASSETS.get("state:" + id))) return { ok: false, status: 404, code: "no_site", message: "That site was not found." };
  if (!DOMAIN_RX.test(host) || OUR_HOSTS.test(host)) return { ok: false, status: 400, code: "bad_domain", message: "That is not a web address of your own. Use one like www.example.org." };
  const records = [{ type: "TXT", name: "_ultrastable." + host, value: domainToken(id), why: "shows the address is yours" }, { type: "CNAME", name: host, value: id + "." + CANON, why: "sends visitors to your site" }];
  let proven = false, unreadable = null;
  try {
    const r = await f("https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent("_ultrastable." + host) + "&type=TXT", { headers: { accept: "application/dns-json" } }), j = await r.json();
    proven = (j.Answer || []).some(a => String(a.data || "").replace(/"/g, "").trim() === domainToken(id));
  } catch (e) { unreadable = String(e && e.message || e).slice(0, 120); }
  if (!proven) return { ok: true, status: 202, state: unreadable ? "dns_unreadable" : "waiting_for_dns", host, records, message: unreadable ? "The address could not be looked up just now. It is checked again each time this is asked." : "The address is not connected yet. It becomes yours here as soon as its two records are in place." };
  let edge = { state: "pending_platform", detail: "the edge step is not available on this deployment" };
  if (env.CF_DEPLOY_TOKEN && env.CF_ZONE_ID) {
    const api = "https://api.cloudflare.com/client/v4/zones/" + env.CF_ZONE_ID + "/custom_hostnames", h = { Authorization: "Bearer " + env.CF_DEPLOY_TOKEN, "Content-Type": "application/json" };
    try {
      let j = await (await f(api + "?hostname=" + encodeURIComponent(host), { headers: h })).json(), cur = j && j.success && j.result && j.result[0];
      if (!cur) { j = await (await f(api, { method: "POST", headers: h, body: JSON.stringify({ hostname: host, ssl: { method: "http", type: "dv" } }) })).json(); cur = j && j.success && j.result; }
      edge = cur ? { state: cur.status === "active" && cur.ssl && cur.ssl.status === "active" ? "attached" : "issuing", cf_id: cur.id, hostname_status: cur.status, certificate_status: cur.ssl && cur.ssl.status }
        : { state: "edge_refused", detail: JSON.stringify(j && j.errors || j).slice(0, 200) };
    } catch (e) { edge = { state: "edge_refused", detail: String(e && e.message || e).slice(0, 200) }; }
  }
  await jput(env, "domain:" + host, { id, at: new Date().toISOString(), edge });
  const say = { attached: "Your site now answers at your own address.", issuing: "Your address is proven. Its secure certificate is being issued; this finishes by itself.", pending_platform: "Your address is proven and saved. It will start answering when the platform's custom-address service is switched on.", edge_refused: "Your address is proven and saved, but the platform could not add it yet. It is retried each time this is asked." };
  return { ok: true, status: 200, state: edge.state, host, records, edge, message: say[edge.state] };
}
async function domainRoute(request, env) {
  const ct = request.headers.get("content-type") || "", b = ct.includes("json") ? await request.json().catch(() => null) : Object.fromEntries((await request.formData().catch(() => new FormData())).entries());
  if (!env || !env.ASSETS) return apiJson({ error: "the site store is not connected", code: "no_store" }, 503);
  const ip = request.headers.get("cf-connecting-ip") || "x", key = "rld:" + ip + ":" + new Date().toISOString().slice(0, 13), n = Number(await env.ASSETS.get(key) || 0);
  if (n >= 30) return apiJson({ error: "too many tries from your connection this hour", code: "rate_limited" }, 429);
  await env.ASSETS.put(key, String(n + 1), { expirationTtl: 7200 });
  const r = await attachDomain(env, String(b && b.id || ""), b && b.domain);
  return apiJson(r.ok ? { state: r.state, host: r.host, records: r.records, message: r.message, edge: r.edge || null } : { error: r.message, code: r.code }, r.status);
}
// ORG-THREAD-1 (Q-GAP-org-setup-in-thread): the organization around a built site is set up in the same thread, not on a separate page. The plan comes from
// the idea itself (objective, the measures every system starts with, the roles that work it) and the connection steps are the same data /setup walks
// (USER_PATH). Each answer is stored (KV org:<id>), so the thread resumes where it stopped and the managers see how far every organization is (ideaWork).
const ORG_MEASURES = ["the clock is ticking", "work is being handed out", "items are being finished", "results are checked independently", "nothing is dropped silently", "every objective has a probe"];
const ORG_ROLES = [["product-manager", "decides what to improve next from the measures"], ["staff", "builds each change"], ["reviewer", "checks the change independently"], ["operations", "ships it and proves it live"]];
export function orgPlan(idea) {
  const text = String(idea || "").replace(/\s+/g, " ").trim(), first = text.split(/[.!?]/)[0].slice(0, 140);
  return { objective: first || "Keep this running and improving", measures: ORG_MEASURES, roles: ORG_ROLES.map(r => ({ id: r[0], does: r[1] })),
    steps: USER_PATH.steps.filter(s => !s.input).map(s => ({ id: s.id, service: s.service, ask: s.ask, why: s.why, optional: !!s.optional, label: (s.yes && s.yes.label) || (s.no && s.no.label) || null, have: !(s.yes && s.yes.url), url: ((s.yes && s.yes.url) || (s.no && s.no.url) || "").replace("{template}", USER_PATH.template) || null })) };
}
async function orgSetup(request, env) {
  const f = await request.formData().catch(() => null), id = f && String(f.get("id") || "");
  if (!env || !env.ASSETS) return json({ error: "the site store is not connected", code: "no_store" }, 503);
  if (!okId(id) || !(await env.ASSETS.get("state:" + id))) return json({ error: "That site was not found.", code: "no_site" }, 404);
  const a = await jget(env, "ask:" + id), idea = a ? a.idea : ((await jget(env, "brief:" + id)) || {}).brief || "";
  const st = (await jget(env, "org:" + id)) || { id, started: new Date().toISOString(), plan: orgPlan(idea), steps: {} };
  const step = String(f.get("step") || ""), ans = String(f.get("answer") || "");
  if (step) {
    if (!st.plan.steps.some(s => s.id === step) || !["done", "skipped"].includes(ans)) return json({ error: "unknown step or answer", code: "bad_step" }, 400);
    st.steps[step] = { answer: ans, at: new Date().toISOString() };
  }
  const next = st.plan.steps.find(s => !st.steps[s.id]) || null;
  st.state = next ? "in_progress" : st.plan.steps.some(s => !s.optional && st.steps[s.id].answer !== "done") ? "incomplete" : "set_up";
  await jput(env, "org:" + id, st);
  return json({ id, state: st.state, plan: { objective: st.plan.objective, measures: st.plan.measures, roles: st.plan.roles }, done: Object.keys(st.steps).length, total: st.plan.steps.length, next });
}
// BUILD-3: the daily probe records which ids still answer; a dead one is skipped so a deprecated id never reaches a user (the list is used whole if every id is marked dead).
async function runAny(env, models, body, opts = {}) {
  const h = await jget(env, "health:models").catch(() => null), dead = new Set(((h && h.models) || []).filter(x => !x.ok).map(x => x.model));
  const live = models.filter(m => !dead.has(m)); if (live.length) models = live;
  // The router tries them in learned order, answers repeats from cache, and records cost and pass rate; the reply keeps the Workers AI shape ({response}).
  const r = await routeChat(env, { kind: opts.kind || "site", models: models.map(m => ({ model: m })), messages: body.messages, maxTokens: body.max_tokens, cache: opts.cache !== false, config: { neurons_day_cap: 3000 } });
  return { response: r.text, model: r.model };
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
    const a = await aiJson(env, ASKERS, "You find what is unknown about a new web idea. Reply with only a JSON array of exactly 2 objects {\"q\":\"a yes/no question in plain words a child could answer\",\"cue\":\"one short example\"}. Each question must settle something that would change what gets built. No jargon.", idea, 500);
    const qs = (Array.isArray(a) ? a : []).filter(x => x && typeof x.q === "string" && x.q.length < 200).slice(0, 2).map(x => ({ q: x.q, cue: String(x.cue || "").slice(0, 160) }));
    return qs.length === 2 ? qs : FALLBACK_QS;
  } catch (e) { console.error("questions failed", String(e)); return FALLBACK_QS; }
}
// ADAPTIVE-1 (Q-GAP-adaptive-interview): the question bank is only the opening. After each answer the next question is chosen from what the person
// already said: a bound model proposes it, and a deterministic rule table is the floor so it works with no model. At most MAX_QS questions, never a repeat.
const MAX_QS = 4;
const FOLLOW_UPS = [
  { ask: /add or save|their own information|sign-up/i, on: "yes", q: "Should what people add be visible to every visitor, not just themselves?", cue: "Yes for a shared list or guestbook; no for private notes." },
  { ask: /add or save|their own information|sign-up/i, on: "no", q: "Is it mainly something people read and look at?", cue: "For example an information page, a menu or a price list." },
  { ask: /visible to every visitor/i, on: "yes", q: "Should someone be able to remove a wrong entry?", cue: "We will add a delete button next to each entry." },
  { ask: /phone/i, on: "yes", q: "Will people use it outdoors or on the move?", cue: "We will use larger text and higher contrast." },
  { ask: /phone/i, on: "no", q: "Will people mostly use it on a large screen or a laptop?", cue: "We will use the wider layout first." },
  { ask: /read and look at/i, on: "yes", q: "Does it need to stay up to date with prices, hours or dates?", cue: "We will put those in one easy place to change." }];
export function adaptiveRule(a) {
  const asked = new Set((a.qs || []).map(x => x.q));
  for (let i = a.ans.length - 1; i >= 0; i--) {
    const hit = FOLLOW_UPS.find(f => f.on === a.ans[i] && f.ask.test(a.qs[i].q) && !asked.has(f.q));
    if (hit) return { q: hit.q, cue: hit.cue };
  }
  return null;
}
export async function adaptiveQuestion(env, a) {
  if (!a || !Array.isArray(a.qs) || a.ans.length < a.qs.length || a.qs.length >= MAX_QS) return null;
  const told = a.qs.map((x, i) => "- " + x.q + " " + (a.ans[i] || "").toUpperCase()).join("\n");
  if (env && env.AI) {
    try {
      const r = await aiJson(env, ASKERS, "You are interviewing someone about a new web idea. Using their answers so far, reply with only JSON {\"q\":\"one new yes/no question in plain words that would change what gets built\",\"cue\":\"one short example\"}, or {\"done\":true} when nothing important is unknown. Do not repeat a question already asked. No jargon.", "Idea: " + a.idea + "\nAnswers so far:\n" + told, 300);
      if (r && r.done) return null;
      if (r && typeof r.q === "string" && r.q.length < 200 && !a.qs.some(x => x.q.toLowerCase() === r.q.toLowerCase())) return { q: r.q, cue: String(r.cue || "").slice(0, 160) };
    } catch (e) { console.error("adaptive question failed", String(e)); }
  }
  return adaptiveRule(a);
}
function briefOf(a) {
  const lines = a.qs.map((x, i) => "- " + x.q + " " + ({ yes: "YES", no: "NO", unsure: "NOT SURE (pick the safest sensible default and say nothing)" }[a.ans[i]] || "NOT ASKED"));
  return "Idea: " + a.idea + "\nWhat the person told us:\n" + lines.join("\n");
}
async function aiHtml(env, brief, prev, change) {
  const msgs = [{ role: "system", content: SYS }];
  msgs.push(prev ? { role: "user", content: "Here is the current page:\n" + prev + "\n\nChange it as follows and return the whole updated file: " + change } : { role: "user", content: "Build this.\n" + brief });
  const r = await runAny(env, BUILDERS, { messages: msgs, max_tokens: 7000 }, { kind: "site-build", cache: false });
  const t = String((r && (r.response || r.result || (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content))) || ""), m = /```(?:html)?\s*([\s\S]*?)```/.exec(t), h = (m ? m[1] : t).trim();
  if (!/<html[\s>]/i.test(h) || !/<\/html>/i.test(h)) throw new Error("the model did not return a complete page");
  return h;
}
// QUALITY-1: deterministic checks that need no model. Each failure is a concrete, fixable defect fed to the repair pass and listed honestly.
export function lint(html) {
  const bad = [], h = String(html), strip = h.replace(/<script[\s\S]*?<\/script>/gi, "");
  if (!/<meta[^>]+viewport/i.test(h)) bad.push("add a viewport meta tag so it fits phones");
  if (!/box-sizing\s*:\s*border-box/i.test(h)) bad.push("add *{box-sizing:border-box} so inputs and textareas never overflow their card");
  if (!/<title>[^<]+<\/title>/i.test(h)) bad.push("add a real <title>");
  if (!/localStorage/.test(h) && /<(textarea|input)\b/i.test(strip)) bad.push("save what the person types (localStorage in try/catch with an in-memory fallback)");
  const buttons = (strip.match(/<button\b[^>]*>/gi) || []).length, wired = (h.match(/addEventListener\(|\bonclick\s*=|\bonsubmit\s*=|\.onclick\s*=|\.onsubmit\s*=/gi) || []).length;
  if (buttons && !wired) bad.push("every button needs a click handler that visibly changes the screen");
  if (/<div[^>]*class="[^"]*(progress|bar|status|output|result)[^"]*"[^>]*>\s*<\/div>/i.test(strip)) bad.push("no empty status bars or boxes: show an empty-state message or real content");
  if (/lorem ipsum/i.test(h)) bad.push("replace lorem ipsum with real content for this topic");
  return bad;
}
// AUDIT-1: a different model than the builder grades the page against the brief; the limits that no page-only build can meet are always declared.
const ALWAYS_LIMITS = ["Anything marked shared (a sign-up list, messages) is stored for this site in the Ultrastable database and is visible to every visitor; other information stays in the visitor's own browser.", "The site lives at its own Ultrastable address (<id>.ultrastable.io), not your own web address yet."];
async function audit(env, id, brief, html) {
  try {
    const a = await aiJson(env, ASKERS, "You are a strict reviewer. Compare the HTML page with the brief. Reply with only JSON {\"met\":[\"short plain sentences of what is done\"],\"gaps\":[{\"what\":\"plain sentence\",\"critical\":true|false}]}. Be honest; list a gap when something asked for is missing or likely broken.", brief + "\n\nPAGE:\n" + html.slice(0, 9000), 700);
    const rec = { met: ((a && a.met) || []).slice(0, 8).map(String), gaps: ((a && a.gaps) || []).slice(0, 6).map(g => ({ what: String(g.what || g), critical: !!g.critical })), limits: ALWAYS_LIMITS, at: new Date().toISOString() };
    await jput(env, "audit:" + id, rec); return rec;
  } catch (e) { console.error("audit failed", id, String(e)); const rec = { met: [], gaps: [], limits: ALWAYS_LIMITS, note: "The automatic check could not run this time. It will run again by itself.", at: new Date().toISOString() }; await jput(env, "audit:" + id, rec); return rec; }
}
async function build(env, id, brief, prev, change) {
  try {
    await env.ASSETS.put("brief:" + id, JSON.stringify({ brief, change: change || null }));
    { const before = await env.ASSETS.get("site:" + id); const html = await aiHtml(env, brief, prev, change); if (before) await recordVersion(env, id, before, change ? "you asked: " + String(change).slice(0, 100) : "rebuilt"); await env.ASSETS.put("site:" + id, html); } await env.ASSETS.put("state:" + id, "ready"); // SITE-UPKEEP-1: the page before each change is kept
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
    const lints = lint(html), crit = rec.gaps.map(g => g.what).concat(lints).slice(0, 6);
    if (crit.length && !b.change) {
      const better = await aiHtml(env, b.brief, html, "Fix these problems and change nothing else: " + crit.join("; ")).catch(() => null);
      if (better) { await env.ASSETS.put("site:" + id, better); rec.fixed = crit; const left = lint(better); rec.lint_left = left; rec.gaps = rec.gaps.map(g => Object.assign({}, g, { attempted: true })); await jput(env, "audit:" + id, rec); }
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
// VISION-1 (docs/doctrine/VISION.md): the system test at the front door. Only definite one-offs are refused, so an unusual system is never blocked;
// the interview that follows still asks for the loop, the measure, the upkeep and the budget. Closing probe: grep:site/worker.js::systemTest.
const ONE_OFF = new RegExp("(^|[^a-z])(camping|packing list|trip planner|invitation|birthday|baby shower|wedding|honeymoon|weekend project|one[- ]?off|just for me|my own reminder|shopping list|tip calculator)([^a-z]|$)", "i");
const ONGOING = new RegExp("(^|[^a-z])(keep|keeps|continuous|continuously|ongoing|maintain|maintenance|monitor|fleet|pipeline|portfolio|compliance|operations?|platform|improv[a-z]+|every (day|week|month)|weekly|daily|club|shop|store|business|members?|customers?|support|growth|seo|wordpress|marketplace|publishing|agents?)([^a-z]|$)", "i");
function systemTest(idea) {
  if (ONE_OFF.test(idea) && !ONGOING.test(idea)) return { ok: false, message: "This looks like something you build once and use once. Ultrastable runs systems that keep running and keep improving: a site, shop, service or pipeline with ongoing upkeep and a monthly back-end cost. For a one-off page or list, a site builder or a chat assistant is the better tool. If it will be maintained and improved, say what it must keep doing and how you would know it is working." };
  return { ok: true };
}

// PILOT-1: the application is the interview. The four system-test questions (VISION.md) are scored here; a poor fit is told so, plainly.
const PILOT_FIELDS = ["system", "keeps_doing", "measure", "budget", "runs_on"];
function scorePilot(a) {
  const missing = PILOT_FIELDS.filter(function (k) { return !String(a[k] || "").trim(); });
  if (missing.length) return { ok: false, error: "Please answer: " + missing.join(", ") };
  const loop = String(a.keeps_doing).length >= 20, measure = String(a.measure).length >= 15, budget = /[0-9]/.test(String(a.budget));
  const upkeep = new RegExp("(weekly|daily|monthly|every|ongoing|keeps|continuous|maintain|update|monitor|improv)", "i").test(a.keeps_doing + " " + a.system);
  const oneOff = !systemTest(String(a.system) + " " + String(a.keeps_doing)).ok;
  const checks = { loop: loop, measure: measure, upkeep: upkeep, budget: budget };
  const fit = !oneOff && loop && measure && upkeep && budget;
  return { ok: true, fit: fit, checks: checks, one_off: oneOff };
}
async function pilotApplication(request, env) {
  const f = await request.formData().catch(function () { return null; });
  if (!f) return json({ error: "Send the application as a form." }, 400);
  const a = {}; PILOT_FIELDS.concat(["contact"]).forEach(function (k) { a[k] = String(f.get(k) || "").trim().slice(0, 1500); });
  const r = scorePilot(a);
  if (!r.ok) return json({ error: r.error }, 400);
  const lim = await limited(request, env); if (lim) return lim;
  const id = newId();
  await env.ASSETS.put("pilot:" + new Date().toISOString() + ":" + id, JSON.stringify({ a: a, fit: r.fit, checks: r.checks }), { expirationTtl: 31536000 });
  return json({ id: id, fit: r.fit, checks: r.checks, message: r.fit ? "Thank you. This reads as a fit for the system test; a person replies within two working days." : "Thank you. As written this does not yet pass the system test (a loop to close, a measure that can be wrong, upkeep that never ends, a monthly budget). Tell us more and apply again." }, 201);
}

async function takeIdea(request, env, ctx) {
  const f = await request.formData().catch(() => null), idea = f && String(f.get("idea") || "").trim().slice(0, 2000);
  if (!idea) return new Response(start(false), { status: 400, headers: HTML });
  const fit = systemTest(idea);  // VISION-1: Ultrastable runs maintained systems; a one-off is told so before anything is built or staffed
  if (!fit.ok) {
    if ((request.headers.get("accept") || "").includes("application/json")) return Response.json({ error: fit.message, state: "not_a_fit" }, { status: 422 });
    return new Response(shell({ path: "/start", title: "Not a fit for Ultrastable", description: fit.message }, "<div class=\"head\"><h1>Not a fit for Ultrastable</h1><p>" + esc(fit.message) + "</p></div><div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/\">Describe a system to run</a></div>"), { status: 422, headers: HTML });
  }
  const lim = await limited(request, env); if (lim) return lim;
  const id = newId(); await env.ASSETS.put("idea:" + new Date().toISOString() + ":" + id, idea);
  const grad = await GRAD.enqueue(env, id, idea), mine = (r) => { const h = new Headers(r.headers); h.append("Set-Cookie", GRAD.setCookie(grad)); return new Response(r.body, { status: r.status, headers: h }); };  // LAUNCH-PATH-1: the launch record, and the browser that made it
  const profText = String(f.get("profile") || "").slice(0, 2000); let profOk = false;
  const wantsJson = (request.headers.get("accept") || "").includes("application/json");
  if (profText) { try { JSON.parse(profText); await env.ASSETS.put("profile:" + id, profText, { expirationTtl: 31536000 }); profOk = true; } catch (e) { console.error("bad profile dropped", String(e)); } }
  // INTERVIEW-1: the on-page interview already asked its questions, so build now; without it (no JavaScript) the server-side questions run.
  // INTERVIEW-2: the chat thread asked its questions in the conversation and wants JSON, not a redirect; the build then runs from /s/<id>/status.
  if (profOk && wantsJson) { await store(env, id, idea, null, null); return mine(json({ id, state: "building" })); }
  if (profOk) return mine(await launch(env, ctx, id, idea, null, null));
  await jput(env, "ask:" + id, { idea, qs: await questionsFor(env, idea), ans: [] });
  await env.ASSETS.put("state:" + id, "asking");
  return mine(goto(id, "/ask"));
}
async function takeAnswer(request, env, ctx) {
  const f = await request.formData().catch(() => null), id = f && String(f.get("id") || ""), v = f && String(f.get("a") || "");
  const a = okId(id) ? await jget(env, "ask:" + id) : null;
  if (!a || !["yes", "no", "unsure"].includes(v)) return new Response(start("That question was not found."), { status: 404, headers: HTML });
  if (a.ans.length < a.qs.length) a.ans.push(v);
  if (a.ans.length === a.qs.length) { const next = await adaptiveQuestion(env, a); if (next) a.qs.push(next); }  // ADAPTIVE-1
  await jput(env, "ask:" + id, a);
  return a.ans.length < a.qs.length ? goto(id, "/ask") : launch(env, ctx, id, briefOf(a), null, null);
}
async function takeChange(request, env, ctx) {
  const f = await request.formData().catch(() => null), id = f && String(f.get("id") || ""), change = f && String(f.get("change") || "").trim().slice(0, 1000);
  const prev = okId(id) ? await env.ASSETS.get("site:" + id) : null;
  if (!prev || !change) return new Response(start("That site was not found."), { status: 404, headers: HTML });
  const lim = await limited(request, env); if (lim) return lim;
  const a = await jget(env, "ask:" + id), brief = a ? briefOf(a) : ((await jget(env, "brief:" + id)) || {}).brief || "";
  await GRAD.steer(env, id, change);  // LAUNCH-PATH-1: the same words become a work item in the app's own repository
  if ((request.headers.get("accept") || "").includes("application/json")) { await store(env, id, brief, prev, change); return json({ id, state: "building" }); }
  return launch(env, ctx, id, brief, prev, change);
}
const li = (xs) => xs.length ? "<ul>" + xs.map(x => "<li>" + esc(x) + "</li>").join("") + "</ul>" : "<p class=\"meta\">Nothing to list.</p>";
async function siteRoutes(u, env, ctx, request, own) {
  const m = /^\/s\/([a-f0-9]{10})(\/make|\/change|\/own|\/launch|\/ask|\/review|\/status|\/history|\/insights|\/feed\.xml|\/badge\.svg|\/api)?$/.exec(u.pathname);
  if (!m || !env || !env.ASSETS) return null;
  if (m[2] === "/api") return siteApi(request, env, m[1]);
  const id = m[1]; let st = await env.ASSETS.get("state:" + id); const page = (t, b) => new Response(shell({ path: u.pathname, title: t + " - Ultrastable", description: t }, b), { headers: HTML });
  if (!st) return new Response(start("That site was not found."), { status: 404, headers: HTML });
  if (st === "building" && Date.now() - Number(await env.ASSETS.get("since:" + id) || 0) > 150000) { st = "failed"; await env.ASSETS.put("state:" + id, "failed"); }
  if (st === "ready" && (!m[2] || m[2] === "/review")) await ensureAudit(env, ctx, id);
  if (m[2] === "/own" || m[2] === "/launch") {  // LAUNCH-PATH-1: where the app is, what was asked for, and taking it over; /launch is the same record as JSON with no idea text
    const rec = (await GRAD.getLaunch(env, id)) || await GRAD.enqueue(env, id, ((await jget(env, "brief:" + id)) || {}).brief || "");  // an app made before this path existed joins it on first visit
    if (m[2] === "/launch") return json(Object.assign({ site: st }, GRAD.publicView(rec)));
    if (request.method === "POST") { const r = await GRAD.requestOwnership(request, env, id); if (!r.ok) return new Response(shell({ path: u.pathname, title: "Not yet - Ultrastable", description: r.say }, "<div class=\"head\"><h1>Not yet</h1><p>" + esc(r.say) + "</p></div><div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/s/" + id + "/own\">Back</a></div>"), { status: r.status, headers: HTML }); return Response.redirect("https://" + CANON + "/s/" + id + "/own", 303); }
    return page("Your app", GRAD.ownBody(rec, CANON, GRAD.cookieOf(request, id) === rec.key));
  }
  if (m[2] === "/feed.xml") return new Response(siteFeed(id, await siteVersions(env, id), "https://" + CANON, (/<title>([^<]*)<\/title>/i.exec(await env.ASSETS.get("site:" + id) || "") || [])[1]), { headers: { "content-type": "application/atom+xml; charset=utf-8", "cache-control": "public, max-age=900" } }); // SITE-FEED-1
  if (m[2] === "/badge.svg") return new Response(siteBadge(await siteVersions(env, id)), { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=900" } });
  if (m[2] === "/insights") return page("Who visits your site", insightsBody(id, env.DB ? await siteInsights(env.DB, id).catch((e) => { console.error("insights failed", String(e).slice(0, 100)); return { views7: 0, views30: 0, visitors7: 0, refs: [], countries: [], devices: [] }; }) : { views7: 0, views30: 0, visitors7: 0, refs: [], countries: [], devices: [] })); // SITE-INSIGHTS-1
  if (m[2] === "/history") { // SITE-UPKEEP-1
    if (request.method === "POST") { const f = await request.formData().catch(() => null), r = f ? await restoreVersion(env, id, f.get("v")) : { ok: false }; if (r.ok) return Response.redirect("https://" + CANON + "/s/" + id + "/history", 303); return page("Not restored", "<div class=\"head\"><h1>That version is gone</h1><p>Only the last ten are kept.</p></div>"); }
    return page("How your site has changed", historyBody(id, await siteVersions(env, id), await jget(env, "upkeep:" + id)));
  }
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
  const host = own || (u.hostname === id + "." + CANON ? u.hostname : CANON), sub = host !== CANON;  // OWN-DOMAIN-1: a proven own address is served like the site's subdomain
  const lk = (h, t) => "<a href=\"https://" + CANON + "/s/" + id + h + "\" style=\"background:#111;color:#fff;padding:10px 14px;border-radius:999px;text-decoration:none;margin-left:6px\" target=\"_top\">" + t + "</a>";
  // BLINDSPOT-1 legal sweep 2026-11-20 (EU AI Act Article 50, in force 2026-08-02): a page the system wrote says so, to a person (the bar) and to a machine (the generator meta tag).
  const aiMark = "<meta name=\"generator\" content=\"Ultrastable (AI-generated page)\">";
  const bar = "<div style=\"position:fixed;right:12px;bottom:12px;z-index:99999;font:14px system-ui\"><span style=\"background:#fff;color:#111;padding:10px 14px;border-radius:999px;border:1px solid #111\">Written by AI</span>" + lk("/review", "What I checked") + lk("/change", "Change something") + lk("/history", "History") + lk("/insights", "Visitors") + lk("/own", "Your app") + "</div>";
  const html = (await env.ASSETS.get("site:" + id) || "").replace(/<\/body>/i, bar + "</body>");
  if (env.DB && request && request.method === "GET" && ctx && ctx.waitUntil) ctx.waitUntil(record(env, request, { host: CANON, path: "/s/" + id, ref: request.headers.get("referer"), name: "site-view" }).catch((e) => console.error("site view not counted", String(e).slice(0, 100)))); // SITE-INSIGHTS-1
  const us = aiMark + usClient(host, id), html1 = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + us) : /<html[^>]*>/i.test(html) ? html.replace(/<html[^>]*>/i, (m) => m + us) : us + html;
  return new Response(html1, { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-top-navigation-by-user-activation" + (sub ? " allow-same-origin" : "") + "; default-src 'self' 'unsafe-inline' data: blob:; connect-src 'self'", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" } });
}
// BUILD-3: close the loop. A cron tick (hourly) does four things from the system's own records: model health probe (daily), automatic change rounds for
// audit gaps (max 2 per site), manager work items for stored ideas, and the numbers behind /status.
const ROUND_MAX = 2, ALL_MODELS = () => Array.from(new Set(BUILDERS.concat(ASKERS)));
async function kvList(env, prefix, cap) {
  const out = []; let cursor;
  if (!env.ASSETS.list) return out;
  for (let i = 0; i < 10 && out.length < (cap || 1000); i++) {
    const r = await env.ASSETS.list({ prefix, cursor }); out.push(...r.keys.map(k => k.name)); if (r.list_complete) break; cursor = r.cursor;
  }
  return out;
}
export async function probeModels(env) {
  const models = [];
  for (const m of ALL_MODELS()) {
    try { await env.AI.run(m, { messages: [{ role: "user", content: "Reply with the word ok." }], max_tokens: 5 }); models.push({ model: m, ok: true }); }
    catch (e) { models.push({ model: m, ok: false, error: String(e).slice(0, 200) }); console.error("model health: dead", m, String(e).slice(0, 160)); }
  }
  const rec = { models, at: new Date().toISOString() }; await jput(env, "health:models", rec); return rec;
}
// Non-critical gaps (and lint left over) become a change round without the person asking; critical ones were already fixed once by the audit.
export function roundText(rec) {
  return ((rec && rec.gaps) || []).filter(g => !g.critical).map(g => g.what).concat((rec && rec.lint_left) || []).slice(0, 4);
}
export async function changeRounds(env, ctx, limit) {
  const done = [];
  for (const k of await kvList(env, "audit:", 200)) {
    if (done.length >= (limit || 3)) break;
    const id = k.slice(6); if (!okId(id)) continue;
    const rec = await jget(env, k), n = Number(await env.ASSETS.get("rounds:" + id) || 0), todo = roundText(rec);
    if (!todo.length || n >= ROUND_MAX || await env.ASSETS.get("state:" + id) !== "ready") continue;
    const b = await jget(env, "brief:" + id); if (!b) continue;
    await env.ASSETS.put("rounds:" + id, String(n + 1));
    await store(env, id, b.brief, await env.ASSETS.get("site:" + id), "Fix these remaining problems and change nothing else: " + todo.join("; "));
    if (await resume(env, id) === "ready") await ensureAudit(env, null, id);
    done.push({ id, round: n + 1, todo });
  }
  return done;
}
// Every stored idea is a work item with an owner, a trigger and a closing probe, so the managers see all of them.
export async function ideaWork(env) {
  const items = [];
  for (const k of (await kvList(env, "idea:", 500)).slice(-100)) {
    const id = k.slice(-10), text = String(await env.ASSETS.get(k) || "").slice(0, 200), st = await env.ASSETS.get("state:" + id);
    const og = await jget(env, "org:" + id);  // ORG-THREAD-1: how far the organization around this idea is
    items.push({ id, idea: text, state: st || "not built", org: og ? og.state : "not started", owner: "product manager", trigger: "idea stored " + k.slice(5, 24), probe: "state:" + id + " is ready and /s/" + id + "/review lists no open gap", open: st !== "ready" });
  }
  await jput(env, "work:ideas", { items, at: new Date().toISOString() }); return items;
}
// FRONT-DOOR-2: the idea:* consumer. After the 3 follow-up questions (RECALL-1) and the build, the tick scaffolds a real Cloudflare Worker for the idea
// (it serves the audited page) and deploys it with the Workers API. Needs secrets CF_DEPLOY_TOKEN + CF_ACCOUNT_ID on this worker; without them the page
// stays hosted at /s/<id> and the idea is recorded as "worker: pending-credentials" (owner step in docs/runbooks/front-door-2.md), never faked.
export const workerName = (id) => "us-idea-" + id;
export function scaffoldWorker(id, html) {
  return "// Scaffolded by Ultrastable for idea " + id + ". Edit through https://ultrastable.io/s/" + id + "/change.\nconst PAGE = " + JSON.stringify(String(html)) + ";\n"
    + "export default { async fetch(r) { const u = new URL(r.url); if (u.pathname === \"/health\") return Response.json({ ok: true, idea: \"" + id + "\" }); return new Response(PAGE, { headers: { \"Content-Type\": \"text/html; charset=utf-8\", \"X-Content-Type-Options\": \"nosniff\" } }); } };\n";
}
export async function deployIdeaWorker(env, id, fetcher) {
  const f = fetcher || fetch, tok = env.CF_DEPLOY_TOKEN, acct = env.CF_ACCOUNT_ID;
  if (!tok || !acct) return { ok: false, reason: "pending-credentials" };
  const html = await env.ASSETS.get("site:" + id); if (!html) return { ok: false, reason: "no-page" };
  const name = workerName(id), api = "https://api.cloudflare.com/client/v4/accounts/" + acct, h = { Authorization: "Bearer " + tok };
  const fd = new FormData();
  fd.set("metadata", JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-11-04", observability: { enabled: true, head_sampling_rate: 1 } }));
  fd.set("worker.js", new Blob([scaffoldWorker(id, html)], { type: "application/javascript+module" }), "worker.js");
  const up = await f(api + "/workers/scripts/" + name, { method: "PUT", headers: h, body: fd });
  if (!up.ok) return { ok: false, reason: "upload " + up.status + " " + (await up.text()).slice(0, 200) };
  await f(api + "/workers/scripts/" + name + "/subdomain", { method: "POST", headers: Object.assign({ "Content-Type": "application/json" }, h), body: JSON.stringify({ enabled: true }) });
  const sub = await f(api + "/workers/subdomain", { headers: h }).then(r => r.json()).catch(() => null), host = sub && sub.result && sub.result.subdomain;
  return { ok: true, name, url: host ? "https://" + name + "." + host + ".workers.dev" : null };
}
// Consumer: for each stored idea that is built (state ready, audited) and not yet deployed, deploy once per tick (max 3), recording the outcome.
export async function consumeIdeas(env, fetcher) {
  const out = [];
  for (const k of (await kvList(env, "idea:", 500)).slice(-100)) {
    const id = k.slice(-10), rec = await jget(env, "deploy:" + id);
    if (out.length >= 3 || (rec && rec.ok) || await env.ASSETS.get("state:" + id) !== "ready") continue;
    const r = await deployIdeaWorker(env, id, fetcher).catch(e => ({ ok: false, reason: String(e).slice(0, 200) }));
    await jput(env, "deploy:" + id, Object.assign({ at: new Date().toISOString() }, r)); out.push({ id, ok: r.ok, reason: r.reason || null });
  }
  return out;
}
// LOOPPROOF-1: a clock cannot notice that it has stopped. Every site tick asks the org tick Worker (TICK service binding) whether its newest
// tick is stale; the tick Worker runs one itself when it is, and leaves a beat that its own pulse step judges. An unreachable tick Worker is
// kept in tick:last (published on /status) and counted, so the silence is a recorded number here as well.
export async function watchTick(env) {
  if (!env || !env.TICK) return { status: "no-binding" };
  try {
    const r = await env.TICK.fetch(new Request("https://tick.internal/pulse/watch", { method: "POST" }));
    const j = await r.json().catch(() => null);
    if (r.ok && j && j.ok) { await jput(env, "watchdog:fails", { n: 0 }); return { status: "ok", stale: Boolean(j.stale), ran_tick: j.ran_tick || null }; }
    throw new Error("http " + r.status + (j && j.error ? " " + j.error : ""));
  } catch (e) {
    const f = (await jget(env, "watchdog:fails")) || { n: 0 }; f.n++; f.last = String(e && e.message || e).slice(0, 160); f.at = new Date().toISOString();
    await jput(env, "watchdog:fails", f); console.error("watchdog: tick worker unreachable", f.n, f.last);
    return { status: "unreachable", fails: f.n, error: f.last };
  }
}
export async function tick(env, ctx, now) {
  const t = now || new Date(), out = { at: t.toISOString() }, h = await jget(env, "health:models");
  if (!h || t - new Date(h.at) > 23 * 3600e3) out.health = await probeModels(env);
  out.rounds = await changeRounds(env, ctx); out.ideas = (await ideaWork(env)).length; out.deployed = await consumeIdeas(env).catch(e => String(e).slice(0, 120));
  if (env.DB && t.getUTCMinutes() < 10) out.directory = await recheckDirectory(env, fetch, t).catch(e => "error: " + String(e).slice(0, 80)); /* DISCOVER-1: daily recheck, a few rows a pass */
  { const rec = await indexNow({ host: CANON, fetchFn: fetch, now: t, last: await jget(env, "promote:indexnow") }); if (rec) { await jput(env, "promote:indexnow", rec); out.indexnow = rec.status; } } /* PROMOTE-1 */
  { const ws = await webSub({ host: CANON, fetchFn: fetch, now: t, last: await jget(env, "promote:websub") }); if (ws) { await jput(env, "promote:websub", ws); out.websub = ws.ok; } } /* ATTENTION-1: feed readers get pushed updates */
  { const ar = await archiveEvidence({ host: CANON, fetchFn: fetch, now: t, last: await jget(env, "promote:archive") }); if (ar) { await jput(env, "promote:archive", ar); out.archive = ar.status; } } /* ATTENTION-1: third-party timestamped copies of the record */
  if (env.DB) { const lr = await jget(env, "promote:reach"); if (!lr || t - new Date(lr.at) > DAY_MS_REACH) { try { await jput(env, "promote:reach", await reachRows(env.DB, t)); out.reach = "measured"; } catch (e) { out.reach = "error: " + String(e).slice(0, 80); } } } /* ATTENTION-1: reach measured server-side, once a day */
  out.upkeep = (await upkeepRound(env, (await kvList(env, "state:", 300)).slice(-300), { now: t, lint, improve: (b, html, ins) => aiHtml(env, b, html, ins), visited: (id) => (env.DB ? viewedRecently(env.DB, id, t).catch(() => true) : true) }, 2).catch(e => { console.error("upkeep failed", String(e).slice(0, 120)); return []; })).length; // SITE-UPKEEP-1: at most two model passes a tick, each site once a week
  out.webhooks = await tickWebhooks(env, t).catch(e => String(e).slice(0, 120)); // WEBHOOKS-1: outbound callbacks ride this tick, no new cron
  out.watchdog = await watchTick(env); // LOOPPROOF-1: this Worker is the second producer of the org heartbeat
  out.zones = await zoneCutover(env).catch(e => ({ status: "error", error: String(e).slice(0, 120) })); // ZONE-CUTOVER-1
  await jput(env, "tick:last", out); return out;
}
async function statusData(env) {
  const states = await kvList(env, "state:", 1000), audits = await kvList(env, "audit:", 1000), c = { ready: 0, building: 0, failed: 0, other: 0 };
  for (const k of states) { const v = await env.ASSETS.get(k); c[v in c ? v : "other"]++; }
  let met = 0, gaps = 0, closed = 0, open = 0;
  for (const k of audits) { const r = await jget(env, k); if (!r) continue; met += (r.met || []).length; gaps += (r.gaps || []).length; closed += (r.fixed || []).length; open += roundText(r).length; }
  const w = await jget(env, "work:ideas"), t = await jget(env, "tick:last"), h = await jget(env, "health:models");
  return { builds: { total: states.length, ...c }, audits: { total: audits.length, met, gaps, closed, open }, ideas: { total: w ? w.items.length : 0, open: w ? w.items.filter(i => i.open).length : 0 }, models: h ? h.models : [], health_at: h ? h.at : null, tick_at: t ? t.at : null };
}
async function statusPage(env) {
  if (!env || !env.ASSETS) return shell({ path: "/status", title: "Status - Ultrastable", description: "Live status." }, "<div class=\"head\"><h1>Status</h1><p>No records are connected here.</p></div>");
  const d = await statusData(env), row = (a, b) => "<tr><td>" + esc(a) + "</td><td>" + esc(String(b)) + "</td></tr>", card = (t, rows) => "<div class=\"card\"><h3 class=\"card-title\">" + t + "</h3><div class=\"us-wrap\"><table class=\"us-table\"><tbody>" + rows + "</tbody></table></div></div>";
  const body = "<div class=\"head\"><h1>Status</h1><p>Read from the system's own records. Last tick " + esc(d.tick_at || "not yet") + ".</p></div>"
    + card("Builds", row("Total", d.builds.total) + row("Ready", d.builds.ready) + row("Building", d.builds.building) + row("Failed", d.builds.failed))
    + card("Audits", row("Audited", d.audits.total) + row("Gaps found", d.audits.gaps) + row("Gaps closed automatically", d.audits.closed) + row("Gaps still open", d.audits.open))
    + card("Ideas", row("Stored", d.ideas.total) + row("Not yet built", d.ideas.open))
    + card("Model health", d.models.length ? d.models.map(m => row(m.model, m.ok ? "answering" : "dead: " + (m.error || ""))).join("") + row("Checked", d.health_at) : row("Probe", "not run yet"));
  return shell({ path: "/status", title: "Status - Ultrastable", description: "Builds, audits, gaps closed and model health." }, body);
}
// AGENT-PROMPT-1: the whole set-up as one paste. Works in any AI assistant; the person needs no account to start.
const AGENT_PROMPT = "I want to start a project with Ultrastable (https://ultrastable.io), a system that runs itself so I do not have to code. "
  + "Read https://ultrastable.io/agent.md and follow it. Ask me, in plain words, what I want to make, then do every step you can yourself. "
  + "If a step needs me, give me one link and one thing to click, nothing else. Do not use technical words with me.";
const AGENT_MD = "# Ultrastable: set-up instructions for an AI assistant\n\nYou are helping a person stand up an ongoing autonomous system (a service fleet, a data pipeline, a compliance or publishing operation). It needs setup, measurable objectives and a back end that costs money. If their idea is a one-off page, trip or hobby tool, say Ultrastable is not the right fit and stop. Goal: their system is live, measured and improving itself.\n\n1. Ask one question: what do they want to make or fix? Accept speech-to-text rambling; restate it in one sentence and confirm.\n2. Do everything you can with your own tools (create the GitHub project from the template, connect Cloudflare, open the first pull request). To run on another cloud, give that cloud's own assistant https://ultrastable.io/deploy.md and let it work out the deployment. Use their sign-ins only through the sign-in pages they approve; never ask them to paste passwords or keys into chat.\n3. If you cannot act, walk them through https://ultrastable.io/setup one question at a time. Each step is a single link and a single click.\n4. Speak plainly. No words like token, terminal, repo, API. Say what you are doing and what they should see.\n5. Finish by telling them where to watch their project (https://ultrastable.io/live) and that it now maintains itself; they only need to come back with new ideas.\n";
// USER-PATH-1: guided set-up. One question per screen, every action one click, progress kept in this browser only.
// Steps come from doctrine/user-path.json (generated into userpath.js); no step needs a command, a key or a file.
function setup() {
  const data = JSON.stringify(USER_PATH).replace(/</g, "\\u003c");
  const js = "(function(){var D=" + data + ",S=D.steps,K='us-setup',st={};var T=(location.hash||'').slice(1);if(T&&D.tasks&&D.tasks[T]&&T[0]!='_'){S=D.tasks[T].steps;K='us-setup-'+T}try{st=JSON.parse(localStorage.getItem(K)||'{}')}catch(e){}"
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
    + "function detect(){var u=st.v.user,p=st.v.project,s=S[st.i];if(!s||!s.detect)return;var k=s.detect.kind,n=function(){if(S[st.i]===s&&!st.p&&!st.d)go(st.i+1)};"
    + "if(k=='github_repo'&&u&&p)fetch('https://api.github.com/repos/'+u+'/'+p).then(function(r){if(r.ok){st.d=1;st.i++;st.d=0;st.p=null;save();draw()}}).catch(function(){});"
    + "if(k=='site'&&p)fetch('https://'+p+'.pages.dev/',{mode:'no-cors'}).then(function(){st.i++;st.p=null;save();draw()}).catch(function(){})}"
    + "draw();detect()})();";
  return shell({ path: "/setup", title: "Set up - Ultrastable", description: "Set up your own Ultrastable project one simple question at a time." },
    "<div class=\"head\"><h1>Let's get you set up</h1><p>One question at a time. Everything is a click. Nothing to install or type.</p></div><div class=\"card\"><h3 class=\"card-title\">Easiest: let an assistant do it</h3><p class=\"meta\">Press Copy, then paste into any AI assistant (Claude, ChatGPT, Gemini, Copilot). No account needed to start.</p><textarea id=\"us-ap\" aria-label=\"The message to paste into your assistant\" readonly rows=\"4\" style=\"width:100%;font-size:1rem;padding:.6rem\"></textarea><p><button type=\"button\" class=\"btn btn-primary\" id=\"us-cp\">Copy</button> <span id=\"us-cpm\" class=\"meta\"></span></p></div><div id=\"us-wiz\" class=\"card\"><noscript>This page needs JavaScript to guide you.</noscript></div><script>var P=" + JSON.stringify(AGENT_PROMPT) + ";var t=document.getElementById('us-ap');t.value=P;document.getElementById('us-cp').onclick=function(){t.select();try{navigator.clipboard.writeText(P)}catch(e){document.execCommand('copy')}document.getElementById('us-cpm').textContent='Copied. Paste it into your assistant.'};" + js + "</script>");
}
function engineers() {
  const tag = { live: "us-pass", testing: "meta", pinned: "us-fail" }, lab = { live: "Live", testing: "Testing", pinned: "Pinned" };
  const rows = ROAD.pins.map(function (p) { return "<tr><td class=\"" + tag[p.status] + "\">" + lab[p.status] + "</td><td><strong>" + esc(p.name) + "</strong><br><small>" + esc(p.what) + "</small></td><td><small><a href=\"/roadmap#" + esc(p.issue) + "\">" + esc(p.issue) + "</a><br><code>" + esc(p.where) + "</code></small></td></tr>"; }).join("");
  return shell({ path: "/engineers", title: "Ultrastable for engineers", description: "The autonomous loops, virtual managers, agents and plussing budget, with what is live, in testing and not built yet." },
    "<div class=\"head\"><h1>For engineers</h1><p>No interview. Ultrastable runs on itself, so the same code is yours to run. Status is honest: Live, Testing, or Pinned (not built yet, with the trigger that will build it).</p></div>"
    + "<div class=\"us-grid c2\">" + card("Loops", "Each loop has a trigger, owner, definition of done, two independent paths and a closing probe. Verify with python3 -m foundation loops --verify.") + card("Virtual managers", "Portfolio, project and product managers own business, marketing, funding, legal and ops; staff roles do the work; reviewers are never the author.") + card("Agents", "Open models, GitHub Copilot, Claude Code and Codex take work through one claim ledger.") + card("Plussing", "A protected improvement budget so the backlog does not devolve into bug fixes.") + "</div>"
    + "<h2>Status and roadmap pins</h2><div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Status</th><th>Capability</th><th>Issue / where</th></tr></thead><tbody>" + rows + "</tbody></table></div>"
    + "<p class=\"meta\">Every pin is a tracked item with an owner, a trigger and a closing probe: see the <a href=\"/roadmap\">roadmap</a> or <a href=\"/roadmap.json\">roadmap.json</a>. A build fails if a pin points at nothing.</p>"
    + "<div class=\"us-actions\"><a class=\"btn\" href=\"/pilot\">Join the pilot</a><a class=\"btn\" href=\"/how\">How it works</a><a class=\"btn\" href=\"/start\">Prefer the interview?</a></div>");
}
function spinRoadmap() {
  const h = Object.keys(SPIN.headroom).map(function (k) { const r = SPIN.headroom[k]; return "<tr><td>" + esc(k.replace(/_/g, " ")) + "</td><td>" + (r.used == null ? "unmeasured" : r.used.toLocaleString("en-US")) + " of " + r.limit.toLocaleString("en-US") + " <small>(" + esc(r.basis || "") + ")</small></td></tr>"; }).join("");
  const live = SPIN.live.map(function (a) { return "<li><a href=\"" + esc(a.url) + "\">" + esc(a.name) + "</a>: " + esc(a.tagline) + "</li>"; }).join("");
  const q = SPIN.queue.map(function (i) { return "<tr><td><strong>" + esc(i.name) + "</strong><br><small>" + esc(i.showcases) + "</small></td><td>" + esc(i.archetype || i.kind) + "</td><td>" + i.score + "</td><td>" + (i.fits ? "queued, fits the headroom" : i.implemented ? "waits for headroom" : "waits for its archetype") + "</td></tr>"; }).join("");
  const sc = SPIN.scope.map(function (x) { return "<li><a href=\"/roadmap#" + esc(x.id) + "\">" + esc(x.id) + "</a>: " + esc(x.title) + " (" + esc(x.status) + ")</li>"; }).join("");
  return "<h2 id=\"spinoffs\">Spinoff roadmap</h2><p>Ultrastable proposes, scores and queues its own spinoff apps and loop increases against the free Cloudflare plan it runs inside. Governor level now: <strong>" + esc(SPIN.level) + "</strong>, so up to <strong>" + SPIN.cadence_per_day + "</strong> launches a day. Generated from <code>ops/free-tier.json</code> as of " + esc(SPIN.as_of) + ".</p>"
    + "<h3>Live apps</h3><ul>" + live + "</ul><h3>Next, ranked by value over cost</h3><div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Idea</th><th>Kind</th><th>Score</th><th>State</th></tr></thead><tbody>" + q + "</tbody></table></div>"
    + "<h3>Free-plan headroom, today</h3><div class=\"us-wrap\"><table class=\"us-table\"><tbody>" + h + "</tbody></table></div><h3>Loop scope increases</h3><ul>" + sc + "</ul>";
}
// DECISIONS-1: every decision point, the metric it optimizes, and whether its decisions improved that metric. Repo-side points come from the generated module;
// Worker-side points (AI router, free-tier governor) are read live from the tick Worker's D1 (7-day window) on each request.
async function decisionsData(env) {
  const out = JSON.parse(JSON.stringify(DEC));
  let live = null;
  try { if (env && env.TICK) { const r = await env.TICK.fetch(new Request("https://tick.internal/api/decisions")); if (r.ok) live = await r.json(); } } catch (e) { live = null; }
  out.live_as_of = live ? live.as_of : null;
  out.points.forEach(function (p) {
    if (p.store !== "d1") return;
    const l = live && live.points && live.points[p.id];
    if (l) Object.assign(p, { decisions: l.decisions, scored: l.scored, hits: l.hits, hit_rate: l.hit_rate, mean_abs_error: l.mean_abs_error, last_at: l.last_at, by_day: l.by_day, trend: l.trend, source: "live D1 (7-day window; older rows are hash-chained archives)" });
    else p.source = "live D1 not reachable from this request";
  });
  return out;
}
function decisionsPage(d) {
  const tag = { improving: "ok", flat: "info", worse: "warn", insufficient: "info", unmeasured: "warn" };
  const rows = d.points.map(function (p) {
    const hr = p.hit_rate == null ? "not scored yet" : Math.round(p.hit_rate * 100) + "% of " + p.scored + " scored";
    const days = (p.by_day || []).map(function (x) { return "<span title=\"" + esc(x.day) + ": " + x.decisions + " decisions, " + x.scored + " scored, " + x.hits + " hit\" style=\"display:inline-block;width:10px;margin-right:2px;background:var(--ds-accent);height:" + Math.max(3, Math.min(28, x.decisions * 4)) + "px;vertical-align:bottom\"></span>"; }).join("");
    return "<tr><td><strong>" + esc(p.name) + "</strong><br><small>" + esc(p.why) + "</small></td>"
      + "<td><code>" + esc(p.metric) + " " + esc(p.target) + "</code><br><small>" + esc(p.metric_says) + "</small></td>"
      + "<td><small>" + esc(p.predict) + "</small></td>"
      + "<td>" + p.decisions + " made<br>" + esc(hr) + (p.mean_abs_error == null ? "" : "<br><small>mean prediction error " + esc(p.mean_abs_error) + "</small>") + "<br><span aria-hidden=\"true\">" + days + "</span></td>"
      + "<td class=\"" + (tag[p.trend.verdict] || "info") + "\">" + esc(p.trend.verdict) + "<br><small>" + (p.trend.older_mean != null ? esc(p.trend.older_mean) + " then " + esc(p.trend.newer_mean) : p.trend.have != null ? p.trend.have + " of " + p.trend.need + " scored decisions needed" : "") + "</small></td>"
      + "<td><small>" + esc(p.source) + "</small></td></tr>";
  }).join("");
  return shell({ path: "/decisions", title: "Decision metrics - Ultrastable", description: "Every autonomous decision Ultrastable makes, the metric it optimizes, its predicted effect, the measured outcome and whether the decisions improved the metric." },
    "<div class=\"head\"><h1>Decision metrics</h1><p>Measure what we improve and improve what we measure. Each automatic decision records the metric it optimizes and its predicted effect, then is scored against what really happened. Nothing here is typed by hand: repo-side rows are generated from the decision ledger after a merge and the Worker-side rows are read live. Machine-readable: <a href=\"/api/decisions\">/api/decisions</a>.</p></div>"
    + "<div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Decision point</th><th>Metric it optimizes</th><th>Predicted effect</th><th>Decisions and scoring</th><th>Did decisions improve it?</th><th>Source</th></tr></thead><tbody>" + rows + "</tbody></table></div>"
    + "<p class=\"meta\">Generated " + esc(d.as_of) + (d.live_as_of ? "; live read " + esc(d.live_as_of) : "; live read unavailable") + ". The verdict compares the older half of scored decisions with the newer half and says insufficient until enough are scored. A code path that makes a decision without a declared metric fails the build (<code>python3 -m foundation decisions --check</code>).</p>");
}
// GOALS-1: what the system works toward, the knobs it may turn, what it changed and whether each loop closed. Read live from the tick Worker (/api/goals).
async function goalsData(env) {
  try { if (env && env.TICK) { const r = await env.TICK.fetch(new Request("https://tick.internal/api/goals")); if (r.ok) return await r.json(); } } catch (e) { console.error("goals", e && e.message); }
  return null;
}
function goalsPage(d) {
  if (!d) return shell({ path: "/goals", title: "Goals - Ultrastable", description: "The goals Ultrastable works toward, its knobs and its loops." }, "<div class=\"head\"><h1>Goals</h1><p>The live goal data could not be read just now. The system retries on its next request; machine-readable: <a href=\"/api/goals\">/api/goals</a>.</p></div>");
  const f = function (v) { return v == null ? "no reading" : (Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 1000) / 1000); };
  const spark = function (a) { if (!a || a.length < 2) return ""; const lo = Math.min.apply(null, a), hi = Math.max.apply(null, a), w = 90, h = 22; const pts = a.map(function (y, i) { return Math.round(i * w / (a.length - 1)) + "," + Math.round(h - 2 - (hi === lo ? 0.5 : (y - lo) / (hi - lo)) * (h - 4)); }).join(" "); return "<svg width=\"" + w + "\" height=\"" + h + "\" viewBox=\"0 0 " + w + " " + h + "\" role=\"img\" aria-label=\"last " + a.length + " readings\"><polyline points=\"" + pts + "\" fill=\"none\" stroke=\"var(--ds-accent)\" stroke-width=\"2\"/></svg>"; };
  const kn = d.knobs || [], byGoal = {};
  kn.forEach(function (k) { (byGoal[k.goal_id] = byGoal[k.goal_id] || []).push(k); });
  const kview = function (k) { return "<li><code>" + esc(k.id) + "</code> = <strong>" + esc(f(k.value)) + "</strong> (bounds " + esc(k.min) + " to " + esc(k.max) + ", step " + esc(k.step) + ", default " + esc(k.default) + (k.resting_until ? ", resting until " + esc(k.resting_until.slice(0, 16)) : "") + ")" + (k.what ? "<br><small>" + esc(k.what) + "</small>" : "") + "</li>"; };
  const goals = d.goals || [], kids = function (id) { return goals.filter(function (g) { return g.parent_id === id; }); };
  const row = function (g, depth) {
    if (g.level !== "target") return "<tr><td style=\"padding-left:" + (depth * 16) + "px\"><strong>" + esc(g.level) + "</strong>: " + esc(g.statement) + "<br><small><code>" + esc(g.id) + "</code>" + (g.tenant !== "core" ? " (tenant " + esc(g.tenant) + ")" : "") + "</small></td><td colspan=\"4\"></td></tr>";
    const tone = g.value == null ? "warn" : g.met ? "ok" : "warn";
    return "<tr><td style=\"padding-left:" + (depth * 16) + "px\">" + esc(g.statement) + "<br><small><code>" + esc(g.id) + "</code>" + (g.tenant !== "core" ? " (tenant " + esc(g.tenant) + ")" : "") + (g.origin === "system" ? ", set by the system" : "") + (g.deadline ? ", by " + esc(g.deadline) : "") + "</small></td>"
      + "<td class=\"" + tone + "\"><strong>" + esc(f(g.value)) + "</strong> " + esc(g.unit || "") + "<br><small>" + (g.value == null ? "not reported yet" : g.met ? "target met" : "off target") + "</small></td>"
      + "<td><code>" + esc(g.op) + " " + esc(g.target) + "</code></td><td>" + spark(g.spark) + "<br><small>" + esc(g.trend) + (g.error_budget ? "; error budget " + esc(g.error_budget.state) + (g.error_budget.budget_remaining != null ? " (" + Math.round(g.error_budget.budget_remaining * 100) + "% left)" : "") : "") + "</small></td>"
      + "<td>" + ((byGoal[g.id] || []).length ? "<ul>" + byGoal[g.id].map(kview).join("") + "</ul>" : "<small>no knob; an unmet goal files a backlog item</small>") + "</td></tr>";
  };
  const tree = function (parent, depth) { return goals.filter(function (g) { return (g.parent_id || null) === parent; }).map(function (g) { return row(g, depth) + tree(g.id, depth + 1); }).join(""); };
  const ids = new Set(goals.map(function (g) { return g.id; }));
  const roots = goals.filter(function (g) { return g.parent_id && !ids.has(g.parent_id); }).map(function (g) { return row(g, 0) + tree(g.id, 1); }).join("");
  const adj = (d.adjustments || []).map(function (a) { return "<tr><td><small>" + esc(a.at.slice(0, 16).replace("T", " ")) + "</small></td><td><code>" + esc(a.knob) + "</code> " + esc(a.old) + " to " + esc(a.new) + "</td><td><small>" + esc(a.why) + "<br>Predicted: " + esc(a.prediction) + "</small></td><td class=\"" + (a.verdict === "kept" ? "ok" : a.verdict === "reverted" ? "warn" : "info") + "\">" + esc(a.verdict) + (a.measured != null ? "<br><small>" + esc(f(a.baseline)) + " to " + esc(f(a.measured)) + "</small>" : "") + "</td></tr>"; }).join("");
  const loops = (d.loops || []).map(function (l) { return "<tr><td><code>" + esc(l.loop) + "</code></td><td>" + l.runs_24h + "</td><td>" + l.ok_runs_24h + "</td><td>" + l.acted_24h + "</td><td class=\"" + (l.closed === "closing" ? "ok" : "warn") + "\">" + esc(l.closed) + "</td></tr>"; }).join("");
  return shell({ path: "/goals", title: "Goals - Ultrastable", description: "What Ultrastable works toward: every goal with its value against its target, the knobs the system may turn, what it changed, and whether each loop closed." },
    "<div class=\"head\"><h1>Goals</h1><p>A system that improves itself has to know what it is working toward. Each target below has a metric, a number and the knobs the system may turn within safe bounds. Each tick it measures, moves at most one knob one step, checks a day later whether the goal moved and reverts the change if it did not, and writes every step to the hash-chained audit log. Tenants such as Practical Solutions register their own goals through the same interface. Machine-readable: <a href=\"/api/goals\">/api/goals</a>.</p></div>"
    + "<h2>Goals and knobs</h2><div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Goal</th><th>Now</th><th>Target</th><th>Trend</th><th>Knobs</th></tr></thead><tbody>" + (tree(null, 0) + roots) + "</tbody></table></div>"
    + "<h2>Recent knob changes</h2>" + (adj ? "<div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>When (UTC)</th><th>Change</th><th>Why and prediction</th><th>Verdict</th></tr></thead><tbody>" + adj + "</tbody></table></div>" : "<p>No knob has been turned yet. A knob moves only when its goal is off target and its cooldown has passed.</p>")
    + "<h2>Loops: did they close?</h2><div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Loop</th><th>Runs, 24 h</th><th>Finished ok</th><th>Returned work</th><th>State</th></tr></thead><tbody>" + loops + "</tbody></table></div>"
    + "<p class=\"meta\">Read live " + esc(d.as_of) + ". closing means finished ok in nearly all runs; degraded means some failures; not closing means none finished ok. " + esc(d.audit) + "</p>");
}
function roadmap() {
  const done = (i) => /^done/i.test(i.status), ids = Object.keys(ROAD.issues).sort();
  const rows = ids.map(function (k) { const i = ROAD.issues[k]; return "<tr id=\"" + esc(k) + "\"><td><strong>" + esc(k) + "</strong><br><small>" + esc(i.milestone) + "</small></td><td>" + esc(i.title) + "<br><small>Owner: " + esc(i.owner) + ". Trigger: " + esc(i.trigger) + "</small></td><td class=\"" + (done(i) ? "us-pass" : "us-fail") + "\">" + (done(i) ? "Done" : "Open") + "</td><td><small><code>" + esc(i.done) + "</code></small></td></tr>"; }).join("");
  return shell({ path: "/roadmap", title: "Roadmap - Ultrastable", description: "Every status pin and known gap on this site, tied to a tracked item with an owner, a trigger and a closing probe." },
    "<div class=\"head\"><h1>Roadmap</h1><p>Each item here backs a claim on this site. It has an owner, a trigger and a closing probe the system runs; an item closes only when its probe passes. Machine-readable: <a href=\"/roadmap.json\">roadmap.json</a>. The whole work queue, one issue per item, is mirrored onto GitHub: <a href=\"https://github.com/ultrastable/ultrastable/issues?q=is%3Aissue+is%3Aopen+label%3Aqueue\">open items</a>, <a href=\"https://github.com/ultrastable/ultrastable/milestones\">milestones</a> and the <a href=\"https://github.com/orgs/ultrastable/projects/1\">project board</a>.</p></div>"
    + "<div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Item</th><th>What</th><th>State</th><th>Closing probe</th></tr></thead><tbody>" + rows + "</tbody></table></div>" + spinRoadmap());
}
async function dashboard(tenantId) {
  const T = DASH.tenants[tenantId];
  if (!T) return null;
  const panels = T.panels.map(function (p) {
    const rows = p.rows.map(function (r) { return "<tr><td>" + esc(r[0]) + "</td><td><small>" + esc(r[1]) + "</small></td></tr>"; }).join("");
    return "<div class=\"card\" id=\"panel-" + esc(p.id) + "\"><h3 class=\"card-title\">" + esc(p.title) + "</h3><p><strong>" + esc(p.headline) + "</strong></p><div class=\"us-wrap\"><table class=\"us-table\"><tbody>" + rows + "</tbody></table></div><p class=\"meta\">" + esc(p.note) + " Source: <code>" + esc(p.source) + "</code></p></div>";
  }).join("");
  const lf = T.live_feed;
  const probes = lf.available ? await Promise.all(lf.runtimes.map(async function (r) {
    try { const res = await fetch(r.health, { signal: AbortSignal.timeout(3000), headers: { accept: "application/json" } }); const j = await res.json(); const t = j.last_tick; return { r: r, ok: !!j.ok, tick: t ? ("tick " + t.id + " at " + t.finished_at + " (" + t.steps_completed + "/" + t.steps_total + " steps)") : "no tick yet" }; }
    catch (e) { return { r: r, ok: false, tick: "unreachable" }; }
  })) : [];
  const liveRows = probes.map(function (p) { return "<tr><td>" + esc(p.r.tenant) + " <small>(level " + p.r.level + (p.r.parent ? ", reports to " + esc(p.r.parent) : "") + ")</small></td><td class=\"" + (p.ok ? "us-pass" : "us-fail") + "\">" + (p.ok ? "healthy" : "not healthy") + "</td><td><small>" + esc(p.tick) + "</small></td></tr>"; }).join("");
  const pm = DASH.pilot;
  const opts = pm.options.map(function (o) { return "<tr><td><strong>" + esc(o.id) + "</strong></td><td><small>" + esc(o.runs_on) + "</small></td><td><small>" + esc(o.revenue) + "</small></td><td><small>" + esc(o.status) + "</small></td></tr>"; }).join("");
  return shell({ path: "/dashboard", title: "Ultrastable dashboard preview", description: "What the control plane looks like: loops, objectives and metrics, failure modes, capabilities, roadmap and earned autonomy, computed from the repository." },
    "<div class=\"head\"><h1>Dashboard preview</h1><p>This is the control plane Ultrastable runs on itself, computed from its own repository (tenant <code>" + esc(tenantId) + "</code>, level " + T.level + ", commit <code>" + esc(DASH.asof) + "</code>). No customer data is shown or held here: a pilot runs in your own account.</p></div>"
    + "<div class=\"us-grid c2\">" + panels + "</div>"
    + "<h2 id=\"live\">Live feed</h2><p>" + esc(lf.says) + "</p>" + (liveRows ? "<div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Runtime</th><th>Status</th><th>Last tick</th></tr></thead><tbody>" + liveRows + "</tbody></table></div>" : "<p class=\"meta\">No runtime is recorded yet. Tracked by <a href=\"/roadmap#" + esc(lf.tracked_by) + "\">" + esc(lf.tracked_by) + "</a>.</p>")
    + "<h2 id=\"pilot\">Pilot model</h2><p>" + esc(pm.why) + "</p><div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th>Option</th><th>Runs on</th><th>Revenue (hypothesis)</th><th>Status</th></tr></thead><tbody>" + opts + "</tbody></table></div>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Join the pilot</a><a class=\"btn\" href=\"/roadmap\">See the roadmap</a><a class=\"btn\" href=\"/engineers\">For engineers</a></div>");
}
function contact() {
  return shell({ path: "/contact", title: "Contact Ultrastable", description: "How to reach the Ultrastable team about pilots, partnerships and press." },
    "<div class=\"head\"><h1>Contact</h1><p>One address; a person replies within two working days.</p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">Pilots, partnerships and press</h3><p class=\"meta\"><a href=\"mailto:" + PILOT_MAIL + "\">" + PILOT_MAIL + "</a></p></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">Online</h3><p class=\"meta\">ultrastable.io. The source is open; the Ultrastable License governs use.</p></div>"
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Join the pilot</a></div>");
}

const ROBOTS = robots(CONTENT_SIGNAL, "https://" + CANON + "/sitemap.xml");  // AGENT-READY-2: explicit AI-bot groups, same policy as Content-Signal
const LLMS = "# Ultrastable\n\n> Ultrastable is the foundation for any autonomous system. It is a self-governing development platform: a control loop around coding agents that finds its own work in metrics and failures, hands tasks to the agent that fits, proves each change live with automatic revert, and scores its decisions against logged predictions. Ultrastable runs on itself. Its earlier testbed and a second system, Practical Solutions, are described under test cases.\n\n- [Connect your agent](https://ultrastable.io/connect-agent): one click for VS Code, Cursor, Claude, Codex\n- [Live proof](https://" + CANON + "/live): changes the system shipped, from its own records\n- [Changelog feed](https://" + CANON + "/changelog.xml): merged changes by day, size and origin, as RSS; the same data as JSON at /changelog.json\n- [Research](https://" + CANON + "/research): white papers testing outside studies and common beliefs about AI systems against this system's own records; JSON at /api/research, Atom at /research.atom\n- [Progress](https://" + CANON + "/progress): what every system shipped today, this week and this month; Atom at /progress.atom, JSON at /progress.json\n- [Left alone, it builds](https://" + CANON + "/left-alone): the argued case that an unattended system ships useful work, with a live ledger; JSON at /left-alone.json\n- [How it works](https://" + CANON + "/how)\n- [Pilot](https://" + CANON + "/pilot)\n\n\n## Control-plane API (live)\n\n- [API index](https://ultrastable.io/api/v1): status, agents, work (on_deck, in_progress, blocked, done), activity, products, companion brief; OpenAPI at /openapi.json\n- [Operations dashboard](https://dashboard.ultrastable.io/): the same data as a page, refreshed every 30 seconds\n- [A2A agent card](https://ultrastable.io/.well-known/agent-card.json), [API catalog](https://ultrastable.io/.well-known/api-catalog), MCP at /connect-agent (one-click add to VS Code, Cursor, Claude, Codex; no tokens), /mcp (" + [...LIVE_TOOLS, ...TOOLS, ...WRITE_TOOLS].length + " tools, generated from the code that serves them: " + [...LIVE_TOOLS, ...TOOLS, ...WRITE_TOOLS].map(function (t) { return t.name; }).join(", ") + ")\n- [Verified claims](https://" + CANON + "/claims): every statement on this site bound to a probe, checked on every change and daily against live\n- POST /api/v1/intake submits a backlog item with an integration bearer token\n";

const FAVICON = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\" role=\"img\" aria-label=\"ultrastable\"><title>ultrastable</title><path d=\"M30 12 L54 56 H6 Z\" fill=\"#FF5B1F\" stroke=\"#FF5B1F\" stroke-width=\"4\" stroke-linejoin=\"round\"/><circle cx=\"50\" cy=\"14\" r=\"6\" fill=\"#FFC857\"/></svg>";
const SOCIAL = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 1280 640\" width=\"1280\" height=\"640\"><title>ultrastable</title><defs><linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#12342A\"/><stop offset=\"1\" stop-color=\"#0B1A15\"/></linearGradient></defs><rect width=\"1280\" height=\"640\" fill=\"url(#g)\"/><g transform=\"translate(96 96) scale(2)\"><path d=\"M30 12 L54 56 H6 Z\" fill=\"#FF5B1F\" stroke=\"#FF5B1F\" stroke-width=\"4\" stroke-linejoin=\"round\"/><circle cx=\"50\" cy=\"14\" r=\"6\" fill=\"#FFC857\"/></g><text x=\"96\" y=\"340\" font-family=\"Fraunces,Georgia,'Times New Roman',serif\" font-size=\"76\" font-weight=\"700\" letter-spacing=\"-2\" fill=\"#F6F1E7\">Coding agents write code.</text><text x=\"96\" y=\"430\" font-family=\"Fraunces,Georgia,'Times New Roman',serif\" font-size=\"76\" font-weight=\"700\" letter-spacing=\"-2\" fill=\"#FF5B1F\">Ultrastable runs the system.</text><text x=\"96\" y=\"530\" font-family=\"Georgia,serif\" font-size=\"32\" fill=\"#C9D4CC\">From one idea to a business that improves itself.</text><text x=\"1184\" y=\"590\" text-anchor=\"end\" font-family=\"Georgia,serif\" font-size=\"28\" fill=\"#FFC857\">ultrastable.io</text></svg>";
async function png(env, key) { const a = env && env.ASSETS ? await env.ASSETS.get(key, "arrayBuffer") : null; if (!a) return new Response("Not found", { status: 404 }); return new Response(a, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" } }); }
const SVG = { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" };

const HTML = { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Content-Type-Options": "nosniff" };

// META-SIGNAL-1: record a microphone event code or transcript text for the meta loop (doctrine/meta-loop.json); the tick drains it through foundation/metasignal.py detectors.
const META_PER_IP_HOUR = 20, META_PER_DAY = 200; // caps on public meta-signal writes
const META_CODES = ["not-allowed", "service-not-allowed", "no-speech", "network", "audio-capture", "unsupported", "busy", "edited-after-dictation", "abandoned"];
async function metaIngest(request, env) {
  let b; try { b = JSON.parse((await request.text()).slice(0, 4000)); } catch (e) { return Response.json({ ok: false, code: "bad_json" }, { status: 400 }); }
  const rec = { source: String(b.source || "chat").slice(0, 24), at: new Date().toISOString() };
  if (b.source === "mic-event") { if (!META_CODES.includes(b.code)) return Response.json({ ok: false, code: "unknown_code" }, { status: 422 }); rec.code = b.code; rec.surface = String(b.surface || "site").slice(0, 24); }
  else if (typeof b.text === "string" && b.text.trim()) rec.text = b.text.slice(0, 2000);
  else return Response.json({ ok: false, code: "empty" }, { status: 422 });
  { // BLINDSPOT-1 security sweep 2026-11-20: this endpoint is public and writes to KV, so one client or a flood cannot use up the day's writes. No write happens once a cap is reached.
    const ip = request.headers.get("cf-connecting-ip") || "x", k1 = "rlm:" + ip + ":" + rec.at.slice(0, 13), k2 = "rlm:day:" + rec.at.slice(0, 10);
    try { // SMOKE-LIVE-1: production returned a bare 500 for every valid event; a storage failure is now a plain 503 the smoke test can tell from a bug
      const [a, d] = await Promise.all([env.ASSETS.get(k1), env.ASSETS.get(k2)]);
      if (Number(a || 0) >= META_PER_IP_HOUR || Number(d || 0) >= META_PER_DAY) return Response.json({ ok: false, code: "rate_limited" }, { status: 429, headers: { "Retry-After": "3600" } });
      await Promise.all([env.ASSETS.put(k1, String(Number(a || 0) + 1), { expirationTtl: 7200 }), env.ASSETS.put(k2, String(Number(d || 0) + 1), { expirationTtl: 172800 })]);
    } catch (e) { console.error("meta-ingest storage", String(e && e.message || e).slice(0, 120)); return Response.json({ ok: false, code: "storage_unavailable", message: "Saved nothing this time; the system retries on its own." }, { status: 503, headers: { "Retry-After": "600" } }); }
  }
  try { await env.ASSETS.put("meta:" + rec.at + ":" + newId(), JSON.stringify(rec), { expirationTtl: 31536000 }); } catch (e) { console.error("meta-ingest storage", String(e && e.message || e).slice(0, 120)); return Response.json({ ok: false, code: "storage_unavailable", message: "Saved nothing this time; the system retries on its own." }, { status: 503, headers: { "Retry-After": "600" } }); }
  return Response.json({ ok: true });
}

// LLMS-FULL-1 and OPENSEARCH-1: the text of every public page, rendered by this same handler (so it is the page, not a copy of it), read once an
// hour per isolate. /llms-full.txt serves it to agents in one fetch; /search matches it for people and browsers (described at /opensearch.xml).
const FULL_PATHS = ["/", "/how", "/product", "/for", "/showcase", "/engineers", "/roadmap", "/decisions", "/goals", "/org", "/claims", "/team", "/faq", "/pilot", "/start", "/privacy", "/accessibility", "/contact"];
let PAGE_TEXT = null;
export function pageText(html) {
  const h = String(html), t = /<title>([^<]*)<\/title>/i.exec(h), m = /<main[^>]*>([\s\S]*?)<\/main>/i.exec(h);
  const txt = (m ? m[1] : h).replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|li|h[1-6]|tr|div)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .split("\n").map(l => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
  return { title: t ? t[1].replace(/&amp;/g, "&").trim() : "", text: txt };
}
async function pageTexts(env, ctx) {
  if (PAGE_TEXT && Date.now() - PAGE_TEXT.at < 3600e3) return PAGE_TEXT.pages;
  const pages = [];
  for (const p of FULL_PATHS) {
    try {  // the user agent marks this as a bot, so the analytics collector skips these internal renders
      const r = await handler.fetch(new Request("https://" + CANON + p, { headers: { "user-agent": "ultrastable-pagetext/1 (bot)" } }), env, ctx);
      if (r.ok && (r.headers.get("content-type") || "").includes("text/html")) pages.push({ path: p, ...pageText(await r.text()) });
    } catch (e) { console.error("pagetext", p, String(e)); }
  }
  PAGE_TEXT = { at: Date.now(), pages };
  return pages;
}
async function llmsFull(env, ctx) {
  const pages = await pageTexts(env, ctx);
  return LLMS + "\n\n# Full text of every public page (" + pages.length + " pages, rendered by the site Worker)\n" + pages.map(function (p) { return "\n\n## " + (p.title || p.path) + "\n\nURL: https://" + CANON + p.path + "\n\n" + p.text; }).join("");
}
const OPENSEARCH = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><OpenSearchDescription xmlns=\"http://a9.com/-/spec/opensearch/1.1/\"><ShortName>Ultrastable</ShortName><Description>Search the Ultrastable site</Description><InputEncoding>UTF-8</InputEncoding><Image width=\"16\" height=\"16\" type=\"image/svg+xml\">https://" + CANON + "/favicon.svg</Image><Url type=\"text/html\" method=\"get\" template=\"https://" + CANON + "/search?q={searchTerms}\"/></OpenSearchDescription>";
export function searchPages(pages, q) {
  const words = String(q).toLowerCase().split(/\s+/).filter(w => w.length > 1).slice(0, 8);
  if (!words.length) return [];
  return pages.map(function (p) {
    const hay = (p.title + "\n" + p.text).toLowerCase(); let score = 0;
    for (const w of words) { let i = -1, n = 0; while ((i = hay.indexOf(w, i + 1)) !== -1 && n < 50) n++; if (!n) return null; score += n + (p.title.toLowerCase().includes(w) ? 10 : 0); }
    const at = hay.indexOf(words[0]), from = Math.max(0, at - 80);
    return { path: p.path, title: p.title, score, snippet: (from ? "... " : "") + (p.title + "\n" + p.text).slice(from, from + 220).replace(/\n/g, " ") + " ..." };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
}
async function searchPage(env, ctx, q) {
  q = String(q).slice(0, 120);
  const hits = q ? searchPages(await pageTexts(env, ctx), q) : [];
  const form = "<form action=\"/search\" method=\"get\" role=\"search\" class=\"card\"><label for=\"sq\">Search this site</label><br><input id=\"sq\" name=\"q\" type=\"search\" value=\"" + esc(q) + "\" class=\"us-q\"><button class=\"btn\" type=\"submit\">Search</button></form>";
  const list = !q ? "" : hits.length ? "<p>" + hits.length + " page" + (hits.length === 1 ? "" : "s") + " match.</p>" + hits.map(function (h) { return "<div class=\"card\"><a href=\"" + esc(h.path) + "\"><strong>" + esc(h.title || h.path) + "</strong></a><p class=\"meta\">" + esc(h.snippet) + "</p></div>"; }).join("") : "<p>No page matches that. Try fewer words.</p>";
  return shell({ path: "/search", title: "Search - Ultrastable", description: "Search every public page of the Ultrastable site." }, "<div class=\"head\"><h1>Search</h1></div>" + form + list);
}

const handler = {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    const host = u.hostname.replace(/^www\./, "");
    if (u.pathname === "/health") { const lt = env && env.ASSETS ? await jget(env, "tick:last").catch(() => null) : null; return Response.json({ ok: true, worker: "ultrastable-site", version: VERSION, watchdog: lt && lt.watchdog ? { ...lt.watchdog, at: lt.at } : null }); } /* LOOPPROOF-1: the second producer's last reading of the org heartbeat */
    if (u.pathname === "/favicon.svg") return new Response(FAVICON, { headers: SVG });
    if (u.pathname === "/social-card.png") return png(env, "social-card.png");
    if (u.pathname === "/apple-touch-icon.png") return png(env, "apple-touch-icon.png");
    if (u.pathname === "/social-card.svg") return new Response(SOCIAL, { headers: SVG });
    if (u.hostname === "dashboard." + CANON) { // CONTROL-PLANE-1: the operations dashboard host serves /ops at its root and the API beside it
      const cp = await controlPlane(request, env, ctx); if (cp) return cp;
      if (u.pathname === "/" || u.pathname === "/ops") return new Response(opsPage(shell), { headers: { ...HTML, "Cache-Control": "no-store" } });
      return Response.redirect("https://" + CANON + u.pathname + u.search, 302); }
    { const sm = SUBHOST.exec(u.hostname); if (sm) {
      if (u.pathname === "/.well-known/api-catalog") { const d = tenantDiscovery(sm[1]); return new Response(JSON.stringify({ linkset: [{ anchor: d.discovery.api, "service-doc": [{ href: "https://" + CANON + "/api/v1/products", type: "application/json" }], status: [{ href: d.health, type: "application/json" }] }] }), { headers: { "content-type": "application/linkset+json", "access-control-allow-origin": "*" } }); } // BUILD-2: <id>.ultrastable.io serves that site at / and its API at /s/<id>/api (same origin)
      if (u.pathname === "/") { const q = new URL(request.url); q.pathname = "/s/" + sm[1]; return (await siteRoutes(q, env, ctx, request)) || new Response("Not found", { status: 404 }); }
      if (u.pathname.startsWith("/s/" + sm[1] + "/api")) return siteRoutes(u, env, ctx, request);
      return Response.redirect("https://" + CANON + u.pathname, 302); } }
    if (!OUR_HOSTS.test(u.hostname) && env && env.ASSETS) { // OWN-DOMAIN-1: a host that is not ours is served only when attachDomain stored it as proven
      const dm = await jget(env, "domain:" + u.hostname.toLowerCase()).catch(() => null);
      if (dm && okId(dm.id)) {
        if (u.pathname === "/") { const q = new URL(request.url); q.pathname = "/s/" + dm.id; return (await siteRoutes(q, env, ctx, request, u.hostname)) || new Response("Not found", { status: 404 }); }
        if (u.pathname === "/s/" + dm.id + "/api") return siteRoutes(u, env, ctx, request);
        return Response.redirect("https://" + u.hostname + "/", 302); } }
    if (host === "ultrastable.app") return Response.redirect("https://" + CANON + "/pilot", 301);
    if (host === "ultrastable.net") return Response.redirect("https://" + CANON + "/live", 301);
    if (u.hostname === "www." + CANON) return Response.redirect("https://" + CANON + u.pathname, 301);
    const an = env && env.DB ? await handleAnalytics(request, env, { hosts: [CANON] }) : null; if (an) return an;
    if (request.method === "POST" && u.pathname === "/api/meta/ingest") return metaIngest(request, env); // META-SIGNAL-1
    if (request.method === "GET" && u.pathname === "/api/suggest") return suggestions(u, env);
    { const cn = await connectionsRoute(request, env); if (cn) return cn; } // CONNECTIONS-1: /connections and the owner-only /connect/* consent flow
    { const md = await mydata(request, env); if (md) return md; } // PORTABILITY-2: /my-data, one click, passkey session
    { const wh = await webhooksRoute(request, env, ctx, authIntegration); if (wh) return wh; } // WEBHOOKS-1: /hooks/<provider>, /api/v1/webhooks, /api/v1/hooks
    if (u.pathname === "/agents/scoreboard") return Response.redirect("https://" + CANON + "/api/v1/agents/scoreboard", 302);  // AGENT-SCOREBOARD-1: agent_scoreboard per agent and harness (site/controlplane.js agentScoreboard)
    { const cp = await controlPlane(request, env, ctx); if (cp) return cp; } // CONTROL-PLANE-1: /api/v1
    if (u.pathname === "/feed.xml" || u.pathname === "/feed.json") { if (env && env.DB) { try { ctx.waitUntil(record(env, request, { host: CANON, path: u.pathname, ref: "", name: "feed" })); } catch (e) { console.error("feed hit", String(e && e.message)); } } return u.pathname === "/feed.xml" ? feedResponse(CANON) : jsonFeedResponse(CANON); } // REACH-1; STICKY-1: a feed request is counted server-side (name "feed", daily-rotating id, no cookie), so the number of daily feed readers is measured
    if (u.pathname === "/api/graph" || u.pathname === "/api/graph/insights") { let j = { error: "tick worker not reachable" }, st = 503; try { if (env && env.TICK) { const r = await env.TICK.fetch(new Request("https://tick.internal" + u.pathname)); j = await r.json(); st = r.status; } } catch (e) { console.error("api/graph", String(e && e.message)); } return new Response(JSON.stringify(j), { status: st, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }); } // DATAGRAPH-1: the public view of the knowledge graph of the platform's own data (counts, series, orphan findings; no record a visitor may not see)
    if (u.pathname === "/api/stickiness" || /^\/api\/stickiness\/queue\/[a-z0-9-]{1,60}\.json$/.test(u.pathname)) { let j = { error: "tick worker not reachable" }, st = 503; try { if (env && env.TICK) { const r = await env.TICK.fetch(new Request("https://tick.internal" + u.pathname)); j = await r.json(); st = r.status; } } catch (e) { console.error("api/stickiness", String(e && e.message)); } return new Response(JSON.stringify(j), { status: st, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }); } // STICKY-1: the judged content state and the social queue the core social module drains
    if (request.method === "GET" && u.pathname === "/api/growth/hits") return growthHits(env); // GROWTH-HITS-1: aggregate counts only, read by foundation/growth.py so Actions needs no Cloudflare token
    if (u.pathname === "/api/reach") { const v = await jget(env, "promote:reach"); return Response.json(v || { rows: null, error: "not measured yet" }, { status: v ? 200 : 503, headers: { "cache-control": "public, max-age=600", "access-control-allow-origin": "*" } }); } // ATTENTION-1: aggregate counts only
    { const pr = await progressRoutes(u, env, shell, HTML, CANON); if (pr) return pr; } // PROGRESS-1
    { const ys = yearRoutes(u, shell, HTML); if (ys) return ys; } // YEAR-SIM-1: /year, /year.json
    { const tr = await trendsRoutes(u, env, shell, HTML); if (tr) return tr; } // TEMPORAL-1
    { const yr = await yieldRoutes(u, env, shell, HTML); if (yr) return yr; } // INTENT-YIELD-1
    { const br = await balanceRoutes(u, env, shell, HTML); if (br) return br; } // FLOW-BALANCE-1
    { const rs = researchRoutes(u, shell, HTML); if (rs) return rs; } // RESEARCH-1: /research, /research/<id>, /api/research
    { const fm = await failMineRoutes(u, env, shell, HTML); if (fm) return fm; } // FAILMINE-1: /failures, recurrence and time to remediation
    { const fm = await failMineRoutes(u, env, shell, HTML); if (fm) return fm; } /* FAILMINE-1 */ { const yr = await yearFailRoutes(u, env, shell, HTML); if (yr) return yr; } // YEARFAIL-1: /year, the simulated year with no input
    { const la = await leftAloneRoutes(u, env, shell, HTML); if (la) return la; } // ATTENTION-1: the argued case and its live ledger
    if (u.pathname.replace(/\/$/, "") === "/proof") return Response.redirect("https://" + CANON + "/live", 301); // PROOF-OWN-1: /proof served the earlier testbed's records; deprecated
    if (u.pathname === "/customer-zero") return caseResponse(u, request, env, shell, HTML, DASH.asof_at); // CASE-STUDY-1: generated from the snapshot, every value linked to its record
    if (u.pathname === "/demo") return demoResponse(u, request, env, shell, HTML, DASH.asof_at); // DEMO-DASHBOARD-1: the live record as a dashboard
    if (u.pathname === "/live" || u.pathname === "/api/live" || u.pathname === "/api/freshness" || u.pathname === "/changelog.xml" || u.pathname === "/changelog.json") return liveResponse(u, request, env, shell, HTML, DASH.asof_at);
    if (request.method === "POST" && u.pathname === "/api/idea") return takeIdea(request, env, ctx);
    if (request.method === "POST" && u.pathname === "/api/pilot") return pilotApplication(request, env);
    if (request.method === "POST" && u.pathname === "/api/answer") return takeAnswer(request, env, ctx);
    if (request.method === "POST" && u.pathname === "/api/change") return takeChange(request, env, ctx);
    if (u.pathname.startsWith(DATA_PATH)) { const dm = /^([a-f0-9]{10})\/([A-Za-z0-9_-]{1,40})$/.exec(u.pathname.slice(DATA_PATH.length)); return dm ? siteData(request, env, dm[1], dm[2].toLowerCase()) : apiJson({ error: "use /api/data/<site>/<collection>", code: "bad_path" }, 404); } // DATA-API-1
    if (request.method === "POST" && u.pathname === "/api/domain") return domainRoute(request, env); // OWN-DOMAIN-1
    if (request.method === "POST" && u.pathname === "/api/org") return orgSetup(request, env); // ORG-THREAD-1
    { const sr = await siteRoutes(u, env, ctx, request); if (sr) return sr; }
    if (request.method === "GET" && u.pathname.replace(/\/$/, "") === "/status") return new Response(await statusPage(env), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method not allowed", { status: 405 });
    const PAGES = ["/", "/engineers", "/dashboard", "/roadmap", "/decisions", "/goals", "/org", "/how", "/showcase", "/for", "/claims", "/product", "/team", "/faq", "/contact", "/pilot", "/start", "/setup", "/ops", "/privacy", "/accessibility"], pth = u.pathname.replace(/\/$/, "") || "/";
    if (env && env.DB && request.method === "GET" && (PAGES.includes(pth) || /^\/(for|showcase)\/[a-z0-9-]+$/.test(pth))) { /* UIUX-1: audience and case pages are path steps, so they are counted too */ const w = record(env, request, { host: CANON, path: pth, ref: request.headers.get("referer") }).catch(e => console.error("analytics", e && e.message)); if (ctx && ctx.waitUntil) ctx.waitUntil(w); }
    { const m = /^\/(for|showcase)\/([a-z0-9-]+)\/?$/.exec(u.pathname); if (m) { const h = m[1] === "for" ? forAudience(m[2]) : showcaseCase(m[2]); if (h) return new Response(h, { headers: HTML }); } }
    switch (u.pathname.replace(/\/$/, "") || "/") {
      case "/": { // UIUX-1: the running experiment on this step picks the wording; exposure is one first-party event, bots and Do Not Track are served the control and not counted
        const ux = await experimentFor(request, env, "/");
        if (ux && ux.record && env && env.DB) { const w = record(env, request, { host: CANON, path: "/", ref: request.headers.get("referer"), name: exposureName(ux) }).catch(e => console.error("analytics", e && e.message)); if (ctx && ctx.waitUntil) ctx.waitUntil(w); }
        return new Response(home(ux), { headers: ux ? { ...HTML, "Cache-Control": "private, no-cache", "X-Experiment": ux.id + ":" + ux.arm } : HTML }); }
      case "/how": return new Response(how(), { headers: HTML });
      case "/verification": return new Response(shell({ path: "/verification", title: "Verified invariants - Ultrastable", description: "Guarantees model-checked and tied to the deployed code" }, verificationBody()), { headers: HTML });
      case "/api/verification": return new Response(JSON.stringify(verificationJson()), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
      case "/showcase": return new Response(showcase(), { headers: HTML });
      case "/directory": return new Response(directoryPage(await directoryListing(env)), { headers: HTML });  // DISCOVER-1
      case "/directory.json": return Response.json(await directoryListing(env), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
      case "/api/directory/register": if (request.method === "POST") return registerDirectory(request, env, fetch); return Response.json({ ok: false, error: "use_post" }, { status: 405 });
      case "/family.json": return new Response(JSON.stringify({ family: SH.domains, nav: [["Find your path", "/for"], ["Test cases", "/showcase"], ["Product", "/product"], ["How it works", "/how"], ["Live proof", "/live"], ["Research", "/research"], ["Contact", "/contact"]], tokens: { accent_light: "#b83800", accent_dark: "#ff7f4d", base: "https://" + CANON + "/" } }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
      case "/for": return new Response(forIndex(), { headers: HTML });
      case "/claims": return new Response(claimsPage(), { headers: HTML });
      case "/changelog": case "/api/changelog": if (u.hostname === "dashboard.ultrastable.io") return new Response("changelog unavailable", { status: 503, headers: { "retry-after": "60" } }); /* CHANGELOG-LOOP-1: this host is served by this worker, so a redirect to itself looped; OWNER_PATH forwards to the dashboard worker first */ return Response.redirect("https://dashboard.ultrastable.io" + pth + u.search, 302); // PROVENANCE-1: the public changelog is served by the dashboard worker
      case "/self": case "/.well-known/ultrastable": return new Response(JSON.stringify(SELF, null, 1), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300", "Link": "</self>; rel=\"describedby\"" } });
      case "/api/claims": return new Response(JSON.stringify(VERIFIED), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
      case "/product": return new Response(product(), { headers: HTML });
      case "/team": return new Response(team(), { headers: HTML });
      case "/org": return new Response(org(), { headers: HTML });
      case "/engineers": return new Response(engineers(), { headers: HTML });
      case "/roadmap": return new Response(roadmap(), { headers: HTML });
      case "/goals": return new Response(goalsPage(await goalsData(env)), { headers: { ...HTML, "Cache-Control": "public, max-age=60" } });
      case "/api/goals": { const g = await goalsData(env); return new Response(JSON.stringify(g || { error: "goals unavailable" }), { status: g ? 200 : 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" } }); }
      case "/decisions": return new Response(decisionsPage(await decisionsData(env)), { headers: { ...HTML, "Cache-Control": "public, max-age=60" } });
      case "/api/v1/ignition": return ignitionResponse(env);  // Q-CRIT-PUBLIC-STAGE
      case "/api/spend": { let j = { error: "tick worker not reachable" }, st = 503; try { if (env && env.TICK) { const r = await env.TICK.fetch(new Request("https://tick.internal/api/spend" + u.search)); j = await r.json(); st = r.status; } } catch (e) { console.error("api/spend", String(e && e.message)); } return new Response(JSON.stringify(j), { status: st, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" } }); }  // SPEND-SOFT-1: today's estimated bill, throttle level and knobs
      case "/api/roi": { let j = { error: "tick worker not reachable" }, st = 503; try { if (env && env.TICK) { const r = await env.TICK.fetch(new Request("https://tick.internal/api/roi")); j = await r.json(); st = r.status; } } catch (e) { /* reported as 503 */ } return new Response(JSON.stringify(j), { status: st, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } }); }  // ROI-1
      case "/api/decisions": return new Response(JSON.stringify(await decisionsData(env)), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" } });
      case "/ops": return new Response(opsPage(shell), { headers: { ...HTML, "Cache-Control": "no-store" } });
      case "/dashboard": { const t = u.searchParams.get("tenant") || "ultrastable"; const h = await dashboard(t); return h ? new Response(h, { headers: HTML }) : new Response("No such tenant", { status: 404, headers: HTML }); }
      case "/roadmap.json": return new Response(JSON.stringify({ ...ROAD, spinoffs: SPIN }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
      case "/faq": return new Response(faq(), { headers: HTML });
      case "/privacy": return new Response(shell({ path: "/privacy", title: "Privacy - Ultrastable", description: "What this site records and what it does not." }, PRIVACY), { headers: HTML });
      case "/accessibility": return new Response(shell({ path: "/accessibility", title: "Accessibility - Ultrastable", description: "What we build to and how to report a barrier." }, ACCESSIBILITY), { headers: HTML });
      case "/.well-known/security.txt": return new Response(SECURITY_TXT, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
      case "/contact": return new Response(contact(), { headers: HTML });
      case "/pilot": return new Response(pilot(), { headers: HTML });
      case "/start": return new Response(start(false), { headers: HTML });
      case "/setup": return new Response(setup(), { headers: HTML });
      case "/deploy.md": return new Response(BRIEF.all, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
      case "/deploy/cloudflare.md": case "/deploy/gcp.md": case "/deploy/aws.md": case "/deploy/azure.md": return new Response(BRIEF[pth.slice(8, -3)], { headers: { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
      case "/agent.md": return new Response(AGENT_MD, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Access-Control-Allow-Origin": "*" } });
      case "/robots.txt": return new Response(ROBOTS, { headers: { "Content-Type": "text/plain" } });
      case "/connect-agent": return new Response(connectAgentPage(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
      case "/llms.txt": return new Response(LLMS, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      case "/llms-full.txt": return new Response(await llmsFull(env, ctx), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600", "Access-Control-Allow-Origin": "*" } });  // LLMS-FULL-1
      case "/opensearch.xml": return new Response(OPENSEARCH, { headers: { "Content-Type": "application/opensearchdescription+xml; charset=utf-8", "Cache-Control": "public, max-age=86400" } });  // OPENSEARCH-1
      case "/search": return new Response(await searchPage(env, ctx, u.searchParams.get("q") || ""), { headers: { ...HTML, "Cache-Control": "public, max-age=300", "X-Robots-Tag": "noindex" } });  // OPENSEARCH-1
      case "/sitemap.xml": return new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" + SITEMAP_PATHS.map(function (p) { return "<url><loc>https://" + CANON + p + "</loc></url>"; }).join("") + "</urlset>", { headers: { "Content-Type": "application/xml" } });
      default: return new Response(shell({ path: u.pathname, title: "Not found - Ultrastable", description: "Page not found." }, "<div class=\"head\"><h1>Not found</h1><p>That page does not exist. <a href=\"/\">Go to the home page</a>.</p></div>"), { status: 404, headers: HTML });
    }
  }
};
// AGENTIC-1: machine-readable discovery and a read-only MCP endpoint in front of every page.
// TOPOLOGY-1: the owner dashboard is a separate worker reached through the OWNER service binding (doctrine/topology.json); only its own paths are forwarded.
const OWNER_PATH = /^\/(owner|changelog|api\/changelog|api\/owner\/[a-z-]+(\/callback)?|connect\/github-signin|auth\/github-signin\/callback)$/;  // OWNER-IDENTITY-1: GitHub sign-in and its one-click app registration live on the dashboard
const AUTH_PATH = /^\/(connect(\/[a-z-]+)?|auth\/(github(-admin)?\/(callback|installed)|health)|hook\/(github|host))$/;  // HOSTS-1: the signed repo and host webhooks reach the tick Worker through the same forward
//  // AUTH-1: the consent screen and provider callbacks live on the tick Worker; the public host forwards them so the person stays on one address
// ACCOUNT-SPLIT-2: once the ultrastable account is primary, the old account's site forwards every request there (secret UPSTREAM_ORIGIN, set by
// the promoting tick) and runs no cron. The custom domains stay on the old account's zones until the zones move.
// FREE-TIER-1: a GitHub delivery the tick does not act on is answered here, before any forward. Each forwarded delivery is one more Worker request on
// every hop (old account's site, this site, the tick); workflow_run, check_run, workflow_job and status deliveries were about 130 a minute on 2026-11-18.
export const HOOK_EVENTS_FORWARDED = ["push", "pull_request", "issues", "issue_comment", "release", "ping"];
export function hookEventFilter(request) {
  if (request.method !== "POST" || new URL(request.url).pathname !== "/hook/github") return null;
  const ev = request.headers.get("x-github-event") || "";
  return HOOK_EVENTS_FORWARDED.includes(ev) ? null : new Response(JSON.stringify({ routed: false, ignored: ev || "none" }), { status: 202, headers: { "content-type": "application/json" } });
}
export function forwardTo(request, upstream) {
  const u = new URL(request.url), t = new URL(upstream);
  if (t.host === u.host) return null;
  const h = new Headers(request.headers); h.set("x-forwarded-host", u.host); h.set("x-forwarded-proto", "https");
  return fetch(new Request(new URL(u.pathname + u.search, t), { method: request.method, headers: h, body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body, redirect: "manual" }));
}
const entry = { async scheduled(event, env, ctx) { if (env && env.UPSTREAM_ORIGIN) return; if (halted(null, env)) return; /* HALT-1 */ env = budgetEnv(env, SHARES.site); ctx.waitUntil(tick(env, ctx).catch(e => console.error("tick failed", String(e)))); }, async fetch(request, env, ctx) { { const dropped = hookEventFilter(request); if (dropped) return dropped; } /* FREE-TIER-1 */ if (env && env.UPSTREAM_ORIGIN) { const fw = forwardTo(request, env.UPSTREAM_ORIGIN); if (fw) return fw; } env = budgetEnv(env, SHARES.site); { const idp = await internalDeploy(request, env || {}); if (idp) return idp; } /* HANDOFF-1 */ if (request.method === "POST" && new URL(request.url).pathname === "/pulse/watch") { const w = await watchTick(env); return Response.json({ ok: w.status === "ok", via: "ultrastable-site", ...w }, { status: w.status === "ok" ? 200 : 503 }); } /* SINGLE-ACCOUNT-1: the second, independent restart route for the tick, inside the ultrastable account */ /* OWNER-ROUTE-1: owner paths are tested before AUTH_PATH, because /connect/github-signin also matches /connect/<provider> and would land on the tick Worker's placeholder */ if (env && env.OWNER && OWNER_PATH.test(new URL(request.url).pathname.replace(/\/$/, ""))) return env.OWNER.fetch(request); if (env && env.TICK && AUTH_PATH.test(new URL(request.url).pathname)) { try { return await env.TICK.fetch(request); } catch (e) { return new Response('<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>Connect</title><body style="font:16px system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h1>One moment</h1><p>The connection service is restarting. <a href="/connect/github">Try again</a>.</p>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8', 'retry-after': '10' } }); } } { const kf = keyFile(new URL(request.url).pathname); if (kf) return kf; } { const pk = await passkeys(request, env); if (pk) return pk; } { const z = await authzen(request, env); if (z) return z; } const a = await agentic(request, env); if (a) return a; if (new URL(request.url).pathname === "/webmcp.js") return new Response(WEBMCP_JS, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=300", "x-content-type-options": "nosniff" } }); return negotiate(withLinks(await handler.fetch(request, env, ctx), request), request); } };


// GROWTH-HITS-1 (2026-11-25): the product manager runs in Actions, which had no Cloudflare token, so every growth metric read empty and it filed nothing.
// The Worker already holds the analytics database; it serves the four 7-day aggregates (no paths, no visitor ids), cached for 10 minutes.
export async function growthHits(env, now = Date.now()) {
  const h = { "content-type": "application/json", "cache-control": "public, max-age=600", "access-control-allow-origin": "*" };
  if (!env || !env.DB) return new Response(JSON.stringify({ error: "no analytics database" }), { status: 503, headers: h });
  const w = Math.floor(now / 1000) - 7 * 86400;
  try {
    const one = (sql) => env.DB.prepare(sql).bind(w).first();
    const [a, b, c] = await Promise.all([
      one("SELECT COUNT(*) AS pv, COUNT(DISTINCT vid) AS v FROM hits WHERE bot=0 AND name='pageview' AND at>=?"),
      one("SELECT COUNT(*) AS n FROM hits WHERE bot=1 AND at>=?"),
      one("SELECT COUNT(*) AS n FROM hits WHERE bot=0 AND name='pageview' AND path LIKE '/pilot%' AND at>=?"),
    ]);
    return new Response(JSON.stringify({ pageviews_7d: a.pv, visitors_7d: a.v, agent_hits_7d: b.n, pilot_page_views_7d: c.n, window_days: 7 }), { headers: h });
  } catch (e) {
    console.error("api/growth/hits", String(e && e.message));
    return new Response(JSON.stringify({ error: "analytics read failed" }), { status: 503, headers: h });
  }
}

// SERVER-TIMING-1 and EARLY-HINTS-1: every response says how long the Worker took (Server-Timing, read by the UI/UX audit and any browser's
// developer tools), and every page names the one image all pages draw above the fold as a preload Link, which Cloudflare turns into a 103 Early Hint.
export function timed(res, t0, now = Date.now()) {
  if (!res || res.status === 101 || res.webSocket) return res;
  const r = new Response(res.body, res);
  r.headers.append("Server-Timing", "worker;dur=" + Math.max(0, now - t0) + ";desc=\"site worker\"");
  if ((r.headers.get("content-type") || "").includes("text/html")) r.headers.append("Link", "</favicon.svg>; rel=preload; as=image; type=\"image/svg+xml\"");
  return r;
}
export default { scheduled: entry.scheduled, async fetch(request, env, ctx) { const t0 = Date.now(); return timed(await entry.fetch(request, env, ctx), t0); } };
