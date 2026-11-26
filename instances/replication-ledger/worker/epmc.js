// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The second route for reading a finding's replications (No single route): Europe PMC's free REST API, used when OpenAlex refuses
// the beat (it rate-limits by address and Workers share theirs). Europe PMC indexes PubMed and preprints, so it covers psychology,
// medicine and biology; findings it does not hold stay on OpenAlex and are retried next beat. Each record is shaped like an OpenAlex
// work so the same reader (kindOf, lexicalRead, modelRead with a verbatim quote) files it.
export const EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest/search";
const UA = "replication-ledger/1 (+https://replication-ledger.ultrastable.org; mailto:pilot@ultrastable.io)";
const strip = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

export async function epmc(query, { resultType = "lite", pageSize = 1, sort = "" } = {}, fetchImpl = fetch) {
  const u = `${EPMC}?query=${encodeURIComponent(query)}&format=json&resultType=${resultType}&pageSize=${pageSize}${sort ? "&sort=" + encodeURIComponent(sort) : ""}`;
  const r = await fetchImpl(u, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!r.ok) throw new Error(`europepmc ${r.status}`);
  return (await r.json())?.resultList?.result || [];
}

// An inverted index from plain text, the shape OpenAlex uses for abstracts.
export function invert(text) {
  const idx = {};
  strip(text).split(" ").forEach((w, i) => { if (w) (idx[w] ||= []).push(i); });
  return idx;
}

export function asWork(r) {
  const people = String(r.authorString || "").replace(/\.$/, "").split(/,\s*/).filter(Boolean);
  return { id: `https://europepmc.org/article/${r.source}/${r.id}`, doi: r.doi ? `https://doi.org/${r.doi}` : null, title: strip(r.title).replace(/\.$/, ""),
    publication_year: Number(r.pubYear) || null, authorships: people.map(p => ({ author: { display_name: p } })),
    primary_location: { source: { display_name: strip(r.journalInfo?.journal?.title || r.bookOrReportDetails?.publisher || "") } },
    abstract_inverted_index: r.abstractText ? invert(r.abstractText) : null, is_retracted: false, cited_by_count: r.citedByCount ?? null };
}

// The original by DOI, then the papers citing it whose text speaks of replication, newest first.
// Most-cited first, so the landmark replications are read before this year's passing mentions. When Europe PMC does not hold the
// original (many psychology journals are outside PubMed), the finding's name is searched in titles and abstracts instead.
const SPEAKS = `(replicat* OR reanalys* OR "re-analysis" OR "meta-analysis")`;
export const nameQuery = name => {
  const words = String(name || "").replace(/["()]/g, " ").split(/\s+/).filter(w => w.length > 2).slice(0, 6);
  return words.length ? `(${words.map(w => `TITLE_ABS:"${w}"`).join(" AND ")}) AND ${SPEAKS}` : null;
};
export async function citingReplications(doi, { pageSize = 12, name = "" } = {}, fetchImpl = fetch) {
  const [orig] = await epmc(`DOI:"${doi}"`, {}, fetchImpl);
  const opts = { resultType: "core", pageSize, sort: "CITED desc" };
  if (orig) {
    const rows = await epmc(`CITES:${orig.id}_${orig.source} AND ${SPEAKS}`, opts, fetchImpl);
    return { id: `${orig.source}/${orig.id}`, cited_by: orig.citedByCount ?? null, via: "cites", works: rows.map(asWork) };
  }
  const q = nameQuery(name);
  if (!q) return null;
  const rows = await epmc(q, opts, fetchImpl);
  return { id: null, cited_by: null, via: "name", works: rows.map(asWork) };
}
