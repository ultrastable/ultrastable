// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
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
console.log("oidc ok");
