// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The discovery loop: how the ledger keeps itself current with no person in the path. Every beat (hourly cron, and any page request when
// the last beat is older than BEAT.SPARK_MIN, so no single trigger can stop it) it
//   1. takes the findings checked longest ago, asks OpenAlex for works citing the original that report a replication, reanalysis or
//      meta-analysis, and notes whether the original was retracted;
//   2. reads each new abstract: a kind and outcome are filed only when backed by a sentence quoted verbatim from the abstract (Workers AI
//      first, a fixed lexical reader when no model answers); an attempt it cannot read stays a lead and never moves a standing;
//   3. searches recent replication papers for landmark originals not yet in the ledger and adds them as findings, claim quoted from the
//      original's own abstract;
//   4. checks seed citations against Crossref.
// Machine-read attempts count at RUBRIC.MACHINE weight (standing.js). fetch and the model are injected so the tests run offline.

import { KINDS, OUTCOMES } from "./standing.js";
import { FIELDS, doiKey } from "./ledger.js";

export const BEAT = { FINDINGS: 4, READS: 6, CANDIDATES: 12, DISCOVER: 3, CROSSREF: 3, MIN_CITED: 300, MIN_OVERLAP: 2, SPARK_MIN: 120, STALE_DAYS: 30 };
export const OA = "https://api.openalex.org/";
const UA = "replication-ledger/1 (+https://replication-ledger.ultrastable.org)";
export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const SEL = "id,doi,title,publication_year,authorships,primary_location,abstract_inverted_index,is_retracted,cited_by_count,primary_topic,referenced_works";

// OpenAlex field names to ledger fields. A work in any other field is not filed.
export const FIELD_MAP = {
  Psychology: "psychology", Neuroscience: "psychology", Medicine: "medicine", Nursing: "medicine", "Health Professions": "medicine",
  Pharmacology: "medicine", "Immunology and Microbiology": "medicine", "Economics, Econometrics and Finance": "economics",
  "Physics and Astronomy": "physics", "Biochemistry, Genetics and Molecular Biology": "biology", "Agricultural and Biological Sciences": "biology",
  "Social Sciences": "social-science"
};
// Rotating searches for replication papers that may name a landmark original the ledger lacks.
export const SEARCHES = ["registered replication report", "many labs replication", "failed to replicate", "multisite replication",
  "replication of a classic", "reanalysis original data", "preregistered replication", "large-scale replication project"];

