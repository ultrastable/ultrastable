// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ATTENTION-1 (Rowan, 2026-11-20): a public, argued case that an autonomous system left to run its own loops produces useful work. The page is
// a thesis plus a ledger read live from /progress data at request time; no number on it is typed by hand. It argues arguments, not people:
// it names no individual and mocks no one. It states its own limits. Routes: /left-alone, /left-alone.json. Ultrastable is the foundation for any autonomous system.
import { progressData } from "./progress.js";
import { digest, substantive } from "../workers/core/progress/index.js";

const esc = s => String(s ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));

// The ledger: only facts the progress record holds. An unreadable source yields null, never a made-up zero.
export function ledger(d, now = Date.now()) {
  if (!d) return null;
  const w = digest(d.events, { now, period: "weekly" }), m = digest(d.events, { now, period: "monthly" });
  const times = d.events.filter(substantive).map(e => Date.parse(e.at)).filter(t => !isNaN(t));
  const first = times.length ? new Date(Math.min(...times)).toISOString() : null;
  return { read_at: d.at, systems: d.systems.map(s => ({ id: s.id, name: s.name, state: s.state, last_at: s.last_at, shipped_7d: s.shipped_7d, url: s.url })),
    shipped_7d: w.substantive, shipped_30d: m.substantive, by_kind_30d: m.by_kind, earliest_in_record: first, apps_launched: d.apps.live, sources: d.sources };
}

export function leftAlonePage(shell, L) {
  const meta = { path: "/left-alone", title: "Left alone, it builds - Ultrastable", description: "A running system, left to run its own loops, that ships useful work. The argument, the live ledger, and what this does not show." };
  const led = !L ? "<p>The live record could not be read just now. It is read again on the next request: <a href=\"/progress\">/progress</a>.</p>"
    : "<p><strong>" + esc(L.shipped_7d) + "</strong> substantive changes shipped in the last 7 days and <strong>" + esc(L.shipped_30d) + "</strong> in the last 30, across " + esc(L.systems.length) + " systems, read from merged changes at " + esc(L.read_at.slice(0, 16).replace("T", " ")) + " UTC. Record-keeping merges are not counted.</p>"
      + "<div class=\"us-wrap\"><table class=\"us-table\"><tr><th>System</th><th>State</th><th>Last 7 days</th></tr>" + L.systems.map(s => "<tr><td><a href=\"" + esc(s.url || "/progress") + "\" rel=\"noopener\">" + esc(s.name) + "</a></td><td>" + esc(s.state) + "</td><td>" + esc(s.shipped_7d) + "</td></tr>").join("") + "</table></div>"
      + "<p class=\"meta\">Machine-readable: <a href=\"/left-alone.json\">/left-alone.json</a>, <a href=\"/progress.atom\">/progress.atom</a>.</p>";
  const body = "<div class=\"head\"><h1>Left alone, it builds</h1><p>The usual picture of an autonomous AI system is one that, unwatched, drifts toward harm or does nothing useful. This is a working counterexample at small scale: a system that runs its own loops, and the ledger of what it shipped while nobody drove it.</p></div>"
    + "<section class=\"card\"><h2>The claim, stated narrowly</h2><p>An autonomous system with a clear scope, a kill switch, rate limits, audited actions and automatic revert can be left alone and keep producing useful, checkable work. We hold this as a hypothesis that the ledger below can falsify, not as a general statement about all AI.</p></section>"
    + "<section class=\"card\"><h2>Why it holds up in this case</h2><ul><li><strong>Closed loops, not free roaming.</strong> Work happens inside loops that measure their own result and revert a change that makes it worse.</li><li><strong>Narrow permissions.</strong> It works inside the repositories and Cloudflare account it runs on. Money, signing and the owner's accounts stay behind a gate.</li><li><strong>A halt in the open.</strong> The stop switch is a public file: <a href=\"https://github.com/ultrastable/ultrastable/blob/main/ops/halt.json\" rel=\"noopener\">ops/halt.json</a>.</li><li><strong>Recorded decisions.</strong> Decisions carry a prediction that is scored later, and probes are on <a href=\"/live\">/live</a>.</li></ul></section>"
    + "<section class=\"card\"><h2>The live ledger</h2>" + led + "</section>"
    + "<section class=\"card\"><h2>What this does not show</h2><ul><li>It is one system with a narrow job. It says nothing about future, far more capable systems, and we do not claim it does.</li><li>Parts are still unproven. Some checks are not green, and public reach is at an early stage. The probes at <a href=\"/live\">/live</a> report the failures too.</li><li>It is a response to one argument, that unattended autonomy cannot be useful. It is not a rebuttal of research into risks of more capable systems, which deserves a reply on its merits and with evidence, not with slogans.</li></ul><p>If you think a number here is wrong or the framing overreaches, <a href=\"/contact\">tell us</a>; corrections are applied in code and show in the record.</p></section>";
  return shell(meta, body);
}

export async function leftAloneRoutes(u, env, shell, HTML, opts = {}) {
  const p = u.pathname.replace(/\/$/, "");
  if (p !== "/left-alone" && p !== "/left-alone.json") return null;
  const now = opts.now || Date.now(), L = ledger(await progressData(env, { ...opts, now }), now);
  if (p === "/left-alone.json") return new Response(JSON.stringify(L || { error: "ledger unavailable", code: "ledger_unavailable" }), { status: L ? 200 : 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
  return new Response(leftAlonePage(shell, L), { status: L ? 200 : 503, headers: { ...HTML, "Cache-Control": "public, max-age=300" } });
}
