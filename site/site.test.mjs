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
assert.match(homeHtml, /class="us-ask"/); assert.match(homeHtml, /id="us-mic"/); assert.match(homeHtml, /href="\/engineers"/);
assert.doesNotMatch(homeHtml, /<textarea/, "no intimidating text box on the front door");
for (const m of homeHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)) new Function(m[1]);
const eng = await (await get("https://ultrastable.io/engineers")).text(); assert.match(eng, /Pinned/); assert.match(eng, /Live/);
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
