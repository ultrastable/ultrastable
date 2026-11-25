// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// Citations come from the registry, not from memory. fromCrossref() turns a Crossref work into a ledger citation, so `cli.mjs add`
// needs only a DOI; check() compares a stored citation with what Crossref holds for its DOI, so a mistyped DOI or title is caught.
// Crossref is open and needs no credential. fetch is injected so tests run offline.

const API = "https://api.crossref.org/works/";
const UA = "replication-ledger/1 (+https://github.com/ultrastable/replication-ledger)";

export async function lookup(doi, fetchImpl = fetch) {
  const r = await fetchImpl(API + encodeURIComponent(doi), { headers: { "user-agent": UA, accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`crossref ${r.status} for ${doi}`);
  return (await r.json()).message;
}

const clean = s => String(s || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

export function fromCrossref(m) {
  const people = (m.author || []).map(a => a.family ? `${a.family} ${(a.given || "").split(/[\s.-]+/).filter(Boolean).map(x => x[0]).join("")}`.trim() : clean(a.name));
  const authors = people.length > 6 ? people.slice(0, 3).join(", ") + ", et al." : people.join(", ");
  const year = (m.issued?.["date-parts"]?.[0]?.[0]) ?? (m["published-print"]?.["date-parts"]?.[0]?.[0]) ?? null;
  return { authors: authors || "Unknown", year, title: clean((m.title || [])[0]), venue: clean((m["container-title"] || [])[0]), doi: m.DOI };
}

const norm = s => clean(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Same work? The title words must largely agree and the year may differ by one (online-first versus print).
export function check(cite, m) {
  const issues = [];
  const got = fromCrossref(m);
  const a = new Set(norm(cite.title).split(" ")), b = new Set(norm(got.title).split(" "));
  const overlap = [...a].filter(w => b.has(w)).length / Math.max(1, Math.min(a.size, b.size));
  if (overlap < 0.6) issues.push(`title differs: ledger "${cite.title}" vs Crossref "${got.title}"`);
  if (got.year && Math.abs(got.year - cite.year) > 1) issues.push(`year differs: ledger ${cite.year} vs Crossref ${got.year}`);
  return issues;
}
