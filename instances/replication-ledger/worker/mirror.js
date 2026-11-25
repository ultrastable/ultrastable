// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The second egress (No single route): OpenAlex refuses calls from Cloudflare Workers that carry no API key, but answers GitHub's
// runners. The daily workflow ledger-openalex.yml runs openalex-mirror.mjs there, which asks OpenAlex the same questions the beat asks
// (openalexCandidates and discoverFindings in discover.js) and lands the answers as data/openalex.json on main; the Worker bundles that
// file at deploy and the beat reads it as one more route. Records are stored with plain-text abstracts (smaller than OpenAlex's inverted
// index) and turned back into OpenAlex works here, so the same reader and verbatim-quote guard file them. Nothing here fetches.
import { invert } from "./epmc.js";
import { doiKey, FIELDS } from "./ledger.js";

export const MIRROR_VERSION = 1;

// Compact form written by the runner: one OpenAlex work to the fields the reader and citeOf need.
export function compact(w, abstract) {
  return { id: w.id, doi: w.doi || null, title: w.title || "", publication_year: w.publication_year ?? null,
    authors: (w.authorships || []).map(a => a.author?.display_name).filter(Boolean).slice(0, 7),
    venue: w.primary_location?.source?.display_name || "", abstract: String(abstract || "").slice(0, 4000) };
}

// Back to the shape of an OpenAlex work.
export const expand = c => ({ id: c.id, doi: c.doi, title: c.title, publication_year: c.publication_year,
  authorships: (c.authors || []).map(n => ({ author: { display_name: n } })), primary_location: { source: { display_name: c.venue || "" } },
  abstract_inverted_index: c.abstract ? invert(c.abstract) : null });

// One finding's entry, matched by the original's DOI so a renamed finding still finds its record. null when the mirror does not hold it.
export function fromMirror(mirror, f) {
  const want = doiKey(f?.original?.doi);
  if (!want || !mirror?.findings) return null;
  const e = mirror.findings[f.id]?.doi && doiKey(mirror.findings[f.id].doi) === want ? mirror.findings[f.id]
    : Object.values(mirror.findings).find(x => doiKey(x.doi) === want);
  if (!e) return null;
  return { openalex: e.openalex || null, retracted: !!e.is_retracted, cited_by: e.cited_by_count ?? null, works: (e.works || []).map(expand) };
}

// Findings the runner discovered with originalOf (claim quoted from the original's own abstract), filtered as discoverFindings filters:
// a DOI or id the ledger already holds is skipped, and only ledger fields are kept.
export function discoveredFromMirror(mirror, { knownDois = new Set(), knownIds = new Set(), max = 3 } = {}) {
  const found = [];
  for (const f of mirror?.discovered || []) {
    if (found.length >= max) break;
    const d = doiKey(f?.original?.doi);
    if (!d || knownDois.has(d) || !FIELDS[f.field] || !f.claim || !f.claim_quoted) continue;
    let id = f.id, i = 2;
    while (knownIds.has(id)) id = `${f.id}-${i++}`;
    knownIds.add(id); knownDois.add(d);
    found.push({ ...f, id, replications: [], via_route: "openalex-mirror" });
  }
  return found;
}
