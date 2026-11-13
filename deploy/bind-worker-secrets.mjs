// SELF-SUSTAIN-1: give the deployed tick Worker the credentials its own lane and executor providers need, so merges, dispatches and deploys happen with no session running.
// Secret values are read from the environment, sent straight to the Cloudflare secrets API, and never printed. With no GitHub credential bound the step records `no-credential`
// (one gate with the Actions-hosted lane as the default in effect) and exits 0; any API failure exits 1.
//   LANE_PAT -> GITHUB_TOKEN (lane: merge green PRs) and GITHUB_DISPATCH_TOKEN (executor: wake the workflow); GITHUB_REPOS names the repositories the lane serves.
import { appendFileSync } from "node:fs";
const A = process.env.CLOUDFLARE_ACCOUNT_ID, T = process.env.CLOUDFLARE_API_TOKEN, W = process.env.TICK_WORKER || "ultrastable-tick";
export function plan(env) {
  const pat = env.LANE_PAT || "";
  const out = [];
  if (pat) { out.push(["GITHUB_TOKEN", pat], ["GITHUB_DISPATCH_TOKEN", pat]); }
  if (pat && env.GITHUB_REPOS) out.push(["GITHUB_REPOS", env.GITHUB_REPOS]);
  return out;
}
export async function bind(env, f = fetch) {
  const items = plan(env);
  if (!items.length) return { status: "no-credential", bound: [] };
  const bound = [];
  for (const [name, text] of items) {
    const r = await f(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${env.TICK_WORKER || "ultrastable-tick"}/secrets`, {
      method: "PUT", headers: { authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN, "content-type": "application/json" }, body: JSON.stringify({ name, text, type: "secret_text" }),
    });
    if (!r.ok) throw new Error(`secret ${name}: HTTP ${r.status}`);
    bound.push(name);
  }
  return { status: "bound", bound };
}
if (process.argv[1] && process.argv[1].endsWith("bind-worker-secrets.mjs")) {
  if (!A || !T) { console.error("Cloudflare credentials missing"); process.exit(1); }
  const r = await bind(process.env);
  appendFileSync(new URL("../ops/bindings.jsonl", import.meta.url), JSON.stringify({ at: new Date().toISOString(), worker: W, ...r }) + "\n");
  console.log("bind-worker-secrets:", r.status, r.bound.join(","));
}
