// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { standing, moved, attemptWeight } from "./standing.js";
import { validate, addReplication, withStandings } from "./ledger.js";
import { fromCrossref, check } from "./crossref.js";
import { route } from "./index.js";

const ledger = JSON.parse(readFileSync(new URL("./data/findings.json", import.meta.url), "utf8"));
let n = 0;
const cite = (doi, year = 2020) => ({ authors: "A B", year, title: "A study", venue: "J", doi });
const att = (outcome, kind = "direct", extra = {}) => ({ kind, outcome, preregistered: false, added: "2026-11-25", summary: "x", cite: cite("10.1234/t" + (n++)), ...extra });

test("the seed ledger validates and spans at least five fields", () => {
  assert.deepEqual(validate(ledger), []);
  assert.ok(new Set(ledger.findings.map(f => f.field)).size >= 5);
});

test("the seed contains findings that held and findings that failed, all computed", () => {
  const s = Object.fromEntries(withStandings(ledger).map(f => [f.id, f.standing.standing]));
  assert.equal(s["ego-depletion"], "fails");
  assert.equal(s["anchoring"], "holds");
  assert.equal(s["statins-mortality"], "holds");
  assert.equal(s["marshmallow-test"], "weakened");
  assert.equal(s["minimum-wage-nj"], "contested");
});

test("standing rubric: untested, thin, holds, fails, weakened, contested", () => {
  assert.equal(standing([]).standing, "untested");
  assert.equal(standing([att("held", "conceptual", { machine: true })]).standing, "thin");
  assert.equal(standing([att("held"), att("held")]).standing, "holds");
  assert.equal(standing([att("failed", "multisite")]).standing, "fails");
  assert.equal(standing([att("smaller", "multisite")]).standing, "weakened");
  assert.equal(standing([att("held"), att("failed")]).standing, "contested");
});

test("preregistration and machine-read attempts change the weight", () => {
  assert.equal(attemptWeight(att("held", "direct", { preregistered: true })), 2.5);
  assert.equal(attemptWeight(att("held", "direct", { machine: true })), 1);
  assert.equal(attemptWeight(att("held", "unknown-kind")), 0);
});

test("a typed standing, a number in a summary, or a duplicate paper is refused", () => {
  const bad = structuredClone(ledger);
  bad.findings[0].standing = "holds";
  bad.findings[1].replications[0].summary = "found 3 effects";
  bad.findings[2].replications.push(structuredClone(bad.findings[2].replications[0]));
  const errs = validate(bad).join("\n");
  assert.match(errs, /standing is computed/);
  assert.match(errs, /carries a number/);
  assert.match(errs, /filed twice/);
});

test("adding a replication recomputes the standing and logs the move", () => {
  const { ledger: next, change } = addReplication(ledger, "anchoring", att("failed", "multisite", { preregistered: true }));
  assert.equal(change.from, "holds");
  assert.notEqual(change.to, "holds");
  assert.equal(change.moved, true);
  assert.equal(ledger.findings.find(f => f.id === "anchoring").replications.length, 1, "input not mutated");
  assert.equal(next.findings.find(f => f.id === "anchoring").replications.length, 2);
  assert.throws(() => addReplication(ledger, "no-such", att("held")), /no finding/);
  assert.equal(moved({ standing: "holds" }, { standing: "fails" }).kind, "down");
});

test("Crossref metadata becomes a citation and mismatches are caught", () => {
  const m = { DOI: "10.1/x", title: ["Ego depletion: is the active self a limited resource?"], "container-title": ["JPSP"], issued: { "date-parts": [[1998]] },
    author: [{ family: "Baumeister", given: "Roy F." }, { family: "Tice", given: "Dianne M." }] };
  assert.deepEqual(fromCrossref(m), { authors: "Baumeister RF, Tice DM", year: 1998, title: m.title[0], venue: "JPSP", doi: "10.1/x" });
  assert.deepEqual(check({ title: "Ego depletion: Is the active self a limited resource", year: 1998 }, m), []);
  assert.equal(check({ title: "Something else entirely about cats", year: 2005 }, m).length, 2);
});

test("the Worker serves findings with computed standings", async () => {
  const all = await route("https://x/api/findings").json();
  assert.equal(all.findings.length, ledger.findings.length);
  assert.ok(all.findings.every(f => f.standing.standing));
  const one = await route("https://x/api/findings/ego-depletion").json();
  assert.equal(one.standing.standing, "fails");
  assert.equal(route("https://x/api/findings/nope").status, 404);
  assert.equal((await route("https://x/health").json()).ok, true);
});
