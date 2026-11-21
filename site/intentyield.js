// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// INTENT-YIELD-1: /yield answers "for a given unit of human input, what is the best unit of output". One intent is one owner directive in its own
// words; one kept outcome is that directive's own probe passing, unrestated, after the settle window. Every cell is read from
// site/intent-yield-data.js, which `python3 -m foundation intentyield --run --apply` writes; nothing is typed by hand. No person is scored.
import { INTENT_YIELD } from "./intent-yield-data.js";
const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
const pct = v => (v === null || v === undefined) ? "not settled yet" : Math.round(v * 100) + "%";

export function yieldPage(shell, Y = INTENT_YIELD) {
  const meta = { path: "/yield", title: "Intent yield - Ultrastable", description: "For each directive the owner gave, whether it came true and stayed true without being said again." };
  const s = Y.summary || {};
  const rows = (Y.intents || []).map(i => "<tr><th scope=\"row\"><code>" + esc(i.id) + "</code></th><td>" + esc(i.title) + "</td><td>" + esc(i.date) + "</td><td>" + esc(i.verdict)
    + "</td><td>" + esc(i.restatements) + (i.restates ? " (restates <code>" + esc(i.restates) + "</code>)" : "") + "</td><td>" + (i.item ? "<code>" + esc(i.item) + "</code>" : "") + "</td></tr>").join("");
  const body = "<div class=\"head\"><h1>Intent yield</h1><p>One unit of input is one thing the owner asked for, in their own words. One unit of output is that thing coming true, passing its own check, and staying true for " + esc(Y.settle_days)
    + " days without the owner having to say it again. Hours, commits and pull requests are not counted, and no person is scored. Last run " + esc(Y.at) + (Y.error ? "; that run reported a problem: " + esc(Y.error) : "") + ".</p></div>"
    + "<section class=\"card\"><h2>Yield</h2><ul><li>Kept after " + esc(Y.settle_days) + " days: " + esc(pct(s.kept_share)) + " (target " + esc(pct(Y.target_kept_share)) + ")</li><li>Holding before the window ends: " + esc(pct(s.holding_share))
    + "</li><li>Said more than once: " + esc(pct(s.restated_share)) + "</li><li>Directives with a check that can run: " + esc(s.measured) + " of " + esc(s.intents) + "</li></ul></section>"
    + "<section class=\"card\"><h2>Each directive</h2><div class=\"us-wrap\"><table class=\"us-table\"><tr><th>Id</th><th>Directive</th><th>Given</th><th>Verdict</th><th>Restatements</th><th>Queue item</th></tr>" + rows + "</table></div><p class=\"meta\">Machine-readable: <a href=\"/yield.json\">/yield.json</a>.</p></section>";
  return shell(meta, body);
}

export async function yieldRoutes(u, env, shell, HTML) {
  const p = u.pathname.replace(/\/$/, "");
  if (p !== "/yield" && p !== "/yield.json") return null;
  if (p === "/yield.json") return new Response(JSON.stringify(INTENT_YIELD), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
  return new Response(yieldPage(shell), { headers: { ...HTML, "Cache-Control": "public, max-age=300" } });
}
