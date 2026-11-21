// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// THOUGHT-1: every paper page carries the hook (Ultrastable runs on Ultrastable; Practical Solutions is one system it runs) and share links,
// and /research.atom lists every paper with an id that changes when its measured result does.
import assert from "node:assert/strict";
import { researchRoutes, atom } from "./research.js";
import DATA from "./research-data.js";
const shell = (m, body) => `<title>${m.title}</title>${body}`, HTML = { "Content-Type": "text/html" };
const page = async p => researchRoutes(new URL("https://ultrastable.io" + p), shell, HTML);
const list = await (await page("/research")).text();
assert.match(list, /Ultrastable runs on Ultrastable/); assert.match(list, /href="https:\/\/ultrastable\.org">Practical Solutions/);
assert.ok(DATA.papers.length >= 4, "the own papers (open loops, safety by limits) are generated");
for (const p of DATA.papers) {
  const h = await (await page("/research/" + p.slug)).text();
  assert.match(h, /Ultrastable runs on Ultrastable/, p.slug);
  assert.match(h, /linkedin\.com\/sharing\/share-offsite\/\?url=https%3A%2F%2Fultrastable\.io%2Fresearch%2F/, p.slug);
}
const r = await page("/research.atom"); assert.match(r.headers.get("content-type"), /atom/);
const x = await r.text();
for (const p of DATA.papers) assert.ok(x.includes(`/research/${p.slug}#${p.met}of${p.total}`), p.slug);
assert.equal(atom(DATA).split("<entry>").length - 1, DATA.papers.length);
console.log("research hook, share links and feed ok");
