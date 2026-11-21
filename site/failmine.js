// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// FAILMINE-1: /failures shows every failure the system recorded, its root-cause class, recurrence rate and time to remediation. Every number is
// read from site/failmine-data.js, which `python3 -m foundation failmine --run --apply` writes from the ledgers; nothing is typed by hand.
import { FAILMINE } from "./failmine-data.js";
const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

export function failMinePage(shell, F = FAILMINE) {
  const meta = { path: "/failures", title: "Failures and root causes - Ultrastable", description: "Every failure the system recorded, its root cause, how often it recurred and how long it took to fix." };
  const pct = Math.round((F.recurrence_rate || 0) * 100);
  const cls = (F.classes || []).map(c => "<tr><td>" + esc(c.class) + "</td><td>" + esc(c.events) + "</td><td>" + esc(c.open) + "</td><td>" + esc(c.root_cause) + "</td><td>" + esc(c.failure_mode || "unregistered") + "</td></tr>").join("");
  const rec = (F.recurring || []).slice(0, 15).map(s => "<tr><td>" + esc(s.class) + "</td><td>" + esc(s.count) + "</td><td><strong>" + esc(s.disposition) + "</strong></td><td>" + esc(s.signature) + "</td></tr>").join("");
  const body = "<div class=\"head\"><h1>Failures and root causes</h1><p>" + esc(F.events) + " failures recorded, " + esc(F.open) + " still open. Recurrence rate " + esc(pct) + "% (failures that repeat an earlier signature). Median time to remediation " + esc(F.mttr_hours_median ?? "unmeasured") + " h over " + esc(F.remediated) + " fixed failures. Measured " + esc(F.at) + ".</p></div>"
    + "<section class=\"card\"><h2>By root cause</h2><div class=\"us-wrap\"><table class=\"us-table\"><tr><th>Class</th><th>Events</th><th>Open</th><th>Root cause</th><th>Failure mode</th></tr>" + cls + "</table></div></section>"
    + "<section class=\"card\"><h2>Recurring</h2><p>Seen twice: change the approach. Three times: incident and redesign. Each is a queue item that closes when the signature stays quiet for a week.</p><div class=\"us-wrap\"><table class=\"us-table\"><tr><th>Class</th><th>Times</th><th>Disposition</th><th>Signature</th></tr>" + rec + "</table></div><p class=\"meta\">Machine-readable: <a href=\"/failures.json\">/failures.json</a>.</p></section>";
  return shell(meta, body);
}

export async function failMineRoutes(u, env, shell, HTML) {
  const p = u.pathname.replace(/\/$/, "");
  if (p !== "/failures" && p !== "/failures.json") return null;
  if (p === "/failures.json") return new Response(JSON.stringify(FAILMINE), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
  return new Response(failMinePage(shell), { headers: { ...HTML, "Cache-Control": "public, max-age=300" } });
}
