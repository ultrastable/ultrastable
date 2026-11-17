// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPINOFF-1: one Worker serves every spun-off app at <slug>.ultrastable.app from the generated bundle (spinoffs/registry.json).
// Ultrastable is the foundation for any autonomous system. Archetype "domain-check": reads only public pages and public DNS of the
// domain a visitor types. Stores aggregate counts, a daily-salted visitor hash and the domain only as a keyed one-way hash (to tell a fix
// from a first look). No address, name, IP or readable domain is kept. Metrics are public at /api/metrics.
import bundle from "./registry.js";
import { userError } from "../seed/worker/src/errors.js";  // USER-BACKEND-1

const J = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*", ...h } });
const sha = async s => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, "0")).join("");
const INDEXNOW_KEY = "ultrastable-indexnow-7f3a9c2e4b1d";  // public by design (IndexNow proves ownership by serving it); same key as site/promote.js
const UA = "ultrastable-blindspot (+https://blindspot.ultrastable.app; reads public pages only)";

export function cleanDomain(raw) {
  let d = String(raw || "").trim().toLowerCase().replace(/^https?:\/\//, "").split(/[\/?#]/)[0];
  if (!/^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(d)) return null;
  if (/^(localhost|.*\.(local|internal|localdomain|lan|home|corp|test|invalid|example))$/.test(d)) return null;
  return d;
}

async function get(f, url, opt = {}) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 6000);
  try { return await f(url, { headers: { "user-agent": UA, accept: opt.accept || "*/*" }, redirect: opt.redirect || "follow", signal: c.signal }); }
  catch (e) { return null; } finally { clearTimeout(t); }
}
async function txt(f, name) {
  const r = await get(f, "https://cloudflare-dns.com/dns-query?type=TXT&name=" + encodeURIComponent(name), { accept: "application/dns-json" });
  if (!r || !r.ok) return null;
  try { return ((await r.json()).Answer || []).map(a => String(a.data).replace(/"/g, "")); } catch (e) { return null; }
}
const LINKS = { privacy: /privacy|datenschutz|confidentialit/i, terms: /terms|conditions|\/tos\b|nutzungsbedingungen/i, accessibility: /accessib|a11y|barriere/i };

export async function runChecks(domain, ids, f = fetch) {
  const need = new Set(ids), out = {};
  const home = need.has("https") || need.has("hsts") || ["privacy", "terms", "accessibility"].some(i => need.has(i)) ? await get(f, "https://" + domain + "/") : null;
  if (need.has("https")) {
    const h = await get(f, "http://" + domain + "/", { redirect: "manual" });
    const loc = h && h.headers.get("location") || "";
    out.https = { pass: !!(home && home.ok) && (!h || /^https:/i.test(loc) || h.status >= 400 || !!home), detail: home && home.ok ? "HTTPS answered" : "no HTTPS answer" };
    if (h && h.status < 400 && !/^https:/i.test(loc) && h.status !== 200) out.https.detail += "; http did not redirect to https";
  }
  if (need.has("hsts")) { const v = home && home.headers.get("strict-transport-security"); out.hsts = { pass: !!v, detail: v ? v.slice(0, 80) : "header absent" }; }
  if (need.has("security-txt")) {
    const r = await get(f, "https://" + domain + "/.well-known/security.txt"), t = r && r.ok ? (await r.text()).slice(0, 4000) : "";
    out["security-txt"] = { pass: /^\s*contact:/im.test(t), detail: r && r.ok ? "found" : "not found" };
  }
  if (need.has("spf")) { const t = await txt(f, domain); out.spf = t === null ? { pass: null, detail: "DNS lookup failed" } : { pass: t.some(x => /^v=spf1/i.test(x)), detail: t.some(x => /^v=spf1/i.test(x)) ? "present" : "no v=spf1 record" }; }
  if (need.has("dmarc")) { const t = await txt(f, "_dmarc." + domain); out.dmarc = t === null ? { pass: null, detail: "DNS lookup failed" } : { pass: t.some(x => /^v=DMARC1/i.test(x)), detail: t.some(x => /^v=DMARC1/i.test(x)) ? "present" : "no v=DMARC1 record" }; }
  if (["privacy", "terms", "accessibility"].some(i => need.has(i))) {
    const html = home && home.ok ? (await home.text()).slice(0, 300000) : "";
    const hrefs = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi)].map(m => m[1] + " " + m[2].replace(/<[^>]+>/g, " "));
    for (const k of ["privacy", "terms", "accessibility"]) if (need.has(k)) out[k] = html ? { pass: hrefs.some(x => LINKS[k].test(x)), detail: "searched the home page links" } : { pass: null, detail: "home page not readable" };
  }
  return out;
}

async function record(env, row) {
  if (!env.DB) return;
  await env.DB.prepare("INSERT INTO spinoff_events (at,app,visitor,dhash,failed,nfail,prev_nfail,fixes,recheck,ref,blocked,error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(row.at, row.app, row.visitor, row.dhash || "", row.failed || "", row.nfail || 0, row.prev_nfail || 0, row.fixes || 0, row.recheck || 0, row.ref || "", row.blocked || 0, row.error || 0).run();
}

export async function metrics(env, app) {
  const z = { app, uses_7d: 0, unique_visitors_7d: 0, visitors_with_a_gap_7d: 0, referrer_domains_7d: 0, verified_fixes_7d: 0, gap_closed_share: 0, return_share: 0, error_share: 0, abuse_blocks: 0, requests_vs_daily_cap: 0 };
  if (!env.DB) return z;
  const since = new Date(Date.now() - 7 * 864e5).toISOString();
  const r = await env.DB.prepare("SELECT COUNT(CASE WHEN blocked=0 AND error=0 THEN 1 END) uses, COUNT(DISTINCT CASE WHEN blocked=0 AND error=0 THEN visitor END) vis, COUNT(DISTINCT CASE WHEN nfail>0 AND blocked=0 THEN visitor END) gapv, COUNT(DISTINCT CASE WHEN ref!='' THEN ref END) refs, COALESCE(SUM(fixes),0) fixes, COALESCE(SUM(CASE WHEN recheck=1 THEN prev_nfail END),0) prev, COALESCE(SUM(recheck),0) rech, COALESCE(SUM(error),0) err, COALESCE(SUM(blocked),0) blk, COUNT(*) total FROM spinoff_events WHERE app=? AND at>=?").bind(app, since).first();
  const day = await env.DB.prepare("SELECT COUNT(*) n FROM spinoff_events WHERE app=? AND at>=? GROUP BY substr(at,1,10) ORDER BY n DESC LIMIT 1").bind(app, since).first();
  const cap = bundle.caps.max_requests_per_app_per_day;
  return { ...z, uses_7d: r.uses, unique_visitors_7d: r.vis, visitors_with_a_gap_7d: r.gapv, referrer_domains_7d: r.refs, verified_fixes_7d: r.fixes,
    gap_closed_share: r.prev ? +(r.fixes / r.prev).toFixed(3) : 0, return_share: r.uses ? +(r.rech / r.uses).toFixed(3) : 0, error_share: r.total ? +(r.err / r.total).toFixed(3) : 0,
    abuse_blocks: r.blk, requests_vs_daily_cap: day ? +(day.n / cap).toFixed(4) : 0 };
}

async function check(env, app, domainRaw, request, f) {
  const domain = cleanDomain(domainRaw), now = new Date(), at = now.toISOString(), day = at.slice(0, 10);
  const salt = env.SALT || "ultrastable-spinoff", ip = request.headers.get("cf-connecting-ip") || "", ua = request.headers.get("user-agent") || "";
  const visitor = (await sha(salt + "|" + day + "|" + ip + "|" + ua)).slice(0, 16);
  let ref = ""; try { ref = new URL(request.headers.get("referer") || "").hostname.replace(/^www\./, ""); } catch (e) { /* no referrer */ }
  if (ref.endsWith("ultrastable.app")) ref = "";
  if (!domain) return J({ ok: false, code: "bad_domain", error: "Type a public domain such as example.org (no address, port or path)." }, 400);
  if (env.DB) {
    const n = await env.DB.prepare("SELECT COUNT(*) n FROM spinoff_events WHERE app=? AND visitor=? AND at>=?").bind(app.slug, visitor, day).first();
    const total = await env.DB.prepare("SELECT COUNT(*) n FROM spinoff_events WHERE app=? AND at>=?").bind(app.slug, day).first();
    if (n.n >= 30 || total.n >= bundle.caps.max_requests_per_app_per_day) { await record(env, { at, app: app.slug, visitor, blocked: 1 }); return J({ ok: false, code: "rate_limited", error: "Too many checks today. Try again tomorrow." }, 429); }
  }
  const ids = app.checks.map(c => c.id), t0 = await runChecks(domain, ids, f);
  const rows = app.checks.map(c => ({ id: c.id, title: c.title, fix: c.fix, ...(t0[c.id] || { pass: null, detail: "not run" }) }));
  const failed = rows.filter(r => r.pass === false).map(r => r.id), dhash = (await sha(salt + "|d|" + domain)).slice(0, 20);
  let prev = null; if (env.DB) prev = await env.DB.prepare("SELECT failed, nfail FROM spinoff_events WHERE app=? AND dhash=? AND blocked=0 AND error=0 ORDER BY id DESC LIMIT 1").bind(app.slug, dhash).first();
  const was = prev ? prev.failed.split(",").filter(Boolean) : [], fixes = prev ? was.filter(x => !failed.includes(x) && rows.find(r => r.id === x && r.pass === true)).length : 0;
  await record(env, { at, app: app.slug, visitor, dhash, failed: failed.join(","), nfail: failed.length, prev_nfail: prev ? prev.nfail : 0, fixes, recheck: prev ? 1 : 0, ref });
  return J({ ok: true, domain, checked_at: at, passed: rows.filter(r => r.pass === true).length, missing: failed.length, unknown: rows.filter(r => r.pass === null).length, fixed_since_last_check: fixes, results: rows,
    note: "Automated read of public pages and DNS. A missing item is a prompt to look, not legal, security or compliance advice." });
}

const PAGE = app => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${app.name}</title><meta name="description" content="${app.tagline}">
<style>:root{--bg:#fff;--fg:#14181f;--mute:#566;--line:#d5dae1;--ok:#0b6b3a;--bad:#a1260f;--acc:#1f4fd8}@media(prefers-color-scheme:dark){:root{--bg:#10141a;--fg:#e8ecf2;--mute:#9aa6b6;--line:#2a323d;--ok:#5ad08a;--bad:#ff8a73;--acc:#8fb0ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}main{max-width:680px;margin:0 auto;padding:24px 16px}h1{font-size:28px;margin:0 0 8px}p.s{color:var(--mute);margin:0 0 20px}
form{display:flex;flex-direction:column;gap:12px}input,button{font:inherit;min-height:44px;border-radius:10px;border:1px solid var(--line);padding:0 14px;background:var(--bg);color:var(--fg)}button{background:var(--acc);color:#fff;border:0;font-weight:600;cursor:pointer}
@media(min-width:560px){form{flex-direction:row}input{flex:1}}li{list-style:none;border-top:1px solid var(--line);padding:12px 0}ul{padding:0;margin:20px 0}.p{color:var(--ok)}.f{color:var(--bad)}small,.m{color:var(--mute);font-size:14px}</style></head>
<body><main><h1>${app.name}</h1><p class="s">${app.tagline}</p>
<form id="f"><input id="d" name="domain" inputmode="url" autocomplete="off" placeholder="example.org" aria-label="Your domain" required><button>Check</button></form>
<div id="o" aria-live="polite"></div>
<p class="m">It reads only public pages and public DNS of the domain you type. It keeps counts and a one-way fingerprint of the domain so it can tell you what you fixed when you check again; never your address, name or the readable domain. Not legal or security advice. <a href="/api/metrics">Live metrics</a> · <a href="/llms.txt">For agents</a></p></main>
<script>const f=document.getElementById("f"),o=document.getElementById("o");f.onsubmit=async e=>{e.preventDefault();o.textContent="Checking…";const r=await fetch("/api/check",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({domain:document.getElementById("d").value})}),j=await r.json();
if(!j.ok){o.textContent=j.error;return}o.innerHTML="<h2>"+j.missing+" to look at, "+j.passed+" in place"+(j.fixed_since_last_check?" ("+j.fixed_since_last_check+" fixed since last time)":"")+"</h2><ul>"+j.results.map(x=>"<li><b class='"+(x.pass===true?"p":x.pass===false?"f":"")+"'>"+(x.pass===true?"✓ ":x.pass===false?"✗ ":"? ")+x.title+"</b><br><small>"+x.detail+"</small>"+(x.pass===false?"<br>"+x.fix:"")+"</li>").join("")+"</ul><p class='m'>Fix something, then check again.</p>"};</script></body></html>`;

export async function handle(request, env, f = fetch) {
  const u = new URL(request.url), host = u.hostname.toLowerCase(), sub = host.endsWith("." + bundle.domain) ? host.slice(0, -bundle.domain.length - 1) : "";
  if (!sub || sub.includes(".")) return new Response("Not found", { status: 404 });
  if (bundle.retired.includes(sub)) return new Response("This app was retired by the portfolio manager.", { status: 410 });
  const app = bundle.apps[sub];
  if (!app) return new Response("Not found", { status: 404 });
  if (u.pathname === "/" + INDEXNOW_KEY + ".txt") return new Response(INDEXNOW_KEY, { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (u.pathname === "/api/metrics") return J(await metrics(env, sub), 200, { "cache-control": "public, max-age=300" });
  if (u.pathname === "/api/check") {
    if (request.method === "GET") return check(env, app, u.searchParams.get("domain"), request, f);
    if (request.method === "POST") { let b = {}; try { b = await request.json(); } catch (e) { return J({ ok: false, code: "bad_json", error: "Send JSON {\"domain\":\"example.org\"}" }, 400); } return check(env, app, b.domain, request, f); }
    return J({ ok: false, code: "method" }, 405);
  }
  if (u.pathname === "/llms.txt") return new Response(`# ${app.name}\n${app.tagline}\nGET /api/check?domain=example.org returns JSON results for ${app.checks.map(c => c.id).join(", ")}.\nGET /api/metrics returns public aggregate usage and outcome metrics.\nReads only public pages and DNS. Stores no personal data.\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
  if (u.pathname === "/") return new Response(PAGE(app), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
  return new Response("Not found", { status: 404 });
}

export default { fetch: (req, env) => handle(req, env).catch(e => { const r = userError(e, "spinoffs"); return J({ ok: false, code: r.code, error: r.error }, r.status); }) };
