// Excerpt of QNFO/qnfo-workers qnfo-gateway/worker.js at commit 3e11986682011d90987db97cd149be5c549c397a ()
// Lines 3655-3742 (platform page) and 3743-3770 (About page with the platform paragraph), plus the router line 8842. Not runnable on its own: it uses the gateway's qdsPage, esc and D1 helpers.
__name22222222(handleHub, "handleHub");
__name222222222(handleHub, "handleHub");
__name2222222222(handleHub, "handleHub");
// ULTRASTABLE-CLAIMS-1 (2026-11-10, owner: "The system shall always function as the system describes itself"): every claim the product page
// makes is a row in qnfo-audit.product_claims with a read-only probe. /platform runs each probe live and shows pass or fail; the same probes run
// hourly as remediation contracts (claim-ultrastable-*), so a claim that stops being true files its own issue. Design: docs/PRODUCT-ULTRASTABLE.md.
var PLATFORM_CACHE = { at: 0, data: null };
// ULTRASTABLE-CREATOR-LINK-1 (2026-11-10): the platform's public identity and who directs it come from qnfo-audit.product_profile, so an owner answer on
// fleet.qnfo.org/focus (trigger owner_asks_product_profile_au) changes the page without a deploy. These defaults hold when the table cannot be read.
var PLATFORM_PROFILE_DEFAULT = { name: "Ultrastable", home_url: "https://qnfo.org/platform", repo_url: "https://github.com/QNFO/qnfo-workers", creator_name: "Rowan Brad Quni-Gudzinas", creator_role: "Directed by", creator_title: "systems researcher studying autonomous AI systems", creator_url: "https://rwnq8.github.io/", creator_same_as: "https://orcid.org/0009-0002-4317-5604 https://github.com/rwnq8 https://www.linkedin.com/in/rowan-quni https://qnfo.org/about", credit_visible: "1" };
async function platformProfile(env) {
  var p = Object.assign({}, PLATFORM_PROFILE_DEFAULT);
  try {
    var rows = (await env.AUDIT.prepare("SELECT key, value FROM product_profile WHERE product = 'ultrastable'").all()).results || [];
    rows.forEach(function(r) { if (r && r.key && r.value != null && Object.prototype.hasOwnProperty.call(PLATFORM_PROFILE_DEFAULT, r.key)) p[r.key] = String(r.value); });
  } catch (e) { console.error(JSON.stringify({ event: "platform-profile-read-failed", error: String(e && e.message || e) })); }
  ["home_url", "repo_url", "creator_url"].forEach(function(k) { if (!/^https:\/\//.test(p[k])) p[k] = PLATFORM_PROFILE_DEFAULT[k]; });
  p.creator_same_as = String(p.creator_same_as).split(/\s+/).filter(function(u) { return /^https:\/\//.test(u); });
  return p;
}
async function platformClaims(env) {
  var now = Date.now();
  if (PLATFORM_CACHE.data && now - PLATFORM_CACHE.at < 300000) return PLATFORM_CACHE.data;
  var out = { checked_at: new Date(now).toISOString(), claims: [], error: null };
  try {
    var rows = (await env.AUDIT.prepare("SELECT id, claim, probe_sql, evidence_note FROM product_claims WHERE product = 'ultrastable' ORDER BY sort, id").all()).results || [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], res = { id: r.id, claim: r.claim, evidence_note: r.evidence_note, pass: false, observed: null, detail: null };
      try {
        var bare = String(r.probe_sql).replace(/'(?:[^']|'')*'/g, "''");
        if (!/^\s*SELECT\b/i.test(bare) || /;\s*\S/.test(bare)) throw new Error("probe is not a single SELECT");
        var row = await env.AUDIT.prepare(r.probe_sql).first();
        res.observed = row ? String(row.observed) : null; res.detail = row && row.detail != null ? String(row.detail) : null;
        res.pass = !!row && String(row.observed) === String(row.expected);
      } catch (e) { res.detail = "the check could not run: " + String(e && e.message || e).slice(0, 160); }
      out.claims.push(res);
    }
  } catch (e) { out.error = "claims table unavailable: " + String(e && e.message || e).slice(0, 160); }
  out.profile = await platformProfile(env);
  PLATFORM_CACHE = { at: now, data: out };
  return out;
}
function platformJsonLd(pf) {
  var app = { "@type": "SoftwareApplication", "@id": "https://qnfo.org/platform#app", name: pf.name, url: pf.home_url, applicationCategory: "DeveloperApplication", operatingSystem: "Cloudflare Workers",
    description: "A self-governing development platform: it finds its own work, ships each change through coding agents, proves it live with an automatic revert, and scores its decisions against logged predictions.",
    codeRepository: pf.repo_url, publisher: { "@id": "https://qnfo.org/#org" } };
  if (pf.credit_visible !== "0") {
    var person = { "@type": "Person", "@id": "https://qnfo.org/#person", name: pf.creator_name, url: pf.creator_url, jobTitle: "Systems researcher", sameAs: pf.creator_same_as };
    app.creator = { "@id": "https://qnfo.org/#person" }; app.author = { "@id": "https://qnfo.org/#person" };
    if (typeof identityJsonLd === "function") return identityJsonLd(pf.home_url, { person: { url: pf.creator_url, sameAs: [pf.creator_url].concat(pf.creator_same_as) }, nodes: [app] });
    return '<script type="application/ld+json">' + JSON.stringify({ "@context": "https://schema.org", "@graph": [person, app] }).replace(/</g, "\\u003c") + "<\/script>";
  }
  return '<script type="application/ld+json">' + JSON.stringify(Object.assign({ "@context": "https://schema.org" }, app)).replace(/</g, "\\u003c") + "<\/script>";
}
var ULTRASTABLE_HOME = "ultrastable.io";
var ULTRASTABLE_ALIASES = ["www.ultrastable.io", "ultrastable.app", "www.ultrastable.app", "ultrastable.net", "www.ultrastable.net"];
function ultrastableRoute(host, p, u) {
  if (host !== ULTRASTABLE_HOME && ULTRASTABLE_ALIASES.indexOf(host) < 0) return null;
  if (p === "/health") return health();
  if (host !== ULTRASTABLE_HOME) return new Response(null, { status: 301, headers: { Location: "https://" + ULTRASTABLE_HOME + p + (u.search || "") } });
  if (p === "/" || p === "/platform") return "page";
  if (p === "/api/platform-claims") return "json";
  if (p === "/robots.txt") return new Response("User-agent: *\nAllow: /\nSitemap: https://" + ULTRASTABLE_HOME + "/sitemap.xml\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  if (p === "/sitemap.xml") return new Response('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://' + ULTRASTABLE_HOME + '/</loc><changefreq>daily</changefreq></url></urlset>\n', { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
  if (p === "/qds.css" || p === "/qds.js" || p === "/qds-consent.js") return null;
  return new Response(null, { status: 301, headers: { Location: "https://qnfo.org" + p + (u.search || "") } });
}
async function handlePlatform(env, asJson) {
  var d = await platformClaims(env);
  var ok = d.claims.filter(function(c) { return c.pass; }).length, n = d.claims.length;
  var pf = d.profile || Object.assign({}, PLATFORM_PROFILE_DEFAULT, { creator_same_as: PLATFORM_PROFILE_DEFAULT.creator_same_as.split(" ") });
  var credit = pf.credit_visible === "0" ? "" : '<p class="q-meta">' + esc(pf.creator_role) + ' <a href="' + esc(pf.creator_url) + '" rel="author">' + esc(pf.creator_name) + '</a>, ' + esc(pf.creator_title) + '.</p>';
  if (asJson) return new Response(JSON.stringify({ product: pf.name, home_url: pf.home_url, repo_url: pf.repo_url, directed_by: pf.credit_visible === "0" ? null : { role: pf.creator_role, name: pf.creator_name, title: pf.creator_title, url: pf.creator_url, same_as: pf.creator_same_as }, passing: ok, total: n, checked_at: d.checked_at, error: d.error, claims: d.claims }), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
  var status = d.error ? "The live checks could not be read just now; the page tries again in five minutes." : (n === 0 ? "No claims are registered yet." : ok + " of " + n + " claims pass their live check right now (checked " + esc(d.checked_at.slice(0, 16).replace("T", " ")) + " UTC, and hourly by the fleet).");
  var rowsHtml = d.claims.map(function(c) {
    return '<tr><td><strong style="color:var(' + (c.pass ? "--q-ok" : "--q-bad") + ')">' + (c.pass ? "Pass" : "Fail") + '</strong></td><td>' + esc(c.claim) + (c.detail ? '<br><span class="q-small">' + esc(c.detail) + '</span>' : "") + '</td></tr>';
  }).join("");
  var body = '<section class="q-hero" style="padding-bottom:16px"><div class="q-wrap"><p class="q-eyebrow">The platform</p><h1 class="q-display" style="max-width:20ch">' + esc(pf.name.charAt(0).toUpperCase() + pf.name.slice(1)) + ': the platform QNFO runs on</h1>' +
    '<p class="q-lede">A self-governing development platform (working name). It finds its own work in its metrics and failures, hands each change to a coding agent, proves the change live with a probe and an automatic revert, and scores its decisions against the predictions it logged first. QNFO is its first customer.</p>' +
    '<p class="q-meta">' + status + '</p>' + credit + '</div></section>' +
    '<div class="q-wrap"><article class="q-article"><div class="q-prose"><h2>What it claims, checked live</h2><p>Each line is a claim from the product page. The check behind it runs against the fleet\u2019s own database on every visit (cached five minutes) and hourly as a contract that opens an issue when it fails.</p>' +
    '<div class="q-table-wrap"><table class="q-table"><thead><tr><th>Check</th><th>Claim and what the check saw</th></tr></thead><tbody>' + (rowsHtml || '<tr><td colspan="2">No claims are registered yet.</td></tr>') + '</tbody></table></div>' +
    (pf.credit_visible === "0" ? "" : '<h2>Who directs it</h2><p>' + esc(pf.creator_name) + ' is a ' + esc(pf.creator_title) + '. Rowan sets the platform\u2019s operating rules and evaluates what it does; coding agents write the code. Work and record: <a href="' + esc(pf.creator_url) + '" rel="author">' + esc(pf.creator_url.replace(/^https:\/\//, "").replace(/\/$/, "")) + '</a>' + pf.creator_same_as.map(function(u) { return ', <a href="' + esc(u) + '">' + esc(u.replace(/^https:\/\/(www\.)?/, "")) + '</a>'; }).join("") + '.</p>') +
    '<h2>Where it falls short</h2><p>One installation (QNFO). Hundreds of issues are open against a target of zero. The prediction match rate is scored by the system itself. The core still shares a database with QNFO\u2019s research applications. The full list, the evidence and the spin-off plan are on the <a href="https://github.com/QNFO/qnfo-workers/blob/main/docs/PRODUCT-ULTRASTABLE.md">product page</a>.</p>' +
    '<p class="q-small">Machine-readable: <a href="/api/platform-claims">/api/platform-claims</a>.</p></div></article></div>';
  return new Response(qdsPage({ title: "Ultrastable \u2014 the platform QNFO runs on", description: "Ultrastable, the self-governing development platform behind QNFO, with every claim checked live against the fleet's own records.", canonical: pf.home_url, jsonld: platformJsonLd(pf), active: "about" }, body), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" } });
}

async function handleAbout(env) {
  try {
    const [pc, nc, ec] = await Promise.all([
      env.LIVING_PAPER.prepare("SELECT COUNT(*) as cnt FROM papers WHERE slug IS NOT NULL AND status IN ('published','distributed','external_preprint')").first(),
      env.DB.prepare("SELECT COUNT(*) as count FROM nodes").first(),
      env.DB.prepare("SELECT COUNT(*) as count FROM edges").first()
    ]);
    return new Response(renderAboutHTML({ papers: pc ? pc.cnt : 0, nodes: nc ? nc.count : 0, edges: ec ? ec.count : 0 }), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" }
    });
  } catch (e) {
    return new Response(renderAboutHTML({ papers: 0, nodes: 0, edges: 0 }), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" }
    });
  }
}
__name(handleAbout, "handleAbout");
__name2(handleAbout, "handleAbout");
__name22(handleAbout, "handleAbout");
__name222(handleAbout, "handleAbout");
__name2222(handleAbout, "handleAbout");
function renderAboutHTML(stats) {
  const fmt = function(n) { return Number(n || 0).toLocaleString("en-US"); };
  const body = '<section class="q-hero" style="padding-bottom:16px"><div class="q-wrap"><p class="q-eyebrow">About</p><h1 class="q-display" style="max-width:18ch">About QNFO</h1><p class="q-lede">QNFO is the independent research imprint of Rowan Brad Quni-Gudzinas: one researcher with an open, auditable, AI-assisted research pipeline. The author is a systems researcher. The work asks how autonomous AI systems behave when nobody is steering: what an autonomous research system actually delivers and where it fails, what an AI-assisted claim is worth (ignorance audits), and what computation costs per correct answer (Joules-per-Solution). The <a href="/#selected-works">selected works</a> are the place to start.</p><p class="q-lede">The fleet that runs QNFO is also a product in its own right: a self-governing development platform, working name Ultrastable. It finds its own work in its own metrics and failures, hands each change to a coding agent, proves the change live with a probe and an automatic revert, and scores every decision against the prediction it logged first. QNFO is its first customer. <a href="/platform">Every claim, checked live</a>.</p></div></section>' +
    '<div class="q-wrap"><article class="q-article"><div class="q-prose">' +
    '<h2>What QNFO is</h2><p>Open research in three lines, in this order: autonomous AI systems and their operation, the epistemics of AI-assisted science, and energy-honest computing (the Joules-per-Solution metric). The corpus is browsable on <a href="https://papers.qnfo.org/papers">papers.qnfo.org</a>, and <a href="https://ask.qwav.org/">Ask the corpus</a> answers questions from it with citations and the knowledge graph around each answer.</p><p class="q-meta">QNFO is not an acronym. The name is the name.</p>' +
    '<h2>The thesis</h2><p>Computational advantage is measured in joules per solution, not qubit counts or press releases. The <a href="https://github.com/rwnq8/joules-per-compute-benchmark">joules-per-compute benchmark</a> formalizes the questions the industry prefers to defer: the Landauer floor for cryogenic controllers, the Margolus\u2013Levitin bound as a scheduling constraint, and the energy floor of surface-code error correction at a thousand logical qubits.</p>' +
    '<h2>The record</h2><div class="q-table-wrap"><table class="q-table"><tbody><tr><td>Papers in the corpus</td><td class="q-num">' + fmt(stats.papers) + ' (counted live)</td></tr><tr><td>Knowledge graph</td><td class="q-num">' + fmt(stats.nodes) + " nodes, " + fmt(stats.edges) + ' edges (counted live)</td></tr><tr><td>Readership on paper pages</td><td class="q-num">about 400 requests a day (2026-09-03)</td></tr></tbody></table></div><p class="q-meta">The first two rows are queried on every request. Roughly nine in ten requests to the zone are scanner noise; the readership figure excludes it.</p>' +

// --- router (line 8842)
    // answer 301 to it). It serves the live claims page at /, its JSON, the health probe and the design assets; any other path goes to
    // qnfo.org, so the shared header and footer links keep working. Routed by scripts/attach-surface-routes.py (ULTRASTABLE_HOSTS).
    { const us = ultrastableRoute(host, p, u); if (us === "page") return handlePlatform(env, false); if (us === "json") return handlePlatform(env, true); if (us) return us; }
    // ARCHIVE-ON-GATEWAY-1 and QWAV-ON-GATEWAY-1: hosts that were undeployable Pages projects.
    if (host === "archive.qnfo.org" || host === "qwav.org" || host === "www.qwav.org" || host === "qwav.tech" || host === "www.qwav.tech") {
