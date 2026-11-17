// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import test from "node:test";
import assert from "node:assert/strict";
import { handle, cleanDomain, runChecks } from "../worker.js";

const fakeFetch = async (url, o = {}) => {
  const u = String(url);
  if (u.startsWith("https://cloudflare-dns.com")) return Response.json({ Answer: u.includes("_dmarc") ? [] : [{ data: '"v=spf1 -all"' }] });
  if (u.endsWith("/.well-known/security.txt")) return new Response("Contact: mailto:a@b.c");
  if (u.startsWith("http://")) return new Response("", { status: 301, headers: { location: "https://example.org/" } });
  return new Response('<a href="/privacy">Privacy</a>', { headers: { "strict-transport-security": "max-age=1" } });
};

test("domain validation rejects ips, ports, paths and private names", () => {
  assert.equal(cleanDomain("https://Example.org/x?y"), "example.org");
  for (const bad of ["127.0.0.1", "localhost", "a.local", "example.org:8080", "", "x"]) assert.equal(cleanDomain(bad), null);
});

test("checks report pass, fail and unknown", async () => {
  const r = await runChecks("example.org", ["https", "hsts", "security-txt", "spf", "dmarc", "privacy", "terms"], fakeFetch);
  assert.equal(r.https.pass, true); assert.equal(r.hsts.pass, true); assert.equal(r["security-txt"].pass, true);
  assert.equal(r.spf.pass, true); assert.equal(r.dmarc.pass, false); assert.equal(r.privacy.pass, true); assert.equal(r.terms.pass, false);
});

test("serves the page, rejects unknown hosts and bad domains, answers metrics without a DB", async () => {
  assert.equal((await handle(new Request("https://blindspot.ultrastable.app/"), {})).status, 200);
  assert.equal((await handle(new Request("https://nope.ultrastable.app/"), {})).status, 404);
  assert.equal((await handle(new Request("https://ultrastable.app/"), {})).status, 404);
  const bad = await handle(new Request("https://blindspot.ultrastable.app/api/check?domain=127.0.0.1"), {});
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "bad_domain");
  const m = await (await handle(new Request("https://blindspot.ultrastable.app/api/metrics"), {})).json();
  assert.equal(m.uses_7d, 0);
});

test("a check works end to end without a DB and stores nothing readable", async () => {
  const res = await handle(new Request("https://blindspot.ultrastable.app/api/check", { method: "POST", body: JSON.stringify({ domain: "example.org" }) }), {}, fakeFetch);
  const j = await res.json();
  assert.equal(j.ok, true); assert.equal(j.missing, 3); assert.ok(j.results.every(x => typeof x.title === "string"));
});

test("serves the IndexNow key file on an app host", async () => {
  const r = await handle(new Request("https://blindspot.ultrastable.app/ultrastable-indexnow-7f3a9c2e4b1d.txt"), {});
  assert.equal(await r.text(), "ultrastable-indexnow-7f3a9c2e4b1d");
});
