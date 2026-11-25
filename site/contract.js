// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// FLEET-CONTRACT-1: Ultrastable runs on Ultrastable, so the platform's own site serves the contract it reads from every tenant
// (seed/worker/src/contract.js): /.well-known/ultrastable.json, /claims.json, and its own social queue. Each statement below is a sentence the
// /claims page shows (rendered from this list, so the words are one string) and the endpoint that backs it. The full register of the site's
// sentences and their probes stays doctrine/claims.json (/api/claims); these are the capabilities, each tied to the endpoint that serves it.
// The platform's live reading of itself and of every tenant: python3 -m foundation fleetcontract --live. Test: site/contract.test.mjs.
import { contractRoute, statementsHtml } from "../seed/worker/src/contract.js";

export const SPEC = {
  name: "Ultrastable",
  summary: "The foundation for any autonomous system: managers that measure, decide, ship and prove the result live, for something that has to keep running.",
  url: "https://ultrastable.io",
  repo: "ultrastable/ultrastable",
  statements: [
    { id: "claims", text: "Every statement on this site is bound to a probe in the code, and the result of each probe is served as data.", page: "/claims", api: "/api/claims" },
    { id: "freshness", text: "Each source behind these pages reports its age against its cadence, and the report fails when one is older.", page: "/claims", api: "/api/freshness" },
    { id: "progress", text: "What shipped is read from merged changes for every system the platform runs.", page: "/claims", api: "/progress.json" },
    { id: "pulse", text: "The pulse says whether changes that alter behaviour are still shipping.", page: "/claims", api: "/pulse.json" },
    { id: "goals", text: "The platform's goals, the knobs it may turn and their current readings are public.", page: "/claims", api: "/api/goals" },
    { id: "year", text: "A year with nobody attending is simulated from fault rates and drills, and the result is published.", page: "/claims", api: "/year.json" },
    { id: "balance", text: "Work filed is measured against work closed, per day and per week.", page: "/claims", api: "/balance.json" },
    { id: "directory", text: "Every live system built on Ultrastable is listed in the directory.", page: "/claims", api: "/directory.json" },
    { id: "graph", text: "The platform keeps a graph of its own records, and the public view gives counts and findings.", page: "/claims", api: "/api/graph" },
    { id: "audit", text: "Every deploy and decision is a row in a hash chain whose head is public.", page: "/claims", api: "/api/audit/head" },
    { id: "fleet", text: "Every system on the platform is read against one contract, front end to back end and back again, and the reading is public.", page: "/claims", api: "/api/fleet-contract" },
  ],
  internal: [],
};

const RAW = "https://raw.githubusercontent.com/ultrastable/ultrastable/main/";
const J = (body, status = 200, age = 600) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": status === 200 ? "public, max-age=" + age : "no-store" } });

// The platform's own posts are the public calendar the tick publisher reads (social/calendar.json); served here so the platform has the same
// surface as its tenants. A calendar that cannot be read is a 503 with the reason, never an empty queue that reads as "nothing to say".
async function socialQueue(fetchFn) {
  try {
    const r = await fetchFn(RAW + "social/calendar.json", { headers: { "user-agent": "ultrastable-site/1" } });
    if (!r.ok) return J({ tenant: "ultrastable", error: "calendar_unreadable", status: r.status }, 503);
    const c = await r.json();
    return J({ tenant: "ultrastable", mode: "calendar", posts: (c.posts || []).map(p => ({ id: p.id, date: p.date, text: p.text, url: p.url || null, kind: p.kind || null })) });
  } catch (e) {
    console.error("social-queue: calendar unreachable", String(e && e.message));  // USER-BACKEND-1: the detail is logged, the answer is plain
    return J({ tenant: "ultrastable", error: "calendar_unreachable" }, 503);
  }
}
// The last recorded reading of every system (ops/fleet-contract.json, written by fleetcontract --live --apply in tenant-repos.yml).
async function fleetReading(fetchFn) {
  try {
    const r = await fetchFn(RAW + "ops/fleet-contract.json", { headers: { "user-agent": "ultrastable-site/1" } });
    return r.ok ? J(await r.json(), 200, 300) : J({ error: "reading_unreadable", status: r.status }, 503);
  } catch (e) {
    console.error("fleet-contract: reading unreachable", String(e && e.message));
    return J({ error: "reading_unreachable" }, 503);
  }
}
// AUDIT-CHAIN-1: the chain lives in the tick Worker; its public head and verification are reachable where the site's pages name them.
async function auditProxy(u, env) {
  if (!env || !env.TICK) return J({ error: "tick_unreachable" }, 503);
  try { const r = await env.TICK.fetch(new Request("https://tick.internal" + u.pathname + u.search)); return J(await r.json(), r.status, 60); }
  catch (e) { console.error("audit proxy: tick unreachable", String(e && e.message)); return J({ error: "tick_unreachable" }, 503); }
}

// The paths this module answers, written out so the route list is readable in one place (scripts/check_readmes.py reads site routes from source).
export const PATHS = ["/.well-known/ultrastable.json", "/claims.json", "/social-queue.json", "/api/fleet-contract", "/api/audit/head", "/api/audit/verify"];
export async function contractRoutes(u, env, fetchFn = (...a) => fetch(...a)) {
  if (!PATHS.includes(u.pathname)) return null;
  const c = contractRoute(u.pathname, SPEC);
  if (c) return c;
  if (u.pathname === "/social-queue.json") return socialQueue(fetchFn);
  if (u.pathname === "/api/fleet-contract") return fleetReading(fetchFn);
  if (u.pathname === "/api/audit/head" || u.pathname === "/api/audit/verify") return auditProxy(u, env);
  return null;
}

export const platformStatements = () => statementsHtml(SPEC, "/claims");
