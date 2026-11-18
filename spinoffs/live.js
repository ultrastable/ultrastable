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
export const cleanCountry = raw => { const d = String(raw || "").trim().toUpperCase(); return /^[A-Z]{2,3}$/.test(d) ? d : null; };
export const cleanPlace = raw => { const d = String(raw || "").trim().replace(/\s+/g, " "); return /^[\p{L}\p{M}' .,-]{2,80}$/u.test(d) ? d : null; };

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
  "quake-watch": {
    kind: "feed", name: "USGS Earthquake Hazards Program", home: "https://earthquake.usgs.gov/", columns: ["Where", "Magnitude", "When (UTC)"],
    url: () => "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson",
    rows: j => (j.features || []).map(x => x.properties).sort((a, b) => b.time - a.time).slice(0, 30)
      .map(p => ({ cells: [p.place, p.mag == null ? "unknown" : String(p.mag), new Date(p.time).toISOString().replace("T", " ").slice(0, 16)], url: p.url })),
    empty: "No significant earthquakes in the past 7 days.",
  },
  "country-snapshot": {
    kind: "lookup", name: "World Bank Open Data", home: "https://data.worldbank.org/", label: "Country code", placeholder: "KE", clean: cleanCountry,
    bad: "Type a two or three letter country code such as KE, BR or IND.",
    fetch: async (q, f) => {
      const IND = [["EG.ELC.ACCS.ZS", "Population with electricity"], ["SH.H2O.BASW.ZS", "Population with basic drinking water"], ["IT.NET.USER.ZS", "Population using the internet"], ["SE.ADT.LITR.ZS", "Literacy rate, ages 15 and over"]];
      const res = await Promise.all(IND.map(async ([id, label]) => { const j = await getJson(f, `https://api.worldbank.org/v2/country/${q}/indicator/${id}?format=json&mrnev=1`); return { label, rec: Array.isArray(j) && Array.isArray(j[1]) ? j[1][0] : null, msg: Array.isArray(j) ? null : j }; }));
      const first = res.find(r => r.rec);
      return first ? { country: first.rec.country.value, rows: res.map(r => ({ cells: [r.label, r.rec && r.rec.value != null ? r.rec.value.toFixed(1) + "%" : "not reported", r.rec ? String(r.rec.date) : "-"] })) } : null;
    },
    shape: (d, q) => ({ title: d.country, sub: "Latest reported value for each measure, with its year.", source_url: `https://data.worldbank.org/country/${q}`, columns: ["Measure", "Latest value", "Year"], rows: d.rows }),
  },
  "air-quality": {
    kind: "lookup", name: "Open-Meteo air quality and geocoding", home: "https://open-meteo.com/", label: "City", placeholder: "Nairobi", clean: cleanPlace,
    bad: "Type a city or town name such as Nairobi or Lima.",
    fetch: async (q, f) => {
      const g = await getJson(f, `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=1`), p = (g.results || [])[0];
      if (!p) return null;
      const a = await getJson(f, `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${p.latitude}&longitude=${p.longitude}&current=european_aqi,us_aqi,pm2_5,pm10`), c = a.current || {};
      const v = (x, u) => x == null ? "not reported" : x + u;
      return { place: [p.name, p.admin1, p.country].filter(Boolean).join(", "), at: c.time, rows: [{ cells: ["European air quality index", v(c.european_aqi, ""), c.time || "-"] }, { cells: ["US air quality index", v(c.us_aqi, ""), c.time || "-"] }, { cells: ["Fine particles (PM2.5)", v(c.pm2_5, " µg/m³"), c.time || "-"] }, { cells: ["Coarse particles (PM10)", v(c.pm10, " µg/m³"), c.time || "-"] }] };
    },
    shape: d => ({ title: d.place, sub: "Modelled current conditions for the nearest grid point, not a ground measurement.", source_url: "https://open-meteo.com/en/docs/air-quality-api", columns: ["Measure", "Now", "Time (UTC)"], rows: d.rows }),
  },
  "access-check": {
    kind: "lookup", name: "the public home page you name", home: null, label: "Website domain", placeholder: "example.org", clean: cleanDomain,
    bad: "Type a public domain such as example.org (no address, port or path).",
    url: q => `https://${q}/`,
    shape: (html, q) => ({ title: "Basic accessibility signals for " + q, sub: "Automated read of the home page HTML. Passing these does not make a site accessible.", source_url: `https://${q}/`, columns: ["Check", "Result", "Detail"], rows: a11y(html) }),
  },
};

// USE-COUNT-1: one aggregate row per app per UTC day (a count and nothing else: no visitor, address, query or time of day). It is the measured
// "use" in BENEFIT-1. A counter failure is logged and never breaks the page.
const DDL = "CREATE TABLE IF NOT EXISTS spinoff_daily (app TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (app, day))";
export async function countUse(env, slug) {
  if (!env || !env.DB) return;
  try { await env.DB.batch([env.DB.prepare(DDL), env.DB.prepare("INSERT INTO spinoff_daily (app, day, n) VALUES (?, ?, 1) ON CONFLICT(app, day) DO UPDATE SET n = n + 1").bind(slug, today())]); }
  catch (e) { console.error("spinoff use counter failed", slug, String(e).slice(0, 120)); }
}
export async function uses7d(env, slug) {
  if (!env || !env.DB) return null;
  try {
    const since = new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10);
    await env.DB.prepare(DDL).run();
    const r = await env.DB.prepare("SELECT COALESCE(SUM(n), 0) n FROM spinoff_daily WHERE app = ? AND day >= ?").bind(slug, since).first();
    return r ? r.n : 0;
  } catch (e) { console.error("spinoff use read failed", slug, String(e).slice(0, 120)); return null; }
}

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
  try {
    let data;
    if (src.fetch) { data = await src.fetch(clean, f); if (!data) return { status: 404, body: { ok: false, code: "not_found", error: "Nothing public was found for that. Check the spelling or the code." } }; }
    else {
      const c = new AbortController(), t = setTimeout(() => c.abort(), 8000);
      try {
        const r = await f(src.url(clean), { headers: { "user-agent": UA, accept: "text/html" }, signal: c.signal });
        if (r.status === 404) return { status: 404, body: { ok: false, code: "not_found", error: "Nothing public was found for that. Check the spelling or the code." } };
        if (!r.ok) return { status: 502, body: { ok: false, code: "upstream", error: "The public source did not answer. Try again in a minute." } };
        data = await r.text();
      } finally { clearTimeout(t); }
    }
    return { status: 200, body: { ok: true, fetched_at: new Date().toISOString(), source: src.name, ...src.shape(data, clean) } };
  } catch (e) { return { status: 502, body: { ok: false, code: "upstream", error: "The public source did not answer. Try again in a minute." } }; }
}

