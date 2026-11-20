// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// ZONE-CUTOVER-1 (SINGLE-ACCOUNT-1, OL-20261118-1): finishes the domain move by itself. Ultrastable is the foundation for any autonomous system.
// The four zones sit as pending in the ultrastable account until their registrations move (gate net-nameserver-switch). Every site tick
// reads each zone's status; the tick a zone turns active, this attaches the Worker custom domains and routes the old account served,
// and turns on Email Routing where the old zone had it. Every step is idempotent (an existing domain or route is left as it is) and
// every state is reported as it is: pending, active, attached, error. No step deletes anything. Needs CF_DEPLOY_TOKEN and
// CF_ACCOUNT_ID on the site Worker; without them the result is "unmeasured", never ok.
// Plan source: the old account's live custom domains, routes and Email Routing state, read 2026-11-20. Routes that pointed at a QNFO
// fleet Worker (qnfo-gateway on ultrastable.app and .net) are not carried: the custom domains below serve those hostnames.
// Consumers: site/worker.js tick (out.zones), test site/zonecutover.test.mjs, ops/account-move.json (items move to 'moved' on evidence).
export const PLAN = [
  { zone: "ultrastable.io", domains: [["ultrastable.io", "ultrastable-site"], ["www.ultrastable.io", "ultrastable-site"]], routes: [["*.ultrastable.io/*", "ultrastable-site"]], email: true },
  { zone: "ultrastable.app", domains: [["ultrastable.app", "ultrastable-site"], ["www.ultrastable.app", "ultrastable-site"]], routes: [["*.ultrastable.app/*", "ultrastable-spinoffs"]], email: false },
  { zone: "ultrastable.net", domains: [["ultrastable.net", "ultrastable-site"], ["www.ultrastable.net", "ultrastable-site"]], routes: [], email: false },
  { zone: "ultrastable.org", domains: [["ultrastable.org", "tenant-ps-edge"], ["www.ultrastable.org", "tenant-ps-edge"], ["solutions.ultrastable.org", "tenant-ps-edge"]], routes: [], email: true },
];
const CF = "https://api.cloudflare.com/client/v4";

async function api(f, tok, method, path, body) {
  const r = await f(CF + path, { method, headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* non-JSON answer: reported below as an error with the HTTP status */ }
  if (!r.ok || !j || j.success === false) throw new Error(method + " " + path.split("?")[0] + " " + r.status + " " + ((j && j.errors && j.errors[0] && j.errors[0].message) || "no JSON"));
  return j.result;
}

export async function zoneCutover(env, f = fetch, plan = PLAN) {
  const tok = env && env.CF_DEPLOY_TOKEN, acct = env && env.CF_ACCOUNT_ID;
  if (!tok || !acct) return { status: "unmeasured", reason: "no CF_DEPLOY_TOKEN / CF_ACCOUNT_ID on the site Worker" };
  const out = { status: "ok", zones: {} };
  let have = null;
  for (const p of plan) {
    const z = out.zones[p.zone] = { state: "unknown" };
    try {
      const zs = await api(f, tok, "GET", `/zones?name=${encodeURIComponent(p.zone)}&account.id=${acct}`);
      const zone = (zs || [])[0];
      if (!zone) { z.state = "missing"; if (out.status === "ok") out.status = "pending"; continue; }
      if (zone.status !== "active") { z.state = zone.status; if (out.status === "ok") out.status = "pending"; continue; }
      z.state = "active"; z.attached = []; z.kept = [];
      if (!have) have = new Set((await api(f, tok, "GET", `/accounts/${acct}/workers/domains`)).map(d => d.hostname));
      for (const [hostname, service] of p.domains) {
        if (have.has(hostname)) { z.kept.push(hostname); continue; }
        await api(f, tok, "PUT", `/accounts/${acct}/workers/domains`, { hostname, service, zone_id: zone.id, environment: "production" });
        have.add(hostname); z.attached.push(hostname);
      }
      if (p.routes.length) {
        const rs = new Set((await api(f, tok, "GET", `/zones/${zone.id}/workers/routes`)).map(r => r.pattern));
        for (const [pattern, script] of p.routes) {
          if (rs.has(pattern)) { z.kept.push(pattern); continue; }
          await api(f, tok, "POST", `/zones/${zone.id}/workers/routes`, { pattern, script });
          z.attached.push(pattern);
        }
      }
      if (p.email) {
        const er = await api(f, tok, "GET", `/zones/${zone.id}/email/routing`);
        if (!er || !er.enabled) { await api(f, tok, "POST", `/zones/${zone.id}/email/routing/enable`, {}); z.email = "enabled"; } else z.email = "kept";
      }
    } catch (e) { z.state = "error"; z.error = String(e && e.message || e).slice(0, 200); out.status = "error"; }
  }
  return out;
}
