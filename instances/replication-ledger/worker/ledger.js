// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The ledger's data model and its validator. A finding is one claim with its original study and every replication attempt on record;
// a citation names authors, year, title, venue and a DOI (or, only when none is registered, a note saying why, and a url where one exists).
// validate() is the gate every write passes: the CLI refuses to save a ledger it rejects, and the tests run it on the seed.

import { KINDS, OUTCOMES, standing } from "./standing.js";

export const FIELDS = {
  psychology: { name: "Psychology" },
  medicine: { name: "Medicine" },
  economics: { name: "Economics" },
  physics: { name: "Physics" },
  biology: { name: "Biology" },
  "social-science": { name: "Social science" }
};

const DOI = /^10\.\d{4,9}\/\S+$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DIGIT = /\d/;

export function citeErrors(c, where) {
  const e = [];
  if (!c || typeof c !== "object") return [`${where}: citation missing`];
  for (const k of ["authors", "title", "venue"]) if (!c[k] || typeof c[k] !== "string") e.push(`${where}: ${k} missing`);
  if (!Number.isInteger(c.year) || c.year < 1600 || c.year > 2100) e.push(`${where}: year must be a whole year`);
  if (c.doi != null && !DOI.test(c.doi)) e.push(`${where}: doi "${c.doi}" is not a DOI`);
  if (c.doi == null && !c.note) e.push(`${where}: without a DOI a citation needs a note saying why`);
  return e;
}

export const doiKey = d => String(d || "").trim().toLowerCase();

export function validate(ledger) {
  const errs = [];
  const ids = new Set();
  if (!ledger || !Array.isArray(ledger.findings)) return ["ledger.findings must be a list"];
  for (const f of ledger.findings) {
    const at = `finding ${f.id || "?"}`;
    if (!SLUG.test(f.id || "")) errs.push(`${at}: id must be a lowercase slug`);
    if (ids.has(f.id)) errs.push(`${at}: duplicate id`);
    ids.add(f.id);
    if (!FIELDS[f.field]) errs.push(`${at}: unknown field "${f.field}"`);
    for (const k of ["name", "claim", "query"]) if (!f[k]) errs.push(`${at}: ${k} missing`);
    if ("standing" in f) errs.push(`${at}: standing is computed by standing.js, never typed`);
    errs.push(...citeErrors(f.original, `${at} original`));
    const seen = new Set();
    for (const [i, r] of (f.replications || []).entries()) {
      const rw = `${at} replication ${i + 1}`;
      if (!KINDS[r.kind]) errs.push(`${rw}: unknown kind "${r.kind}"`);
      if (!OUTCOMES[r.outcome]) errs.push(`${rw}: unknown outcome "${r.outcome}"`);
      if (typeof r.preregistered !== "boolean") errs.push(`${rw}: preregistered must be true or false`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.added || "")) errs.push(`${rw}: added must be a date`);
      if (!r.summary) errs.push(`${rw}: summary missing`);
      else if (DIGIT.test(r.summary)) errs.push(`${rw}: summary carries a number; numbers enter only from the source`);
      errs.push(...citeErrors(r.cite, rw));
      if (r.cite?.doi) {
        if (seen.has(doiKey(r.cite.doi))) errs.push(`${rw}: the same paper is filed twice`);
        if (doiKey(r.cite.doi) === doiKey(f.original?.doi)) errs.push(`${rw}: the original cannot replicate itself`);
        seen.add(doiKey(r.cite.doi));
      }
    }
  }
  for (const p of ledger.projects || []) errs.push(...citeErrors(p.cite, `project ${p.id}`));
  return errs;
}

// The ledger as served: each finding with its computed standing.
export function withStandings(ledger) {
  return ledger.findings.map(f => ({ ...f, standing: standing(f.replications) }));
}

// Append one replication attempt to a finding. Returns { ledger, change } or throws; the input is never mutated.
export function addReplication(ledger, findingId, attempt) {
  const next = structuredClone(ledger);
  const f = next.findings.find(x => x.id === findingId);
  if (!f) throw new Error(`no finding "${findingId}"`);
  const before = standing(f.replications);
  f.replications = [...(f.replications || []), attempt];
  const errs = validate(next);
  if (errs.length) throw new Error(errs.join("\n"));
  const after = standing(f.replications);
  return { ledger: next, change: { finding: findingId, at: attempt.added, doi: attempt.cite.doi || null, outcome: attempt.outcome,
    from: before.standing, to: after.standing, moved: before.standing !== after.standing } };
}
