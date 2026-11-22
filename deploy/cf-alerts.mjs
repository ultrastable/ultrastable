// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// CF-ALERTS-1: route Cloudflare's own alerts into the tick Worker, with no person minting or pasting anything. Idempotent:
//   1. CF_ALERT_SECRET is generated here once, bound on the tick Worker and given to the webhook destination; it is never printed.
//   2. The webhook destination points at the tick's /hook/cloudflare (Cloudflare sends a delivery test on create; the route answers it 200).
//   3. One policy per entry of POLICIES in seed/worker/src/cfalerts.js posts to that destination; a type the account does not offer is reported.
// Needs CLOUDFLARE_API_TOKEN (Notifications: Edit, Workers Scripts: Edit) and CLOUDFLARE_ACCOUNT_ID. Run: node deploy/cf-alerts.mjs
import { randomBytes } from "node:crypto";
import { POLICIES } from "../seed/worker/src/cfalerts.js";
const API = "https://api.cloudflare.com/client/v4";
export const DEST_NAME = "ultrastable-tick alerts (CF-ALERTS-1)";

export async function register(env, f = fetch) {
  const acct = env.CLOUDFLARE_ACCOUNT_ID, worker = env.TICK_WORKER || "ultrastable-tick";
  const hookUrl = env.ALERT_HOOK_URL || `https://${worker}.${env.WORKERS_SUBDOMAIN || "ultrastable"}.workers.dev/hook/cloudflare`;
  const call = async (method, path, body) => {
    const r = await f(API + path, { method, headers: { authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok && j.success !== false, status: r.status, j };
  };
  const out = { destination: null, policies: {} };
  const hooks = await call("GET", `/accounts/${acct}/alerting/v3/destinations/webhooks`);
  if (!hooks.ok) throw new Error("list webhooks: HTTP " + hooks.status);
  let dest = (hooks.j.result || []).find(h => h.name === DEST_NAME);
  if (!dest) {
    const secret = randomBytes(32).toString("hex");  // held in memory only: bound on the worker, then handed to the destination
    const bound = await call("PUT", `/accounts/${acct}/workers/scripts/${worker}/secrets`, { name: "CF_ALERT_SECRET", text: secret, type: "secret_text" });
    if (!bound.ok) throw new Error("bind CF_ALERT_SECRET: HTTP " + bound.status);
    const made = await call("POST", `/accounts/${acct}/alerting/v3/destinations/webhooks`, { name: DEST_NAME, url: hookUrl, secret });
    if (!made.ok) throw new Error("create webhook: HTTP " + made.status + " " + JSON.stringify(made.j.errors || []));
    dest = { id: made.j.result.id };
    out.destination = "created";
  } else out.destination = "present";
  const pols = await call("GET", `/accounts/${acct}/alerting/v3/policies`);
  const have = new Set((pols.j.result || []).map(p => p.name));
  for (const p of POLICIES) {
    if (have.has(p.name)) { out.policies[p.alert_type] = "present"; continue; }
    const r = await call("POST", `/accounts/${acct}/alerting/v3/policies`, { name: p.name, alert_type: p.alert_type, enabled: true, filters: p.filters, mechanisms: { webhooks: [{ id: dest.id }] } });
    out.policies[p.alert_type] = r.ok ? "created" : `not offered (HTTP ${r.status}: ${((r.j.errors || [])[0] || {}).message || "error"})`;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  register(process.env).then(r => console.log(JSON.stringify(r, null, 1)), e => { console.error(e.message); process.exit(1); });
}
