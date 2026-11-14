// AUTHZEN-1: OpenID AuthZEN Authorization API 1.0 policy decision point backed by the trust ledger.
// An agent, gateway or MCP server asks "may this subject do this action on this resource?"; the answer comes from the ledger rung for (surface = resource.id, action_class = action.name).
// Fail closed: no ledger row, an unreadable ledger or an unknown rung means decision=false.
const ORIGIN = "https://ultrastable.io";
const LADDER = ["observed", "assisted", "delegated", "autonomous", "self-directed", "self-modifying", "self-extending"];
// Rung needed per action class (the classes seeded in the live trust_ledger, plus the generic verbs); anything not listed needs "autonomous".
const NEEDS = { read: "observed", observe: "observed", draft: "observed", estimate_cost: "observed", propose: "assisted", comment: "assisted", intake: "assisted", request_binding: "assisted", add_record: "assisted", migrate_additive: "assisted", deploy_preview: "assisted", branch_commit_push: "delegated", open_pr: "delegated", merge_pr_green: "delegated", create_update_close: "delegated", claim_release: "delegated", post_report: "delegated", execute: "delegated", deploy: "autonomous", deploy_production: "autonomous", change_live_record: "autonomous", merge: "autonomous", modify: "self-modifying", extend: "self-extending" };
// Irreversible or identity-bound action classes (the interrupt gate): no rung ever grants them. They go through a gate card with a default in effect, never through a decision point.
const GATED = new Set(["spend", "send_as_owner", "publish_public", "sign_or_file", "mint_or_rotate_owner_credential", "delete_repo", "force_push_default_branch", "migrate_destructive", "delete_database_or_bucket", "transfer_or_delete_domain"]);
const NEVER = /^(secret|credential|interrupt-gate|alignment-floor|permission)(:|$)/;
const CORS = { "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };
const j = (o, status, extra) => new Response(JSON.stringify(o), { status: status || 200, headers: { ...CORS, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...(extra || {}) } });

export const METADATA = { policy_decision_point: ORIGIN, access_evaluation_endpoint: ORIGIN + "/access/v1/evaluation", access_evaluations_endpoint: ORIGIN + "/access/v1/evaluations" };

async function ledgerRung(env, surface, action) {
  const row = await env.ORG.prepare("SELECT * FROM trust_ledger WHERE surface = ? AND action_class = ?").bind(surface, action).first();
  if (!row) return null;
  return { rung: String(row.ladder_position || row.rung || ""), score: Number(row.trust_score ?? row.reliability) };
}

export async function decide(env, req) {
  const sub = req && req.subject, res = req && req.resource, act = req && req.action;
  if (!sub || !sub.type || !sub.id || !res || !res.type || !res.id || !act || !act.name) return { status: 400, error: "subject{type,id}, resource{type,id} and action{name} are required" };
  if (NEVER.test(res.type) || NEVER.test(String(res.id))) return { decision: false, context: { reason: "resource is outside every trust rung", rung_needed: null } };
  if (GATED.has(String(act.name))) return { decision: false, context: { reason: "interrupt gate: irreversible or identity-bound; no trust rung grants it", rung_needed: null } };
  const surface = String(res.id), action = String(act.name), need = NEEDS[action] || "autonomous";
  let got; try { got = await ledgerRung(env, surface, action); } catch (e) { return { decision: false, context: { reason: "ledger unreadable; failing closed" } }; }
  if (!got) return { decision: false, context: { reason: "no ledger row for this surface and action; failing closed", rung_needed: need } };
  const have = LADDER.indexOf(got.rung);
  if (have < 0) return { decision: false, context: { reason: "unknown rung " + got.rung, rung_needed: need } };
  const ok = have >= LADDER.indexOf(need);
  return { decision: ok, context: { reason: ok ? "ledger rung " + got.rung + " covers " + action : "ledger rung " + got.rung + " is below " + need, rung: got.rung, rung_needed: need, trust_score: Number.isFinite(got.score) ? got.score : null } };
}

export async function authzen(request, env) {
  const u = new URL(request.url), p = u.pathname.replace(/\/$/, "");
  if (u.hostname !== "ultrastable.io" && u.hostname !== "www.ultrastable.io" && !u.hostname.endsWith(".workers.dev")) return null;
  if (p === "/.well-known/authzen-configuration") return j(METADATA, 200, { "cache-control": "public, max-age=300" });
  if (p !== "/access/v1/evaluation" && p !== "/access/v1/evaluations") return null;
  if (request.method !== "POST") return j({ error: "POST required" }, 405, { allow: "POST" });
  if (!env || !env.ORG) return j({ error: "ledger not bound" }, 503);
  let b; try { b = await request.json(); } catch (e) { return j({ error: "body must be JSON" }, 400); }
  const id = request.headers.get("x-request-id");
  const hdr = id ? { "x-request-id": id } : undefined;
  if (p === "/access/v1/evaluation") { const r = await decide(env, b); return r.status ? j({ error: r.error }, r.status, hdr) : j(r, 200, hdr); }
  const list = Array.isArray(b && b.evaluations) ? b.evaluations.slice(0, 50) : null;
  if (!list || !list.length) return j({ error: "evaluations[] is required" }, 400, hdr);
  const out = []; for (const e of list) { const r = await decide(env, { subject: e.subject || b.subject, resource: e.resource || b.resource, action: e.action || b.action }); out.push(r.status ? { decision: false, context: { reason: r.error } } : r); }
  return j({ evaluations: out }, 200, hdr);
}
