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
    return { response: JSON.stringify([{ q: "Do neighbours sign up?", cue: "e.g. a list" }, { q: "Phone first?", cue: "small screens" }, { q: "Calm look?", cue: "simple" }]) };
  }
  builds++; briefs.push(user); const ch = user.includes("current page") && !user.includes("Fix these problems");
  return { response: "```html\n<html><body><h1>" + (user.includes("Fix these problems") ? "fixed" : ch ? "changed" : "bins") + "</h1></body></html>\n```" };
} };
const E2 = { ASSETS: mem, AI };
const post = (path, o) => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return mod.fetch(new Request("https://ultrastable.io" + path, { method: "POST", body: f }), E2); };
r = await get("https://ultrastable.io/start"); assert.equal(r.status, 200); assert.match(await r.text(), /Tell me what is on your mind/);
r = await post("/api/idea", { idea: "an app for bin day" });
assert.equal(r.status, 303); const id = /\/s\/([a-f0-9]{10})\/ask/.exec(r.headers.get("location"))[1];
for (let i = 0; i < 3; i++) {
  r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/ask"), E2); assert.match(await r.text(), new RegExp("Question " + (i + 1) + " of 3"));
  r = await post("/api/answer", { id, a: ["yes", "no", "unsure"][i] });
  assert.equal(r.status, 303); assert.match(r.headers.get("location"), i < 2 ? /\/ask$/ : /\/make$/);
}
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/make"), E2); assert.equal(r.status, 302, "the /make request itself runs the build");
assert.match(briefs[0], /Do neighbours sign up\? YES/); assert.match(briefs[0], /Phone first\? NO/); assert.match(briefs[0], /Calm look\? NOT SURE/);
assert.equal(builds, 1, "the build is its own stage; the audit and fix run in a later request");
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id), E2); assert.equal(r.status, 200); assert.equal(builds, 2, "first view starts the audit, which fixes the critical gap");
const page = await r.text(); assert.match(page, /<h1>fixed<\/h1>/); assert.match(page, /Change something/); assert.match(page, /What I checked/); assert.match(r.headers.get("content-security-policy"), /sandbox/);
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/review"), E2); const rv = await r.text();
assert.match(rv, /Has a heading/); assert.match(rv, /No sign-up form \(fixed automatically\)/); assert.match(rv, /What I cannot do yet/); assert.match(rv, /not shared with other visitors/);
r = await post("/api/change", { id, change: "make it green" }); assert.equal(r.status, 303);
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/make"), E2); assert.equal(r.status, 302);
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id), E2); assert.match(await r.text(), /changed/);
// BUILD-2: a model that always fails ends as failed after 3 tries, and the questions fall back to defaults
const bad = { ASSETS: mem, AI: { run: async () => { throw new Error("model down"); } } };
const post2 = (path, o) => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return mod.fetch(new Request("https://ultrastable.io" + path, { method: "POST", body: f }), bad); };
r = await post2("/api/idea", { idea: "x" }); const id2 = /\/s\/([a-f0-9]{10})\/ask/.exec(r.headers.get("location"))[1];
for (let i = 0; i < 3; i++) await post2("/api/answer", { id: id2, a: "yes" });
for (let i = 0; i < 4; i++) { r = await mod.fetch(new Request("https://ultrastable.io/s/" + id2 + "/make"), bad); }
assert.equal(kv.get("state:" + id2), "failed"); assert.match(await r.text(), /Something went wrong/);
r = await mod.fetch(new Request("https://ultrastable.io/s/0000000000"), E2); assert.equal(r.status, 404);
r = await get("https://ultrastable.net/"); assert.equal(r.headers.get("location"), "https://ultrastable.io/proof");
r = await get("https://www.ultrastable.io/how"); assert.equal(r.headers.get("location"), "https://ultrastable.io/how");
for (const p of ["/", "/engineers", "/dashboard", "/roadmap", "/how", "/proof", "/pilot", "/product", "/team", "/org", "/faq", "/contact"]) {
  r = await get("https://ultrastable.io" + p); assert.equal(r.status, 200, p);
  const h = await r.text(); assert.match(h, /<body/); assert.match(h, /rel="canonical"/);
  assert.ok(((h.replace(/<style>[\s\S]*?<\/style>/, "")).match(/class="btn btn-primary"/g) || []).length <= 1, p + " has at most one primary action");
}
assert.match(await (await get("https://ultrastable.io/")).text(), /Live checks are loading/, "offline claims fail soft");
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

