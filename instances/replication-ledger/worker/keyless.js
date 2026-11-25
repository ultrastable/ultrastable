// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// Keyless routes for reading a finding's replications (No single route), tried after Europe PMC when OpenAlex refuses the Worker:
// Crossref's works search and Semantic Scholar's paper search. Neither needs a key or an account. Both cover every field, so a finding
// outside PubMed (economics, physics, most of psychology) still gets searched. Each record is shaped like an OpenAlex work so the same
// reader (kindOf, lexicalRead, modelRead with a verbatim quote) files it, and a record without a DOI is never filed (checkFinding skips it).
// Neither route knows which papers cite the original, so a record is kept only when its title or abstract names the finding (named()).
// Calls are counted against one budget per beat (BEAT.KEYLESS in discover.js), because a Worker invocation has a subrequest limit.
import { invert } from "./epmc.js";

export const CROSSREF = "https://api.crossref.org/works";
export const S2 = "https://api.semanticscholar.org/graph/v1/paper/search";
export const CONTACT = "pilot@ultrastable.io";
const UA = `replication-ledger/1 (+https://replication-ledger.ultrastable.org; mailto:${CONTACT})`;
export const S2_WAIT_MS = 3000;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const strip = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const STOP = new Set("the and for with from that this effect effects study replication of in on a an to".split(" "));

// The words a record must carry to count as about this finding: up to four content words of its name (or of the original's title).
export function nameWords(f) {
  const src = f?.name || f?.original?.title || "";
  return strip(src).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(" ").filter(w => w.length > 2 && !STOP.has(w)).slice(0, 4);
}
export const named = (words, text) => { const t = strip(text).toLowerCase(); return words.length > 0 && words.every(w => t.includes(w)); };
export const searchText = f => { const w = nameWords(f); return w.length ? `${w.join(" ")} replication` : null; };

const fail = async (name, r) => { let why = ""; try { why = strip(await r.text()).slice(0, 80); } catch { why = ""; } return new Error(`${name} ${r.status}${why ? ": " + why : ""}`); };

export function fromCrossrefWork(m) {
  const people = (m.author || []).map(a => strip([a.given, a.family].filter(Boolean).join(" ") || a.name)).filter(Boolean);
  const year = m.issued?.["date-parts"]?.[0]?.[0] ?? m.published?.["date-parts"]?.[0]?.[0] ?? null;
  const doi = m.DOI ? `https://doi.org/${m.DOI}` : null;
  return { id: doi || `crossref:${strip((m.title || [])[0])}`, doi, title: strip((m.title || [])[0]).replace(/\.$/, ""), publication_year: Number(year) || null,
    authorships: people.map(p => ({ author: { display_name: p } })), primary_location: { source: { display_name: strip((m["container-title"] || [])[0]) } },
    abstract_inverted_index: m.abstract ? invert(strip(m.abstract).replace(/^abstract\s+/i, "")) : null, is_retracted: false, cited_by_count: m["is-referenced-by-count"] ?? null };
}

export function fromS2Paper(p) {
  const doi = p.externalIds?.DOI ? `https://doi.org/${p.externalIds.DOI}` : null;
  return { id: p.paperId ? `https://www.semanticscholar.org/paper/${p.paperId}` : doi, doi, title: strip(p.title).replace(/\.$/, ""), publication_year: Number(p.year) || null,
    authorships: (p.authors || []).map(a => ({ author: { display_name: strip(a.name) } })).filter(a => a.author.display_name),
    primary_location: { source: { display_name: strip(p.venue || p.journal?.name || "") } },
    abstract_inverted_index: p.abstract ? invert(p.abstract) : null, is_retracted: false, cited_by_count: p.citationCount ?? null };
}

const keep = (f, works) => { const w = nameWords(f); return works.filter(x => named(w, `${x.title} ${Object.keys(x.abstract_inverted_index || {}).join(" ")}`)); };

export async function crossrefSearch(f, { rows = 12 } = {}, fetchImpl = fetch) {
  const q = searchText(f);
  if (!q) return null;
  const u = `${CROSSREF}?query=${encodeURIComponent(q)}&filter=has-abstract:true&rows=${rows}&select=DOI,title,author,issued,container-title,abstract,is-referenced-by-count&mailto=${encodeURIComponent(CONTACT)}`;
  const r = await fetchImpl(u, { headers: { "user-agent": UA, accept: "application/json" } });
  if (!r.ok) throw await fail("crossref", r);
  return keep(f, ((await r.json())?.message?.items || []).map(fromCrossrefWork));
}

export async function s2Search(f, { limit = 12 } = {}, fetchImpl = fetch, wait = sleep) {
  const q = searchText(f);
  if (!q) return null;
  const u = `${S2}?query=${encodeURIComponent(q)}&limit=${limit}&fields=title,abstract,year,authors,venue,externalIds,citationCount`;
  for (let tries = 0; ; tries++) {
    const r = await fetchImpl(u, { headers: { "user-agent": UA, accept: "application/json" } });
    if (r.status === 429 && tries === 0) { await wait(Math.min(S2_WAIT_MS, 1000 * (Number(r.headers?.get?.("retry-after")) || 1))); continue; }
    if (!r.ok) throw await fail("semanticscholar", r);
    return keep(f, ((await r.json())?.data || []).map(fromS2Paper));
  }
}

// The routes in order. budget = { calls } is shared by the whole beat; a spent budget is named as the route's error.
export const ROUTES = [["crossref", crossrefSearch], ["semanticscholar", s2Search]];
export async function keylessRoute(name, f, { pageSize = 12, budget = { calls: Infinity }, wait } = {}, fetchImpl = fetch) {
  const fn = Object.fromEntries(ROUTES)[name];
  if (!(budget.calls > 0)) throw new Error(`${name}: keyless budget for this beat is spent`);
  budget.calls--;
  return name === "semanticscholar" ? fn(f, { limit: pageSize }, fetchImpl, wait) : fn(f, { rows: pageSize }, fetchImpl);
}
