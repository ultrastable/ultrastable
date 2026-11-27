// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DEMO-DASHBOARD-1: /demo, the live record as a dashboard a pilot applicant can read in under a minute. Rendered on the server from the same
// snapshot and live overlay as /live (site/live.js load + overlay): no client script, no external call, no login, GET only.
// Every figure is read from the snapshot; a value the snapshot does not hold is shown as "not measured", never as zero.
import { load, overlay } from "./live.js";

const esc = t => String(t == null ? "" : t).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => v == null || Number.isNaN(v) ? "not measured" : String(v);
import { readingRecency } from "./live.js"; // RECENCY-1
import { recencyHeaders } from "../seed/worker/src/recency.js";
export const DEMO_CSS = ".dm-tiles{display:grid;gap:12px;grid-template-columns:repeat(2,1fr)}@media(min-width:720px){.dm-tiles{grid-template-columns:repeat(4,1fr)}}"
  + ".dm-tile{background:var(--sf);border:1px solid var(--line);border-radius:8px;padding:14px}.dm-n{font-size:28px;font-weight:700;line-height:1.1}.dm-l{font-size:14px;color:var(--ink2)}"
  + ".dm-cap{color:var(--ink2);max-width:64ch}.dm-chart{width:100%;height:auto;max-width:720px;display:block}.dm-bar{background:var(--sf2);border-radius:6px;height:14px;overflow:hidden}.dm-bar span{display:block;height:100%;background:var(--good)}"
  + ".dm-st{white-space:nowrap}.dm-ok{color:var(--good);font-weight:600}.dm-bad{color:var(--bad);font-weight:600}.dm-key{display:flex;gap:16px;flex-wrap:wrap;font-size:14px;color:var(--ink2);margin:6px 0}.dm-key i{display:inline-block;width:12px;height:12px;border-radius:2px;margin-right:6px;vertical-align:-1px}";

const table = (head, rows) => "<div class=\"us-wrap\"><table class=\"us-table\"><thead><tr>" + head.map(h => "<th scope=\"col\">" + esc(h) + "</th>").join("") + "</tr></thead><tbody>"
  + (rows.length ? rows.map(r => "<tr>" + r.map(c => "<td>" + (c && c.html != null ? c.html : esc(c)) + "</td>").join("") + "</tr>").join("") : "<tr><td colspan=\"" + head.length + "\">Nothing recorded yet.</td></tr>") + "</tbody></table></div>";

// Two series only (the system's own changes and everything else), told apart by fill and by a pattern, so the chart does not rely on colour alone.
export function shippedByDay(d) {
  const own = c => /unattended|executor|worker|bot/i.test(String(c.by || ""));
  return ((d.throughput || {}).changelog || []).slice(0, 14).map(g => ({ date: g.date, unattended: g.changes.filter(own).length, session: g.changes.filter(c => !own(c)).length })).reverse();
}
function chart(days) {
  if (!days.length) return "<p class=\"dm-cap\">No merged changes are in the snapshot yet.</p>";
  const W = 720, H = 220, pad = 28, max = Math.max(1, ...days.map(x => x.unattended + x.session)), bw = (W - pad * 2) / days.length, y = v => (H - pad) - v / max * (H - pad * 2);
  const bars = days.map((x, i) => { const x0 = pad + i * bw + 3, w = Math.max(4, bw - 6), a = x.unattended, b = x.session;
    return "<rect x=\"" + x0.toFixed(1) + "\" y=\"" + y(a).toFixed(1) + "\" width=\"" + w.toFixed(1) + "\" height=\"" + ((H - pad) - y(a)).toFixed(1) + "\" fill=\"var(--ac)\"/>"
      + "<rect x=\"" + x0.toFixed(1) + "\" y=\"" + y(a + b).toFixed(1) + "\" width=\"" + w.toFixed(1) + "\" height=\"" + (y(a) - y(a + b)).toFixed(1) + "\" fill=\"url(#dm-h)\" stroke=\"var(--ink2)\" stroke-width=\"1\"/>"
      + "<text x=\"" + (x0 + w / 2).toFixed(1) + "\" y=\"" + (H - 8) + "\" text-anchor=\"middle\" font-size=\"11\" fill=\"var(--ink2)\">" + esc(x.date.slice(5)) + "</text>"; }).join("");
  return "<svg class=\"dm-chart\" viewBox=\"0 0 " + W + " " + H + "\" role=\"img\" aria-label=\"Merged changes per day for the last " + days.length + " days with changes, split by who drove them. The table below holds the same numbers.\">"
    + "<defs><pattern id=\"dm-h\" width=\"6\" height=\"6\" patternUnits=\"userSpaceOnUse\" patternTransform=\"rotate(45)\"><rect width=\"6\" height=\"6\" fill=\"var(--sf2)\"/><line x1=\"0\" y1=\"0\" x2=\"0\" y2=\"6\" stroke=\"var(--ink2)\" stroke-width=\"2\"/></pattern></defs>"
    + "<line x1=\"" + pad + "\" y1=\"" + (H - pad) + "\" x2=\"" + (W - pad) + "\" y2=\"" + (H - pad) + "\" stroke=\"var(--line)\"/><text x=\"" + pad + "\" y=\"14\" font-size=\"11\" fill=\"var(--ink2)\">most in one day: " + max + "</text>" + bars + "</svg>"
    + "<div class=\"dm-key\"><span><i style=\"background:var(--ac)\"></i>the system's own loops</span><span><i style=\"background:var(--sf2);border:1px solid var(--ink2)\"></i>a working session</span></div>";
}

