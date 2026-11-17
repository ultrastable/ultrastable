// Q-CRIT-COLLECTORS: push the signals the tick Worker cannot read itself to /api/criticality/sample, then mirror the live
// /metrics/criticality.json into ultrastable/ultrastable metrics/criticality.json.
//   node deploy/criticality-collect.mjs          build the sample, POST it, mirror the reading
//   node deploy/criticality-collect.mjs --dry    build and print the sample only; sends and writes nothing
// One sample per run: verified and failed deploys in the last 24 h (ops/deploys.jsonl, live_matches_commit), spend units from the latest
// criticality row (ops/criticality.jsonl `cost`: foundation/cost.py's normalized level of ops/cost.jsonl, x 10; cap_breached above 1), human touches = workflow_dispatch runs in 24 h
// (GitHub API, when GH_TOKEN is set), and the ignition gaps foundation/sauce.py wrote to ops/ignition.json (the Worker keeps them as rows).
// Run by foundation/sauce.py at the end of every launch pass when CRITICALITY_URL and CRITICALITY_TOKEN are set; also runnable after deploy-workers.
// Env: CRITICALITY_URL (the tick Worker origin), CRITICALITY_TOKEN (bearer, never printed), GH_TOKEN (optional: touches and the seed mirror).
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("..", import.meta.url);
const rows = (rel) => existsSync(new URL(rel, ROOT)) ? readFileSync(new URL(rel, ROOT), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

// Pure: the sample from the repository's own records. `now` is injected so tests never read the wall clock.
export function buildSample({ deploys, crit, ignition, touches, now }) {
  const since = now - 24 * 3600e3;
  const win = deploys.filter((r) => r.at && Date.parse(r.at) >= since && r.uploaded);
  const ok = win.filter((r) => r.live_matches_commit === true).length;
  const last = crit.length ? crit[crit.length - 1] : null;
  const level = last && Number.isFinite(Number(last.cost)) ? Number(last.cost) : 0;
  return {
    at: new Date(now).toISOString().replace("T", " ").slice(0, 19), source: "collector",
    deploys_ok: ok, deploys_fail: win.length - ok, spend_units: Math.round(level * 10 * 1000) / 1000, human_touches: touches || 0,
    cap_breached: level > 1, ignition_gaps: (ignition && Array.isArray(ignition.gaps) ? ignition.gaps : []).map((g) => ({ link: g.link, owner: g.owner, closing_probe: g.closing_probe })),
  };
}

async function dispatchTouches(fetchFn, token, now) {
  if (!token) return 0;
  const r = await fetchFn("https://api.github.com/repos/ultrastable/ultrastable/actions/runs?event=workflow_dispatch&per_page=100", { headers: { authorization: "Bearer " + token, accept: "application/vnd.github+json" } });
  if (!r.ok) return 0;
  const j = await r.json();
  return (j.workflow_runs || []).filter((x) => Date.parse(x.created_at) >= now - 24 * 3600e3 && x.triggering_actor?.type !== "Bot").length;
}

export async function mirror(fetchFn, token, reading) {
  const url = "https://api.github.com/repos/ultrastable/ultrastable/contents/metrics/criticality.json";
  const h = { authorization: "Bearer " + token, accept: "application/vnd.github+json" };
  const cur = await fetchFn(url, { headers: h });
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const body = { message: "metrics: criticality reading (Q-CRIT-COLLECTORS)", content: Buffer.from(JSON.stringify(reading, null, 1) + "\n").toString("base64"), ...(sha ? { sha } : {}) };
  const r = await fetchFn(url, { method: "PUT", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify(body) });
  return r.status;
}

export async function main(argv = process.argv.slice(2), env = process.env, fetchFn = fetch, now = Date.now()) {
  const touches = await dispatchTouches(fetchFn, env.GH_TOKEN, now).catch(() => 0);
  const ign = existsSync(new URL("ops/ignition.json", ROOT)) ? JSON.parse(readFileSync(new URL("ops/ignition.json", ROOT), "utf8")) : null;
  const sample = buildSample({ deploys: rows("ops/deploys.jsonl"), crit: rows("ops/criticality.jsonl"), ignition: ign, touches, now });
  if (argv.includes("--dry") || !env.CRITICALITY_URL || !env.CRITICALITY_TOKEN) {
    console.log(JSON.stringify({ sent: false, why: argv.includes("--dry") ? "dry run" : "CRITICALITY_URL or CRITICALITY_TOKEN not set here", sample }));
    return 0;
  }
  const base = env.CRITICALITY_URL.replace(/\/$/, "");
  const r = await fetchFn(base + "/api/criticality/sample", { method: "POST", headers: { authorization: "Bearer " + env.CRITICALITY_TOKEN, "content-type": "application/json" }, body: JSON.stringify(sample) });
  const out = { sent: r.status === 202, status: r.status, gaps: sample.ignition_gaps.length };
  if (out.sent) {
    const live = await fetchFn(base + "/metrics/criticality.json").then((x) => x.ok ? x.json() : null).catch(() => null);
    out.k_eff = live ? live.k_eff : null;
    if (live && env.GH_TOKEN) out.mirror = await mirror(fetchFn, env.GH_TOKEN, live).catch((e) => "error " + e.message);
  }
  console.log(JSON.stringify(out));
  return out.sent ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().then((c) => process.exit(c));
