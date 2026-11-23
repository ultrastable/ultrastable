// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from "node:test";
import assert from "node:assert/strict";
import { handleLive, SOURCES, a11y, cleanCountry, cleanPlace } from "../live.js";

const app = id => ({ name: id, tagline: "t", live: id });
const ok = body => new Response(typeof body === "string" ? body : JSON.stringify(body));
const get = (id, path, f) => handleLive(id, app(id), new URL("https://x.ultrastable.app" + path), f);

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

test("country-snapshot validates the code, reads four World Bank measures, maps an unknown code to not_found", async () => {
  assert.equal(cleanCountry("ke"), "KE"); assert.equal(cleanCountry("Kenya"), null);
  assert.equal((await get("country-snapshot", "/api/lookup?q=12", async () => ok([]))).status, 400);
  const f = async u => ok([{ page: 1 }, [{ country: { value: "Kenya" }, date: "2022", value: 76.54 }]]);
  const j = await (await get("country-snapshot", "/api/lookup?q=ke", f)).json();
  assert.equal(j.title, "Kenya"); assert.equal(j.rows.length, 4); assert.deepEqual(j.rows[0].cells.slice(1), ["76.5%", "2022"]);
  const none = async () => ok([{ message: [{ id: "120", key: "Invalid value" }] }]);
  assert.equal((await get("country-snapshot", "/api/lookup?q=ZZ", none)).status, 404);
});

test("air-quality geocodes any city anywhere then reads current air quality", async () => {
  assert.equal(cleanPlace("São Paulo"), "São Paulo"); assert.equal(cleanPlace("x"), null); assert.equal(cleanPlace("a<b>"), null);
  const f = async u => String(u).includes("geocoding") ? ok({ results: [{ name: "Nairobi", country: "Kenya", latitude: -1.28, longitude: 36.8 }] }) : ok({ current: { time: "2026-11-18T12:00", european_aqi: 31, us_aqi: 44, pm2_5: 9.1, pm10: 15 } });
  const j = await (await get("air-quality", "/api/lookup?q=Nairobi", f)).json();
  assert.equal(j.title, "Nairobi, Kenya"); assert.equal(j.rows[0].cells[1], "31");
  assert.equal((await get("air-quality", "/api/lookup?q=Nowhereville", async () => ok({}))).status, 404);
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

test("use is counted as one aggregate row per app per day and reported as uses_7d; no DB is harmless", async () => {
  const rows = new Map(), run = { run: async () => ({}) };
  const DB = { prepare: q => ({ bind: (...a) => ({ q, a, first: async () => ({ n: [...rows.values()].reduce((x, y) => x + y, 0) }), run: async () => ({}) }), run: async () => ({}), q }),
    batch: async st => { const ins = st[1]; const k = ins.a.join("|"); rows.set(k, (rows.get(k) || 0) + 1); } };
  const f = async () => ok({ features: [] });
  await handleLive("quake-watch", app("quake-watch"), new URL("https://x/"), f, { DB });
  await handleLive("quake-watch", app("quake-watch"), new URL("https://x/api/data"), f, { DB });
  assert.equal([...rows.values()][0], 2); assert.equal(rows.size, 1);
  assert.match([...rows.keys()][0], /^quake-watch\|\d{4}-\d{2}-\d{2}$/);  // app and day only
  const m = await (await handleLive("quake-watch", app("quake-watch"), new URL("https://x/api/metrics"), f, { DB })).json();
  assert.equal(m.uses_7d, 2);
  assert.equal((await handleLive("quake-watch", app("quake-watch"), new URL("https://x/"), f, {})).status, 200);
});

test("CONTEXT-FIT-1: lookup and feed answers are in the page itself, so they show with scripts off", async () => {
  const f = async () => ok([{ page: 1 }, [{ country: { value: "Kenya" }, date: "2022", value: 76.54 }]]);
  const html = await (await get("country-snapshot", "/?q=ke", f)).text();
  assert.match(html, /<form id="f" method="get" action="\/">/); assert.match(html, /<h2>Kenya<\/h2>/); assert.match(html, /76\.5%/);
  const feedf = async () => ok({ features: [{ properties: { place: "Somewhere", mag: 5.1, time: 1000, url: "u1" } }] });
  assert.match(await (await get("quake-watch", "/", feedf)).text(), /<td><a href='u1'>Somewhere<\/a><\/td>/);
});