export async function oa(path, fetchImpl = fetch) {
  const r = await fetchImpl(OA + path, { headers: { "user-agent": UA, accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`openalex ${r.status}`);
  return r.json();
}

export function abstractText(inv) {
  if (!inv) return "";
  const words = [];
  for (const [w, at] of Object.entries(inv)) for (const i of at) words[i] = w;
  return words.filter(Boolean).join(" ");
}

const squash = s => String(s || "").replace(/\s+/g, " ").trim();
const low = s => squash(s).toLowerCase();
export const quoted = (text, quote) => !!quote && squash(quote).length >= 25 && low(text).includes(low(quote));
const sentences = t => squash(t).split(/(?<=[.!?])\s+(?=[A-Z])/);

export function citeOf(w) {
  const people = (w.authorships || []).map(a => a.author?.display_name).filter(Boolean);
  const authors = people.length > 6 ? people.slice(0, 3).join(", ") + ", et al." : people.join(", ");
  return { authors: authors || "Unknown", year: w.publication_year, title: squash(w.title), venue: squash(w.primary_location?.source?.display_name || "") || "Unknown venue",
    doi: w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "") : null, url: w.id };
}

export function kindOf(text) {
  const t = low(text);
  if (/many labs|multi-?lab|multi-?site|registered replication report|\brrr\b|collaborative replication/.test(t)) return "multisite";
  if (/meta-?analy|pooled analysis|systematic review/.test(t)) return "meta-analysis";
  if (/randomi[sz]ed (controlled )?trial/.test(t)) return "rct";
  if (/re-?analy[sz]|reproduc(e|ibility) (the|of) (original )?(data|analysis)/.test(t)) return "reanalysis";
  if (/direct replication|close replication|exact replication|preregistered replication|replicat(e|ed|ion of) (the )?(original|study|experiment)/.test(t)) return "direct";
  if (/conceptual replication|replicat/.test(t)) return "conceptual";
  return null;
}

const LEX = [
  ["failed", /(fail(ed|s)? to (replicate|reproduce|find)|did not replicate|could not (replicate|reproduce)|not replicated|no evidence (for|of|that)|no significant|did not find|null (effect|result)|unable to replicate|effect (was|is) (close to|indistinguishable from) zero)/i],
  ["smaller", /(substantially smaller|much smaller|smaller than (the |in the )?original|considerably weaker|reduced effect size|effect size was smaller)/i],
  ["mixed", /(partial(ly)? replicat|mixed (results|evidence|support)|replicated (only )?in (some|one)|inconsistent)/i],
  ["held", /(successfully replicated|replicated the original|consistent with the original|confirm(ed|s) the original|robust(ly)? replicat|we replicate[ds]? (the|this|their)|replicated (the|this) (effect|finding))/i]
];

// The fixed reader: the first sentence matching an outcome pattern, quoted verbatim. Only for works whose text says they replicate.
export function lexicalRead(text) {
  if (!/replicat|reanaly|re-analy|meta-analy/i.test(text)) return null;
  for (const s of sentences(text)) for (const [outcome, re] of LEX) if (re.test(s)) return { outcome, quote: s, read_by: "lexical" };
  return null;
}

// The model reader. Its answer is used only when the quote is verbatim from the abstract and names a known outcome.
export async function modelRead(ai, claim, title, text) {
  if (!ai || !text) return null;
  const prompt = `Original claim: ${claim}\nPaper title: ${title}\nAbstract: ${text}\n\nDoes this paper attempt to replicate, reanalyse or meta-analyse the original claim? Answer only JSON: {"replicates": true|false, "outcome": "held"|"smaller"|"mixed"|"failed"|"unclear", "preregistered": true|false, "quote": "<one sentence copied exactly from the abstract that states the result>"}`;
  try {
    const r = await ai.run(MODEL, { messages: [{ role: "user", content: prompt }], max_tokens: 300 });
    const raw = typeof r?.response === "string" ? r.response : JSON.stringify(r?.response || "");
    const j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    if (!j.replicates || !OUTCOMES[j.outcome] || !quoted(text, j.quote)) return { refused: true };
    return { outcome: j.outcome, quote: squash(j.quote), preregistered: !!j.preregistered, read_by: "model" };
  } catch { return null; }
}

// Read one candidate. Returns an attempt (machine: true) or a lead with the reason it was not filed.
export async function readCandidate(w, finding, ai) {
  const text = abstractText(w.abstract_inverted_index);
  const both = `${w.title || ""}. ${text}`;
  const kind = kindOf(both);
  const cite = citeOf(w);
  if (!kind) return { lead: { cite, reason: "does not say it replicates the original" } };
  if (!text) return { lead: { cite, reason: "no abstract to quote from" } };
  const m = await modelRead(ai, finding.claim, w.title, text);
  const r = m && !m.refused ? m : lexicalRead(text);
  if (!r) return { lead: { cite, reason: m?.refused ? "the model's reading had no verbatim quote" : "no result sentence found" } };
  const preregistered = !!r.preregistered || /pre-?regist/i.test(both);
  return { attempt: { kind: KINDS[kind] ? kind : "conceptual", outcome: r.outcome, preregistered, machine: true, quote: r.quote, read_by: r.read_by, cite } };
}

// 1 + 2: replications of one finding. known: Set of DOIs already filed or led for this finding.
export async function checkFinding(f, { fetchImpl = fetch, ai, known = new Set(), reads = BEAT.READS } = {}) {
  const out = { finding: f.id, attempts: [], leads: [], retracted: false, openalex: null, cited_by: null };
  if (!f.original?.doi) return out;
  const orig = await oa(`works/doi:${encodeURIComponent(f.original.doi)}?select=id,is_retracted,cited_by_count`, fetchImpl);
  if (!orig) return out;
  out.openalex = orig.id; out.retracted = !!orig.is_retracted; out.cited_by = orig.cited_by_count ?? null;
  const wid = String(orig.id).split("/").pop();
  const res = await oa(`works?filter=cites:${wid},title_and_abstract.search:${encodeURIComponent("replication OR replicate OR reanalysis OR meta-analysis")}&sort=publication_date:desc&per-page=${BEAT.CANDIDATES}&select=${SEL}`, fetchImpl);
  for (const w of res?.results || []) {
    const doi = doiKey(citeOf(w).doi);
    if (!doi || known.has(doi) || doi === doiKey(f.original.doi)) continue;
    if (out.attempts.length + out.leads.length >= reads) break;
    known.add(doi);
    const r = await readCandidate(w, f, ai);
    if (r.attempt) out.attempts.push(r.attempt); else out.leads.push(r.lead);
  }
  return out;
}

const STOP = new Set("a an and the of in on for to with by from is are was were be as at or not its their our this that these those effect effects study studies replication replications replicating replicate test tests testing evidence new large scale registered report preregistered multisite many labs original data analysis using".split(" "));
const words = t => new Set(low(t).replace(/[^a-z0-9 ]/g, " ").split(" ").filter(w => w.length > 2 && !STOP.has(w)));
export const slug = t => low(t).replace(/[^a-z0-9 ]/g, " ").split(" ").filter(w => w && !STOP.has(w)).slice(0, 5).join("-") || "finding";

// 3: from one replication paper, the landmark original it repeats: the referenced work sharing the most title words with it
// (at least BEAT.MIN_OVERLAP), cited at least BEAT.MIN_CITED times, in a ledger field. Returns a finding or null.
export async function originalOf(rep, fetchImpl = fetch) {
  const refs = (rep.referenced_works || []).map(x => String(x).split("/").pop()).slice(0, 50);
  if (!refs.length) return null;
  const res = await oa(`works?filter=openalex:${refs.join("|")},cited_by_count:>${BEAT.MIN_CITED - 1}&per-page=50&select=${SEL}`, fetchImpl);
  const want = words(rep.title);
  let best = null, bestN = 0;
  for (const w of res?.results || []) {
    const n = [...words(w.title)].filter(x => want.has(x)).length;
    if (n > bestN || (n === bestN && best && w.cited_by_count > best.cited_by_count)) { best = w; bestN = n; }
  }
  if (!best || bestN < BEAT.MIN_OVERLAP) return null;
  const field = FIELD_MAP[best.primary_topic?.field?.display_name];
  const text = abstractText(best.abstract_inverted_index);
  if (!field || !FIELDS[field] || !text) return null;
  const cite = citeOf(best);
  if (!cite.doi) return null;
  const claim = sentences(text).find(s => s.length > 60 && s.length < 400) || sentences(text)[0];
  return { id: slug(best.title), field, topic: best.primary_topic?.display_name || "", name: squash(best.title).replace(/[.:]$/, ""),
    claim, claim_quoted: true, original: cite, query: `"${squash(best.title)}" replication`, discovered: true, via: citeOf(rep), replications: [] };
}

export async function discoverFindings(beatNo, { fetchImpl = fetch, knownDois = new Set(), knownIds = new Set() } = {}) {
  const q = SEARCHES[beatNo % SEARCHES.length];
  const since = new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10);
  const res = await oa(`works?search=${encodeURIComponent(q)}&filter=from_publication_date:${since},has_abstract:true&sort=cited_by_count:desc&per-page=${BEAT.DISCOVER}&select=${SEL}`, fetchImpl);
  const found = [];
  for (const rep of res?.results || []) {
    const f = await originalOf(rep, fetchImpl);
    if (!f || knownDois.has(doiKey(f.original.doi))) continue;
    let id = f.id, i = 2;
    while (knownIds.has(id)) id = `${f.id}-${i++}`;
    f.id = id; knownIds.add(id); knownDois.add(doiKey(f.original.doi));
    found.push(f);
  }
  return { search: q, found };
}
