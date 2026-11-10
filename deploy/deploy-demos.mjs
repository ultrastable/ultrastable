// Manual deploy of the public demos (no workflow on purpose: Actions minutes are capped, see BG-30).
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... node deploy/deploy-demos.mjs
import { build } from "../demos/build-worker.mjs";
const T = process.env.CLOUDFLARE_API_TOKEN, A = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!T || !A) { console.error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }
const api = (m, p, b, h = {}) => fetch("https://api.cloudflare.com/client/v4" + p, { method: m, headers: { authorization: "Bearer " + T, ...h }, body: b }).then(r => r.json());
const form = new FormData();
form.append("metadata", new Blob([JSON.stringify({ main_module: "worker.mjs", compatibility_date: "2026-11-04" })], { type: "application/json" }));
form.append("worker.mjs", new Blob([build()], { type: "application/javascript+module" }), "worker.mjs");
const up = await api("PUT", `/accounts/${A}/workers/scripts/ultrastable-demos`, form); console.log("upload", up.success);
const zone = "18a7463a4e79b98d04aa22eb96b0127b"; // ultrastable.io (same zone id as deploy-site.mjs)
const rt = await api("POST", `/zones/${zone}/workers/routes`, JSON.stringify({ pattern: "ultrastable.io/demos*", script: "ultrastable-demos" }), { "content-type": "application/json" });
console.log("route", rt.success, JSON.stringify(rt.errors || []));
if (!up.success || !rt.success) process.exit(1);
