// Ultrastable standard web analytics (ANALYTICS-1, 2026-11-10). Ships in every seed; the dashboard and the seed worker import this one file.
// First-party and cookieless: no third-party script, no IP stored, no cookie, no cross-day visitor id. Honors Do Not Track and Global Privacy Control.
// Portable core: touches the platform only through env.DB (SQL) and fetch/Request/Response. Schema: analytics/schema.sql.
// Every metric in REGISTRY has a trigger or a named exemption (rule from the QNFO scoreboard); test/analytics.test.mjs enforces it.
export const VERSION = "0.1.0";
const DAY = 864e5, RAW_KEEP_DAYS = 35;
const BOT_RE = /bot|crawl|spider|slurp|preview|monitor|uptime|curl|wget|python-requests|httpclient|headless|lighthouse|facebookexternalhit|node-fetch|undici|go-http|java\//i;
const enc = new TextEncoder();
async function sha(s) { const b = await crypto.subtle.digest("SHA-256", enc.encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
export const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return ""; } };
export const cleanPath = p => { p = String(p || "/").split(/[?#]/)[0].slice(0, 120); if (!p.startsWith("/")) p = "/" + p; return p.length > 1 ? p.replace(/\/$/, "") : p; };
export const deviceOf = ua => /ipad|tablet/i.test(ua) ? "tablet" : /mobi|android|iphone/i.test(ua) ? "mobile" : "desktop";
export const isBot = ua => !ua || BOT_RE.test(ua);

// Registry: every metric names its kind (target|guard), a trigger (breach when `value < min` or `value > max`, after `grace_days` of collection) or an exemption.
export const REGISTRY = [
  { name: "pageviews_7d", kind: "target", label: "Page views, 7 days", min: 1, grace_days: 14 },
  { name: "visitors_7d", kind: "target", label: "Unique visitors, 7 days (daily-rotating ids, summed per day)", min: 1, grace_days: 14 },
  { name: "referral_share_7d", kind: "target", label: "Share of views arriving from another site", exemption: "informational until traffic exceeds 100 views in 7 days; no sensible floor before then" },
  { name: "pageviews_30d", kind: "target", label: "Page views, 30 days", exemption: "context for pageviews_7d; the 7-day trigger covers the breach" },
  { name: "referral_30d", kind: "target", label: "Views from another site, 30 days", exemption: "context for referral_share_7d" },
  { name: "collector_selfcheck", kind: "guard", label: "Collector accepted a synthetic hit in the last 30 minutes (1 = yes)", min: 1, grace_days: 0 },
  { name: "bot_share_7d", kind: "guard", label: "Share of hits that look like bots", max: 0.8, grace_days: 7, min_hits: 50 },
];

export async function record(env, req, o) {
  const ua = req.headers.get("user-agent") || "", now = Date.now();
  if (req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1") return false;
  const host = String(o.host || "").replace(/^www\./, "").toLowerCase(), day = new Date(now).toISOString().slice(0, 10);
  const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "";
  const vid = (await sha(day + ":" + (env.ANALYTICS_SALT || "us") + ":" + ip + ":" + ua)).slice(0, 16);
  const ref = hostOf(o.ref || ""), name = String(o.name || "pageview").slice(0, 40);
  await env.DB.prepare("INSERT INTO hits(at,host,path,ref,country,device,bot,vid,name) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)")
    .bind(now, host, cleanPath(o.path), ref && ref !== host ? ref : "", (req.cf && req.cf.country) || req.headers.get("cf-ipcountry") || "", deviceOf(ua), isBot(ua) ? 1 : 0, vid, name).run();
  await env.DB.prepare("INSERT OR IGNORE INTO analytics_meta(key,value) VALUES('started',?1)").bind(String(now)).run();
  return true;
}

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const allowed = (env, hosts, h) => { const list = (env.ANALYTICS_HOSTS ? String(env.ANALYTICS_HOSTS).split(",") : hosts || []).map(x => x.trim().replace(/^www\./, "")); return list.includes(h); };
// Beacon: <script defer src="https://HOST/a.js"></script>. Sends one hit per page load; nothing is stored in the browser.
export const BEACON_JS = '(function(){try{if(navigator.doNotTrack=="1"||navigator.globalPrivacyControl)return;var s=document.currentScript,u=new URL("/a/e",s&&s.src||location.href).href;var d=JSON.stringify({h:location.hostname,p:location.pathname,r:document.referrer});if(navigator.sendBeacon)navigator.sendBeacon(u,new Blob([d],{type:"text/plain"}));else fetch(u,{method:"POST",body:d,keepalive:true,mode:"no-cors"})}catch(e){}})();';

// Returns a Response for analytics routes, or null when the path is not ours. opts.hosts = hostnames this deployment may count.
export async function handleAnalytics(req, env, opts) {
  const p = new URL(req.url).pathname;
  if (p === "/a.js") return new Response(BEACON_JS, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=3600", ...CORS } });
  if (p !== "/a/e") return null;
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: CORS });
  let b = {}; try { const t = await req.text(); if (t.length > 1000) return new Response(null, { status: 413, headers: CORS }); b = JSON.parse(t); } catch (e) { return new Response(null, { status: 400, headers: CORS }); }
  const h = String(b.h || "").replace(/^www\./, "").toLowerCase();
  if (!allowed(env, opts && opts.hosts, h)) return new Response(null, { status: 204, headers: CORS });
  try { await record(env, req, { host: h, path: b.p, ref: b.r, name: "pageview" }); } catch (e) { console.error("analytics record", e && e.message); return new Response(null, { status: 500, headers: CORS }); }
  return new Response(null, { status: 204, headers: CORS });
}

// Called by the scheduled tick: a synthetic hit through the real insert path, then prune old raw rows.
export async function selfcheck(env, host) {
  const req = new Request("https://" + host + "/", { headers: { "user-agent": "ultrastable-selfcheck/bot" } });
  await record(env, req, { host, path: "/", name: "selfcheck" });
  await env.DB.prepare("DELETE FROM hits WHERE at<?1").bind(Date.now() - RAW_KEEP_DAYS * DAY).run();
}

export async function measure(env, now) {
  now = now || Date.now();
  const one = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).first()) || {};
  const w7 = now - 7 * DAY, w30 = now - 30 * DAY, real = "name='pageview' AND bot=0";
  const pv7 = (await one("SELECT COUNT(*) c FROM hits WHERE at>=?1 AND " + real, w7)).c || 0;
  const pv30 = (await one("SELECT COUNT(*) c FROM hits WHERE at>=?1 AND " + real, w30)).c || 0;
  const vis7 = (await one("SELECT COUNT(*) c FROM (SELECT DISTINCT vid, substr(datetime(at/1000,'unixepoch'),1,10) d FROM hits WHERE at>=?1 AND " + real + ")", w7)).c || 0;
  const rf7 = (await one("SELECT COUNT(*) c FROM hits WHERE at>=?1 AND ref<>'' AND " + real, w7)).c || 0;
  const rf30 = (await one("SELECT COUNT(*) c FROM hits WHERE at>=?1 AND ref<>'' AND " + real, w30)).c || 0;
  const all7 = (await one("SELECT COUNT(*) c, SUM(bot) b FROM hits WHERE at>=?1 AND name='pageview'", w7));
  const sc = (await one("SELECT MAX(at) t FROM hits WHERE name='selfcheck'")).t || 0;
  const started = +((await one("SELECT value v FROM analytics_meta WHERE key='started'")).v || now);
  return { now, age_days: (now - started) / DAY, hits7: all7.c || 0,
    values: { pageviews_7d: pv7, visitors_7d: vis7, referral_share_7d: pv7 ? +(rf7 / pv7).toFixed(3) : 0, pageviews_30d: pv30, referral_30d: rf30, collector_selfcheck: now - sc < 30 * 60e3 ? 1 : 0, bot_share_7d: all7.c ? +((all7.b || 0) / all7.c).toFixed(3) : 0 } };
}
// A breach is hit=1. A metric with neither a trigger nor an exemption is itself a defect (see the registry test).
export function evaluate(m) {
  return REGISTRY.map(r => {
    const value = m.values[r.name]; let hit = 0, why = r.exemption ? "exempt: " + r.exemption : "";
    if (!r.exemption && m.age_days >= (r.grace_days || 0) && (r.min_hits == null || m.hits7 >= r.min_hits)) {
      if (r.min != null && value < r.min) { hit = 1; why = "below " + r.min; }
      if (r.max != null && value > r.max) { hit = 1; why = "above " + r.max; }
    }
    if (!why) why = "within bounds";
    return { name: r.name, kind: r.kind, label: r.label, value, hit, why };
  });
}
export async function report(env, now) {
  const m = await measure(env, now), rows = evaluate(m);
  const top = (await env.DB.prepare("SELECT host,path,COUNT(*) views FROM hits WHERE at>=?1 AND name='pageview' AND bot=0 GROUP BY host,path ORDER BY views DESC LIMIT 8").bind(m.now - 7 * DAY).all()).results;
  const refs = (await env.DB.prepare("SELECT ref,COUNT(*) views FROM hits WHERE at>=?1 AND name='pageview' AND bot=0 AND ref<>'' GROUP BY ref ORDER BY views DESC LIMIT 6").bind(m.now - 7 * DAY).all()).results;
  const daily = (await env.DB.prepare("SELECT substr(datetime(at/1000,'unixepoch'),1,10) day,COUNT(*) views FROM hits WHERE at>=?1 AND name='pageview' AND bot=0 GROUP BY day ORDER BY day").bind(m.now - 14 * DAY).all()).results;
  return { version: VERSION, age_days: +m.age_days.toFixed(1), metrics: rows, breaches: rows.filter(r => r.hit).length, top, refs, daily };
}
export const summary = r => r.metrics.map(x => (x.hit ? "BREACH " : "ok     ") + x.name + " = " + x.value + " (" + x.why + ")").join("\n");