const PAGE = (app, src) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(app.name)}</title><meta name="description" content="${esc(app.tagline)}">
<style>:root{--bg:#fff;--fg:#14181f;--mute:#566;--line:#d5dae1;--ok:#0b6b3a;--bad:#a1260f;--acc:#1f4fd8}@media(prefers-color-scheme:dark){:root{--bg:#10141a;--fg:#e8ecf2;--mute:#9aa6b6;--line:#2a323d;--ok:#5ad08a;--bad:#ff8a73;--acc:#8fb0ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:24px 16px}h1{font-size:28px;margin:0 0 8px}p.s{color:var(--mute);margin:0 0 20px}
form{display:flex;flex-direction:column;gap:12px;margin-bottom:16px}input,button{font:inherit;min-height:44px;border-radius:10px;border:1px solid var(--line);padding:0 14px;background:var(--bg);color:var(--fg)}button{background:var(--acc);color:#fff;border:0;font-weight:600;cursor:pointer}
@media(min-width:560px){form{flex-direction:row}input{flex:1}}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{text-align:left;padding:10px 8px 10px 0;border-top:1px solid var(--line);vertical-align:top}a{color:var(--acc)}.m{color:var(--mute);font-size:14px}.pass{color:var(--ok)}.look{color:var(--bad)}</style></head>
<body><main><h1>${esc(app.name)}</h1><p class="s">${esc(app.tagline)}</p>
${src.kind === "lookup" ? `<form id="f"><input id="q" inputmode="${src.clean === cleanDomain ? "url" : "text"}" autocomplete="off" placeholder="${esc(src.placeholder)}" aria-label="${esc(src.label)}" required><button>Look up</button></form>` : ""}
<div id="o" aria-live="polite">Loading live data…</div>
<p class="m">Source: ${src.home ? `<a href="${esc(src.home)}">${esc(src.name)}</a>` : esc(src.name)}, read live when you open this page; nothing is stored about you. Information only, not legal, financial or professional advice. <a href="/api/freshness">Freshness</a> · <a href="/llms.txt">For agents</a></p></main>
<script>const o=document.getElementById("o"),E=s=>String(s==null?"":s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const T=(cols,rows)=>"<table><thead><tr>"+cols.map(c=>"<th scope='col'>"+E(c)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(r=>"<tr>"+r.cells.map((c,i)=>"<td"+(c==="pass"?" class='pass'":c==="look at this"?" class='look'":"")+">"+(i===0&&r.url?"<a href='"+E(r.url)+"'>"+E(c)+"</a>":E(c))+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
const show=j=>{if(!j.ok){o.textContent=j.error;return}o.innerHTML=(j.title?"<h2>"+E(j.title)+"</h2><p class='m'>"+E(j.sub)+"</p>":"")+(j.rows.length?T(j.columns,j.rows):"<p>"+E(j.empty||"Nothing to show.")+"</p>")+"<p class='m'>Fetched live "+E(j.fetched_at)+"</p>"};
${src.kind === "feed" ? `fetch("/api/data").then(r=>r.json()).then(show).catch(()=>{o.textContent="The public source is not answering right now. Try again in a minute."});` : `o.textContent="Type above to look something up.";document.getElementById("f").onsubmit=e=>{e.preventDefault();o.textContent="Looking up…";fetch("/api/lookup?q="+encodeURIComponent(document.getElementById("q").value)).then(r=>r.json()).then(show).catch(()=>{o.textContent="The public source is not answering right now. Try again in a minute."})}`}</script></body></html>`;

export async function handleLive(sub, app, u, f = fetch, env = {}) {
  const src = SOURCES[app.live];
  if (!src) return new Response("Not found", { status: 404 });
  const p = u.pathname;
  if (p === "/") { await countUse(env, sub); return new Response(PAGE(app, src), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } }); }
  if (p === "/llms.txt") return new Response(`# ${app.name}\n${app.tagline}\n${src.kind === "feed" ? "GET /api/data returns the current rows as JSON." : "GET /api/lookup?q=... returns the result as JSON."}\nGET /api/freshness states the age of the live source. Source: ${src.name}. Nothing about any person is stored.\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (p === "/api/freshness" || p === "/api/metrics") {
    try {
      const d = src.kind === "feed" ? await feed(src, f) : null, age = d ? Math.max(0, Math.round((Date.now() - Date.parse(d.fetched_at)) / 1000)) : 0;
      return J({ app: sub, kind: src.kind, source: src.name, ok: true, fetched_at: d ? d.fetched_at : "per request", age_seconds: age, max_age_seconds: TTL, board_age_hours: +(age / 3600).toFixed(3), error_share: 0, ...(await uses7d(env, sub).then(n => n == null ? {} : { uses_7d: n })) }, 200, { "cache-control": "no-store" });
    } catch (e) { return J({ app: sub, kind: src.kind, source: src.name, ok: false, error: "upstream unavailable", board_age_hours: null, error_share: 1 }, 503, { "cache-control": "no-store" }); }
  }
  if (p === "/api/data" && src.kind === "feed") {
    await countUse(env, sub);
    try { const d = await feed(src, f); return J({ ok: true, source: src.name, columns: src.columns, empty: src.empty, ...d }); }
    catch (e) { return J({ ok: false, code: "upstream", error: "The public source did not answer. Try again in a minute." }, 502); }
  }
  if (p === "/api/lookup" && src.kind === "lookup") { await countUse(env, sub); const r = await lookup(src, u.searchParams.get("q"), f); return J(r.body, r.status, { "cache-control": "no-store" }); }
  return new Response("Not found", { status: 404 });
}
