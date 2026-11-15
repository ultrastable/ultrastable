// HANDOFF-1 bootstrap and recovery: deploy a platform worker through the same server path the tick uses (seed/worker/src/handoff.js makeDeployer ->
// the site worker's /__internal/deploy), from a commit on GitHub, not from a working copy. Used once to put the handoff loop itself live, and whenever
// the tick is down and cannot deploy its own fix. It rotates INTERNAL_DEPLOY_KEY on the site and the tick in the same run, so no key is ever printed or stored.
//   CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... GH_TOKEN=... node deploy/handoff-deploy.mjs <worker-id> [sha]
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { makeDeployer } from "../seed/worker/src/handoff.js";
const [id, shaArg] = process.argv.slice(2);
const T = process.env.CLOUDFLARE_API_TOKEN, A = process.env.CLOUDFLARE_ACCOUNT_ID, G = process.env.GH_TOKEN || process.env.GITHUB_TOKEN, REPO = process.env.REPO || "ultrastable/ultrastable";
if (!id || !T || !A || !G) { console.error("usage: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GH_TOKEN set; node deploy/handoff-deploy.mjs <worker-id> [sha]"); process.exit(1); }
const gh = (p) => fetch("https://api.github.com" + p, { headers: { authorization: "Bearer " + G, accept: "application/vnd.github+json", "user-agent": "ultrastable-handoff-deploy" } }).then(r => r.json());
const sha = shaArg || (await gh(`/repos/${REPO}/commits/main`)).sha;
// the tick's config.js is generated on the server path from seed/autonomy at that commit (handoff.js tickConfigSource)
const key = randomBytes(32).toString("base64url");
for (const s of ["ultrastable-site", "ultrastable-tick"]) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${A}/workers/scripts/${s}/secrets`, { method: "PUT", headers: { authorization: "Bearer " + T, "content-type": "application/json" }, body: JSON.stringify({ name: "INTERNAL_DEPLOY_KEY", text: key, type: "secret_text" }) }).then(r => r.json());
  if (!r.success) { console.error("key on", s, JSON.stringify(r.errors)); process.exit(1); }
}
await new Promise(r => setTimeout(r, 8000));  // secret propagation
const site = { fetch: (u, o) => fetch("https://ultrastable.io" + new URL(u).pathname, o) };
const res = await makeDeployer({ token: G, site, key })(id, sha, REPO);
console.log(JSON.stringify({ worker: id, sha: sha.slice(0, 12), ...res }));
process.exit(res.ok ? 0 : 1);
