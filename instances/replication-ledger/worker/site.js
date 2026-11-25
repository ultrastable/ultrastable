// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The ledger's pages, rendered on the server from data/findings.json and the standings standing.js computes, so every page works with no
// script and is indexable. Script only adds the guess-first reveal; without it the record is one tap away in a <details>. Light and dark,
// 16 px body, 44 px targets, visible focus, reduced motion respected. No cookies, no trackers, nothing stored about the reader.
import { FIELDS } from "./ledger.js";
import { KINDS, OUTCOMES, STANDINGS, RUBRIC, attemptWeight } from "./standing.js";

export const SITE = "https://replication-ledger.ultrastable.org";
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// What a reader can guess: the four standings a replication record can reach. thin and untested are not offered, they are not a verdict.
export const GUESS = ["holds", "weakened", "contested", "fails"];

const CSS = `:root{--bg:#f7f6f3;--fg:#1d1b18;--muted:#5d5850;--card:#fff;--line:#e2ddd4;--accent:#7a3fb0;--accent-fg:#fff;--chip:#eeeae3;
--holds:#1d7a3e;--weakened:#8a5a00;--contested:#9a4a00;--fails:#b42318;--thin:#5d6670;--untested:#5d6670}
@media (prefers-color-scheme:dark){:root{--bg:#141311;--fg:#ece8e1;--muted:#b0a99d;--card:#1d1b18;--line:#38342e;--accent:#c79bf0;--accent-fg:#1d0b2e;--chip:#2a2723;
--holds:#7fd49a;--weakened:#f2c35c;--contested:#f2a15c;--fails:#f39087;--thin:#aab4bd;--untested:#aab4bd}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
header.top{border-bottom:1px solid var(--line);background:var(--card)}header.top nav{max-width:1040px;margin:0 auto;padding:6px 16px;display:flex;gap:4px;align-items:center;flex-wrap:wrap}
header.top a{display:inline-flex;align-items:center;min-height:44px;padding:0 10px;border-radius:10px;text-decoration:none;color:var(--fg)}header.top a:hover{background:var(--chip)}
header.top a.brand{font-weight:800;font-size:1.1rem;margin-right:auto}header.top a.brand span{color:var(--accent)}
main{max-width:1040px;margin:0 auto;padding:24px 16px 72px}h1{font-size:clamp(1.7rem,5vw,2.5rem);line-height:1.15;margin:8px 0 10px;letter-spacing:-.02em}
h2{font-size:1.3rem;margin:36px 0 12px}h3{font-size:1.05rem;margin:0 0 4px}.lede{font-size:1.1rem;color:var(--muted);max-width:720px;margin:0 0 20px}.muted{color:var(--muted)}.small{font-size:.9rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px}
.tile{display:block;padding:16px;border-radius:16px;text-decoration:none;color:var(--fg);border:1px solid var(--line);background:var(--card);min-height:88px}.tile:hover,.card:hover{border-color:var(--accent)}
.tile b{display:block}.card{display:flex;flex-direction:column;gap:6px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;text-decoration:none;color:var(--fg);min-height:44px}
.badge{display:inline-flex;align-items:center;font-weight:750;font-size:.9rem;padding:3px 10px;border-radius:99px;border:2px solid currentColor;align-self:flex-start}
.s-holds{color:var(--holds)}.s-weakened{color:var(--weakened)}.s-contested{color:var(--contested)}.s-fails{color:var(--fails)}.s-thin{color:var(--thin)}.s-untested{color:var(--untested)}
.tag{display:inline-block;font-size:.8rem;font-weight:650;padding:2px 9px;border-radius:99px;background:var(--chip);color:var(--muted)}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.stats{display:flex;flex-wrap:wrap;gap:22px;margin:6px 0 24px}.stats b{display:block;font-size:1.6rem;line-height:1.1}
.step{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:16px 0}.step .k{font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:var(--accent);margin-bottom:4px}
.opts{display:grid;gap:8px;margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}.opts button{font:inherit;text-align:left;min-height:48px;padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
.opts button.right{border-color:var(--holds);font-weight:700}.opts button.wrong{border-color:var(--fails)}
.attempt{border-top:1px solid var(--line);padding:12px 0}.attempt:first-child{border-top:0}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.wrap{overflow-x:auto}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:650}[hidden]{display:none!important}
footer{border-top:1px solid var(--line);margin-top:48px;padding:20px 16px;color:var(--muted);font-size:.9rem}footer div{max-width:1040px;margin:0 auto}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;

function shell(title, desc, inner, { path = "/", script = "" } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}${esc(path)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><style>${CSS}</style></head>
<body><header class="top"><nav aria-label="Main"><a class="brand" href="/">Replication&nbsp;<span>Ledger</span></a><a href="/#fields">Fields</a><a href="/projects">Replication projects</a><a href="/rubric">How standings work</a></nav></header>
<main>${inner}</main><footer><div>Guess whether a textbook finding survived replication, then see the record. Every standing is computed from the replication attempts on file, never typed by hand.
Runs on <a href="https://ultrastable.io/">Ultrastable</a>, the foundation for any autonomous system. No cookies, no trackers. Data: <a href="/api/findings">/api/findings</a> · <a href="/api/rubric">/api/rubric</a></div></footer>${script}</body></html>`;
}

