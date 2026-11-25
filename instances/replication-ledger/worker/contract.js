// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// FLEET-CONTRACT-1: what the Replication Ledger states, the page that shows each statement and the endpoint that backs it. The shared module
// (vendor/ultrastable/contract.js, the core's seed/worker/src/contract.js) serves /.well-known/ultrastable.json and /claims.json from this one
// declaration; contract.test.mjs runs its verify() against the router, and the platform runs the same reading against the deployed site.

export const SITE = "https://replication-ledger.ultrastable.org";

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
