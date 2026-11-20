// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// PILOT-OFFER-1: the offer section of /pilot, rendered from doctrine/pilot-offer.json (carried in site/dashboard-data.js as pilot_offer by
// scripts/build_dashboard.py, so the dashboard freshness check covers it). A figure is shown only when the data holds one; a null price says that no figure exists yet.

const esc = t => String(t == null ? "" : t).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
const money = v => v == null ? null : "$" + Number(v).toLocaleString("en-US");

export function priceLine(p) {
  if (p.monthly_usd != null) return "About " + money(p.monthly_usd) + " a month" + (p.range_usd ? " (range " + money(p.range_usd[0]) + " to " + money(p.range_usd[1]) + ")" : "") + ".";
  return p.default_in_effect;
}
export function pilotOffer(o) {
  return "<div class=\"card\" id=\"offer\"><h3 class=\"card-title\">" + esc(o.who_for.heading) + "</h3><p class=\"meta\">" + esc(o.who_for.intro) + "</p><ol>"
    + o.who_for.questions.map(q => "<li data-offer=\"" + esc(q.id) + "\"><strong>" + esc(q.ask) + "</strong> " + esc(q.means) + "</li>").join("") + "</ol></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">" + esc(o.includes.heading) + "</h3><ul>" + o.includes.items.map(i => "<li>" + esc(i) + "</li>").join("") + "</ul></div>"
    + "<div class=\"card\"><h3 class=\"card-title\">" + esc(o.price.heading) + "</h3><p data-offer=\"price\">" + esc(priceLine(o.price)) + "</p><p class=\"meta\">" + esc(o.price.rule) + "</p><p class=\"meta\">" + esc(o.price.revision) + "</p></div>";
}