export const badge = st => `<span class="badge s-${esc(st)}">${esc(STANDINGS[st].name)}</span>`;
const doiLink = c => c.doi ? `<a href="https://doi.org/${esc(c.doi)}">doi:${esc(c.doi)}</a>` : c.url ? `<a href="${esc(c.url)}">source</a>` : `<span class="muted">${esc(c.note || "no DOI")}</span>`;
const cite = c => `${esc(c.authors)} (${esc(c.year)}). <i>${esc(c.title)}</i>. ${esc(c.venue)}. ${doiLink(c)}`;

function card(f, { reveal = true } = {}) {
  return `<a class="card" href="/f/${esc(f.id)}"><span class="small muted">${esc(FIELDS[f.field].name)} · ${esc(f.original.year)}</span><h3>${esc(f.name)}</h3>
${reveal ? `<div class="row">${badge(f.standing.standing)} <span class="small muted">${f.standing.attempts} ${f.standing.attempts === 1 ? "attempt" : "attempts"}</span></div>` : `<span class="tag">Guess: did it hold?</span>`}</a>`;
}

export function home(findings, projects) {
  const counts = Object.fromEntries(Object.keys(STANDINGS).map(k => [k, findings.filter(f => f.standing.standing === k).length]));
  const attempts = findings.reduce((n, f) => n + f.standing.attempts, 0);
  const fields = Object.entries(FIELDS).filter(([id]) => findings.some(f => f.field === id));
  const inner = `<h1>Which landmark findings held up?</h1>
<p class="lede">A ledger of famous scientific findings and every attempt to repeat them, across ${fields.length} fields. Guess first, then see what the replications found.</p>
<div class="stats"><div><b>${findings.length}</b><span class="muted small">findings</span></div><div><b>${attempts}</b><span class="muted small">replication attempts</span></div>
<div><b>${counts.holds}</b><span class="muted small">hold</span></div><div><b>${counts.fails}</b><span class="muted small">failed</span></div><div><b>${counts.weakened + counts.contested}</b><span class="muted small">weakened or contested</span></div></div>
<h2 id="fields">Fields</h2><div class="tiles">${fields.map(([id, fl]) => `<a class="tile" href="/field/${esc(id)}"><b>${esc(fl.name)}</b><span class="muted small">${findings.filter(f => f.field === id).length} findings</span></a>`).join("")}</div>
<h2>Did it survive? Guess first</h2><div class="grid">${findings.map(f => card(f, { reveal: false })).join("")}</div>
<h2>Large replication projects</h2><p class="muted">${projects.length} field-wide efforts that repeated many studies at once. <a href="/projects">See them all</a>.</p>`;
  return shell("Replication Ledger: which landmark findings held up", "Famous scientific findings and every attempt to replicate them, with a standing computed from the record.", inner);
}

export function fieldPage(id, findings) {
  const fl = FIELDS[id];
  const list = findings.filter(f => f.field === id).sort((a, b) => STANDINGS[b.standing.standing].rank - STANDINGS[a.standing.standing].rank);
  return shell(`${fl.name}: which findings held up · Replication Ledger`, `Replication record of landmark findings in ${fl.name.toLowerCase()}.`,
    `<p class="small"><a href="/">Ledger</a></p><h1>${esc(fl.name)}</h1><p class="lede">Ordered from best supported to failed. Each standing is computed from the replication attempts on its page.</p><div class="grid">${list.map(f => card(f)).join("")}</div>`, { path: "/field/" + id });
}

const REVEAL = `<script>(()=>{const box=document.getElementById("guess");if(!box)return;const ans=box.dataset.answer,rec=document.getElementById("record");
rec.hidden=true;box.hidden=false;box.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{box.querySelectorAll("button").forEach(x=>{x.disabled=true;
if(x.dataset.v===ans)x.classList.add("right");else if(x===b)x.classList.add("wrong")});const out=document.getElementById("verdict");
out.textContent=b.dataset.v===ans?"Right. Here is the record.":"Not quite. Here is the record.";rec.hidden=false;rec.open=true;rec.scrollIntoView({block:"start"})}))})()</script>`;

