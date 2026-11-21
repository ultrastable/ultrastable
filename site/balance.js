// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// FLOW-BALANCE-1 (Rowan, 2026-11-21): /balance shows whether the work queue is draining. Inflow (items filed, net of duplicates and batches) against
// outflow (items closed with evidence) per day and per week, SLA compliance of every open item, and what the second loop did when the balance
// tipped. Every number is read from site/balance-data.js, which `python3 -m foundation balance` writes on each fleet pass. Routes: /balance, /balance.json.
import { BALANCE } from "./balance-data.js";
import { spark } from "./temporal.js";
const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

export function balancePage(shell, B = BALANCE) {
  const meta = { path: "/balance", title: "Issue balance - Ultrastable", description: "New issues against closed issues, per day and per week, and how many open issues are inside their service level." };
  if (B.unmeasured) return shell(meta, "<div class=\"head\"><h1>Issue balance</h1><p>Not measured on the last pass: " + esc(B.unmeasured) + ".</p></div>");
  const w = B.windows || {}, sla = B.sla || {}, a = B.actions || {}, h = B.history || [];
  const row = (label, x) => x ? "<tr><th scope=\"row\">" + label + "</th><td>" + esc(x.net_inflow) + (x.superseded ? " <span class=\"meta\">(" + esc(x.filed) + " filed, " + esc(x.superseded) + " merged)</span>" : "") + "</td><td>" + esc(x.closed) + "</td><td>" + (x.ok ? "Draining" : "Growing") + " (" + (x.balance >= 0 ? "+" : "") + esc(x.balance) + ")</td></tr>" : "";
  const worst = (sla.worst || []).map(r => "<tr><td><code>" + esc(r.id) + "</code></td><td>" + esc(r.age_days) + " days</td><td>" + esc(r.sla_days) + " days</td></tr>").join("") || "<tr><td colspan=\"3\">No open issue is past its service level.</td></tr>";
  const state = B.tipped ? "Out of balance. The second loop is merging duplicates, batching floods, holding new filings to " + esc(B.throttle?.daily_quota) + " a day and running the builder at " + esc(B.closure_boost) + "x its normal daily cap." : "In balance: issues close at least as fast as they arrive, and every open issue is inside its service level.";
  const body = "<div class=\"head\"><h1>Issue balance</h1><p>" + state + " Last pass " + esc(B.at) + ".</p></div>"
    + "<section class=\"card\"><h2>Inflow against closures</h2><div class=\"us-wrap\"><table class=\"us-table\"><tr><th>Window</th><th>New issues</th><th>Closed</th><th>State</th></tr>" + row("Last day", w.day) + row("Last week", w.week) + "</table></div>"
    + "<p class=\"meta\">Closed counts only fixes and recorded dispositions with evidence; a merged duplicate lowers new issues and never counts as closed. "
    + (h.length > 1 ? "Weekly new " + spark(h.map(r => r.week_in), { label: "new issues per week, by pass" }) + " closed " + spark(h.map(r => r.week_out), { label: "closed issues per week, by pass" }) : "") + "</p></section>"
    + "<section class=\"card\"><h2>Service levels</h2><p>" + esc(sla.within) + " of " + esc(B.open) + " open issues are inside their service level (" + esc(Math.round((sla.compliance ?? 1) * 1000) / 10) + "%). Oldest open issue: " + esc(sla.oldest_days) + " days.</p><div class=\"us-wrap\"><table class=\"us-table\"><tr><th>Past its service level</th><th>Age</th><th>Allowed</th></tr>" + worst + "</table></div></section>"
    + "<section class=\"card\"><h2>What the loop did this pass</h2><p>" + esc(a.superseded || 0) + " duplicates merged into the older issue; " + esc((a.batches || []).length) + " floods batched into one issue each" + ((a.batches || []).length ? " (" + (a.batches || []).map(x => "<code>" + esc(x) + "</code>").join(", ") + ")" : "") + ".</p><p class=\"meta\">Machine-readable: <a href=\"/balance.json\">/balance.json</a>.</p></section>";
  return shell(meta, body);
}

export async function balanceRoutes(u, env, shell, HTML) {
  const p = u.pathname.replace(/\/$/, "");
  if (p !== "/balance" && p !== "/balance.json") return null;
  if (p === "/balance.json") return new Response(JSON.stringify(BALANCE), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
  return new Response(balancePage(shell), { headers: { ...HTML, "Cache-Control": "public, max-age=300" } });
}
