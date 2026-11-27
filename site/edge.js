// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// RECENCY-1: the site's entry point. It wraps site/worker.js so every page says when it was last updated and how often it updates,
// and every response carries the same in headers. A route that knows a fresher time (/live, /demo, /api/live) stamps its own and wins.
import site from "./worker.js";
import DASH from "./dashboard-data.js";
import { recency, recencyText, stamp } from "../seed/worker/src/recency.js";

// Bundled pages carry the commit time of their generated data, rebuilt after every merge and redeployed within 26 h (CADENCE_S.pages in live.js).
export const PAGE_SCHEDULE = "Rebuilt after every merge and live within 26 hours";
export function pageRecency(now = Date.now()) { return recency({ updatedAt: DASH.asof_at, maxAgeS: 26 * 3600, schedule: PAGE_SCHEDULE, source: "commit " + DASH.asof, now }); }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export async function withRecency(res, now = Date.now()) {
  if (!res || res.status !== 200) return res;
  const own = res.headers.get("x-updated-at");
  const r = own ? recency({ updatedAt: own, maxAgeS: Number(res.headers.get("x-max-age-seconds")) || 26 * 3600, schedule: res.headers.get("x-update-schedule") || PAGE_SCHEDULE, now }) : pageRecency(now);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("text/html")) {
    const html = await res.text();
    const line = "<p class=\"meta\" id=\"recency\">" + esc(recencyText(r)) + " <a href=\"/api/freshness\">Freshness check</a></p>";
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
      const j = await res.json(); const r = pageRecency();
      return stamp(new Response(JSON.stringify({ recency: r, ...j }), res), r);
    }
    return withRecency(res);
  },
};
