// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// The discovery loop, offline: a fake OpenAlex and Crossref, a D1 stand-in on node:sqlite, and a fake model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { kindOf, lexicalRead, quoted, readCandidate, abstractText, originalOf, slug } from "./discover.js";
import { beat, load, freshness } from "./store.js";
import worker, { route } from "./index.js";

const inv = t => { const o = {}; t.split(" ").forEach((w, i) => (o[w] ||= []).push(i)); return o; };

function d1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, b = []) => ({
    bind: (...x) => stmt(sql, x),
    all: async () => ({ results: db.prepare(sql).all(...b) }),
    run: async () => { const r = db.prepare(sql).run(...b); return { meta: { last_row_id: Number(r.lastInsertRowid) } }; },
    _run: () => db.prepare(sql).run(...b)
  });
  return { prepare: sql => stmt(sql), batch: async ss => ss.map(s => s._run()) };
}

const EGO = "https://openalex.org/W1";
const REP = "We ran a preregistered multilab replication across many labs of the ego depletion effect. The depletion effect was close to zero and we failed to replicate the original effect in every lab.";
const ORIG_ABS = "Four experiments examined whether people who exert self-control later show weaker self-control on an unrelated task. Results suggest that the self has a limited resource that acts like strength or energy.";
function fakeFetch(calls = []) {
  return async url => {
    calls.push(url);
    const ok = body => ({ ok: true, status: 200, json: async () => body });
    if (url.startsWith("https://api.crossref.org/")) return { ok: false, status: 404, json: async () => ({}) };
    if (url.includes("works/doi:")) return ok(url.includes("0022-3514.74.5.1252") ? { id: EGO, is_retracted: false, cited_by_count: 5000 } : { id: "https://openalex.org/W9", is_retracted: false, cited_by_count: 10 });
    if (url.includes("filter=cites:W1,")) return ok({ results: [
      { id: "https://openalex.org/W2", doi: "https://doi.org/10.9999/new-rep", title: "A new multilab test of ego depletion", publication_year: 2026, authorships: [{ author: { display_name: "Ann Lee" } }], primary_location: { source: { display_name: "J Rep" } }, abstract_inverted_index: inv(REP) },
      { id: "https://openalex.org/W3", doi: "https://doi.org/10.9999/opinion", title: "Thoughts on willpower", publication_year: 2026, abstract_inverted_index: inv("An essay about willpower and the self.") }] });
    if (url.includes("filter=cites:")) return ok({ results: [] });
    if (url.includes("works?search=")) return ok({ results: [{ id: "https://openalex.org/W5", title: "Registered replication report: the pratfall advantage", referenced_works: ["https://openalex.org/W6", "https://openalex.org/W7"] }] });
    if (url.includes("filter=openalex:")) return ok({ results: [
      { id: "https://openalex.org/W6", doi: "https://doi.org/10.9999/pratfall", title: "The pratfall advantage in interpersonal attraction", publication_year: 1966, cited_by_count: 900, primary_topic: { display_name: "Attraction", field: { display_name: "Psychology" } }, abstract_inverted_index: inv("A superior person who commits a blunder is rated as more attractive than one who does not, in a study of college students.") },
      { id: "https://openalex.org/W7", doi: "https://doi.org/10.9999/other", title: "Statistics for everyone", cited_by_count: 9000, primary_topic: { field: { display_name: "Mathematics" } } }] });
    return { ok: false, status: 500, json: async () => ({}) };
  };
}

test("the readers: kind, verbatim quote, lexical outcome", () => {
  assert.equal(kindOf("A Many Labs replication"), "multisite");
  assert.equal(kindOf("A meta-analysis of trials"), "meta-analysis");
  assert.equal(kindOf("An essay"), null);
  assert.equal(lexicalRead(REP).outcome, "failed");
  assert.ok(quoted(REP, "The depletion effect was close to zero and we failed to replicate the original effect in every lab."));
  assert.equal(quoted(REP, "The effect replicated strongly in every lab we ran."), false);
  assert.equal(abstractText(inv("b a c")), "b a c");
  assert.equal(slug("The pratfall advantage in interpersonal attraction"), "pratfall-advantage-interpersonal-attraction");
});

