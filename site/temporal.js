// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TEMPORAL-1 (Rowan, 2026-11-21): /trends shows how the system evolves over time, not a snapshot: activity per component and per loop as daily series,
// and what the loop read from them (hotspots, neglect, stopped loops, repeated failures). Every cell is read from site/temporal-data.js, which
// `python3 -m foundation temporal --run --apply` writes from the repository's own history and ledgers; nothing is typed by hand. Routes: /trends, /trends.json.
import { TEMPORAL } from "./temporal-data.js";
const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

export function spark(vals, { w = 140, h = 32, label = "" } = {}) {
  const v = (vals || []).map(Number), max = Math.max(1, ...v), step = v.length > 1 ? w / (v.length - 1) : w;
  const pts = v.map((y, i) => (i * step).toFixed(1) + "," + (h - 2 - (y / max) * (h - 4)).toFixed(1)).join(" ");
  return "<svg role=\"img\" aria-label=\"" + esc(label || "daily series, peak " + max) + "\" viewBox=\"0 0 " + w + " " + h + "\" width=\"" + w + "\" height=\"" + h + "\" style=\"vertical-align:middle\"><polyline fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.5\" points=\"" + pts + "\"/></svg>";
}

export function trendsPage(shell, T = TEMPORAL) {
  const meta = { path: "/trends", title: "Trends over time - Ultrastable", description: "How the system changes over days: which parts are busy, which are neglected, which loops stopped, and what the system did about it." };
  const find = (T.findings || []).map(f => "<tr><td>" + esc(f.kind.replace("_", " ")) + "</td><td><code>" + esc(f.subject) + "</code></td><td>" + esc(f.evidence) + "</td><td>" + esc(f.advocate) + "</td><td>" + esc(f.runs) + "</td><td>" + (f.item ? "<code>" + esc(f.item) + "</code>" : "") + "</td></tr>").join("")
    || "<tr><td colspan=\"6\">No open findings: every series is inside its own baseline.</td></tr>";
  const areas = (T.areas || []).map(a => "<tr><th scope=\"row\">" + esc(a.id) + "</th><td>" + spark(a.spark, { label: a.id + " commits per day" }) + "</td><td>" + esc(a.recent_rate) + " / day</td><td>" + esc(a.baseline_rate) + " / day</td><td>" + esc(a.last_active || "") + "</td></tr>").join("");
  const loops = (T.ledgers || []).map(l => "<tr><th scope=\"row\"><code>" + esc(l.id.replace("ledger:", "")) + "</code></th><td>" + spark(l.spark, { label: l.id + " events per day" }) + "</td><td>" + esc(l.events) + "</td><td>" + esc(l.fails) + "</td><td>" + esc(l.last || "") + "</td></tr>").join("");
  const hist = (T.history || []);
  const sim = T.simulation ? "<p>The simulated year (<a href=\"/year\">/year</a>) is the forward half of this picture: " + esc(T.simulation.pass) + " of " + esc(T.simulation.months) + " simulated months passed, " + esc(T.simulation.fail) + " failed, " + esc(T.simulation.uncovered) + " are not simulated yet.</p>" : "";
  const ten = (T.tenants || []).map(t => "<h3>" + esc(t.tenant) + "</h3><p>History from " + esc(t.history_from) + "; " + esc((t.findings || []).length) + " open findings.</p><div class=\"us-wrap\"><table class=\"us-table\"><tr><th>Kind</th><th>Subject</th><th>Evidence</th><th>Advocate</th></tr>"
    + ((t.findings || []).map(f => "<tr><td>" + esc(f.kind.replace("_", " ")) + "</td><td><code>" + esc(f.subject) + "</code></td><td>" + esc(f.evidence) + "</td><td>" + esc(f.advocate) + "</td></tr>").join("") || "<tr><td colspan=\"4\">No open findings.</td></tr>") + "</table></div>").join("");
  const body = "<div class=\"head\"><h1>How the system changes over time</h1><p>A snapshot says what exists. A series says what is being rewritten again and again, what nobody has touched, and which loop stopped firing. Each run reads the repository's own history and ledgers back to " + esc(T.history_from) + ", compares the last " + esc(T.window.recent_days) + " days with the days before, and files what it finds into the same queue that fixes everything else. Last run " + esc(T.at) + ".</p></div>"
    + "<section class=\"card\"><h2>What the loop found</h2><div class=\"us-wrap\"><table class=\"us-table\"><tr><th>Kind</th><th>Subject</th><th>Evidence</th><th>Advocate</th><th>Runs</th><th>Queue item</th></tr>" + find + "</table></div><p class=\"meta\">Open findings over time: " + spark(hist.map(r => r.open), { label: "open findings per run" }) + " " + esc(hist.length) + " runs recorded; " + esc((T.settled || []).length) + " findings settled.</p></section>"
    + "<section class=\"card\"><h2>Components</h2><div class=\"us-wrap\"><table class=\"us-table\"><tr><th>Area</th><th>Commits per day, last " + esc(T.window.spark_days) + " days</th><th>Recent</th><th>Baseline</th><th>Last active</th></tr>" + areas + "</table></div></section>"
    + "<section class=\"card\"><h2>Loops</h2><div class=\"us-wrap\"><table class=\"us-table\"><tr><th>Loop ledger</th><th>Events per day</th><th>Events</th><th>Failures</th><th>Last event</th></tr>" + loops + "</table></div>" + sim + (ten ? "<h2>Systems built on it</h2><p>The same loop reads each tenant's own history, with the tenant's own areas, ledgers and entries. Findings go to the tenant's own queue.</p>" + ten : "") + "<p class=\"meta\">Machine-readable: <a href=\"/trends.json\">/trends.json</a>.</p></section>";
  return shell(meta, body);
}

export async function trendsRoutes(u, env, shell, HTML) {
  const p = u.pathname.replace(/\/$/, "");
  if (p !== "/trends" && p !== "/trends.json") return null;
  if (p === "/trends.json") return new Response(JSON.stringify(TEMPORAL), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
  return new Response(trendsPage(shell), { headers: { ...HTML, "Cache-Control": "public, max-age=300" } });
}
