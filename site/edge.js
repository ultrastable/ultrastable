// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// RECENCY-1: the site's entry point. It wraps site/worker.js so every page says when it was last updated and how often it updates,
// and every response carries the same in headers. A route that knows a fresher time (/live, /demo, /api/live) stamps its own and wins.
import site from "./worker.js";
import DASH from "./dashboard-data.js";
import SPIN from "./spinoff-roadmap-data.js";
import { recency, recencyText, stamp } from "../seed/worker/src/recency.js";

// Bundled pages carry the commit time of their generated data, rebuilt after every merge and redeployed within 26 h (CADENCE_S.pages in live.js).
export const PAGE_SCHEDULE = "Rebuilt after every merge and live within 26 hours";
export function pageRecency(now = Date.now()) { return recency({ updatedAt: DASH.asof_at, maxAgeS: 26 * 3600, schedule: PAGE_SCHEDULE, source: "commit " + DASH.asof, now }); }
// RECENCY-SECTIONS-1: a section built from its own data carries that data's date, so a stale section shows even when the page build is current.
export const SPIN_SCHEDULE = "Refreshed by the daily spinoff loop; older than 48 hours counts as stale";
export function sectionRecency(path, now = Date.now()) {
  if (path !== "/roadmap" && path !== "/roadmap.json") return {};
  return { spinoffs: recency({ updatedAt: SPIN.as_of, maxAgeS: 48 * 3600, schedule: SPIN_SCHEDULE, source: "ops/free-tier.json", now }) };
}
function withSections(r, sections) {
  const bad = Object.keys(sections).filter((k) => sections[k].stale);
  return bad.length ? { ...r, stale: true, stale_sections: bad } : r;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function withRecency(res, now = Date.now(), sections = {}) {
  if (!res || res.status !== 200) return res;
  const own = res.headers.get("x-updated-at");
  const r0 = own ? recency({ updatedAt: own, maxAgeS: Number(res.headers.get("x-max-age-seconds")) || 26 * 3600, schedule: res.headers.get("x-update-schedule") || PAGE_SCHEDULE, now }) : pageRecency(now);
  const r = withSections(r0, sections);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    const html = await res.text();
    const line = "<p class=\"meta\" id=\"recency\">" + esc(recencyText(r0)) + " <a href=\"/api/freshness\">Freshness check</a></p>"
      + Object.keys(sections).map((k) => "<p class=\"meta\" id=\"recency-" + esc(k) + "\">Section " + esc(k) + ": " + esc(recencyText(sections[k])) + "</p>").join("");
    const out = html.includes("id=\"recency\"") || !html.includes("</main>") ? html : html.replace("</main>", line + "</main>");
    return stamp(new Response(out, res), r);
  }
  return stamp(res, r);
}

export default {
  ...site,
  async fetch(request, env, ctx) {
    const res = await site.fetch(request, env, ctx);
    const u = new URL(request.url);
    if (u.pathname === "/roadmap.json" && res.status === 200) {  // the roadmap's own machine-readable recency field
      const j = await res.json(); const sec = sectionRecency(u.pathname), r = withSections(pageRecency(), sec);
      return stamp(new Response(JSON.stringify({ recency: r, sections: sec, ...j }), res), r);
    }
    return withRecency(res, Date.now(), sectionRecency(u.pathname));
  },
};
