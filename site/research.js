// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// RESEARCH-1 (Rowan, 2026-11-21): Ultrastable's own R&D and white papers. /research lists every paper, /research/<id> renders one, /api/research
// serves the same data. Every number comes from research-data.js, which foundation/research.py regenerates from the system's ledgers after every
// merge; a finding the system does not meet is shown as not met with its open work item, never hidden. Ultrastable is the foundation for any autonomous system.
import DATA from "./research-data.js";

const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
const BADGE = { met: "Met", "not-met": "Not met", unmeasured: "Not measured" };
const fmt = v => (v === null || v === undefined ? "not measured" : String(v));

// THOUGHT-1: the hook travels with every paper, so a reader never wonders why a paper about AI limits sits next to a catalogue of public-health fixes.
const HOOK = `<section class="card"><h2>Why these papers exist</h2><p>Ultrastable runs on Ultrastable. These papers are written, measured and republished by the system itself, from its own records. <a href="https://ultrastable.org">Practical Solutions</a> is one example of a system it runs: a free, evidence-based catalogue of fixes for global problems that keeps its own evidence current. The subject is the example; the point is what a self-running system can do for any work that has to keep running.</p></section>`;
const share = (p, origin = "https://ultrastable.io") => {
  const url = `${origin}/research/${p.slug}`, text = `${p.title}. ${p.met} of ${p.total} tests met, measured by the system on itself.`;
  return `<p class="muted">Share: <a href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}" rel="noopener">LinkedIn</a> · <a href="https://bsky.app/intent/compose?text=${encodeURIComponent(text + " " + url)}" rel="noopener">Bluesky</a> · <a href="/research.atom">Feed</a></p>`;
};

function listPage(d) {
  const papers = d.papers.map(p => `<li><a href="/research/${esc(p.slug)}"><strong>${esc(p.title)}</strong></a><br><span class="muted">${esc(p.met)} of ${esc(p.total)} findings met today · seeded by ${esc(p.study.title)} (${esc(p.study.authors.join(", "))})</span></li>`).join("");
  const persp = Object.entries(d.perspectives).map(([k, v]) => `<li>${esc(k)}: ${v ? "covered by a study" : "no study yet; intake looks for one first"}</li>`).join("");
  const qs = d.questions.map(q => `<tr><td>${esc(q.question)}</td><td>${esc(q.metric_label)}: ${esc(fmt(q.value))}</td><td>${esc(q.target.op)} ${esc(q.target.value)}</td><td>${esc(BADGE[q.status])}</td></tr>`).join("");
  const intake = (d.intake || []).length ? `<h2>Candidate studies</h2><ul>${d.intake.map(c => `<li><a href="${esc(c.url)}" rel="noopener">${esc(c.title)}</a> (${esc(c.perspective)})</li>`).join("")}</ul>` : "";
  return `<div class="head"><h1>Research</h1><p>Ultrastable studies outside research on AI systems, maps each concern it raises to the mechanisms this system uses, and tests that answer against its own records. Where the system falls short, the shortfall is shown here and is an open work item until a measurement closes it. Machine-readable: <a href="/api/research">/api/research</a>.</p></div>`
    + `<section><h2>White papers</h2><ul class="list">${papers}</ul></section>` + HOOK
    + `<section><h2>Our own R&amp;D questions</h2><div class="table-wrap"><table><thead><tr><th>Question</th><th>Measured</th><th>Target</th><th>Status</th></tr></thead><tbody>${qs}</tbody></table></div></section>`
    + `<section><h2>Perspectives</h2><ul>${persp}</ul>${intake}</section>`
    + `<p class="muted">Generated ${esc(d.as_of)} from the system's ledgers.</p>`;
}

// WHITEPAPER-1: a paper reads as a white paper: numbered sections, a results table, limitations, conclusion and numbered references.
const SEC = [["introduction", "1. Introduction"], ["background", "2. Background and related work"], ["method", "3. Method"], ["results", "4. Results"],
  ["discussion", "5. Discussion"], ["limitations", "6. Limitations"], ["conclusion", "7. Conclusion"]];