// Generic public pages: no research framing, no prior-disclosure or patent-mechanism wording (docs/CONFIDENTIALITY.md).
for (const p of ["/", "/product", "/team", "/org", "/faq", "/contact"]) {
  const h = await (await get("https://ultrastable.io" + p)).text();
  assert.doesNotMatch(h, /QNFO|patent|provisional|disclos|research/i, p + " stays generic");
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
  assert.ok(html.includes("Q-LOOP-live-clock") && /live feed/i.test(html), "the pending live feed is stated, not faked");
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
  assert.equal(rr.status, 200); assert.equal(await rr.text(), snap);
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
  assert.equal((await rpc("tools/list")).result.tools.length, 11);
  assert.equal(JSON.parse((await rpc("tools/call", { name: "get_scoreboard" })).result.content[0].text).a, 1);
  assert.equal((await rpc("nope")).error.code, -32601);
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
  const calls = []; const AI3 = { run: async (m, a) => { calls.push(m); if (m.includes("llama-3.1-8b")) throw new Error("deprecated"); if (a.messages[0].content && a.messages[0].content.includes("strict reviewer")) return { response: JSON.stringify({ met: ["ok"], gaps: [] }) }; return { response: "<html><body>round</body></html>" }; } };
  const env3 = { ASSETS: kv3, AI: AI3 }, sid = "abcdef0123";
  store3.set("idea:2026-11-12T10:00:00.000Z:" + sid, "bin day app"); store3.set("state:" + sid, "ready"); store3.set("site:" + sid, "<html><body>v1</body></html>");
  store3.set("brief:" + sid, JSON.stringify({ brief: "Idea: bins" })); store3.set("audit:" + sid, JSON.stringify({ met: [], gaps: [{ what: "No dark mode", critical: false }, { what: "No sign-up", critical: true }], limits: [] }));
  const T = (await import(pathToFileURL(fileURLToPath(new URL("./worker.js", import.meta.url))).href));
  const out = await T.tick(env3, null);
  assert.equal(out.rounds.length, 1); assert.deepEqual(out.rounds[0].todo, ["No dark mode"]); assert.equal(store3.get("rounds:" + sid), "1");
  assert.match(store3.get("site:" + sid), /round/); assert.equal(out.ideas, 1);
  const h = JSON.parse(store3.get("health:models")); assert.equal(h.models.find(m => m.model.includes("llama-3.1-8b")).ok, false);
  calls.length = 0; store3.set("rounds:" + sid, "1"); store3.set("audit:" + sid, JSON.stringify({ met: [], gaps: [{ what: "y", critical: false }], limits: [] })); await T.changeRounds(env3, null);
  assert.ok(calls.length > 0 && !calls.some(m => m.includes("llama-3.1-8b")), "a dead model id is never called");
  store3.set("audit:" + sid, JSON.stringify({ met: [], gaps: [{ what: "x", critical: false }], limits: [] })); store3.set("rounds:" + sid, "2");
  assert.equal((await T.changeRounds(env3, null)).length, 0, "round cap of 2");
  const res = await mod.fetch(new Request("https://ultrastable.io/status"), env3), txt = await res.text();
  assert.equal(res.status, 200); assert.match(txt, /Model health/); assert.match(txt, /dead: /); assert.match(txt, /Gaps closed automatically/);
  console.log("ultrastable-site build-3 ok");
}
