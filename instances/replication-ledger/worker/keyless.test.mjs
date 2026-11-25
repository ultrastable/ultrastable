// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// Discovery with no OpenAlex key: the keyless routes (Crossref, Semantic Scholar), the OpenAlex mirror a GitHub runner lands, and the
// runner itself. Offline: every fetch is fake.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkFinding, BEAT } from "./discover.js";
import { crossrefSearch, s2Search, fromCrossrefWork, fromS2Paper, nameWords, named } from "./keyless.js";
import { fromMirror, discoveredFromMirror, compact, expand } from "./mirror.js";
import { buildMirror, sameContent } from "./openalex-mirror.mjs";

const finding = { id: "ego-depletion", name: "Ego depletion", claim: "Exerting self-control depletes a limited resource.", original: { doi: "10.1037/0022-3514.74.5.1252", title: "Ego depletion: is the active self a limited resource?" } };
const ABSTRACT = "We conducted a preregistered multisite replication of the ego depletion effect across 23 laboratories. The effect was close to zero and we failed to replicate the original finding of a depletion effect.";
const ok = body => ({ ok: true, status: 200, json: async () => body });
const refused = { ok: false, status: 429, headers: { get: () => "0" }, text: async () => "Insufficient budget. This request has no API key" };
const down = { ok: false, status: 503, headers: { get: () => null }, text: async () => "" };
const inv = t => { const o = {}; t.split(" ").forEach((w, i) => (o[w] ||= []).push(i)); return o; };

const CR_ITEM = { DOI: "10.1177/1745691616652873", title: ["A Multilab Preregistered Replication of the Ego-Depletion Effect"], author: [{ given: "Martin S.", family: "Hagger" }, { given: "Nikos", family: "Chatzisarantis" }],
  issued: { "date-parts": [[2016, 7]] }, "container-title": ["Perspectives on Psychological Science"], abstract: `<jats:p>${ABSTRACT}</jats:p>`, "is-referenced-by-count": 1400 };
const CR_OFF = { DOI: "10.1/unrelated", title: ["Replication in physics labs"], abstract: "<jats:p>We failed to replicate a superconductivity claim.</jats:p>" };
const S2_PAPER = { paperId: "abc", title: "A Multilab Preregistered Replication of the Ego-Depletion Effect", abstract: ABSTRACT, year: 2016, venue: "Perspectives on Psychological Science",
  authors: [{ name: "M. Hagger" }], externalIds: { DOI: "10.1177/1745691616652873" }, citationCount: 1500 };

// OpenAlex and Europe PMC refuse; Crossref and Semantic Scholar answer as told.
function world({ crossref = ok({ message: { items: [CR_ITEM, CR_OFF] } }), s2 = [ok({ data: [S2_PAPER] })] } = {}, calls = []) {
  let s2n = 0;
  return async url => {
    calls.push(url);
    if (url.startsWith("https://api.openalex.org/")) return refused;
    if (url.startsWith("https://www.ebi.ac.uk/")) return down;
    if (url.startsWith("https://api.crossref.org/works?")) return crossref;
    if (url.startsWith("https://api.semanticscholar.org/")) return s2[Math.min(s2n++, s2.length - 1)];
    return down;
  };
}

test("Crossref works are shaped like OpenAlex works", () => {
  const w = fromCrossrefWork(CR_ITEM);
  assert.equal(w.doi, "https://doi.org/10.1177/1745691616652873");
  assert.equal(w.publication_year, 2016);
  assert.equal(w.authorships[0].author.display_name, "Martin S. Hagger");
  assert.equal(w.primary_location.source.display_name, "Perspectives on Psychological Science");
  assert.ok(w.abstract_inverted_index.replication);
  assert.equal(fromS2Paper(S2_PAPER).doi, "https://doi.org/10.1177/1745691616652873");
  assert.equal(fromS2Paper({ ...S2_PAPER, externalIds: {} }).doi, null);
});

test("a keyless record counts only when it names the finding", async () => {
  assert.deepEqual(nameWords(finding), ["ego", "depletion"]);
  assert.equal(named(["ego", "depletion"], "physics labs"), false);
  const calls = [];
  const works = await crossrefSearch(finding, { rows: 5 }, world({}, calls));
  assert.equal(works.length, 1);
  assert.match(calls[0], /query=ego%20depletion%20replication/);
  assert.match(calls[0], /mailto=pilot%40ultrastable\.io/);
  assert.match(calls[0], /filter=has-abstract:true/);
});

test("when OpenAlex and Europe PMC refuse, Crossref answers and the same reader files the attempt with its verbatim quote", async () => {
  const calls = [];
  const r = await checkFinding(finding, { fetchImpl: world({}, calls) });
  assert.equal(r.source, "crossref");
  assert.deepEqual(r.tried, ["openalex", "europepmc", "crossref"]);
  assert.equal(r.attempts.length, 1);
  const a = r.attempts[0];
  assert.equal(a.outcome, "failed"); assert.equal(a.kind, "multisite"); assert.equal(a.machine, true);
  assert.ok(ABSTRACT.includes(a.quote));
  assert.equal(a.cite.doi, "10.1177/1745691616652873");
  assert.ok(!calls.some(u => u.startsWith("https://api.semanticscholar.org/")), "Semantic Scholar is not asked once Crossref answered");
});