function paperPage(p, asOf) {
  const s = p.sections || {};
  const table = `<table><caption>Table 1. Findings, measurements and targets.</caption><thead><tr><th>Finding</th><th>Concern</th><th>Metric</th><th>Measured (n)</th><th>Target</th><th>Verdict</th></tr></thead><tbody>`
    + (s.table || []).map(r => `<tr><td>${esc(r.id)}</td><td>${esc(r.concern)}</td><td>${esc(r.metric)}</td><td>${esc(fmt(r.measured))} (${esc(r.n)})</td><td>${esc(r.target)}</td><td>${esc(BADGE[r.status] || r.status)}</td></tr>`).join("") + `</tbody></table>`;
  const body = SEC.map(([k, h]) => `<section><h2>${h}</h2>` + (k === "limitations" ? `<ul>${(s[k] || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : (s[k] || []).map(x => `<p>${esc(x)}</p>`).join("")) + (k === "results" ? table : "") + `</section>`).join("");
  const refs = `<section><h2>References</h2><ol>${(p.references || []).map(r => `<li>${esc(r.text)}${r.url ? ` <a href="${esc(r.url)}">${esc(r.url)}</a>` : ""}</li>`).join("")}</ol></section>`;
  return `<article class="paper"><div class="head"><p><a href="/research">Research</a> / White paper</p><h1>${esc(p.title)}</h1><p class="muted">Ultrastable white paper · updated ${esc(asOf)}</p><h2>Abstract</h2><p>${esc(p.abstract)}</p>${share(p)}</div>`
    + body + refs + HOOK + `<p class="muted">Generated from the system's own records. JSON: <a href="/api/research/${esc(p.slug)}">/api/research/${esc(p.slug)}</a></p></article>`;
}

// THOUGHT-1: a feed of the papers, so readers and aggregators follow them with no account; an entry's id changes when its measured result does.
// REACH-PAPERS-1: schema.org ScholarlyArticle on every paper, so search engines and scholar indexes read title, date and author.
export function jsonld(p, asOf, origin = "https://ultrastable.io") {
  const ld = { "@context": "https://schema.org", "@type": "ScholarlyArticle", headline: p.title, abstract: p.abstract, url: origin + "/research/" + p.slug,
    datePublished: asOf, dateModified: asOf, author: { "@type": "Organization", name: "Ultrastable", url: origin }, publisher: { "@type": "Organization", name: "Ultrastable" },
    isAccessibleForFree: true, inLanguage: "en" };
  return '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, "\\u003c") + "</script>";
}

export function atom(d, origin = "https://ultrastable.io") {
  const x = s => esc(s);
  const entries = d.papers.map(p => `<entry><id>${x(origin)}/research/${x(p.slug)}#${x(p.met)}of${x(p.total)}</id><title>${x(p.title)}</title><link href="${x(origin)}/research/${x(p.slug)}"/><updated>${x(d.as_of)}</updated><summary>${x(p.abstract)} Ultrastable runs on Ultrastable; Practical Solutions (https://ultrastable.org) is one system it runs.</summary></entry>`).join("");
  return `<?xml version="1.0" encoding="utf-8"?><feed xmlns="http://www.w3.org/2005/Atom"><id>${x(origin)}/research</id><title>Ultrastable research</title><link rel="self" href="${x(origin)}/research.atom"/><link href="${x(origin)}/research"/><updated>${x(d.as_of)}</updated><author><name>Ultrastable</name></author>${entries}</feed>`;
}

export function researchRoutes(u, shell, HTML, data = DATA) {
  const p = u.pathname.replace(/\/$/, "");
  const J = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
  if (p === "/research.atom") return new Response(atom(data), { headers: { "Content-Type": "application/atom+xml; charset=utf-8", "Cache-Control": "public, max-age=900", "Access-Control-Allow-Origin": "*" } });
  if (p === "/api/research") return new Response(JSON.stringify(data), { headers: J });
  let m = /^\/api\/research\/([a-z0-9-]+)$/.exec(p);
  if (m) {
    const paper = data.papers.find(x => x.slug === m[1]);
    return new Response(JSON.stringify(paper || { error: "no such paper", code: "not_found" }), { status: paper ? 200 : 404, headers: J });
  }
  if (p === "/research") return new Response(shell({ path: "/research", title: "Research - Ultrastable", description: "Ultrastable's own R&D: outside studies of AI systems, the mechanisms that answer them, and measurements from the system's own records." }, listPage(data)), { headers: { ...HTML, "Cache-Control": "public, max-age=300" } });
  m = /^\/research\/([a-z0-9-]+)$/.exec(p);
  if (m) {
    const paper = data.papers.find(x => x.slug === m[1]);
    if (!paper) return null;
    return new Response(shell({ path: p, title: paper.title + " - Ultrastable", description: paper.abstract.slice(0, 200) }, paperPage(paper, data.as_of) + jsonld(paper, data.as_of)), { headers: { ...HTML, "Cache-Control": "public, max-age=300" } });
  }
  return null;
}
