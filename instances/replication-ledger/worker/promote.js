// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TENANT-PROMO-1: promotion is part of a tenant's role. The ledger serves its social queue at /social-queue.json, built from its own findings by
// the shared seed/worker/src/promoqueue.js and drained by the core publisher within social/gate.json, and links the other live systems that run
// on Ultrastable from every page, read from doctrine/stakeholders.json so a new sibling appears without a code change. ADMIT-1 found the ledger
// live with neither (foundation/admit.py). Check: foundation/tenantpromo.py; test: promote.test.mjs.
import { promoQueue } from "../../../seed/worker/src/promoqueue.js";
import SH from "../../../doctrine/stakeholders.json" with { type: "json" };
import seed from "./data/findings.json" with { type: "json" };
import { FIELDS } from "./ledger.js";

export const TENANT = "replication-ledger";
export const SITE = "https://replication-ledger.ultrastable.org";
export const HOOK = "The Replication Ledger runs on Ultrastable.";
export const START = "2026-11-26", EVERY_DAYS = 2;

// Live siblings with a public home, never this system itself.
export const SIBLINGS = (SH.showcases || []).filter(c => c.status === "live" && c.home && c.id !== TENANT).map(c => ({ id: c.id, name: c.name, home: c.home }));

// Findings in turn across fields, so consecutive posts are about different subjects. Guess-first: a post asks, the page answers.
export function order(findings = seed.findings) {
  const fields = [...new Set(findings.map(f => f.field))], by = fields.map(id => findings.filter(f => f.field === id)), out = [];
  for (let i = 0; by.some(l => i < l.length); i++) for (const l of by) if (i < l.length) out.push(l[i]);
  return out;
}

export function postText(f) {
  const field = (FIELDS[f.field] || {}).name || f.field;
  return `Did it replicate? ${f.name} (${field}): ${f.claim}\nGuess first, then see every attempt on file:`;
}

export function socialQueue(now = Date.now(), findings = seed.findings) {
  const items = order(findings).map(f => ({ id: f.id, path: "/f/" + f.id, text: postText(f), kind: "finding" }));
  return promoQueue({ tenant: TENANT, site: SITE, hook: HOOK, items, start: START, every_days: EVERY_DAYS, now });
}
