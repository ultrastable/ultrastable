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
const briefs = []; let builds = 0, sugCalls = 0;
const AI = { run: async (m, a) => {
  const user = a.messages[1].content;
  if (!m.includes("qwen")) {
    if (a.messages[0].content.includes("JSON array of strings")) { sugCalls++; return { response: JSON.stringify(["with online booking", "<b>bad</b>", "with online booking", "Add a map"]) }; }
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
for (const p of ["/", "/engineers", "/how", "/proof", "/pilot", "/product", "/team", "/org", "/faq", "/contact"]) {
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
// THREAD-1: a rounded composer (one line that grows) with mic, rotating idea chips and a conversation log.
assert.match(homeHtml, /class="th-cmp"/); assert.match(homeHtml, /id="th-mic"/); assert.match(homeHtml, /href="\/engineers"/); assert.match(homeHtml, /role="log"/);
assert.match(homeHtml, /<textarea id="th-in" name="idea" rows="1"/, "the composer starts as a one-line pill, never a square box");
assert.match(homeHtml, /\.th-cmp\{[^}]*border-radius:28px/, "composer is rounded");
assert.ok((homeHtml.match(/class="th-chip"/g) || []).length >= 6, "idea chips are offered");
assert.match(homeHtml, /form class="th-cmp" id="th-form" method="post" action="\/api\/idea"/, "works without JavaScript");
const st = await (await get("https://ultrastable.io/start?idea=A%20wedding%20page")).text(); assert.match(st, />A wedding page<\/textarea>/); assert.match(st, /"auto":true/);
for (const m of homeHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
const eng = await (await get("https://ultrastable.io/engineers")).text(); assert.match(eng, /Pinned/); assert.match(eng, /Live/);
const fp = new FormData(); fp.set("idea", "bins. for other people"); fp.set("profile", JSON.stringify({ space: { who: "B" } }));
r = await mod.fetch(new Request("https://ultrastable.io/api/idea", { method: "POST", body: fp }), E2); assert.equal(r.status, 303);
assert.ok([...kv.keys()].some((k) => k.startsWith("profile:")), "interview profile is stored with the idea");
// THREAD-1: the thread drives the build as JSON stages: idea -> build -> status with the independent check -> change.
const pj = (path, o, env) => { const f = new FormData(); for (const k in o) f.set(k, o[k]); return mod.fetch(new Request("https://ultrastable.io" + path, { method: "POST", body: f, headers: { accept: "application/json" } }), env || E2); };
r = await pj("/api/idea", { idea: "A cost controller that watches cloud spend and trims waste weekly. for other people", profile: JSON.stringify({ said: "A cost controller that watches cloud spend and trims waste weekly", space: { who: "B" }, adds: ["A photo gallery"] }) });
assert.equal(r.status, 201); const tj = await r.json(); assert.equal(tj.state, "building"); assert.ok(/^[a-f0-9]{10}$/.test(tj.id));
const picks = JSON.parse(kv.get("picks")); assert.equal(picks["A photo gallery"], 1); assert.equal(picks["A cost controller that watches cloud spend and trims waste weekly"], 1, "PICKS-1: chosen ideas are counted");
r = await mod.fetch(new Request("https://ultrastable.io/api/s/" + tj.id + "/build"), E2); assert.equal(r.status, 405);
r = await pj("/api/s/" + tj.id + "/build", {}); assert.equal((await r.json()).state, "ready");
r = await mod.fetch(new Request("https://ultrastable.io/api/s/" + tj.id), E2); let sj = await r.json(); assert.equal(sj.state, "ready");
r = await mod.fetch(new Request("https://ultrastable.io/api/s/" + tj.id), E2); sj = await r.json(); assert.ok(sj.audit && sj.audit.met.length, "status returns the independent check once it ran");
r = await pj("/api/change", { id: tj.id, change: "make it green" }); assert.equal(r.status, 201);
r = await pj("/api/s/" + tj.id + "/build", {}); assert.equal((await r.json()).state, "ready");
assert.match(briefs[briefs.length - 1], /make it green/);
assert.equal((await mod.fetch(new Request("https://ultrastable.io/api/s/0000000000"), E2)).status, 404);
r = await pj("/api/idea", { idea: "" }); assert.equal(r.status, 400); assert.ok((await r.json()).error);
// SUGGEST-1: ideas rotate (daily set + pool, ranked by picks) and adapt to what is typed; model output is cleaned and cached; offline falls back.
r = await mod.fetch(new Request("https://ultrastable.io/api/suggest"), E2); let sg = await r.json();
assert.ok(sg.ideas.length >= 10); assert.equal(sg.source, "daily+pool");
const n0 = sugCalls; r = await mod.fetch(new Request("https://ultrastable.io/api/suggest?mode=grow&q=wedding%20page"), E2); sg = await r.json();
assert.deepEqual(sg.ideas, ["with online booking", "Add a map"], "deduped, markup dropped"); assert.equal(sg.source, "model"); assert.ok(Array.isArray(sg.near));
r = await mod.fetch(new Request("https://ultrastable.io/api/suggest?mode=grow&q=wedding%20page"), E2); assert.equal((await r.json()).source, "cache"); assert.equal(sugCalls, n0 + 1, "a repeat costs no model call");
r = await mod.fetch(new Request("https://ultrastable.io/api/suggest?mode=add&q=bins"), { ASSETS: mem, AI: { run: async () => { throw new Error("down"); } } }); assert.equal((await r.json()).source, "fallback");
r = await get("https://ultrastable.io/api/suggest?q=cloud%20cost"); sg = await r.json(); assert.ok(sg.near.includes("A cost controller that watches cloud spend and trims waste weekly"), "no KV or model: pool keyword match");
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
