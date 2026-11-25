// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFinding, abstractText, oa, setOpenAlexKey } from "./discover.js";
import { asWork, invert, nameQuery } from "./epmc.js";

const finding = { id: "ego-depletion", claim: "Exerting self-control depletes a limited resource.", original: { doi: "10.1037/0022-3514.74.5.1252" } };
const ABSTRACT = "We conducted a preregistered multisite replication of the ego depletion effect across 23 laboratories. The effect was close to zero and we failed to replicate the original finding of a depletion effect.";

function refusing(calls = []) {
  return async url => {
    calls.push(url);
    if (url.startsWith("https://api.openalex.org/")) return { ok: false, status: 429, headers: { get: () => "0" }, text: async () => "Too Many Requests" };
    const ok = body => ({ ok: true, status: 200, json: async () => body });
    if (/query=DOI%3A/.test(url)) return ok({ resultList: { result: [{ id: "9599441", source: "MED", citedByCount: 4000 }] } });
    if (/query=CITES%3A9599441_MED/.test(url)) return ok({ resultList: { result: [{ id: "27474142", source: "MED", doi: "10.1177/1745691616652873",
      title: "A Multilab Preregistered Replication of the Ego-Depletion Effect.", pubYear: "2016", authorString: "Hagger MS, Chatzisarantis NL, Alberts H.",
      journalInfo: { journal: { title: "Perspectives on psychological science" } }, abstractText: `<h4>Abstract</h4>${ABSTRACT}` }] } });
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

test("an OpenAlex refusal names its reason", async () => {
  await assert.rejects(oa("works/x", refusing(), async () => {}), /openalex 429: Too Many Requests/);
});

test("when OpenAlex refuses, Europe PMC answers and the same reader files the attempt with its verbatim quote", async () => {
  const calls = [];
  const r = await checkFinding(finding, { fetchImpl: refusing(calls) });
  assert.equal(r.source, "europepmc");
  assert.equal(r.cited_by, 4000);
  assert.equal(r.attempts.length, 1);
  const a = r.attempts[0];
  assert.equal(a.outcome, "failed"); assert.equal(a.kind, "multisite"); assert.equal(a.preregistered, true);
  assert.ok(ABSTRACT.includes(a.quote));
  assert.equal(a.cite.doi, "10.1177/1745691616652873"); assert.match(a.cite.authors, /Hagger MS/);
  assert.ok(calls.some(u => u.startsWith("https://www.ebi.ac.uk/europepmc/")));
});

test("when both routes fail the error names both", async () => {
  const both = async () => ({ ok: false, status: 503, headers: { get: () => null }, text: async () => "" });
  await assert.rejects(checkFinding(finding, { fetchImpl: both }), /openalex 503; europepmc 503/);
});

test("Europe PMC records read like OpenAlex works", () => {
  const w = asWork({ id: "1", source: "MED", title: "<i>A</i> title.", pubYear: "2020", abstractText: "One two one." });
  assert.equal(w.title, "A title"); assert.equal(abstractText(w.abstract_inverted_index), "One two one.");
  assert.deepEqual(invert("a b a"), { a: [0, 2], b: [1] });
});

test("an original Europe PMC does not hold is searched by the finding's name, most-cited first", async () => {
  const calls = [];
  const f = async url => {
    calls.push(url);
    if (url.startsWith("https://api.openalex.org/")) return { ok: false, status: 429, headers: { get: () => "0" }, text: async () => "" };
    if (/query=DOI%3A/.test(url)) return { ok: true, status: 200, json: async () => ({ resultList: { result: [] } }) };
    return { ok: true, status: 200, json: async () => ({ resultList: { result: [{ id: "1", source: "MED", doi: "10.1/x", title: "Ego depletion: a multilab replication", pubYear: "2016", authorString: "A B.", abstractText: ABSTRACT }] } }) };
  };
  const r = await checkFinding({ ...finding, name: "Ego depletion" }, { fetchImpl: f });
  assert.equal(r.source, "europepmc"); assert.equal(r.attempts.length, 1);
  const last = decodeURIComponent(calls.at(-1));
  assert.match(last, /TITLE_ABS:"Ego"/); assert.match(last, /sort=CITED desc/);
  assert.equal(nameQuery(""), null);
});

test("a bound OpenAlex key is sent; without one none is", async () => {
  const seen = [];
  const f = async url => { seen.push(url); return { ok: true, status: 200, json: async () => ({}) }; };
  await oa("works/x", f); setOpenAlexKey("k1"); await oa("works/x", f); setOpenAlexKey("");
  assert.ok(!seen[0].includes("api_key")); assert.match(seen[1], /api_key=k1/);
});
