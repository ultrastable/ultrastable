// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// YEARSIM-1: /year shows the last run of the time-compressed year with zero input. Every cell is read from site/yearsim-data.js, which
// `python3 -m foundation yearsim --apply` writes from a real run; nothing is typed by hand. Routes: /year, /year.json.
import { YEARSIM } from "./yearsim-data.js";
const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

export function yearPage(shell, Y = YEARSIM) {
  const meta = { path: "/year", title: "A year with no one - Ultrastable", description: "A simulated year of zero input: what the system detected and fixed by itself, month by month, and what it did not." };
  const rows = Y.months.map(m => "<tr><td>" + esc(m.month) + "</td><td>" + esc(m.area) + "</td><td>" + esc(m.failure || "") + "</td><td><strong>" + esc(m.result) + "</strong></td><td>" + esc((m.evidence || m.why || "").slice(0, 200)) + "</td></tr>").join("");
  const body = "<div class=\"head\"><h1>A year with no one</h1><p>" + esc(Y.pass) + " of " + esc(Y.months.length) + " simulated months passed, " + esc(Y.fail) + " failed and " + esc(Y.uncovered) + " are not simulated yet. Each month injects one failure into a scratch copy of the repository and asks the system's own detectors to notice it and confirm the fix.</p></div>"
    + "<section class=\"card\"><div class=\"us-wrap\"><table class=\"us-table\"><tr><th>Month</th><th>Area</th><th>Injected failure</th><th>Result</th><th>Evidence</th></tr>" + rows + "</table></div></section>"
    + "<section class=\"card\"><h2>What this does not show</h2><p>" + esc(Y.honesty) + "</p><p class=\"meta\">Machine-readable: <a href=\"/year.json\">/year.json</a>.</p></section>";
  return shell(meta, body);
}

export async function yearRoutes(u, env, shell, HTML) {
  const p = u.pathname.replace(/\/$/, "");
  if (p !== "/year" && p !== "/year.json") return null;
  if (p === "/year.json") return new Response(JSON.stringify(YEARSIM), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
  return new Response(yearPage(shell), { headers: { ...HTML, "Cache-Control": "public, max-age=300" } });
}
