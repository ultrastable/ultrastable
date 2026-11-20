// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// EXAMPLE-SYSTEMS-1 (Q-GROW-front-door-example-systems): the kinds of system the front door shows, taken from docs/doctrine/VISION.md
// ("What it is for"). Each one passes the system test in its own words: a loop it closes, a measure that can be wrong, upkeep without
// an end. The front door renders this list; site/site.test.mjs fails when an example lacks one of the three or the page and the list disagree.
export const EXAMPLES = [
  { id: "club-site", name: "A club or small-business website", loop: "Visits, searches and bookings are read, the weakest page is improved, and the numbers are read again.", measure: "Search ranking, page speed and bookings.", upkeep: "Content, security patches and member features keep arriving." },
  { id: "personal-desk", name: "A personal signals desk", loop: "Markets or the news are watched against your own rules, and what matters is followed up.", measure: "Signals that turned out to matter, against those that did not.", upkeep: "Sources and rules keep changing." },
  { id: "service-fleet", name: "A service fleet", loop: "Probes find a failure, a fix is shipped, and a probe that turns red reverts it.", measure: "Uptime, error rate and time to repair.", upkeep: "Failures and drift keep coming." },
  { id: "publishing-desk", name: "A publishing operation", loop: "Findings are checked against their sources, stale ones are refreshed and republished.", measure: "Citations that still resolve and editions that are current.", upkeep: "New findings and corrections keep coming." },
  { id: "compliance", name: "A compliance, security or cost program", loop: "An environment is watched, each finding is closed, and the watch runs again.", measure: "Open findings and spend against budget.", upkeep: "Rules, threats and prices change." },
  { id: "data-pipeline", name: "A data pipeline", loop: "Drift is noticed, the pipeline is repaired, and the reason is logged.", measure: "Freshness and rows that fail validation.", upkeep: "Upstream formats and sources change." },
];
const esc = t => String(t == null ? "" : t).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
export function examplesSection() {
  return "<h2 id=\"examples\">What people run on it</h2><p class=\"us-lede\">Anything that has to keep running and keep getting better. Each of these has a loop to close, a measure that can be wrong and upkeep that keeps arriving.</p><div class=\"us-grid c3\">"
    + EXAMPLES.map(e => "<div class=\"card\" data-example=\"" + esc(e.id) + "\"><h3 class=\"card-title\">" + esc(e.name) + "</h3><p class=\"meta\">" + esc(e.loop) + "</p><p class=\"meta\"><strong>Measured by:</strong> " + esc(e.measure) + "</p><p class=\"meta\"><strong>Still needs work because:</strong> " + esc(e.upkeep) + "</p></div>").join("")
    + "</div><p><a href=\"/start\">Describe yours in a few words</a> or <a href=\"/demo\">see one running</a>.</p>";
}
