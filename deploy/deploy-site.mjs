// Deploys site/worker.js to Cloudflare and attaches the four hostnames. Usage:
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node deploy/deploy-site.mjs
// This is the same sequence used for the first deploy on 2026-11-10 (Workers script upload, then Workers custom domains).
import { readFileSync } from "node:fs";
const T = process.env.CLOUDFLARE_API_TOKEN, A = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!T || !A) { console.error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }
const api = (m, p, b, h = {}) => fetch("https://api.cloudflare.com/client/v4" + p, { method: m, headers: { authorization: "Bearer " + T, ...h }, body: b }).then(r => r.json());
const form = new FormData();
form.append("metadata", new Blob([JSON.stringify({ main_module: "worker.js", compatibility_date: "2026-11-04" })], { type: "application/json" }));
form.append("worker.js", new Blob([readFileSync(new URL("../site/worker.js", import.meta.url))], { type: "application/javascript+module" }), "worker.js");
console.log("upload", (await api("PUT", `/accounts/${A}/workers/scripts/ultrastable-site`, form)).success);
const zones = { "ultrastable.io": "18a7463a4e79b98d04aa22eb96b0127b", "www.ultrastable.io": "18a7463a4e79b98d04aa22eb96b0127b", "ultrastable.app": "29a8a782765682441aafd3f64a186ea6", "ultrastable.net": "e23fd6a6078d557c08462aaa80614402" };
for (const [hostname, zone_id] of Object.entries(zones))
  console.log(hostname, (await api("PUT", `/accounts/${A}/workers/domains`, JSON.stringify({ hostname, service: "ultrastable-site", zone_id, environment: "production" }), { "content-type": "application/json" })).success);
