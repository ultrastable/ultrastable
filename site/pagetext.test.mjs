// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// LLMS-FULL-1, OPENSEARCH-1, SERVER-TIMING-1, EARLY-HINTS-1: the site serves its own pages as text and search, and every response carries its timing.
import { test } from "node:test";
import assert from "node:assert/strict";
import site, { pageText, searchPages, timed } from "./worker.js";

const get = (p) => site.fetch(new Request("https://ultrastable.io" + p, { headers: { "user-agent": "test-bot" } }), {}, { waitUntil() {} });

test("page text keeps the main content and drops markup and scripts", () => {
  const t = pageText("<html><head><title>A &amp; B</title></head><body><nav>menu</nav><main><h1>Hello</h1><script>x()</script><p>one &lt;two&gt;</p></main></body></html>");
  assert.equal(t.title, "A & B");
  assert.equal(t.text, "Hello\none <two>");
});

test("search ranks pages by every word and needs them all", () => {
  const pages = [{ path: "/a", title: "Pilot", text: "join the pilot programme" }, { path: "/b", title: "FAQ", text: "pilot questions and loops" }];
  assert.deepEqual(searchPages(pages, "pilot").map(h => h.path), ["/a", "/b"]);
  assert.deepEqual(searchPages(pages, "pilot loops").map(h => h.path), ["/b"]);
  assert.deepEqual(searchPages(pages, " "), []);
});

test("every response carries Server-Timing; pages also name the preload", async () => {
  const r = timed(new Response("<p>x</p>", { headers: { "content-type": "text/html" } }), 100, 142);
  assert.equal(r.headers.get("server-timing"), 'worker;dur=42;desc="site worker"');
  assert.match(r.headers.get("link"), /<\/favicon\.svg>; rel=preload; as=image/);
  const j = timed(Response.json({}), 0, 5);
  assert.equal(j.headers.get("link"), null);
});

test("llms-full, opensearch and search are served by the site worker", async () => {
  const full = await get("/llms-full.txt");
  assert.equal(full.status, 200); assert.ok(full.headers.get("server-timing"));
  const body = await full.text();
  assert.match(body, /^# Ultrastable/); assert.match(body, /## .+\n\nURL: https:\/\/ultrastable\.io\/how/);
  const os = await get("/opensearch.xml");
  assert.match(await os.text(), /template="https:\/\/ultrastable\.io\/search\?q=\{searchTerms\}"/);
  const s = await (await get("/search?q=pilot")).text();
  assert.match(s, /page(s)? match/); assert.match(s, /class="skip-link"/); assert.match(s, /rel="search"/);
});