test("a model answer without a verbatim quote is refused and the fixed reader takes over", async () => {
  const w = { title: "A many labs test", doi: "https://doi.org/10.1/x", abstract_inverted_index: inv(REP) };
  const liar = { run: async () => ({ response: '{"replicates": true, "outcome": "held", "quote": "It replicated beautifully in every lab we tried."}' }) };
  const r = await readCandidate(w, { claim: "c" }, liar);
  assert.equal(r.attempt.outcome, "failed");
  assert.equal(r.attempt.read_by, "lexical");
  const honest = { run: async () => ({ response: { replicates: true, outcome: "smaller", preregistered: true, quote: "The depletion effect was close to zero and we failed to replicate the original effect in every lab." } }) };
  const h = await readCandidate(w, { claim: "c" }, honest);
  assert.equal(h.attempt.read_by, "model");
  assert.equal(h.attempt.machine, true);
});

test("a landmark original is found from a replication paper's references", async () => {
  const f = await originalOf({ title: "Registered replication report: the pratfall advantage", referenced_works: ["W6", "W7"] }, fakeFetch());
  assert.equal(f.field, "psychology");
  assert.equal(f.discovered, true);
  assert.equal(f.original.doi, "10.9999/pratfall");
  assert.match(f.claim, /blunder/);
});

test("one beat files the attempt, keeps the lead, adds the finding, logs the move, and a second beat files nothing twice", async () => {
  const env = { DB: d1() };
  const r = await beat(env, { fetchImpl: fakeFetch(), now: "2026-11-25T16:00:00.000Z" });
  assert.deepEqual(r.errors, []);
  assert.equal(r.findings, 1);
  let { ledger, live } = await load(env);
  const ego = ledger.findings.find(f => f.id === "ego-depletion");
  assert.ok(ego.replications.some(a => a.machine && a.cite.doi === "10.9999/new-rep"));
  assert.ok(ledger.findings.some(f => f.id === "pratfall-advantage-interpersonal-attraction"));
  assert.equal(live.leads, 1);
  assert.equal(live.beats.length, 1);
  const before = ego.replications.length;
  await beat(env, { fetchImpl: fakeFetch(), now: "2026-11-25T17:00:00.000Z" });
  ({ ledger, live } = await load(env));
  assert.equal(ledger.findings.find(f => f.id === "ego-depletion").replications.length, before);
  assert.equal(ledger.findings.filter(f => f.id.startsWith("pratfall")).length, 1);
  const page = await route("https://x/f/ego-depletion", ledger, live).text();
  assert.match(page, /Found by the ledger/);
  assert.match(await route("https://x/changes", ledger, live).text(), /Recent searches/);
  assert.equal(route("https://x/feed.json", ledger, live).status, 200);
  assert.equal(typeof freshness(ledger, live).oldest_check_days, "number");
});

test("a request sparks a beat when the last one is old; the Worker serves the seed without a database", async t => {
  const real = globalThis.fetch;
  globalThis.fetch = fakeFetch();
  t.after(() => { globalThis.fetch = real; });
  const res = await worker.fetch(new Request("https://x/health"), {}, {});
  assert.equal((await res.json()).ok, true);
  const env = { DB: d1() }, waits = [];
  await worker.fetch(new Request("https://x/"), env, { waitUntil: p => waits.push(p) });
  assert.equal(waits.length, 1);
  await Promise.all(waits);
});

test("the watchdog's restart route runs a beat only when the last one is old", async t => {
  const real = globalThis.fetch;
  globalThis.fetch = fakeFetch();
  t.after(() => { globalThis.fetch = real; });
  const env = { DB: d1() };
  const r1 = await (await worker.fetch(new Request("https://x/pulse/watch", { method: "POST" }), env, {})).json();
  assert.equal(r1.ok, true);
  assert.equal(typeof r1.n, "number");
  const r2 = await (await worker.fetch(new Request("https://x/pulse/watch", { method: "POST" }), env, {})).json();
  assert.match(r2.skipped, /recent/);
});
