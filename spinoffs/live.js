// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPINOFF-GOOD-1: archetypes "live-feed" and "live-lookup". Ultrastable is the foundation for any autonomous system.
// Public-benefit apps whose every number is read from a public source at request time (never a bundled snapshot). No database, no model call,
// no cookies, nothing stored: one Workers request plus one upstream fetch per view, cached at the edge for a few minutes. Each app serves
// /api/freshness (source, fetched_at, age, 503 when the upstream failed) so the freshness probe can fail a stale page.
export const UA = "ultrastable-good (+https://ultrastable.io; reads public data only)";
const TTL = 300;
const today = () => new Date().toISOString().slice(0, 10);

export function cleanDomain(raw) {
  let d = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").split(/[\/?#]/)[0];
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d)) return null;
  if (/^(localhost|.*\.(local|internal|localdomain|lan|home|corp|test|invalid|example))$/.test(d)) return null;
  return d;
}
export const cleanEin = raw => { const d = String(raw || "").replace(/[\s-]/g, ""); return /^\d{9}$/.test(d) ? d : null; };
const usd = v => v == null ? "not reported" : "$" + Math.round(v).toLocaleString("en-US");

async function getJson(f, url) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await f(url, { headers: { "user-agent": UA, accept: "application/json" }, signal: c.signal });
    if (!r.ok) throw new Error("upstream " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

export function a11y(html) {
  const h = String(html || "").slice(0, 400000), tags = n => [...h.matchAll(new RegExp("<" + n + "\\b[^>]*>", "gi"))].map(m => m[0]);
  const imgs = tags("img"), noAlt = imgs.filter(t => !/\balt\s*=/i.test(t)).length;
  const inputs = tags("input").filter(t => !/type\s*=\s*["']?(hidden|submit|button|image|reset)/i.test(t)), ids = new Set([...h.matchAll(/<label\b[^>]*\bfor\s*=\s*["']?([^"'\s>]+)/gi)].map(m => m[1]));
  const unlabeled = inputs.filter(t => { const id = (t.match(/\bid\s*=\s*["']?([^"'\s>]+)/i) || [])[1]; return !(/aria-label(ledby)?\s*=/i.test(t) || (id && ids.has(id))); }).length;
  const vp = (h.match(/<meta[^>]*name=["']viewport["'][^>]*>/i) || [""])[0], h1 = tags("h1").length;
  const R = (check, pass, detail) => ({ cells: [check, pass ? "pass" : "look at this", detail] });
  return [
    R("Page language declared", /<html\b[^>]*\blang\s*=\s*["'][a-z]/i.test(h), "html lang attribute"),
    R("Page has a title", /<title>\s*\S/i.test(h), "title element"),
    R("Zoom is not blocked", !/user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/i.test(vp), vp ? "viewport meta read" : "no viewport meta"),
    R("Images have alt text", noAlt === 0, `${imgs.length} images, ${noAlt} without an alt attribute`),
    R("Form fields have labels", unlabeled === 0, `${inputs.length} fields, ${unlabeled} without a label`),
    R("One main heading", h1 === 1, `${h1} h1 elements`),
    R("Landmark or skip link", /<main\b|role\s*=\s*["']main|href\s*=\s*["']#(main|content|skip)/i.test(h), "main landmark or skip link"),
  ];
}

// One entry per live app; key = the idea id in doctrine/spinoff-ideas.json, mirrored with its freshness bound in doctrine/spinoff-live.json.
export const SOURCES = {
  "open-comment": {
    kind: "feed", name: "Federal Register", home: "https://www.federalregister.gov/", columns: ["Proposal", "Agency", "Comments close"],
    url: () => "https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest&conditions[type][]=PRORULE&fields[]=title&fields[]=agency_names&fields[]=comments_close_on&fields[]=html_url",
    rows: (j, now = today()) => (j.results || []).filter(x => x.comments_close_on && x.comments_close_on >= now).sort((a, b) => a.comments_close_on.localeCompare(b.comments_close_on)).slice(0, 30)
      .map(x => ({ cells: [x.title, (x.agency_names || []).join(", "), x.comments_close_on], url: x.html_url })),
    empty: "No proposed rules with an open comment period were found in the latest 100 published.",
  },
  "quake-watch": {
    kind: "feed", name: "USGS Earthquake Hazards Program", home: "https://earthquake.usgs.gov/", columns: ["Where", "Magnitude", "When (UTC)"],
    url: () => "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson",
    rows: j => (j.features || []).map(x => x.properties).sort((a, b) => b.time - a.time).slice(0, 30)
      .map(p => ({ cells: [p.place, p.mag == null ? "unknown" : String(p.mag), new Date(p.time).toISOString().replace("T", " ").slice(0, 16)], url: p.url })),
    empty: "No significant earthquakes in the past 7 days.",
  },
  "nonprofit-check": {
    kind: "lookup", name: "ProPublica Nonprofit Explorer (IRS filings)", home: "https://projects.propublica.org/nonprofits/", label: "Nonprofit EIN", placeholder: "53-0196605", clean: cleanEin,
    bad: "Type a nine-digit EIN such as 53-0196605. It is the public tax id of an organization.",
    url: q => `https://projects.propublica.org/nonprofits/api/v2/organizations/${q}.json`,
    shape: (j, q) => {
      const o = j.organization || {};
      return { title: o.name || "Unknown organization", sub: [o.city, o.state].filter(Boolean).join(", ") + (o.ntee_code ? " · NTEE " + o.ntee_code : ""), source_url: `https://projects.propublica.org/nonprofits/organizations/${q}`,
        columns: ["Tax year", "Revenue", "Expenses", "Assets"],
        rows: (j.filings_with_data || []).slice(0, 10).map(x => ({ cells: [String(x.tax_prd_yr), usd(x.totrevenue), usd(x.totfuncexpns), usd(x.totassetsend)], url: x.pdf_url || null })) };
    },
  },
  "access-check": {
    kind: "lookup", name: "the public home page you name", home: null, label: "Website domain", placeholder: "example.org", clean: cleanDomain,
    bad: "Type a public domain such as example.org (no address, port or path).",
    url: q => `https://${q}/`, raw: true,
    shape: (html, q) => ({ title: "Basic accessibility signals for " + q, sub: "Automated read of the home page HTML. Passing these does not make a site accessible.", source_url: `https://${q}/`, columns: ["Check", "Result", "Detail"], rows: a11y(html) }),
  },
};

const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", "cache-control": "public, max-age=60", ...h } });
const esc = x => String(x == null ? "" : x).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function feed(src, f) {
  const key = new Request(src.url() + "#c"), cache = typeof caches !== "undefined" ? caches.default : null;
  if (cache) { const hit = await cache.match(key); if (hit) return hit.json(); }
  const j = await getJson(f, src.url()), out = { fetched_at: new Date().toISOString(), rows: src.rows(j) };
  if (cache) await cache.put(key, new Response(JSON.stringify(out), { headers: { "cache-control": `max-age=${TTL}` } }));
  return out;
}

export async function lookup(src, q, f) {
  const clean = src.clean(q);
  if (!clean) return { status: 400, body: { ok: false, code: "bad_input", error: src.bad } };
  const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
  try {
    const r = await f(src.url(clean), { headers: { "user-agent": UA, accept: src.raw ? "text/html" : "application/json" }, signal: c.signal });
    if (r.status === 404) return { status: 404, body: { ok: false, code: "not_found", error: "Nothing public was found for that. Check the number or the domain." } };
    if (!r.ok) return { status: 502, body: { ok: false, code: "upstream", error: "The public source did not answer. Try again in a minute." } };
    const data = src.raw ? await r.text() : await r.json();
    return { status: 200, body: { ok: true, fetched_at: new Date().toISOString(), source: src.name, ...src.shape(data, clean) } };
  } catch (e) { return { status: 502, body: { ok: false, code: "upstream", error: "The public source did not answer. Try again in a minute." } }; }
  finally { clearTimeout(t); }
}

const PAGE = (app, src) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(app.name)}</title><meta name="description" content="${esc(app.tagline)}">
<style>:root{--bg:#fff;--fg:#14181f;--mute:#566;--line:#d5dae1;--ok:#0b6b3a;--bad:#a1260f;--acc:#1f4fd8}@media(prefers-color-scheme:dark){:root{--bg:#10141a;--fg:#e8ecf2;--mute:#9aa6b6;--line:#2a323d;--ok:#5ad08a;--bad:#ff8a73;--acc:#8fb0ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:24px 16px}h1{font-size:28px;margin:0 0 8px}p.s{color:var(--mute);margin:0 0 20px}
form{display:flex;flex-direction:column;gap:12px;margin-bottom:16px}input,button{font:inherit;min-height:44px;border-radius:10px;border:1px solid var(--line);padding:0 14px;background:var(--bg);color:var(--fg)}button{background:var(--acc);color:#fff;border:0;font-weight:600;cursor:pointer}
@media(min-width:560px){form{flex-direction:row}input{flex:1}}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{text-align:left;padding:10px 8px 10px 0;border-top:1px solid var(--line);vertical-align:top}a{color:var(--acc)}.m{color:var(--mute);font-size:14px}.pass{color:var(--ok)}.look{color:var(--bad)}</style></head>
<body><main><h1>${esc(app.name)}</h1><p class="s">${esc(app.tagline)}</p>
${src.kind === "lookup" ? `<form id="f"><input id="q" inputmode="${src.clean === cleanEin ? "numeric" : "url"}" autocomplete="off" placeholder="${esc(src.placeholder)}" aria-label="${esc(src.label)}" required><button>Look up</button></form>` : ""}
<div id="o" aria-live="polite">Loading live data…</div>
<p class="m">Source: ${src.home ? `<a href="${esc(src.home)}">${esc(src.name)}</a>` : esc(src.name)}, read live when you open this page; nothing is stored about you. Information only, not legal, financial or professional advice. <a href="/api/freshness">Freshness</a> · <a href="/llms.txt">For agents</a></p></main>
<script>const o=document.getElementById("o"),E=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const T=(cols,rows)=>"<table><thead><tr>"+cols.map(c=>"<th scope='col'>"+E(c)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(r=>"<tr>"+r.cells.map((c,i)=>"<td"+(c==="pass"?" class='pass'":c==="look at this"?" class='look'":"")+">"+(i===0&&r.url?"<a href='"+E(r.url)+"'>"+E(c)+"</a>":E(c))+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
const show=j=>{if(!j.ok){o.textContent=j.error;return}o.innerHTML=(j.title?"<h2>"+E(j.title)+"</h2><p class='m'>"+E(j.sub)+"</p>":"")+(j.rows.length?T(j.columns,j.rows):"<p>"+E(j.empty||"Nothing to show.")+"</p>")+"<p class='m'>Fetched live "+E(j.fetched_at)+"</p>"};
${src.kind === "feed" ? `fetch("/api/data").then(r=>r.json()).then(show).catch(()=>{o.textContent="The public source is not answering right now. Try again in a minute."});` : `o.textContent="Type above to look something up.";document.getElementById("f").onsubmit=e=>{e.preventDefault();o.textContent="Looking up…";fetch("/api/lookup?q="+encodeURIComponent(document.getElementById("q").value)).then(r=>r.json()).then(show).catch(()=>{o.textContent="The public source is not answering right now. Try again in a minute."})}`}</script></body></html>`;

export async function handleLive(sub, app, u, f = fetch) {
  const src = SOURCES[app.live];
  if (!src) return new Response("Not found", { status: 404 });
  const p = u.pathname;
  if (p === "/") return new Response(PAGE(app, src), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
  if (p === "/llms.txt") return new Response(`# ${app.name}\n${app.tagline}\n${src.kind === "feed" ? "GET /api/data returns the current rows as JSON." : "GET /api/lookup?q=... returns the result as JSON."}\nGET /api/freshness states the age of the live source. Source: ${src.name}. Nothing about any person is stored.\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (p === "/api/freshness" || p === "/api/metrics") {
    try {
      const d = src.kind === "feed" ? await feed(src, f) : null, age = d ? Math.max(0, Math.round((Date.now() - Date.parse(d.fetched_at)) / 1000)) : 0;
      return J({ app: sub, kind: src.kind, source: src.name, ok: true, fetched_at: d ? d.fetched_at : "per request", age_seconds: age, max_age_seconds: TTL, board_age_hours: +(age / 3600).toFixed(3), error_share: 0 }, 200, { "cache-control": "no-store" });
    } catch (e) { return J({ app: sub, kind: src.kind, source: src.name, ok: false, error: "upstream unavailable", board_age_hours: null, error_share: 1 }, 503, { "cache-control": "no-store" }); }
  }
  if (p === "/api/data" && src.kind === "feed") {
    try { const d = await feed(src, f); return J({ ok: true, source: src.name, columns: src.columns, empty: src.empty, ...d }); }
    catch (e) { return J({ ok: false, code: "upstream", error: "The public source did not answer. Try again in a minute." }, 502); }
  }
  if (p === "/api/lookup" && src.kind === "lookup") { const r = await lookup(src, u.searchParams.get("q"), f); return J(r.body, r.status, { "cache-control": "no-store" }); }
  return new Response("Not found", { status: 404 });
}