test("Semantic Scholar answers when Crossref fails, after one retry on 429", async () => {
  const waits = [];
  const r = await checkFinding(finding, { fetchImpl: world({ crossref: down, s2: [{ ok: false, status: 429, headers: new Headers({ "retry-after": "1" }) }, ok({ data: [S2_PAPER] })] }), wait: async ms => waits.push(ms) });
  assert.equal(r.source, "semanticscholar");
  assert.equal(r.attempts.length, 1);
  assert.deepEqual(waits, [1000]);
  await assert.rejects(s2Search(finding, {}, async () => ({ ok: false, status: 429, headers: new Headers(), text: async () => "" }), async () => {}), /semanticscholar 429/);
});

test("the keyless budget is shared by the whole beat and a spent budget is named", async () => {
  const budget = { calls: BEAT.KEYLESS };
  assert.ok(BEAT.KEYLESS > 0 && BEAT.KEYLESS <= 10);
  const calls = [];
  const f = world({ crossref: down, s2: [down] }, calls);
  await assert.rejects(checkFinding(finding, { fetchImpl: f, budget: { calls: 0 } }), /openalex 429.*europepmc 503.*crossref: keyless budget for this beat is spent/);
  for (let i = 0; i < 5; i++) await checkFinding(finding, { fetchImpl: f, budget }).catch(() => null);
  assert.equal(budget.calls, 0);
  assert.equal(calls.filter(u => /crossref\.org|semanticscholar/.test(u)).length, BEAT.KEYLESS);
});

const MIRROR = {
  version: 1, generated_at: "2026-11-25T05:41:00Z", route: "github-actions",
  findings: { "ego-depletion": { doi: "10.1037/0022-3514.74.5.1252", openalex: "https://openalex.org/W1", is_retracted: false, cited_by_count: 5000,
    works: [compact({ id: "https://openalex.org/W2", doi: "https://doi.org/10.9999/mirror-rep", title: "A multilab test of ego depletion", publication_year: 2026,
      authorships: [{ author: { display_name: "Ann Lee" } }], primary_location: { source: { display_name: "J Rep" } } }, ABSTRACT)] } },
  discovered: [{ id: "pratfall-advantage", field: "psychology", name: "The pratfall advantage", claim: "A superior person who blunders is rated more attractive.", claim_quoted: true, original: { doi: "10.9999/pratfall" }, discovered: true, replications: [] },
    { id: "made-up", field: "astrology", claim: "x", claim_quoted: true, original: { doi: "10.9999/astro" } }],
  errors: []
};

test("the OpenAlex mirror a runner landed answers first when OpenAlex refuses the Worker, through the same guard", async () => {
  const calls = [];
  const r = await checkFinding(finding, { fetchImpl: world({}, calls), mirror: MIRROR });
  assert.equal(r.source, "openalex-mirror");
  assert.equal(r.openalex, "https://openalex.org/W1"); assert.equal(r.cited_by, 5000); assert.equal(r.retracted, false);
  assert.equal(r.attempts.length, 1);
  assert.ok(ABSTRACT.includes(r.attempts[0].quote));
  assert.equal(r.attempts[0].cite.doi, "10.9999/mirror-rep");
  assert.ok(calls.every(u => u.startsWith("https://api.openalex.org/")), "only the refused OpenAlex calls; the mirror costs no subrequest");
  assert.equal(fromMirror(MIRROR, { id: "renamed", original: { doi: "10.1037/0022-3514.74.5.1252" } }).works.length, 1);
  assert.equal(fromMirror(MIRROR, { id: "x", original: { doi: "10.1/none" } }), null);
  assert.equal(expand(MIRROR.findings["ego-depletion"].works[0]).authorships[0].author.display_name, "Ann Lee");
});

test("mirror discoveries are filtered like the beat's own: known DOIs, unknown fields and taken ids", () => {
  const found = discoveredFromMirror(MIRROR, { knownIds: new Set(["pratfall-advantage"]) });
  assert.equal(found.length, 1);
  assert.equal(found[0].id, "pratfall-advantage-2");
  assert.equal(discoveredFromMirror(MIRROR, { knownDois: new Set(["10.9999/pratfall"]) }).length, 0);
});

test("the runner asks OpenAlex the beat's question and writes compact records; unchanged content is not rewritten", async () => {
  const calls = [];
  const f = async url => {
    calls.push(url);
    if (url.includes("works/doi:")) return ok({ id: "https://openalex.org/W1", is_retracted: false, cited_by_count: 5000 });
    if (url.includes("filter=cites:W1,")) return ok({ results: [{ id: "https://openalex.org/W2", doi: "https://doi.org/10.9999/rep", title: "Ego depletion replicated?", publication_year: 2025, abstract_inverted_index: inv(ABSTRACT) }] });
    if (url.includes("works?search=")) return ok({ results: [] });
    return down;
  };
  const { mirror, answered } = await buildMirror([finding, { id: "no-doi", original: {} }], { fetchImpl: f, gap: 0, searches: 2, now: "2026-11-25T00:00:00Z" });
  assert.equal(answered, 1);
  const w = mirror.findings["ego-depletion"].works[0];
  assert.equal(w.abstract, ABSTRACT); assert.equal(w.doi, "https://doi.org/10.9999/rep");
  assert.ok(calls.every(u => !u.includes("api_key")));
  assert.equal(calls.filter(u => u.includes("works?search=")).length, 2);
  const again = await buildMirror([finding], { fetchImpl: f, gap: 0, searches: 2, now: "2026-11-26T00:00:00Z" });
  assert.ok(sameContent(mirror, again.mirror));
  const r = await checkFinding(finding, { fetchImpl: world(), mirror });
  assert.equal(r.source, "openalex-mirror"); assert.equal(r.attempts.length, 1);
});
