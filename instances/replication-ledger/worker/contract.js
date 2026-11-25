// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// FLEET-CONTRACT-1: what the Replication Ledger states, the page that shows each statement and the endpoint that backs it. The shared module
// (vendor/ultrastable/contract.js, the core's seed/worker/src/contract.js) serves /.well-known/ultrastable.json and /claims.json from this one
// declaration; contract.test.mjs runs its verify() against the router, and the platform runs the same reading against the deployed site.
// TENANT-PROMO-1: the ledger's own social queue, built by the shared promoqueue module and drained by the core publisher.
import { promoQueue } from "../vendor/ultrastable/promoqueue.js";

export const SITE = "https://replication-ledger.ultrastable.org";
export const HOOK = "The Replication Ledger runs on Ultrastable.";
export const START = "2026-11-27", EVERY_DAYS = 2;

export const SPEC = {
  name: "Replication Ledger",
  summary: "Which landmark findings held up and which failed, across many fields, updated as replications publish.",
  url: SITE,
  repo: "ultrastable/replication-ledger",
  statements: [
    { id: "standings", text: "Every standing is computed from the replication attempts on file, never typed by hand.", page: "/", api: "/api/findings" },
    { id: "rubric", text: "The rules that turn replication attempts into a standing are published in full.", page: "/rubric", api: "/api/rubric" },
    { id: "hourly-search", text: "The ledger searches for new replications and new landmark findings every hour by itself.", page: "/changes", api: "/api/freshness" },
    { id: "moves", text: "Each standing the ledger moved is listed with the paper that moved it.", page: "/changes", api: "/api/changes" },
    { id: "searches", text: "Every search the ledger ran is listed with what it checked and what it filed.", page: "/changes", api: "/api/beats" },
    { id: "citations", text: "Every citation is checked against the publisher's record, and the ones that fail are listed.", page: "/changes", api: "/api/citations" },
    { id: "graph", text: "Findings, papers and authors are kept as a graph that is rebuilt after every search.", page: "/graph", api: "/api/graph" },
  ],
  internal: [],
};

// One post per finding, fields in turn. The post never states the verdict: it asks the reader to guess, and the page shows the record.
export function order(findings) {
  const fields = [...new Set(findings.map(f => f.field))], by = fields.map(x => findings.filter(f => f.field === x)), out = [];
  for (let i = 0; by.some(l => i < l.length); i++) for (const l of by) if (i < l.length) out.push(l[i]);
  return out;
}
export const postText = f => `${f.name}: a landmark finding. Did it hold up when others ran it again? Guess first, then see the replication record:`;
export function socialQueue(findings, now = Date.now()) {
  const items = order(findings).map(f => ({ id: f.id, path: "/f/" + f.id, text: postText(f), kind: "finding" }));
  return promoQueue({ tenant: "replication-ledger", site: SITE, hook: HOOK, items, start: START, every_days: EVERY_DAYS, now });
}
