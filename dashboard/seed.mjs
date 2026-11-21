// Generates seed.sql: owner-only items plus a copy of the open launch issues (refreshed by the `sync` command when a GitHub token is set).
const now = Date.now();
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const owner = [
  ["own-file", "File the provisional patent", "Draft v3 is ready for attorney review. Ask the patent attorney what, if anything, in the public QNFO repos overlaps the claims, and what filing timeline follows.", "The site, grant applications and pitch stay gated until the filing decision is made.", "https://github.com/ultrastable/ultrastable/issues/30", 1, 1],
  ["own-google", "Submit the Google for Startups Cloud Program application", "Needs the site and domain email live; the drafts are in the funding docs.", "Credits are needed to keep developing without paying out of pocket.", "https://github.com/ultrastable/ultrastable/issues/17", 1, 1],
  ["own-gh-token", "Give the dashboard a GitHub token so it can sync issues and label fleet work", "A fine-grained token with Issues read/write on the ultrastable repo, stored as the GITHUB_TOKEN secret. Only you can mint it.", "Until then the task list is a seeded copy and Hand to fleet only queues locally.", null, 2, 1],
];
const gh = [
 [14,"BIZ-1: Choose owning entity","own"],[15,"BIZ-2: Business-in-a-box review","own"],[16,"FN-1: Map funding and credit programs",""],[17,"FN-2: Google for Startups Cloud Program application","own"],[18,"FN-3: Cloudflare for Startups application","own"],[19,"FN-4: Other credit programs",""],[20,"FN-5: Pitch deck",""],
 [21,"GH-1: Create repos, install Claude app","own"],[22,"GH-2: Push starter content to all repos",""],[23,"GH-3: Labels, templates, project board",""],[24,"GH-4: Restrict ip repo; protect main","own"],[25,"GH-5: Make .github public (after filing)","own"],
 [26,"IP-1: Provisional draft",""],[27,"IP-2: Prior-art search",""],[28,"IP-3: Evidence log",""],[29,"IP-4: Counsel review","own"],[30,"IP-5: File provisional","own"],[31,"IP-6: Conversion deadline reminders",""],[32,"IP-7: Non-provisional and/or PCT","own"],[33,"IP-8: Trademark clearance and filing","own"],
 [35,"PL-1: Inventory the QNFO fleet",""],[36,"PL-2: Org-chart config schema",""],[37,"PL-3: Tenant isolation design",""],[38,"PL-4: Ultrastable runs its own backlog",""],[39,"PL-5: GCP embodiment sketch",""],[40,"PL-6: One-command install",""],
 [41,"PR-1: Positioning and first customer profile",""],[42,"PR-3: QNFO case study",""],[43,"PR-4: Pricing hypotheses",""],[44,"QA-1: Independent review of patent vs docs",""],
 [45,"WEB-1: Site on preview URL behind Access",""],[46,"WEB-2: Attach domains after filing",""],[47,"WEB-3: Search Console after filing",""],[48,"WEB-4: robots, sitemap, Open Graph",""],[49,"WEB-5: Domain email hello@",""],[50,"WEB-6: Inventory QNFO setup steps",""],
 [6,"Pilot sign-up flow",""],[11,"CI deploy from this repo to Cloudflare",""],[10,"Claims feed on the product's own host",""],[9,"Investor materials",""],[7,"Recruit 3 design partners",""],
];
let sql = "";
for (const [id, t, w, iw, url, pr, idn] of owner) sql += `INSERT OR IGNORE INTO tasks(id,title,kind,state,why,if_wait,url,identity,source,priority,updated_at) VALUES(${q(id)},${q(t)},'owner','open',${q(w)},${q(iw)},${url ? q(url) : "NULL"},${idn},'seed',${pr},${now});\n`;
for (const [n, t, o] of gh) sql += `INSERT OR IGNORE INTO tasks(id,title,kind,state,url,source,priority,updated_at) VALUES('gh-${n}',${q(t)},${q(o ? "owner" : "fleet")},'open','https://github.com/ultrastable/ultrastable/issues/${n}','github',5,${now});\n`;
console.log(sql);
