// LIVE-PROBE-1: reads the live org D1 and fails (exit 1) unless the deployed tick is actually closing its loops:
// last tick finished every step, k_eff is measured, and the sweeper ran within --max-age-min (default 30). Prints the evidence as JSON.
// Polls up to --wait-min (default 0) for the next cron tick, so a deploy can prove itself.
import { readFileSync } from "node:fs";
const T = process.env.CLOUDFLARE_API_TOKEN, A = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!T || !A) { console.error("set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID"); process.exit(1); }
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? Number(process.argv[i + 1]) : d; };
const maxAge = arg("max-age-min", 30), waitMin = arg("wait-min", 0);
const db = JSON.parse(readFileSync(new URL("../doctrine/topology.json", import.meta.url), "utf8")).stores.d1.find(d => d.key === "org").id;
const q = async sql => { const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/d1/database/${db}/query`, { method: "POST", headers: { authorization: "Bearer " + T, "content-type": "application/json" }, body: JSON.stringify({ sql }) }); const j = await r.json(); if (!j.success) throw new Error(JSON.stringify(j.errors)); return j.result[0].results; };
async function once() {
  const [tick] = await q("SELECT id, started_at, steps_completed, steps_total, errors FROM tick_runs ORDER BY id DESC LIMIT 1");
  const [crit] = await q("SELECT value FROM org WHERE key='criticality'").catch(() => []);
  const [sw] = await q("SELECT at, status, merged, filed, errors, (julianday('now')-julianday(at))*1440 AS age_min FROM sweeper_runs ORDER BY id DESC LIMIT 1").catch(() => []);
  const k = crit ? JSON.parse(crit.value).k_eff : null;
  const fails = [];
  if (!tick || tick.steps_completed !== tick.steps_total) fails.push("tick incomplete: " + (tick && tick.errors));
  if (typeof k !== "number") fails.push("k_eff not measured");
  if (!sw) fails.push("sweeper has never run"); else if (sw.age_min > maxAge) fails.push(`sweeper last ran ${Math.round(sw.age_min)} min ago`);
  return { ok: !fails.length, fails, tick, k_eff: k, sweeper: sw || null };
}
let r = await once();
for (let t = 0; !r.ok && t < waitMin * 60; t += 30) { await new Promise(s => setTimeout(s, 30000)); r = await once(); }
console.log(JSON.stringify(r, null, 1));
process.exit(r.ok ? 0 : 1);