export function demoBody(d) {
  const clocks = d.clocks || [], sb = d.scoreboard || {}, q = ((d.throughput || {}).queue || {}).by_status || {}, top = d.topology || {}, parts = top.parts || {}, fr = d.freshness || {};
  const measured = clocks.filter(c => c.status && c.status !== "unmeasured"), ticking = measured.filter(c => c.status === "ticking" || c.status === "idle").length;
  const days = shippedByDay(d), merged = days.reduce((a, x) => a + x.unattended + x.session, 0);
  const closed = (q.closed || 0) + (q.done || 0), total = closed + (q.open || 0), live = Object.values(parts).reduce((a, p) => a + (p.live || 0), 0), planned = Object.values(parts).reduce((a, p) => a + (p.planned || 0), 0);
  const tile = (n, l) => "<div class=\"dm-tile\"><div class=\"dm-n\">" + esc(n) + "</div><div class=\"dm-l\">" + esc(l) + "</div></div>";
  const st = s => ({ html: "<span class=\"dm-st " + (s === "ticking" || s === "idle" ? "dm-ok" : s === "unmeasured" ? "" : "dm-bad") + "\">" + esc(s || "unmeasured") + "</span>" });
  const ago = s => s == null ? "not measured" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 172800 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " d ago";
  return "<div class=\"head\"><h1>Ultrastable, running right now</h1><p class=\"dm-cap\">This is the system working on itself. Each loop below is a clock, each bar is code that was merged, and nothing here is typed by hand: the page is built from the same record the managers and agents work from.</p>"
    + "<p class=\"meta\">Record as of " + esc(d.generated || "unknown") + (fr.ok === false ? ". Some sources are older than their schedule; the <a href=\"/live\">live page</a> says which." : ".") + "</p></div>"
    + "<div class=\"dm-tiles\">" + tile(measured.length ? ticking + " of " + measured.length : "not measured", "loops on time") + tile(days.length ? merged : "not measured", "changes merged in the days shown")
    + tile(total ? closed + " of " + total : "not measured", "backlog items closed") + tile(live + planned ? live + " of " + (live + planned) : "not measured", "system parts live") + "</div>"
    + "<h2>Code shipped, by day</h2><p class=\"dm-cap\">How much was merged each day, and whether the system's own loops or a working session drove it.</p>" + chart(days)
    + table(["Day", "By the system's loops", "By a working session"], days.slice().reverse().map(x => [x.date, x.unattended, x.session]))
    + "<h2>The loops</h2><p class=\"dm-cap\">Every loop has an expected interval. Its status is measured from recorded runs: ticking, late or stopped.</p>"
    + table(["Loop", "What it does", "Last run", "Status"], clocks.map(c => [c.id, c.what, ago(c.last_beat_age_s), st(c.status)]))
    + "<h2>The backlog</h2><p class=\"dm-cap\">Work the system filed for itself. Closed means a probe passed, not that someone ticked a box.</p>"
    + (total ? "<div class=\"dm-bar\" role=\"img\" aria-label=\"" + closed + " of " + total + " backlog items closed\"><span style=\"width:" + Math.round(closed / total * 100) + "%\"></span></div><p class=\"meta\">" + closed + " closed, " + (q.open || 0) + " open, " + num(((d.throughput || {}).queue || {}).takeable_now) + " ready to take now.</p>" : "<p class=\"meta\">not measured</p>")
    + "<h2>System parts and drift</h2><p class=\"dm-cap\">What is deployed against what the repository says should be. A planned part that is not live yet is drift the system still has to close.</p>"
    + table(["Part", "Live", "Planned, not live yet"], Object.keys(parts).map(k => [k, parts[k].live, parts[k].planned]))
    + ((top.pending_bindings || []).length ? "<p class=\"meta\">Still to wire: " + top.pending_bindings.map(esc).join("; ") + ".</p>" : "")
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/pilot\">Apply for a pilot</a><a class=\"btn\" href=\"/customer-zero\">Read the case study</a><a class=\"btn\" href=\"/live\">See the full record</a></div>";
}

export async function demoResponse(u, request, env, shell, HTML, bundleAt = null) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(JSON.stringify({ error: "read-only" }), { status: 405, headers: { "content-type": "application/json; charset=utf-8", allow: "GET, HEAD" } });
  const r = await load(env);
  const body = r ? demoBody(await overlay(JSON.parse(r.body), env, r.generated, Date.now(), bundleAt)) : "<div class=\"head\"><h1>Ultrastable, running right now</h1><p>The record has not been published yet. The <a href=\"/live\">live page</a> shows it as soon as it is.</p></div>";
  return new Response(shell({ path: "/demo", title: "Demo: Ultrastable running right now", description: "The live record as a dashboard: loops, shipped code by day, backlog and system parts.", recency: readingRecency(r && r.generated) }, "<style>" + DEMO_CSS + "</style>" + body), { status: r ? 200 : 503, headers: { ...HTML, ...recencyHeaders(readingRecency(r && r.generated)) } });
}
