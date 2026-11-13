// SELF-SUSTAIN-1 / AUTH-1: bind what the deployed tick Worker needs to run its own credential layer, with no person minting or pasting anything.
// CREDENTIAL_KEY (the sealing key for stored credentials) is generated here once and never printed; GITHUB_REPOS names the repositories the lane serves. GitHub access itself is never a bound
// secret: the Worker holds a GitHub App (registered and installed through the one-click consent screen, /connect/github) and mints short-lived installation tokens from it.
import { appendFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
const API = "https://api.cloudflare.com/client/v4";
const url = (env, tail = "") => `${API}/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${env.TICK_WORKER || "ultrastable-tick"}/secrets${tail}`;
const hdr = env => ({ authorization: "Bearer " + env.CLOUDFLARE_API_TOKEN, "content-type": "application/json" });
export async function bind(env, f = fetch) {
  const have = await f(url(env), { headers: hdr(env) });
  if (!have.ok) throw new Error("list secrets: HTTP " + have.status);
  const names = new Set(((await have.json()).result || []).map(x => x.name));
  const put = [];
  if (!names.has("CREDENTIAL_KEY")) put.push(["CREDENTIAL_KEY", randomBytes(32).toString("base64")]);  // generated once; an existing key is never rotated here (it would orphan sealed rows)
  if (env.GITHUB_REPOS) put.push(["GITHUB_REPOS", env.GITHUB_REPOS]);
  for (const [name, text] of put) {
    const r = await f(url(env), { method: "PUT", headers: hdr(env), body: JSON.stringify({ name, text, type: "secret_text" }) });
    if (!r.ok) throw new Error(`secret ${name}: HTTP ${r.status}`);
  }
  return { status: put.length ? "bound" : "unchanged", bound: put.map(x => x[0]) };
}
if (process.argv[1] && process.argv[1].endsWith("bind-worker-secrets.mjs")) {
  if (!process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.CLOUDFLARE_API_TOKEN) { console.error("Cloudflare credentials missing"); process.exit(1); }
  const r = await bind(process.env);
  appendFileSync(new URL("../ops/bindings.jsonl", import.meta.url), JSON.stringify({ at: new Date().toISOString(), worker: process.env.TICK_WORKER || "ultrastable-tick", ...r }) + "\n");
  console.log("bind-worker-secrets:", r.status, r.bound.join(","));
}
