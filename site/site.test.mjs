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
// BUILD-1: idea -> building -> live page -> change, all in plain words, with an in-memory KV and a fake model
const kv = new Map(); const mem = { delete: async (k) => { kv.delete(k); }, get: async (k) => kv.has(k) ? kv.get(k) : null, put: async (k, v) => { kv.set(k, v); } };
let calls = 0; const AI = { run: async (m, a) => { calls++; const ch = a.messages[1].content.includes("current page"); return { response: "```html\n<html><body><h1>" + (ch ? "changed" : "bins") + "</h1></body></html>\n```" }; } };
const E2 = { ASSETS: mem, AI };
r = await get("https://ultrastable.io/start"); assert.equal(r.status, 200); assert.match(await r.text(), /What do you want to build/);
const fd = new FormData(); fd.set("idea", "an app for bin day");
r = await mod.fetch(new Request("https://ultrastable.io/api/idea", { method: "POST", body: fd }), E2);
assert.equal(r.status, 303); const id = /\/s\/([a-f0-9]{10})\/make/.exec(r.headers.get("location"))[1];
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/make"), E2); assert.equal(r.status, 302, "the /make request itself runs the build and redirects when ready");
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id), E2); assert.equal(r.status, 200);
const page = await r.text(); assert.match(page, /<h1>bins<\/h1>/); assert.match(page, /Change something/); assert.match(r.headers.get("content-security-policy"), /sandbox/);
const fc = new FormData(); fc.set("id", id); fc.set("change", "make it green");
r = await mod.fetch(new Request("https://ultrastable.io/api/change", { method: "POST", body: fc }), E2); assert.equal(r.status, 303);
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id + "/make"), E2); assert.equal(r.status, 302);
r = await mod.fetch(new Request("https://ultrastable.io/s/" + id), E2); assert.match(await r.text(), /changed/); assert.equal(calls, 2);
// BUILD-2: an evicted build (state stuck at building, claim expired) is resumed by the next poll; a model that always fails ends as failed after 3 tries
const bad = { ASSETS: mem, AI: { run: async () => { throw new Error("model down"); } } };
const f2 = new FormData(); f2.set("idea", "x"); r = await mod.fetch(new Request("https://ultrastable.io/api/idea", { method: "POST", body: f2 }), bad);
const id2 = /\/s\/([a-f0-9]{10})\/make/.exec(r.headers.get("location"))[1];
for (let i = 0; i < 4; i++) { r = await mod.fetch(new Request("https://ultrastable.io/s/" + id2 + "/make"), bad); }
assert.equal(kv.get("state:" + id2), "failed"); assert.match(await r.text(), /Something went wrong/);
r = await mod.fetch(new Request("https://ultrastable.io/s/0000000000"), E2); assert.equal(r.status, 404);
r = await get("https://ultrastable.net/"); assert.equal(r.headers.get("location"), "https://ultrastable.io/proof");
r = await get("https://www.ultrastable.io/how"); assert.equal(r.headers.get("location"), "https://ultrastable.io/how");
for (const p of ["/", "/how", "/proof", "/pilot", "/product", "/team", "/org", "/faq", "/contact"]) {
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
