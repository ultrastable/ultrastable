// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// UIUX-1: the experiment server. The arm matches foundation/design.py assign(), bots and Do Not Track get the control and are not counted, promoted defaults are served.
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
const m = await import(pathToFileURL(fileURLToPath(new URL("./uiux.js", import.meta.url))).href);
const data = { running: [{ id: "UX-001-home-setup-label", path: "/", slot: "home.setup_label", convert_on: "/setup", arms: [{ id: "control", overrides: {} }, { id: "start-mine", overrides: { primary_label: "Start my own system" } }] }], defaults: {} };
const arms = data.running[0].arms;
// vectors computed with python3 -c "from foundation import design; print(design.assign(...))"
assert.equal((await m.armFor("UX-001-home-setup-label", "us:1.2.3.4:Mozilla/5.0", arms)).id, "control");
assert.equal((await m.armFor("UX-001-home-setup-label", "us:9.9.9.9:Safari", arms)).id, "start-mine");
assert.equal((await m.armFor("UX-001-home-setup-label", "a", arms)).id, "start-mine");
const req = (h) => new Request("https://ultrastable.io/", { headers: h });
const human = await m.experimentFor(req({ "user-agent": "Mozilla/5.0", "cf-connecting-ip": "1.2.3.4" }), {}, "/", data);
assert.equal(human.arm, "control"); assert.equal(human.record, true);
const other = await m.experimentFor(req({ "user-agent": "Safari", "cf-connecting-ip": "9.9.9.9" }), {}, "/", data);
assert.equal(other.arm, "start-mine"); assert.equal(m.exposureName(other), "exp:UX-001-home-setup-label:start-mine");
assert.ok(m.exposureName(other).length <= 40, "the counter keeps 40 characters of an event name");
const again = await m.experimentFor(req({ "user-agent": "Safari", "cf-connecting-ip": "9.9.9.9" }), {}, "/", data);
assert.equal(again.arm, other.arm, "sticky: the same visitor gets the same arm");
for (const h of [{ "user-agent": "Safari", dnt: "1" }, { "user-agent": "Safari", "sec-gpc": "1" }, { "user-agent": "Googlebot/2.1" }, {}]) {
  const x = await m.experimentFor(req(h), {}, "/", data); assert.equal(x.arm, "control"); assert.equal(x.record, false, "not counted: " + JSON.stringify(h));
}
assert.equal(await m.experimentFor(req({ "user-agent": "Safari" }), {}, "/pilot", data), null, "no experiment on another path");
assert.equal(m.slotText("home.setup_label", "primary_label", "Set up my own", other, data), "Start my own system");
assert.equal(m.slotText("home.setup_label", "primary_label", "Set up my own", human, data), "Set up my own");
assert.equal(m.slotText("home.setup_label", "primary_label", "Set up my own", null, { running: [], defaults: { "home.setup_label": { primary_label: "Promoted" } } }), "Promoted", "a promoted default replaces the page's wording");
// the real site: both arms are served on /, exposure is recorded once, and the control is the page's own wording
const site = (await import(pathToFileURL(fileURLToPath(new URL("./worker.js", import.meta.url))).href)).default;
const { readFileSync } = await import("node:fs");
const A = (f) => { const b = readFileSync(new URL("./assets/" + f, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
globalThis.fetch = async () => { throw new Error("offline"); };
const seen = []; const DB = { prepare: (sql) => { const o = { bind: (...a) => { o.a = a; return o; }, run: async () => { seen.push(o.a); return {}; }, first: async () => null, all: async () => ({ results: [] }) }; return o; } };
const get = async (h) => { const waits = []; const r = await site.fetch(new Request("https://ultrastable.io/", { headers: h }), { ASSETS: { get: async (k) => A(k) }, DB }, { waitUntil: (p) => waits.push(p) }); await Promise.all(waits); return { text: await r.text(), arm: r.headers.get("x-experiment"), cache: r.headers.get("cache-control") }; };
const a = await get({ "user-agent": "Mozilla/5.0", "cf-connecting-ip": "1.2.3.4" }), b = await get({ "user-agent": "Safari", "cf-connecting-ip": "9.9.9.9" });
assert.match(a.arm, /:control$/); assert.ok(a.text.includes(">Set up my own</a>"));
assert.match(b.arm, /:start-mine$/); assert.ok(b.text.includes(">Start my own system</a>") && !b.text.includes(">Set up my own</a>"));
assert.match(a.cache, /private/, "a varied page is not shared-cached");
assert.ok(seen.some(x => String(x).includes("exp:UX-001-home-setup-label:start-mine")), "exposure recorded as a first-party event");
console.log("uiux ok");
