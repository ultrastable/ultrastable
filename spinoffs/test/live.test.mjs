// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from "node:test";
import assert from "node:assert/strict";
import { handleLive, SOURCES, a11y, cleanEin, lookup } from "../live.js";

const app = id => ({ name: id, tagline: "t", live: id });
const ok = body => new Response(typeof body === "string" ? body : JSON.stringify(body));
const get = (id, path, f) => handleLive(id, app(id), new URL("https://x.ultrastable.app" + path), f);

test("open-comment keeps only proposals still open, soonest first, from a live fetch", async () => {
  const f = async () => ok({ results: [
    { title: "Later", agency_names: ["A"], comments_close_on: "2999-02-01", html_url: "https://u/2" },
    { title: "Closed", agency_names: ["B"], comments_close_on: "2000-01-01", html_url: "https://u/0" },
    { title: "Soon", agency_names: ["C"], comments_close_on: "2999-01-01", html_url: "https://u/1" },
    { title: "No period", agency_names: [], comments_close_on: null, html_url: "https://u/3" }] });
  const j = await (await get("open-comment", "/api/data", f)).json();
  assert.deepEqual(j.rows.map(r => r.cells[0]), ["Soon", "Later"]);
  assert.ok(j.fetched_at);
  const fr = await get("open-comment", "/api/freshness", f);
  assert.equal(fr.status, 200); assert.equal((await fr.json()).ok, true);
});

test("a failing upstream makes freshness 503 and the data call a plain 502", async () => {
  const f = async () => new Response("no", { status: 500 });
  assert.equal((await get("quake-watch", "/api/freshness", f)).status, 503);
  const r = await get("quake-watch", "/api/data", f);
  assert.equal(r.status, 502); assert.match((await r.json()).error, /did not answer/);
});

test("quake-watch lists events newest first", async () => {
  const f = async () => ok({ features: [{ properties: { place: "Old", mag: 5.1, time: 1000, url: "u1" } }, { properties: { place: "New", mag: null, time: 2000, url: "u2" } }] });
  const j = await (await get("quake-watch", "/api/data", f)).json();
  assert.equal(j.rows[0].cells[0], "New"); assert.equal(j.rows[0].cells[1], "unknown");
});

test("nonprofit-check validates the EIN, shows filings, maps 404 to not_found", async () => {
  assert.equal(cleanEin("53-0196605"), "530196605"); assert.equal(cleanEin("12"), null);
  assert.equal((await get("nonprofit-check", "/api/lookup?q=abc", async () => ok({}))).status, 400);
  const f = async u => { assert.ok(u.endsWith("/530196605.json")); return ok({ organization: { name: "Org", city: "X", state: "VA" }, filings_with_data: [{ tax_prd_yr: 2022, totrevenue: 1500, totfuncexpns: 1000, totassetsend: null }] }); };
  const j = await (await get("nonprofit-check", "/api/lookup?q=53-0196605", f)).json();
  assert.equal(j.title, "Org"); assert.deepEqual(j.rows[0].cells, ["2022", "$1,500", "$1,000", "not reported"]);
  assert.equal((await get("nonprofit-check", "/api/lookup?q=530196605", async () => new Response("", { status: 404 }))).status, 404);
});

test("access-check rejects non-public names and scores a page", async () => {
  assert.equal((await get("access-check", "/api/lookup?q=127.0.0.1", async () => ok(""))).status, 400);
  const bad = a11y('<html><head><meta name="viewport" content="user-scalable=no"></head><img src=a><input id=x></html>');
  assert.equal(bad.filter(r => r.cells[1] === "pass").length, 0);
  const good = a11y('<html lang="en"><title>T</title><meta name="viewport" content="width=device-width"><main><h1>H</h1><label for=x>x</label><input id=x><img alt=""></main>');
  assert.ok(good.every(r => r.cells[1] === "pass"), JSON.stringify(good));
  const j = await (await get("access-check", "/api/lookup?q=example.org", async () => ok("<html lang=en>"))).json();
  assert.equal(j.ok, true); assert.equal(j.rows.length, 7);
});

test("every page renders, links its source and states it is not advice; every live idea has a source", async () => {
  for (const id of Object.keys(SOURCES)) {
    const html = await (await get(id, "/", async () => ok({}))).text();
    assert.match(html, /not legal, financial or professional advice/); assert.match(html, /\/api\/freshness/);
  }
  assert.equal((await get("nope", "/")).status, 404);
});
