// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// DEPLOY-OIDC-1: the site accepts a deploy only with a GitHub-signed OIDC token for this repository's main branch (or the internal key).
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { internalDeploy, verifyGithubOidc, _resetJwks, OIDC_ISSUER, OIDC_AUDIENCE } from "./deployer.js";
const { privateKey, publicKey } = await webcrypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwk = { ...(await webcrypto.subtle.exportKey("jwk", publicKey)), kid: "k1" };
const b64u = b => Buffer.from(b).toString("base64url");
const now = Date.now(), t = Math.floor(now / 1000);
async function jwt(claims, kid = "k1") {
  const h = b64u(JSON.stringify({ alg: "RS256", kid })), p = b64u(JSON.stringify({ iss: OIDC_ISSUER, aud: OIDC_AUDIENCE, repository: "ultrastable/ultrastable", ref: "refs/heads/main", exp: t + 300, ...claims }));
  return h + "." + p + "." + b64u(await webcrypto.subtle.sign("RSASSA-PKCS1-v1_5", privateKey, new TextEncoder().encode(h + "." + p)));
}
const calls = [];
const fetcher = async (url, init) => { calls.push(String(url)); if (String(url).endsWith("/.well-known/jwks")) return new Response(JSON.stringify({ keys: [jwk] })); return new Response(JSON.stringify({ success: true, result: { id: "v1" } })); };
assert.equal((await verifyGithubOidc(await jwt({}), {}, fetcher, now)).ok, true);
for (const [bad, why] of [[{ repository: "evil/ultrastable" }, "other repo"], [{ ref: "refs/heads/feature" }, "other branch"], [{ aud: "x" }, "other audience"], [{ exp: t - 5 }, "expired"]]) assert.equal((await verifyGithubOidc(await jwt(bad), {}, fetcher, now)).ok, false, why);
const forged = (await jwt({})).split("."); forged[1] = b64u(JSON.stringify({ iss: OIDC_ISSUER, aud: OIDC_AUDIENCE, repository: "ultrastable/ultrastable", ref: "refs/heads/main", exp: t + 300, sha: "x" }));
assert.equal((await verifyGithubOidc(forged.join("."), {}, fetcher, now)).ok, false, "a changed payload fails the signature");
_resetJwks();
const env = { CF_DEPLOY_TOKEN: "cf", CF_ACCOUNT_ID: "acct" };
const body = JSON.stringify({ name: "ultrastable-agents", main: "worker.js", modules: [{ name: "worker.js", src: "export default {}" }] });
const req = (headers) => new Request("https://site/__internal/deploy", { method: "POST", headers, body });
assert.equal((await internalDeploy(req({ authorization: "Bearer " + await jwt({}) }), env, fetcher)).status, 200, "a valid OIDC token deploys");
assert.equal((await internalDeploy(req({ authorization: "Bearer " + await jwt({ ref: "refs/heads/x" }) }), env, fetcher)).status, 404, "a token for another branch is refused");
assert.equal((await internalDeploy(req({}), env, fetcher)).status, 404, "no credential is refused");
// WORKERS-DEV-1: a non-public worker gets its workers.dev route turned on after the upload
{ _resetJwks(); const seen = []; const f = async (url, init) => { seen.push([String(url), init && init.method]); return String(url).endsWith("/.well-known/jwks") ? new Response(JSON.stringify({ keys: [jwk] })) : new Response(JSON.stringify({ success: true, result: String(url).includes("/zones?") ? [{ name: "ultrastable.app", id: "z1" }] : {} }), { status: 200 }); };
  const b2 = JSON.stringify({ name: "ultrastable-unlearn", main: "worker.js", modules: [{ name: "worker.js", src: "export default {}" }], workers_dev: true, domains: ["unlearn.ultrastable.app"] });
  const r2 = await internalDeploy(new Request("https://site/__internal/deploy", { method: "POST", headers: { authorization: "Bearer " + await jwt({}) }, body: b2 }), env, f);
  assert.equal(r2.status, 200); assert.ok(seen.some(c => c[0].endsWith("/workers/scripts/ultrastable-unlearn/subdomain") && c[1] === "POST"), "workers.dev turned on");
  assert.ok(seen.some(c => c[0].endsWith("/workers/domains") && c[1] === "PUT"), "custom domain attached"); }
// CF-ROUTE-1: the read-and-backup route forwards only allow-listed requests and never a write outside the backup prefix
const cf = async (method, path, b, h = {}) => { const seen = []; const f = async (url, init) => { seen.push([String(url), init && init.method]); return String(url).endsWith("/.well-known/jwks") ? new Response(JSON.stringify({ keys: [jwk] })) : new Response(JSON.stringify({ success: true }), { status: 200 }); }; const r = await internalDeploy(new Request("https://site/__internal/cf", { method: "POST", headers: { authorization: "Bearer " + await jwt({}), "x-cf-method": method, "x-cf-path": path, ...h }, body: b }), env, f); return { r, seen }; };
let x = await cf("GET", "d1/database?per_page=100"); assert.equal(x.r.status, 200); assert.ok(x.seen.some(c => c[0] === "https://api.cloudflare.com/client/v4/accounts/acct/d1/database?per_page=100" && c[1] === "GET"), "a read is forwarded to the pinned account");
_resetJwks();
for (const [m, p2] of [["DELETE", "d1/database"], ["PUT", "r2/buckets/ultrastable-git/objects/other/x"], ["GET", "../user/tokens"], ["PUT", "workers/scripts/x"], ["POST", "d1/database"]]) { _resetJwks(); assert.equal((await cf(m, p2)).r.status, 403, m + " " + p2 + " is refused"); }
_resetJwks(); assert.equal((await cf("POST", "d1/database/" + "a".repeat(8) + "-aaaa-aaaa-aaaa-" + "a".repeat(12) + "/query", JSON.stringify({ sql: "DELETE FROM t" }), { "content-type": "application/json" })).r.status, 403, "a write query is refused");
_resetJwks(); assert.equal((await cf("POST", "d1/database/" + "a".repeat(8) + "-aaaa-aaaa-aaaa-" + "a".repeat(12) + "/query", JSON.stringify({ sql: "SELECT 1" }), { "content-type": "application/json" })).r.status, 200, "a read query is forwarded");
// COST-ROUTE-1: only the cost probe's analytics reads are forwarded, for the pinned account
const gq = async (query, variables = { account: "evil" }) => { const seen = []; const f = async (url, init) => { seen.push([String(url), init && init.body]); return String(url).endsWith("/.well-known/jwks") ? new Response(JSON.stringify({ keys: [jwk] })) : new Response(JSON.stringify({ data: {} }), { status: 200 }); }; _resetJwks(); const r = await internalDeploy(new Request("https://site/__internal/cf-graphql", { method: "POST", headers: { authorization: "Bearer " + await jwt({}) }, body: JSON.stringify({ query, variables }) }), env, f); return { r, seen }; };
let g = await gq("query($account: String!, $dt: Date) { viewer { accounts(filter: { accountTag: $account }) { aiInferenceAdaptiveGroups(limit: 1) { sum { totalNeurons } } } } }");
assert.equal(g.r.status, 200); assert.ok(JSON.parse(g.seen.find(c => c[0].endsWith("/graphql"))[1]).variables.account === "acct", "the account is pinned");
assert.equal((await gq("mutation { x }")).r.status, 403, "a mutation is refused");
assert.equal((await gq("query($account: String!) { viewer { zones { x } } }")).r.status, 403, "another dataset is refused");
console.log("oidc ok");
