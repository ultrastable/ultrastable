// ULTRASTABLE-SITE-1: host routing, pages, design lint and fail-soft proof.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
const mod = (await import(pathToFileURL(fileURLToPath(new URL("./worker.js", import.meta.url))).href)).default;
const ASSET = (f) => readFileSync(new URL("./assets/" + f, import.meta.url));
const ENV = { ASSETS: { get: async (k) => { const b = ASSET(k); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); } } };
const get = (u) => mod.fetch(new Request(u));
globalThis.fetch = async () => { throw new Error("offline"); };
let r = await get("https://ultrastable.app/anything");
assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "https://ultrastable.io/pilot");
// BUILD-1 + RECALL-1 + AUDIT-1: idea -> three tap questions -> building -> live page -> independent check -> change, with an in-memory KV and fake models
const kv = new Map(); const mem = { get: async (k) => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); }, delete: async (k) => { kv.delete(k); } };
const briefs = []; let builds = 0;
const AI = { run: async (m, a) => {
  const user = a.messages[1].content;
  if (!m.includes("qwen")) {
    if (a.messages[0].content.includes("strict reviewer")) return { response: JSON.stringify({ met: ["Has a heading"], gaps: [{ what: "No sign-up form", critical: true }] }) };
    return { response: JSON.stringify([{ q: "Do neighbours sign up?", cue: "e.g. a list" }, { q: "Phone first?", cue: "small screens" }, { q: "Calm look?", cue: "simple" }, { q: "Extra?", cue: "x" }]) };
  }
  builds++; briefs.push(user); const ch = user.includes("current page") && !user.includes("Fix these problems");
  return { response: "```html\n<html><body><h1>" + (user.includes("Fix these problems") ? "fixed" : ch ? "changed" : "bins") + "</h1></body></html>\n```" };
} };
const E2 = { ASSETS: mem, AI };
const post = (path, o) => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return mod.fetch(new Request("https://ultrastable.io" + path, { method: "POST", body: f }), E2); };
r = await get("https://ultrastable.io/start"); assert.equal(r.status, 200); assert.match(await r.text(), /Tell me what is on your mind/);
r = await post("/api/idea", { idea: "an app for bin day" });
assert.equal(r.status, 303); const id = /\/s\/([a-f0-9]{10})\/ask/.exec(r.headers.get("location"))[1];
for (let i = 0; i < 2; i++) { // BUILD-2: two opening questions from the model; ADAPTIVE-1 may add a follow-up chosen from the answers
  r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/ask"), E2); assert.match(await r.text(), new RegExp("Question " + (i + 1) + " of 2"));
  r = await post("/api/answer", { id, a: ["yes", "no"][i] });
  assert.equal(r.status, 303); assert.match(r.headers.get("location"), /\/ask$/);
}
// ADAPTIVE-1 (Q-GAP-adaptive-interview): "Phone first? NO" earns a follow-up that was not in the fixed bank; the interview then ends at the cap.
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/ask"), E2); assert.match(await r.text(), /Will people mostly use it on a large screen or a laptop\?/);
r = await post("/api/answer", { id, a: "yes" }); assert.equal(r.status, 303); assert.match(r.headers.get("location"), /\/make$/);
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/make"), E2); assert.equal(r.status, 302, "the /make request itself runs the build");
assert.match(briefs[0], /Do neighbours sign up\? YES/); assert.match(briefs[0], /Phone first\? NO/); assert.match(briefs[0], /large screen or a laptop\? YES/); assert.ok(!/Calm look/.test(briefs[0]), "the bank is not asked past its first two questions");
assert.equal(builds, 1, "the build is its own stage; the audit and fix run in a later request");
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id), E2); assert.equal(r.status, 200); assert.equal(builds, 2, "first view starts the audit, which fixes the critical gap");
const page = await r.text(); assert.match(page, /<h1>fixed<\/h1>/); assert.match(page, /Change something/); assert.match(page, /What I checked/); assert.match(r.headers.get("content-security-policy"), /sandbox/);
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/review"), E2); const rv = await r.text();
assert.match(rv, /Has a heading/); assert.match(rv, /No sign-up form \(fixed automatically\)/); assert.match(rv, /What I cannot do yet/); assert.match(rv, /visible to every visitor/);
r = await post("/api/change", { id, change: "make it green" }); assert.equal(r.status, 303);
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/make"), E2); assert.equal(r.status, 302);
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id), E2); assert.match(await r.text(), /changed/);
// BUILD-2 (shared back end): two browsers see the same list through /s/<id>/api, also on <id>.ultrastable.io; the sandbox is relaxed only on the subdomain
{
  const rows = []; let seq = 0;
  const stmt = (sql) => ({ b: [], bind(...a) { this.b = a; return this; },
    async run() { if (/INSERT/.test(sql)) { rows.push({ id: ++seq, site: this.b[0], coll: this.b[1], at: this.b[2], data: this.b[3] }); return { meta: { last_row_id: seq } }; } return {}; },
    async all() { return { results: rows.filter(x => x.site === this.b[0] && x.coll === this.b[1]).reverse().map(x => ({ id: x.id, at: x.at, data: x.data })) }; },
    async first() { return { n: rows.filter(x => x.site === this.b[0]).length }; } });
  const DB = { prepare: stmt, batch: async () => [] }, E3 = { ASSETS: mem, AI, DB };
  const api = (host, path, init) => mod.fetch(new Request("https://" + host + path, init), E3);
  const add = (host, d) => api(host, "/s/" + id + "/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coll: "signups", data: d }) });
  assert.equal((await add("ultrastable.io", { name: "Ada" })).status, 201);
  assert.equal((await add(id + ".ultrastable.io", { name: "Grace" })).status, 201);
  for (const h of ["ultrastable.io", id + ".ultrastable.io"]) { // "browser one" and "browser two" read the same list
    const j = await (await api(h, "/s/" + id + "/api?coll=signups")).json(); assert.deepEqual(j.items.map(x => x.data.name), ["Grace", "Ada"], h);
  }
  assert.equal((await add("ultrastable.io", [1])).status, 400); assert.equal((await add("ultrastable.io", { x: "y".repeat(2100) })).status, 413);
  assert.equal((await api("ultrastable.io", "/s/" + id + "/api?coll=BAD NAME")).status, 400);
  assert.equal((await api("ultrastable.io", "/s/0000000000/api?coll=signups")).status, 404);
  { // BUILD-2b: 30 rapid POSTs from one client hit 429 before the per-site cap; another client is not affected
    const from = (ip) => api("ultrastable.io", "/s/" + id + "/api", { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ coll: "flood", data: { a: 1 } }) });
    const codes = []; for (let i = 0; i < 30; i++) codes.push((await from("203.0.113.9")).status);
    assert.ok(codes.includes(429), "rate limit must trip"); assert.ok(codes.filter(c => c === 201).length <= 20, "at most 20 writes a minute");
    const last = await from("203.0.113.9"); assert.equal((await last.json()).code, "rate_limited"); assert.equal(last.headers.get("retry-after"), "60");
    assert.equal((await from("203.0.113.10")).status, 201);
  }
  r = await api(id + ".ultrastable.io", "/"); assert.equal(r.status, 200); const sp = await r.text();
  assert.match(sp, /window\.US=/); assert.match(sp, new RegExp("https://" + id + "\.ultrastable\.io/s/" + id + "/api"));
  assert.match(r.headers.get("content-security-policy"), /allow-same-origin/); assert.match(r.headers.get("content-security-policy"), /connect-src 'self'/);
  r = await api("ultrastable.io", "/s/" + id); assert.doesNotMatch(r.headers.get("content-security-policy"), /allow-same-origin/);
}
// BUILD-2: a model that always fails ends as failed after 3 tries, and the questions fall back to defaults
const bad = { ASSETS: mem, AI: { run: async () => { throw new Error("model down"); } } };
const post2 = (path, o) => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return mod.fetch(new Request("https://ultrastable.io" + path, { method: "POST", body: f }), bad); };
r = await post2("/api/idea", { idea: "x" }); const id2 = /\/s\/([a-f0-9]{10})\/ask/.exec(r.headers.get("location"))[1];
for (let i = 0; i < 4; i++) await post2("/api/answer", { id: id2, a: "yes" });  // with the model down the rule table still asks follow-ups, up to the cap of four
for (let i = 0; i < 4; i++) { r = await mod.fetch(new Request("https://ultrastable.io/s/" + id2 + "/make"), bad); }
assert.equal(kv.get("state:" + id2), "failed"); assert.match(await r.text(), /Something went wrong/);
r = await mod.fetch(new Request("https://ultrastable.io/s/0000000000"), E2); assert.equal(r.status, 404);
r = await get("https://ultrastable.net/"); assert.equal(r.headers.get("location"), "https://ultrastable.io/live");
r = await get("https://www.ultrastable.io/how"); assert.equal(r.headers.get("location"), "https://ultrastable.io/how");
for (const p of ["/", "/engineers", "/dashboard", "/roadmap", "/how", "/showcase", "/pilot", "/product", "/team", "/org", "/faq", "/contact"]) {
  r = await get("https://ultrastable.io" + p); assert.equal(r.status, 200, p);
  const h = await r.text(); assert.match(h, /<body/); assert.match(h, /rel="canonical"/);
  assert.ok(((h.replace(/<style>[\s\S]*?<\/style>/, "")).match(/class="btn btn-primary"/g) || []).length <= 1, p + " has at most one primary action");
}
r = await get("https://ultrastable.io/proof"); assert.equal(r.status, 301); assert.equal(r.headers.get("location"), "https://ultrastable.io/live", "PROOF-OWN-1");
assert.match(await (await get("https://ultrastable.io/")).text(), /claims verified against code/, "home status is Ultrastable's own");
assert.match(await (await get("https://ultrastable.io/")).text(), /Directed by[^<]*<a[^>]*>Rowan Brad Quni-Gudzinas<\/a>, founder and director of Ultrastable/, "BRAND: the platform credits its director on every page");
assert.equal((await get("https://ultrastable.io/nope")).status, 404);
assert.equal((await (await get("https://ultrastable.io/health")).json()).worker, "ultrastable-site");
assert.match(await (await get("https://ultrastable.io/robots.txt")).text(), /Sitemap/);
assert.match(await (await get("https://ultrastable.io/favicon.svg")).text(), /<svg/);
assert.match(await (await get("https://ultrastable.io/")).text(), /og:image/);
// INTERVIEW-1: pill ask bar with mic, chips, engineer lane, honest pins; the client script must parse.
const homeHtml = await (await get("https://ultrastable.io/")).text();
assert.match(homeHtml, /class="us-ask"/); assert.match(homeHtml, /id="us-mic"/); assert.match(homeHtml, /href="\/engineers"/);
assert.doesNotMatch(homeHtml, /<textarea/, "no intimidating text box on the front door");
for (const m of homeHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
const eng = await (await get("https://ultrastable.io/engineers")).text(); assert.match(eng, /Pinned/); assert.match(eng, /Live/);
// SITE-PINS-1: every pin and honest gap links to a tracked item that the roadmap page and roadmap.json carry.
const road = await (await get("https://ultrastable.io/roadmap.json")).json(); const roadHtml = await (await get("https://ultrastable.io/roadmap")).text();
assert.ok(road.pins.length >= 10);
for (const p of road.pins) { assert.ok(road.issues[p.issue], "pin without issue: " + p.name); assert.ok(p.code.length, "pin without code: " + p.name); assert.ok(eng.includes("/roadmap#" + p.issue)); assert.ok(roadHtml.includes("id=\"" + p.issue + "\"")); }
const howHtml = await (await get("https://ultrastable.io/how")).text();
for (const g of road.gaps) { assert.ok(road.issues[g.issue]); assert.ok(howHtml.includes("/roadmap#" + g.issue)); }
{ // ORGMAP-1: /how lists exactly the repositories brand/brand.json declares live, so the page cannot drift from the manifest
  const om = (await import("./orgmap.js")).default;
  assert.ok(howHtml.includes("How Ultrastable is organized"));
  for (const r of om.repos) assert.ok(howHtml.includes("github.com/" + om.org + "/" + r.name), "/how misses " + r.name);
  for (const r of om.retired) assert.ok(howHtml.includes("<code>" + r.name + "</code> is now in <code>" + r.moved_to + "</code>"));
}
const fp = new FormData(); fp.set("idea", "bins. for other people"); fp.set("profile", JSON.stringify({ space: { who: "B" } }));
r = await mod.fetch(new Request("https://ultrastable.io/api/idea", { method: "POST", body: fp }), E2); assert.equal(r.status, 303);
assert.ok([...kv.keys()].some((k) => k.startsWith("profile:")), "interview profile is stored with the idea");

// INTERVIEW-2 + SUGGEST-1: chat thread front door. Suggestions rotate and respond to what is typed; the thread builds through JSON endpoints.
{
  const sj = async (q, env) => (await (await mod.fetch(new Request("https://ultrastable.io/api/suggest?" + q), env)).json()).s;
  const a1 = await sj("seed=1&q="), a2 = await sj("seed=2&q="), a3 = await sj("seed=1&q=");
  assert.equal(a1.length, 4); assert.deepEqual(a1, a3, "same seed, same suggestions"); assert.notDeepEqual(a1, a2, "a new seed rotates the list");
  const rel = await sj("seed=5&q=" + encodeURIComponent("a website for our club"));
  assert.ok(rel.some((t) => /club|community|website/i.test(t)), "suggestions respond to what is typed: " + rel.join(" | "));
  const seenOne = await sj("seed=1&q=&seen=" + encodeURIComponent(a1.join("|")));
  assert.ok(seenOne.every((t) => !a1.includes(t)), "already-shown ideas are not repeated");
  const modelEnv = { ASSETS: mem, AI: { run: async () => ({ response: JSON.stringify(["Weekly rota for the street", "Reminder texts"]) }) } };
  const withModel = await sj("seed=3&q=" + encodeURIComponent("bin day for my street"), modelEnv);
  assert.equal(withModel[0], "Weekly rota for the street"); assert.equal(withModel.length, 4, "model ideas first, bank fills the rest");
  const jf = new FormData(); jf.set("idea", "a rota for the street"); jf.set("profile", JSON.stringify({ space: { who: "B" }, thread: true }));
  r = await mod.fetch(new Request("https://ultrastable.io/api/idea", { method: "POST", body: jf, headers: { Accept: "application/json" } }), E2);
  assert.equal(r.status, 200); const jid = (await r.json()).id; assert.match(jid, /^[a-f0-9]{10}$/);
  r = await mod.fetch(new Request("https://ultrastable.io/s/" + jid + "/status"), E2); assert.equal((await r.json()).state, "ready", "status runs the build");
  r = await mod.fetch(new Request("https://ultrastable.io/s/" + jid + "/status?audit=1"), E2); const first = await r.json();
  assert.equal(first.state, "ready");
  r = await mod.fetch(new Request("https://ultrastable.io/s/" + jid + "/status?audit=1"), E2); assert.ok((await r.json()).audit, "the audit arrives on a later poll");
  const cf = new FormData(); cf.set("id", jid); cf.set("change", "make it green");
  r = await mod.fetch(new Request("https://ultrastable.io/api/change", { method: "POST", body: cf, headers: { Accept: "application/json" } }), E2); assert.equal((await r.json()).state, "building");
  assert.equal(((await (await mod.fetch(new Request("https://ultrastable.io/s/" + jid + "/status"), E2)).json()).state), "ready");
  assert.equal((await mod.fetch(new Request("https://ultrastable.io/s/0000000000/status"), E2)).status, 404);
  const th = await (await get("https://ultrastable.io/start")).text();
  assert.match(th, /id="us-log"[^>]*role="log"/); assert.match(th, /id="us-sug"/); assert.match(th, /aria-label="Dictate"/);
  assert.doesNotMatch(th, /<textarea/); assert.doesNotMatch(th, /QNFO|patent|provisional/i);
}
console.log("ultrastable-site thread ok");
console.log("ultrastable-site ok");

// Social preview must be a PNG (SVG og:image is ignored by most crawlers).
for (const path of ["/social-card.png", "/apple-touch-icon.png"]) {
  r = await mod.fetch(new Request("https://ultrastable.io" + path), ENV);
  assert.equal(r.status, 200, path); assert.equal(r.headers.get("content-type"), "image/png", path);
  const b = new Uint8Array(await r.arrayBuffer());
  assert.equal(String.fromCharCode(b[1], b[2], b[3]), "PNG", path);
}
const pilot = await (await get("https://ultrastable.io/pilot")).text();
assert.match(pilot, /og:image" content="https:\/\/ultrastable\.io\/social-card\.png/);
assert.match(pilot, /twitter:card" content="summary_large_image/);

// Generic public pages: no research framing, no patent wording. QNFO may be named since Rowan's 2026-11-17 SHOWCASE-1 directive (it is a test case); /showcase carries it.
for (const p of ["/", "/product", "/team", "/org", "/faq", "/contact"]) {
  const h = await (await get("https://ultrastable.io" + p)).text();
  assert.doesNotMatch(h, /patent|provisional|disclos|research/i, p + " stays generic");
}
console.log("ultrastable-site pages ok");

// /org states repository roles only: no links to repositories, no architecture terms (org/repos.json public_presence.confidentiality).
const orgHtml = await (await get("https://ultrastable.io/org")).text();
const orgBody = orgHtml.slice(orgHtml.indexOf("<main"), orgHtml.indexOf('<div class="us-foot"'));
assert.ok(orgBody.length > 200, "org body extracted");
assert.doesNotMatch(orgBody, /github\.com|QNFO|patent|adapter\s+for|wrangler|D1|token/i, "/org stays at repo-role level");
console.log("ultrastable-site org ok");
// VISION-1: the front door refuses a definite one-off before anything is stored or built, and lets a maintained system through.
{
  const idea = (text) => { const f = new FormData(); f.set("idea", text); return mod.fetch(new Request("https://ultrastable.io/api/idea", { method: "POST", body: f, headers: { accept: "application/json" } }), E2); };
  let r = await idea("A packing list for camping trips"); assert.equal(r.status, 422); const nf = await r.json(); assert.equal(nf.state, "not_a_fit"); assert.match(nf.error, /site builder/);
  r = await idea("A club website that keeps improving its own search ranking every week"); assert.notEqual(r.status, 422, "a maintained system is not refused");
  console.log("ultrastable-site vision ok");
}

const { lint } = await import(pathToFileURL(fileURLToPath(new URL("./worker.js", import.meta.url))).href);
// QUALITY-1: lint flags the defects seen in the first demo and passes a sound page
{
  const bad = "<html><head><title>x</title></head><body><textarea></textarea><button>Publish</button><div class=\"status\"></div></body></html>";
  const f = lint(bad).join(" | ");
  assert.match(f, /viewport/); assert.match(f, /box-sizing/); assert.match(f, /click handler/); assert.match(f, /empty status/); assert.match(f, /save what/);
  const good = "<!doctype html><html><head><meta name=viewport content=x><title>Ed</title><style>*{box-sizing:border-box}</style></head><body><textarea id=t></textarea><button id=b>Go</button><script>try{localStorage.x=1}catch(e){}b.addEventListener('click',()=>{})</script></body></html>";
  assert.deepEqual(lint(good), []);
}
// DASHBOARD-1: the dashboard preview renders every computed panel, says the live feed is pending, and states the pilot model.
{
  const D = (await import("./dashboard-data.js")).default;
  const html = await (await get("https://ultrastable.io/dashboard")).text();
  for (const p of D.tenants.ultrastable.panels) { assert.ok(html.includes('id="panel-' + p.id + '"'), "panel " + p.id); assert.ok(html.includes(p.source), "source shown: " + p.source); }
  assert.ok(html.includes('id="live"') && /live feed/i.test(html), "the live feed section renders");
  for (const r of D.tenants.ultrastable.live_feed.runtimes) assert.ok(html.includes(r.tenant), "runtime listed: " + r.tenant);
  assert.ok(html.includes("bring-your-own-account") && html.includes('id="pilot"'));
  console.log("ultrastable-site dashboard ok");
}
// PILOT-1 + TENANT-1: the application is scored against the four system-test questions; the dashboard takes a tenant id and unknown tenants 404.
{
  let ipn = 0; const apply = (o) => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return mod.fetch(new Request("https://ultrastable.io/api/pilot", { method: "POST", body: f, headers: { "cf-connecting-ip": "203.0.113." + (++ipn) } }), E2); };
  const good = { system: "A club website and member platform", keeps_doing: "keeps improving search ranking and member features every week", measure: "weekly sessions and sign-ups, target +5 percent a month", budget: "200 USD a month", runs_on: "our Cloudflare account" };
  let r = await apply(good); assert.equal(r.status, 201); let j = await r.json(); assert.equal(j.fit, true); assert.deepEqual(Object.values(j.checks), [true, true, true, true]);
  r = await apply({ ...good, system: "A packing list for camping trips", keeps_doing: "make it once", measure: "", budget: "none" }); assert.equal(r.status, 400, "missing answers are refused with what to fill in");
  r = await apply({ ...good, system: "A packing list for camping trips", keeps_doing: "a one-off page we use for the trip, nothing more", budget: "10" }); j = await r.json(); assert.equal(j.fit, false); assert.match(j.message, /system test/);
  const page = await (await get("https://ultrastable.io/pilot")).text(); assert.ok(page.includes('action="/api/pilot"') && page.includes("system test") === false || page.includes('id="apply"'));
  assert.equal((await get("https://ultrastable.io/dashboard?tenant=ultrastable")).status, 200);
  assert.equal((await get("https://ultrastable.io/dashboard?tenant=nobody")).status, 404, "only registered tenants render");
  console.log("ultrastable-site pilot and tenant ok");
}
// TRANSPARENCY-1: /live is read-only for everyone: GET works, every write verb is refused, an absent snapshot says so.
{
  const snap = JSON.stringify({ generated: "2026-11-12T00:00:00Z", scoreboard: {} });
  const db = { prepare: (q) => ({ bind: () => ({ all: async () => ({ results: [{ body: snap.slice(0, 20) }, { body: snap.slice(20) }] }) }), first: async () => ({ generated: "2026-11-12T00:00:00Z", total: 2 }) }) };
  let rr = await mod.fetch(new Request("https://ultrastable.io/api/live"), { ...ENV, DB: db });
  assert.equal(rr.status, 200); { const j = JSON.parse(await rr.text()); assert.equal(j.generated, "2026-11-12T00:00:00Z"); assert.equal(j.freshness.ok, false); /* LIVE-FRESH-1: a week-old snapshot is stale */ }
  rr = await mod.fetch(new Request("https://ultrastable.io/api/freshness"), { ...ENV, DB: db });
  assert.equal(rr.status, 503);
  rr = await mod.fetch(new Request("https://ultrastable.io/api/live"), ENV);
  assert.equal(rr.status, 503);
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) { rr = await mod.fetch(new Request("https://ultrastable.io/api/live", { method: m, body: "x" }), { ...ENV, DB: db }); assert.equal(rr.status, 405); }
  rr = await mod.fetch(new Request("https://ultrastable.io/live"), ENV);
  assert.equal(rr.status, 200); assert.match(await rr.text(), /running on Ultrastable/);
}
// AGENTIC-1: discovery documents and the read-only MCP endpoint
{
  const snap = JSON.stringify({ generated: "g", scoreboard: { a: 1 }, throughput: { changelog: [] }, managers: [], claims: {}, gaps: [] });
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [{ body: snap }] }) }), first: async () => ({ generated: "g", total: 1 }) }) };
  const E3 = { ...ENV, DB: db };
  const g3 = async (p, init) => mod.fetch(new Request("https://ultrastable.io" + p, init), E3);
  let rr = await g3("/.well-known/api-catalog"); assert.match(rr.headers.get("content-type"), /linkset\+json/); assert.ok((await rr.json()).linkset.length >= 1);
  rr = await g3("/.well-known/mcp/server-card.json"); assert.equal((await rr.json()).serverInfo.name, "ultrastable-live");
  rr = await g3("/.well-known/agent-skills/index.json"); const sk = (await rr.json()).skills[0]; assert.match(sk.sha256, /^[0-9a-f]{64}$/);
  const md = await (await g3("/.well-known/agent-skills/ultrastable-live/SKILL.md")).text();
  const h = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(md)))).map(x => x.toString(16).padStart(2, "0")).join(""); assert.equal(h, sk.sha256);
  assert.match(await (await g3("/robots.txt")).text(), /Content-Signal:/);
  assert.match((await g3("/")).headers.get("link"), /api-catalog/);
  const rpc = async (m, params) => (await (await g3("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params }) })).json());
  assert.equal((await rpc("tools/list")).result.tools.length, 20); // 11 snapshot tools + 6 live control-plane tools (CONTROL-PLANE-1) + submit_work (AGENT-HARNESS-1)
  assert.equal(JSON.parse((await rpc("tools/call", { name: "get_scoreboard" })).result.content[0].text).a, 1);
  assert.equal((await rpc("nope")).error.code, -32601);
  assert.equal((await g3("/.well-known/mcp")).status, 200);
  { const pg = await (await g3("/connect-agent")).text(); assert.match(pg, /vscode:mcp\/install\?/); assert.match(pg, /codex mcp add ultrastable --url https:\/\/ultrastable.io\/mcp/); assert.ok(!/token/i.test(pg.replace(/Nothing to copy or paste/, "")), "no token step"); } // CONNECT-PAGE-1
  assert.match(await (await g3("/connect-agent")).text(), /vscode:mcp\/install/); // one-click connect page
  assert.ok(JSON.parse((await rpc("tools/call", { name: "get_standards" })).result.content[0].text).entries.length > 15);
  assert.ok(JSON.parse((await rpc("tools/call", { name: "get_blind_spots" })).result.content[0].text).length > 5); // AGENT-HARNESS-1: well-known discovery
  assert.equal((await g3("/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "submit_work", arguments: { title: "t", agent: "a", harness: "h" } } }) })).status >= 400, true, "submit_work without a token is refused");
  assert.equal((await g3("/mcp")).status, 405); assert.equal((await g3("/mcp", { method: "DELETE" })).status, 405);
}
// TOPOLOGY-1: the owner dashboard is reached through the OWNER service binding, only on its own paths
{
  const hits = []; const OWNER = { fetch: async (r) => { hits.push(new URL(r.url).pathname); return new Response("dash"); } };
  const E4 = { ...ENV, OWNER };
  for (const p of ["/owner", "/owner/", "/api/owner/code"]) { const rr = await mod.fetch(new Request("https://ultrastable.io" + p), E4); assert.equal(await rr.text(), "dash"); }
  const rr = await mod.fetch(new Request("https://ultrastable.io/api/owner"), E4); assert.notEqual(await rr.text(), "dash");
  assert.equal(hits.length, 3);
}
// BUILD-3: tick = model health + automatic change rounds (max 2) + idea work items; /status reads the records; a dead model id is skipped.
{
  const store3 = new Map(), kv3 = { get: async k => store3.has(k) ? store3.get(k) : null, put: async (k, v) => { store3.set(k, v); }, delete: async k => { store3.delete(k); },
    list: async ({ prefix }) => ({ keys: [...store3.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name })), list_complete: true }) };
  const calls = []; const AI3 = { run: async (m, a) => { calls.push(m); if (m.includes("gpt-oss-20b")) throw new Error("deprecated"); if (a.messages[0].content && a.messages[0].content.includes("strict reviewer")) return { response: JSON.stringify({ met: ["ok"], gaps: [] }) }; return { response: "<html><body>round</body></html>" }; } };
  const env3 = { ASSETS: kv3, AI: AI3 }, sid = "abcdef0123";
  store3.set("idea:2026-11-12T10:00:00.000Z:" + sid, "bin day app"); store3.set("state:" + sid, "ready"); store3.set("site:" + sid, "<html><body>v1</body></html>");
  store3.set("brief:" + sid, JSON.stringify({ brief: "Idea: bins" })); store3.set("audit:" + sid, JSON.stringify({ met: [], gaps: [{ what: "No dark mode", critical: false }, { what: "No sign-up", critical: true }], limits: [] }));
  const T = (await import(pathToFileURL(fileURLToPath(new URL("./worker.js", import.meta.url))).href));
  const out = await T.tick(env3, null);
  assert.equal(out.rounds.length, 1); assert.deepEqual(out.rounds[0].todo, ["No dark mode"]); assert.equal(store3.get("rounds:" + sid), "1");
  assert.match(store3.get("site:" + sid), /round/); assert.equal(out.ideas, 1);
  const h = JSON.parse(store3.get("health:models")); assert.equal(h.models.find(m => m.model.includes("gpt-oss-20b")).ok, false);
  calls.length = 0; store3.set("rounds:" + sid, "1"); store3.set("audit:" + sid, JSON.stringify({ met: [], gaps: [{ what: "y", critical: false }], limits: [] })); await T.changeRounds(env3, null);
  assert.ok(calls.length > 0 && !calls.some(m => m.includes("gpt-oss-20b")), "a dead model id is never called");
  store3.set("audit:" + sid, JSON.stringify({ met: [], gaps: [{ what: "x", critical: false }], limits: [] })); store3.set("rounds:" + sid, "2");
  assert.equal((await T.changeRounds(env3, null)).length, 0, "round cap of 2");
  const res = await mod.fetch(new Request("https://ultrastable.io/status"), env3), txt = await res.text();
  assert.equal(res.status, 200); assert.match(txt, /Model health/); assert.match(txt, /dead: /); assert.match(txt, /Gaps closed automatically/);
  console.log("ultrastable-site build-3 ok");
}
// FRONT-DOOR-2: the idea consumer scaffolds a Worker and deploys it; without credentials it records pending-credentials and fakes nothing.
{
  const { consumeIdeas, scaffoldWorker } = await import(pathToFileURL(fileURLToPath(new URL("./worker.js", import.meta.url))).href);
  assert.match(scaffoldWorker("abc1234567", "<html>x</html>"), /export default \{ async fetch/);
  const k = new Map([["idea:2026-11-13T00:00:00.000Z:abc1234567", "bins"], ["state:abc1234567", "ready"], ["site:abc1234567", "<html>x</html>"]]);
  const E = { ASSETS: { get: async (x) => k.has(x) ? k.get(x) : null, put: async (x, v) => { k.set(x, v); }, list: async ({ prefix }) => ({ keys: [...k.keys()].filter(n => n.startsWith(prefix)).map(name => ({ name })), list_complete: true }) } };
  let o = await consumeIdeas(E); assert.equal(o[0].reason, "pending-credentials");
  const calls = []; const fake = async (u, i) => { calls.push((i && i.method || "GET") + " " + u); return new Response(JSON.stringify({ result: { subdomain: "q" } }), { status: 200 }); };
  o = await consumeIdeas(Object.assign({ CF_DEPLOY_TOKEN: "t", CF_ACCOUNT_ID: "a" }, E), fake); assert.equal(o[0].ok, true);
  assert.ok(calls[0].startsWith("PUT https://api.cloudflare.com/client/v4/accounts/a/workers/scripts/us-idea-abc1234567"));
  assert.equal(JSON.parse(k.get("deploy:abc1234567")).url, "https://us-idea-abc1234567.q.workers.dev");
  assert.deepEqual(await consumeIdeas(E), [], "a deployed idea is not deployed again");
}
// USER-PATH-1 / SETUP-2: no autopilot step, public-state detection and task wizards are in the page
{ const s = await (await get("https://ultrastable.io/setup")).text();
  assert.ok(!/autopilot/i.test(s), "autopilot step is gone");
  assert.match(s, /api\.github\.com\/repos/); assert.match(s, /pages\.dev/); assert.match(s, /"tasks"/); }

// PROMOTE-1: IndexNow channel (key file served, daily submission, failure recorded not thrown)
{ /* PROMOTE-1 IndexNow: key file, daily cadence, failures recorded */
  const P = await import("./promote.js");
  const kf = P.keyFile("/" + P.INDEXNOW_KEY + ".txt");
  assert.equal(await kf.text(), P.INDEXNOW_KEY);
  assert.equal(P.keyFile("/other.txt"), null);
  let sent = null;
  const ok = await P.indexNow({ host: "ultrastable.io", now: new Date("2026-11-14T06:17:00Z"), fetchFn: async (u, o) => { sent = JSON.parse(o.body); return { status: 202 }; } });
  assert.equal(ok.ok, true); assert.equal(sent.urlList.length, P.SITEMAP_PATHS.length); assert.ok(sent.keyLocation.endsWith(P.INDEXNOW_KEY + ".txt"));
  assert.equal(await P.indexNow({ host: "ultrastable.io", now: new Date("2026-11-14T12:17:00Z"), last: ok, fetchFn: async () => { throw new Error("must not send"); } }), null);
  const bad = await P.indexNow({ host: "ultrastable.io", now: new Date("2026-11-14T13:17:00Z"), last: { ...ok, ok: false }, fetchFn: async () => { throw new Error("net down"); } });
  assert.equal(bad.ok, false); assert.match(bad.error, /net down/);
}
console.log("PROMOTE-1 indexnow ok");

{ /* BLINDSPOT-1: privacy, accessibility and security contact exist and match the code */
  const pv = await get("https://ultrastable.io/privacy"), ac = await get("https://ultrastable.io/accessibility"), st = await get("https://ultrastable.io/.well-known/security.txt");
  assert.equal(pv.status, 200); assert.match(await pv.text(), /no cookie/);
  assert.equal(ac.status, 200); assert.match(await ac.text(), /WCAG 2\.2/);
  const t = await st.text(); assert.equal(st.status, 200); assert.match(t, /^Contact: mailto:/); assert.match(t, /Expires: /);
  console.log("BLINDSPOT-1 pages ok");
}

// AGENT-READY-2: Markdown for Agents, AI-bot rules in robots.txt, WebMCP tools (blog.cloudflare.com/agent-readiness).
{
  const md = await mod.fetch(new Request("https://ultrastable.io/how", { headers: { accept: "text/markdown" } }), ENV, { waitUntil() {} });
  assert.equal(md.status, 200); assert.match(md.headers.get("content-type"), /^text\/markdown/); assert.match(md.headers.get("vary") || "", /Accept/i);
  const mdText = await md.text(); assert.match(mdText, /^# /); assert.ok(!/<div|<script/i.test(mdText), "markdown must carry no markup");
  const html = await mod.fetch(new Request("https://ultrastable.io/how", { headers: { accept: "text/html,text/markdown;q=0.5" } }), ENV, { waitUntil() {} });
  assert.match(html.headers.get("content-type"), /text\/html/); assert.match(html.headers.get("vary") || "", /Accept/i);
  assert.match(await html.text(), /src="\/webmcp\.js"/);
  const rb = await (await get("https://ultrastable.io/robots.txt")).text();
  assert.match(rb, /User-agent: GPTBot[\s\S]*?Disallow: \//); assert.match(rb, /User-agent: Claude-User[\s\S]*?Allow: \//); assert.match(rb, /Content-Signal/); assert.match(rb, /Sitemap:/);
  const wm = await get("https://ultrastable.io/webmcp.js");
  assert.match(wm.headers.get("content-type"), /javascript/);
  const js = await wm.text(); assert.match(js, /navigator\.modelContext/); assert.match(js, /ultrastable_status/); assert.ok(!/method:\s*'POST'/.test(js), "webmcp tools are read-only");
}

{ // STAKEHOLDERS-1: every audience path resolves, stories are well formed, one primary action per page
  const SHD = JSON.parse(readFileSync(new URL("../doctrine/stakeholders.json", import.meta.url), "utf8"));
  assert.ok(SHD.audiences.length >= 5 && SHD.showcases.length >= 2);
  const ok = async (href) => { const r = await get("https://ultrastable.io" + href.split("#")[0]); assert.equal(r.status, 200, href); return r.text(); };
  for (const a of SHD.audiences) {
    assert.ok(a.stories.length >= 3, a.id + " has stories");
    for (const t of a.stories) assert.ok(t.as && t.want && t.so, a.id + " story is as/want/so");
    assert.ok(a.path.length >= 3, a.id + " has a path");
    for (const st of [...a.path, a.cta]) { if (/^https:\/\//.test(st.href)) { assert.ok(new URL(st.href).hostname.endsWith(".ultrastable.workers.dev") || /^ultrastable\.(io|org)$/.test(new URL(st.href).hostname), "external steps stay in the family: " + st.href); continue; } await ok(st.href); }
    const h = await ok("/for/" + a.id);
    assert.match(h, /As [^<]*, I want [^<]*, so [^<]*\./);
    assert.equal(((h.replace(/<style>[\s\S]*?<\/style>/, "")).match(/class="btn btn-primary"/g) || []).length, 1, a.id + " one primary action");
  }
  for (const c of SHD.showcases) { const h = await ok("/showcase/" + c.id); assert.match(h, /<h1>/); for (const l of c.links) await ok(l.href); }
  assert.equal((await get("https://ultrastable.io/for/nope")).status, 404);
  assert.equal((await get("https://ultrastable.io/showcase/nope")).status, 404);
  const home = await ok("/"); for (const a of SHD.audiences) assert.ok(home.includes("/for/" + a.id), "home links " + a.id);
  const fam = await (await get("https://ultrastable.io/family.json")).json();
  assert.ok(fam.family.io && fam.family.org && fam.nav.length >= 5, "family.json carries both homes and the shared nav");
  for (const c of SHD.showcases) { assert.ok(["io", "org"].includes(c.domain), c.id + " has a domain"); if (c.home) assert.match(await (await get("https://ultrastable.io/showcase/" + c.id)).text(), new RegExp(c.home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); }
  assert.match(await (await get("https://ultrastable.io/")).text(), /The Ultrastable family:/);
  console.log("STAKEHOLDERS-1 ok");
}

{ // BRAND-SEPARATION-1 (Rowan, 2026-11-17): QNFO is an earlier, separate project; it is named only on its case study, the showcase, the proof source line and the generated honest-gaps list on /how
  for (const pth of ["/", "/product", "/team", "/org", "/faq", "/contact", "/pilot", "/for", "/for/founders", "/for/communities", "/for/developers", "/for/funders", "/for/partners", "/llms.txt"]) {
    const h = await (await get("https://ultrastable.io" + pth)).text();
    assert.doesNotMatch(h, /QNFO/, pth + " does not name QNFO");
  }
  assert.match(await (await get("https://ultrastable.io/showcase/qnfo")).text(), /separate, earlier project and is not Ultrastable/);
  console.log("BRAND-SEPARATION-1 ok");
}
{ // CLAIMS-1 (Rowan, 2026-11-17): words match code. llms.txt lists exactly the MCP tools the worker serves; /claims and /api/claims serve the verified registry
  const { TOOLS, LIVE_TOOLS, WRITE_TOOLS } = await import(pathToFileURL(fileURLToPath(new URL("./agentic.js", import.meta.url))).href);
  const all = [...LIVE_TOOLS, ...TOOLS, ...WRITE_TOOLS].map((t) => t.name);
  const llms = await (await get("https://ultrastable.io/llms.txt")).text();
  for (const n of all) assert.ok(llms.includes(n), "llms.txt describes tool " + n);
  assert.ok(llms.includes("(" + all.length + " tools,"), "llms.txt tool count is the real count");
  const api = await (await get("https://ultrastable.io/api/claims")).json();
  assert.equal(api.summary.drift, 0, "the served registry has no drift");
  assert.equal(api.summary.total, api.claims.length);
  const page = await (await get("https://ultrastable.io/claims")).text();
  assert.match(page, /Verified claims/); assert.match(await (await get("https://ultrastable.io/how")).text(), new RegExp("One loop, " + api.ledgers.length + " ledgers"));
  assert.match(await (await get("https://ultrastable.io/sitemap.xml")).text(), /\/claims</);
  console.log("CLAIMS-1 ok");
}
// DATA-API-1, OWN-DOMAIN-1, ORG-THREAD-1 (Q-GAP-shared-backend, Q-GAP-own-domain, Q-GAP-org-setup-in-thread)
{
  const W = await import(pathToFileURL(fileURLToPath(new URL("./worker.js", import.meta.url))).href);
  const rows = []; let seq = 0;
  const stmt = (sql) => ({ b: [], bind(...a) { this.b = a; return this; },
    async run() { if (/INSERT/.test(sql)) { rows.push({ id: ++seq, site: this.b[0], coll: this.b[1], at: this.b[2], data: this.b[3] }); return { meta: { last_row_id: seq } }; } return {}; },
    async all() { return { results: rows.filter(x => x.site === this.b[0] && x.coll === this.b[1]).reverse().map(x => ({ id: x.id, at: x.at, data: x.data })) }; },
    async first() { return { n: rows.filter(x => x.site === this.b[0]).length }; } });
  const E4 = { ASSETS: mem, AI, DB: { prepare: stmt, batch: async () => [] } };
  const call = (host, path, init) => mod.fetch(new Request("https://" + host + path, init), E4);
  const jpost = (path, o, ip) => call("ultrastable.io", path, { method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": ip || "198.51.100.7" }, body: JSON.stringify(o) });
  // the record is the body; the list is the same one /s/<id>/api serves
  let x = await jpost("/api/data/" + id + "/Guests", { name: "Lin" }); assert.equal(x.status, 201); assert.equal((await x.json()).data.name, "Lin");
  x = await call("ultrastable.io", "/api/data/" + id + "/guests"); assert.deepEqual((await x.json()).items.map(i => i.data.name), ["Lin"]); assert.equal(x.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual((await (await call("ultrastable.io", "/s/" + id + "/api?coll=guests")).json()).items.map(i => i.data.name), ["Lin"], "one store, two paths");
  assert.equal((await jpost("/api/data/" + id + "/guests", [1])).status, 400); assert.equal((await jpost("/api/data/0000000000/guests", { a: 1 })).status, 404);
  assert.equal((await call("ultrastable.io", "/api/data/" + id)).status, 404); assert.equal((await call("ultrastable.io", "/api/data/" + id + "/guests", { method: "DELETE" })).status, 405);
  // own domain: nothing is stored until the TXT record names this site
  const dns = (txt) => async (url, init) => { const u = String(url);
    if (u.startsWith("https://cloudflare-dns.com/")) { assert.match(u, /name=_ultrastable\.www\.example\.org/); return new Response(JSON.stringify({ Answer: txt ? [{ data: "\"" + txt + "\"" }] : [] })); }
    if (u.includes("/custom_hostnames?hostname=")) return new Response(JSON.stringify({ success: true, result: [] }));
    if (u.endsWith("/custom_hostnames") && init.method === "POST") return new Response(JSON.stringify({ success: true, result: { id: "ch1", status: "pending", ssl: { status: "initializing" } } }));
    throw new Error("unexpected fetch " + u); };
  let d = await W.attachDomain(E4, id, "https://WWW.Example.org/path", dns(null));
  assert.equal(d.state, "waiting_for_dns"); assert.equal(d.status, 202); assert.equal(d.records[0].value, "ultrastable-site=" + id); assert.equal(d.records[1].value, id + ".ultrastable.io"); assert.equal(kv.has("domain:www.example.org"), false);
  d = await W.attachDomain(E4, id, "www.example.org", dns("ultrastable-site=ffffffffff")); assert.equal(d.state, "waiting_for_dns", "a record naming another site proves nothing");
  d = await W.attachDomain(E4, id, "www.example.org", async () => { throw new Error("offline"); }); assert.equal(d.state, "dns_unreadable"); assert.equal(kv.has("domain:www.example.org"), false);
  for (const badHost of ["ultrastable.io", "x.ultrastable.org", "foo.workers.dev", "nodots", "no spaces.com"]) assert.equal((await W.attachDomain(E4, id, badHost, dns(null))).code, "bad_domain", badHost);
  assert.equal((await W.attachDomain(E4, "0000000000", "www.example.org", dns(null))).code, "no_site");
  d = await W.attachDomain(E4, id, "www.example.org", dns("ultrastable-site=" + id)); assert.equal(d.state, "pending_platform", "proven, and honest that the edge step did not run"); assert.equal(JSON.parse(kv.get("domain:www.example.org")).id, id);
  d = await W.attachDomain({ ...E4, CF_DEPLOY_TOKEN: "t", CF_ZONE_ID: "z" }, id, "www.example.org", dns("ultrastable-site=" + id)); assert.equal(d.state, "issuing"); assert.equal(d.edge.cf_id, "ch1");
  d = await W.attachDomain({ ...E4, CF_DEPLOY_TOKEN: "t", CF_ZONE_ID: "z" }, id, "www.example.org", async (url) => String(url).startsWith("https://cloudflare-dns.com/") ? new Response(JSON.stringify({ Answer: [{ data: "ultrastable-site=" + id }] })) : new Response(JSON.stringify({ success: false, errors: [{ code: 1414, message: "not entitled" }] })));
  assert.equal(d.state, "edge_refused"); assert.match(d.edge.detail, /1414/);
  // the proven address serves the site and its data path; an unknown foreign host is not served a site
  x = await call("www.example.org", "/"); assert.equal(x.status, 200); const own = await x.text(); assert.match(own, /https:\/\/www\.example\.org\/s\/[a-f0-9]{10}\/api/); assert.match(x.headers.get("content-security-policy"), /allow-same-origin/);
  x = await call("www.example.org", "/s/" + id + "/api?coll=guests"); assert.deepEqual((await x.json()).items.map(i => i.data.name), ["Lin"]);
  x = await call("www.example.org", "/pilot"); assert.equal(x.status, 302); assert.equal(x.headers.get("location"), "https://www.example.org/");
  x = await call("stranger.example.net", "/"); assert.doesNotMatch(await x.text(), /window\.US=/);
  x = await jpost("/api/domain", { id, domain: "ultrastable.io" }); assert.equal(x.status, 400); assert.equal((await x.json()).code, "bad_domain");
  // organization setup in the thread: plan from the idea, steps from the same data /setup walks, progress saved and resumable
  const org = (o) => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return call("ultrastable.io", "/api/org", { method: "POST", body: f }); };
  let o = await (await org({ id })).json(); assert.equal(o.state, "in_progress"); assert.match(o.plan.objective, /bin day/); assert.equal(o.plan.measures.length, 6); assert.deepEqual(o.plan.roles.map(r => r.id), ["product-manager", "staff", "reviewer", "operations"]);
  assert.equal(o.next.id, "github"); assert.equal(o.done, 0); const total = o.total; assert.ok(total >= 4);
  assert.equal((await org({ id, step: "nope", answer: "done" })).status, 400); assert.equal((await org({ id, step: "github", answer: "maybe" })).status, 400); assert.equal((await org({ id: "0000000000" })).status, 404);
  o = await (await org({ id, step: "github", answer: "done" })).json(); assert.equal(o.done, 1); assert.equal(o.next.id, "copy"); assert.match(o.next.url, /github\.com\/ultrastable\/ultrastable\/generate/);
  o = await (await org({ id })).json(); assert.equal(o.next.id, "copy", "the thread resumes where it stopped");
  let guard = 0; while (o.next && guard++ < 20) o = await (await org({ id, step: o.next.id, answer: o.next.optional ? "skipped" : "done" })).json();
  assert.equal(o.state, "set_up"); assert.equal(o.done, total);
  const work = await W.ideaWork({ ...E4, ASSETS: { ...mem, list: async ({ prefix }) => ({ keys: [...kv.keys()].filter(k => k.startsWith(prefix)).sort().map(name => ({ name })), list_complete: true }) } }); assert.equal(work.find(i => i.id === id).org, "set_up", "the managers see the organization's progress");
  const IVm = (await import(pathToFileURL(fileURLToPath(new URL("./interview.js", import.meta.url))).href)).JS;
  assert.match(IVm, /setup-org/); assert.match(IVm, /'\/api\/org'/); assert.match(IVm, /Set up the organization/);
  console.log("ultrastable-site data path, own domain, organization in thread ok");
}
