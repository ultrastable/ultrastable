// SPDX-License-Identifier: LicenseRef-Ultrastable
// Did It Work? A tenant system on Ultrastable, the foundation for any autonomous system.
// Guess first, then the graded evidence. Daily beat re-checks every source link and logs it; reader guesses are anonymous counts.
import { CASES, GRADES, VERDICTS } from "./cases.js";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const SCHEMA = ["CREATE TABLE IF NOT EXISTS checks (case_id TEXT, url TEXT, status INTEGER, at TEXT)", "CREATE TABLE IF NOT EXISTS guesses (case_id TEXT, guess TEXT, n INTEGER, PRIMARY KEY (case_id, guess))", "CREATE TABLE IF NOT EXISTS beats (at TEXT, checked INTEGER, ok INTEGER)"];
async function schema(db) { for (const s of SCHEMA) await db.prepare(s).run(); }

export async function beat(env, fetcher = fetch, now = () => new Date()) {
  await schema(env.DB);
  let checked = 0, ok = 0;
  for (const c of CASES) for (const e of c.evidence) {
    let status = 0;
    try { const r = await fetcher(e.url, { method: "HEAD", redirect: "follow", headers: { "User-Agent": "did-it-work-beat (ultrastable)" } }); status = r.status; } catch (x) { console.error("check", c.id, x && x.message); }
    checked++; if (status > 0 && status < 400) ok++;
    await env.DB.prepare("INSERT INTO checks VALUES (?,?,?,?)").bind(c.id, e.url, status, now().toISOString()).run();
  }
  await env.DB.prepare("INSERT INTO beats VALUES (?,?,?)").bind(now().toISOString(), checked, ok).run();
  return { checked, ok };
}

export async function health(env, now = Date.now()) {
  let last = null;
  try { await schema(env.DB); last = await env.DB.prepare("SELECT at, checked, ok FROM beats ORDER BY at DESC LIMIT 1").first(); } catch (x) { console.error("health", x && x.message); }
  const fresh = !!(last && now - Date.parse(last.at) < 7 * 864e5);
  return { ok: true, app: "did-it-work", cases: CASES.length, stage: fresh ? "looping" : "live", blocks: fresh ? null : "first daily source check has not run yet", last_beat: last };
}

const STYLE = ":root{--bg:#fbfaf7;--ink:#1d1d1b;--mute:#5d5b55;--line:#dedad0;--acc:#0b6e4f}@media (prefers-color-scheme:dark){:root{--bg:#141413;--ink:#f1efe8;--mute:#b5b2a8;--line:#3a3935;--acc:#5fc79d}}body{background:var(--bg);color:var(--ink);font:16px/1.55 system-ui,sans-serif;max-width:44rem;margin:0 auto;padding:1rem}a{color:var(--acc)}.c{border:1px solid var(--line);border-radius:12px;padding:1rem;margin:1rem 0}.m{color:var(--mute);font-size:.95rem}button{font:inherit;min-height:44px;padding:.4rem 1rem;margin:.2rem;border-radius:999px;border:1.5px solid var(--line);background:transparent;color:var(--ink);cursor:pointer}.r{display:none}";
function page(title, body) {
  return new Response("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>" + esc(title) + "</title><style>" + STYLE + "</style><body>" + body + "<p class=m>Runs on <a href='https://ultrastable.io'>Ultrastable</a>, which runs itself. No accounts, no cookies. <a href='/cases.json'>All cases as data</a>.</p></body></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
function card(c) {
  const ev = c.evidence.map((e) => "<li><a href='" + esc(e.url) + "'>" + esc(e.cite) + "</a> <span class=m>(" + esc(GRADES[e.design]) + ")</span></li>").join("");
  return "<div class=c id='" + c.id + "'><h2>" + esc(c.name) + "</h2><p class=m>" + esc(c.where) + ", since " + esc(c.since) + "</p><p><strong>What it promised:</strong> " + esc(c.aim) + "</p><p class=m>" + esc(c.feels) + "</p><p>Your guess: did it work?</p><div>"
    + Object.keys(VERDICTS).map((v) => "<button data-c='" + c.id + "' data-v='" + v + "'>" + esc(VERDICTS[v]) + "</button>").join("")
    + "</div><div class=r><p><strong>What the evaluations found:</strong> " + esc(VERDICTS[c.verdict]) + ". " + esc(c.finding) + "</p><ul>" + ev + "</ul></div></div>";
}
const JS = "<script>document.querySelectorAll('button[data-c]').forEach(function(b){b.onclick=function(){var d=b.closest('.c');d.querySelector('.r').style.display='block';d.querySelectorAll('button').forEach(function(x){x.disabled=true});b.style.borderColor='var(--acc)';fetch('/api/guess',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({c:b.dataset.c,v:b.dataset.v})}).catch(function(){})}})</script>";

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname === "/health") return Response.json(await health(env));
    if (u.pathname === "/cases.json") return Response.json({ grades: GRADES, verdicts: VERDICTS, cases: CASES }, { headers: { "Access-Control-Allow-Origin": "*" } });
    if (u.pathname === "/api/guess" && req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      if (!CASES.some((c) => c.id === b.c) || !VERDICTS[b.v]) return Response.json({ error: "unknown_case_or_guess" }, { status: 400 });
      await schema(env.DB);
      await env.DB.prepare("INSERT INTO guesses VALUES (?,?,1) ON CONFLICT(case_id,guess) DO UPDATE SET n=n+1").bind(b.c, b.v).run();
      return Response.json({ ok: true });
    }
    if (u.pathname === "/") return page("Did It Work?", "<h1>Did It Work?</h1><p>Every big policy promised something. Guess whether it delivered, then see what the evaluations found and how strong that evidence is.</p>" + CASES.map(card).join("") + JS);
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_e, env, ctx) { ctx.waitUntil(beat(env)); }
};