export function findingPage(f) {
  const st = f.standing;
  const guessable = GUESS.includes(st.standing);
  const attempts = f.replications.map(r => `<div class="attempt"><div class="row">${badge(r.outcome === "held" ? "holds" : r.outcome === "failed" ? "fails" : r.outcome === "smaller" ? "weakened" : "contested")}
<span class="tag">${esc(KINDS[r.kind].name)}</span>${r.preregistered ? `<span class="tag">Preregistered</span>` : ""}<span class="small muted">weight ${attemptWeight(r)}</span></div>
<p>${esc(r.summary)}</p><p class="small muted">${cite(r.cite)}</p></div>`).join("");
  const inner = `<p class="small"><a href="/">Ledger</a> · <a href="/field/${esc(f.field)}">${esc(FIELDS[f.field].name)}</a></p>
<h1>${esc(f.name)}</h1><div class="step"><div class="k">The claim</div><p>${esc(f.claim)}</p><p class="small muted">Original study: ${cite(f.original)}</p></div>
${guessable ? `<div class="step" id="guess" data-answer="${esc(st.standing)}" hidden><div class="k">Your guess</div><p>When other researchers tried to repeat this, did it hold up?</p>
<div class="opts">${GUESS.map(g => `<button type="button" data-v="${g}">${esc(STANDINGS[g].name)}</button>`).join("")}</div><p id="verdict" class="muted" aria-live="polite"></p></div>` : ""}
<details id="record" open><summary>The replication record</summary>
<div class="step"><div class="k">Standing</div><div class="row">${badge(st.standing)}</div><p>${esc(STANDINGS[st.standing].say)}</p><p class="small muted">${esc(st.basis)} <a href="/rubric">How this is computed</a>.</p></div>
<h2>Replication attempts</h2>${attempts || `<p class="muted">No replication attempt is on record yet.</p>`}</details>`;
  return shell(`${f.name}: did it replicate? · Replication Ledger`, f.claim, inner, { path: "/f/" + f.id, script: guessable ? REVEAL : "" });
}

export function projectsPage(projects) {
  const rows = projects.map(p => `<tr><td>${esc(FIELDS[p.field]?.name || p.field)}</td><td>${esc(p.what)}</td><td class="small">${cite(p.cite)}</td></tr>`).join("");
  return shell("Large replication projects · Replication Ledger", "Field-wide efforts that repeated many published studies at once.",
    `<p class="small"><a href="/">Ledger</a></p><h1>Large replication projects</h1><p class="lede">Efforts that repeated many published studies at once, so a field's record can be read as a whole, not one finding at a time.</p>
<div class="wrap"><table><thead><tr><th>Field</th><th>What it did</th><th>Source</th></tr></thead><tbody>${rows}</tbody></table></div>`, { path: "/projects" });
}

export function rubricPage() {
  const kinds = Object.entries(KINDS).map(([k, v]) => `<tr><td>${esc(v.name)}</td><td>${v.weight}</td></tr>`).join("");
  const outs = Object.entries(OUTCOMES).map(([k, v]) => `<tr><td>${esc(v.name)}</td><td>${v.score}</td></tr>`).join("");
  const sts = Object.entries(STANDINGS).map(([k, v]) => `<tr><td>${badge(k)}</td><td>${esc(v.say)}</td></tr>`).join("");
  return shell("How standings work · Replication Ledger", "The rubric that computes every standing from the replication record.",
    `<p class="small"><a href="/">Ledger</a></p><h1>How standings work</h1><p class="lede">No standing is typed by hand. This page is rendered from the same code that computes every standing.</p>
<h2>1. Each attempt weighs by its kind</h2><div class="wrap"><table><thead><tr><th>Kind of attempt</th><th>Weight</th></tr></thead><tbody>${kinds}</tbody></table></div>
<p>A preregistered attempt weighs ${RUBRIC.PREREG} times more. An attempt found automatically from a new abstract counts at ${RUBRIC.MACHINE} of its weight until it is confirmed.</p>
<h2>2. Each outcome scores how far the claim held</h2><div class="wrap"><table><thead><tr><th>Outcome</th><th>Score</th></tr></thead><tbody>${outs}</tbody></table></div>
<h2>3. The standing</h2><p>With no attempts, a finding is not yet replicated. Under a total weight of ${RUBRIC.MIN_WEIGHT} there are too few replications to call. Otherwise: it holds at a weighted score of ${Math.round(RUBRIC.HOLDS * 100)}% or more, it failed under ${Math.round(RUBRIC.FAILS * 100)}%, it is weakened when "held, but much smaller" carries at least ${Math.round(RUBRIC.SMALLER_SHARE * 100)}% of the weight, and otherwise it is contested.</p>
<div class="wrap"><table><tbody>${sts}</tbody></table></div>`, { path: "/rubric" });
}

export const notFound = () => shell("Not found · Replication Ledger", "Page not found.", `<h1>Not found</h1><p><a href="/">Back to the ledger</a></p>`);
