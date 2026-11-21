// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// RESEARCH-1 (Rowan, 2026-11-21): Ultrastable's own R&D and white papers. /research lists every paper, /research/<id> renders one, /api/research
// serves the same data. Every number comes from research-data.js, which foundation/research.py regenerates from the system's ledgers after every
// merge; a finding the system does not meet is shown as not met with its open work item, never hidden. Ultrastable is the foundation for any autonomous system.
import DATA from "./research-data.js";

const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
const BADGE = { met: "Met", "not-met": "Not met", unmeasured: "Not measured" };
const fmt = v => (v === null || v === undefined ? "not measured" : String(v));

function listPage(d) {
  const papers = d.papers.map(p => `<li><a href="/research/${esc(p.slug)}"><strong>${esc(p.title)}</strong></a><br><span class="muted">${esc(p.met)} of ${esc(p.total)} findings met today · seeded by ${esc(p.study.title)} (${esc(p.study.authors.join(", "))})</span></li>`).join("");
  const persp = Object.entries(d.perspectives).map(([k, v]) => `<li>${esc(k)}: ${v ? "covered by a study" : "no study yet; intake looks for one first"}</li>`).join("");
  const qs = d.questions.map(q => `<tr><td>${esc(q.question)}</td><td>${esc(q.metric_label)}: ${esc(fmt(q.value))}</td><td>${esc(q.target.op)} ${esc(q.target.value)}</td><td>${esc(BADGE[q.status])}</td></tr>`).join("");
  const intake = (d.intake || []).length ? `<h2>Candidate studies</h2><ul>${d.intake.map(c => `<li><a href="${esc(c.url)}" rel="noopener">${esc(c.title)}</a> (${esc(c.perspective)})</li>`).join("")}</ul>` : "";
  return `<div class="head"><h1>Research</h1><p>Ultrastable studies outside research on AI systems, maps each concern it raises to the mechanisms this system uses, and tests that answer against its own records. Where the system falls short, the shortfall is shown here and is an open work item until a measurement closes it. Machine-readable: <a href="/api/research">/api/research</a>.</p></div>`
    + `<section><h2>White papers</h2><ul class="list">${papers}</ul></section>`
    + `<section><h2>Our own R&amp;D questions</h2><div class="table-wrap"><table><thead><tr><th>Question</th><th>Measured</th><th>Target</th><th>Status</th></tr></thead><tbody>${qs}</tbody></table></div></section>`
    + `<section><h2>Perspectives</h2><ul>${persp}</ul>${intake}</section>`
    + `<p class="muted">Generated ${esc(d.as_of)} from the system's ledgers.</p>`;
}

function paperPage(p, asOf) {
  const fs = p.findings.map(f => `<article class="card"><h3>${esc(f.id)}. ${esc(f.concern)} <span class="muted">(${esc(f.perspective)})</span></h3>`
    + `<p><strong>The study:</strong> ${esc(f.claim)}</p><p><strong>How Ultrastable answers it:</strong></p><ul>${f.mechanisms.map(m => `<li>${esc(m.rule)} (<code>${esc(m.path)}</code>): ${esc(m.how)}</li>`).join("")}</ul>`
    + `<p><strong>Measured here:</strong> ${esc(f.metric_label)}: ${esc(fmt(f.measured))} (n = ${esc(f.n)}). Target ${esc(f.target.op)} ${esc(f.target.value)}. <strong>${esc(BADGE[f.status])}</strong>${f.item ? ` · open item <code>${esc(f.item)}</code>` : ""}</p>`
    + `<p class="muted">Source: ${esc(f.source)}</p></article>`).join("");
  const leads = p.leads.length ? `<section><h2>Proposed further links</h2><p class="muted">Leads from the connection engine; each is a proposal until a study file adopts it.</p><ul>${p.leads.map(l => `<li>${esc(l.finding)} may also relate to ${esc(l.rule)}</li>`).join("")}</ul></section>` : "";
  return `<div class="head"><p><a href="/research">Research</a></p><h1>${esc(p.title)}</h1><p>${esc(p.abstract)}</p></div>`
    + `<section><h2>The study</h2><p>${esc(p.study.title)}. ${esc(p.study.authors.join(", "))}, ${esc(p.study.institution)}; ${esc(p.study.kind)}, version ${esc(p.study.version)}.</p><p>${esc(p.study.data)}</p></section>`
    + `<section><h2>Findings, mechanisms and measurements</h2>${fs}</section>`
    + `<section><h2>Limits</h2><ul>${p.limits.map(x => `<li>${esc(x)}</li>`).join("")}</ul></section>` + leads
    + `<section><h2>Method</h2><p>${esc(p.method)}</p></section><p class="muted">Generated ${esc(asOf)}. JSON: <a href="/api/research/${esc(p.slug)}">/api/research/${esc(p.slug)}</a></p>`;
}

export function researchRoutes(u, shell, HTML, data = DATA) {
  const p = u.pathname.replace(/\/$/, "");
  const J = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" };
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
    return new Response(shell({ path: p, title: paper.title + " - Ultrastable", description: paper.abstract.slice(0, 200) }, paperPage(paper, data.as_of)), { headers: { ...HTML, "Cache-Control": "public, max-age=300" } });
  }
  return null;
}
