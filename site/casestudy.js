// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// CASE-STUDY-1: /customer-zero, the case study of Ultrastable running on itself, generated from the same snapshot and live overlay as
// /live. The page is built from facts() only: every figure is a fact with the record it was read from, and a value the snapshot does not
// hold is left out, never written as zero. No sentence here states a number by hand.
import { load, overlay } from "./live.js";

const esc = t => String(t == null ? "" : t).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
const has = v => v != null && !Number.isNaN(v);

// One fact = { group, label, value, source, record }: source is the path in /api/live the value was read from, record is where a reader opens it.
export function facts(d) {
  const out = [], th = d.throughput || {}, add = (group, label, value, source, record) => { if (has(value)) out.push({ group, label, value, source, record }); };
  const days = (th.changelog || []).slice(0, 7), changes = days.flatMap(g => g.changes);
  if (days.length) {
    add("shipped", "changes merged in the latest " + days.length + " day(s) with changes", changes.length, "throughput.changelog", "/changelog.json");
    const sized = changes.filter(c => has(c.plus));
    if (sized.length) { add("shipped", "lines added", sized.reduce((a, c) => a + c.plus, 0), "throughput.changelog[].changes[].plus", "/changelog.json"); add("shipped", "lines removed", sized.reduce((a, c) => a + (c.minus || 0), 0), "throughput.changelog[].changes[].minus", "/changelog.json"); }
    add("shipped", "merged by the system's own loops", changes.filter(c => /unattended|executor|worker|bot/i.test(String(c.by || ""))).length, "throughput.changelog[].changes[].by", "/changelog.json");
  }
  const dep = (th.deploys || {}).by_conclusion; if (dep) { add("shipped", "site deploys that succeeded", dep.success, "throughput.deploys.by_conclusion.success", "/api/live"); add("broke", "site deploys that failed", dep.failure, "throughput.deploys.by_conclusion.failure", "/api/live"); }
  const clocks = (d.clocks || []).filter(c => c.status && c.status !== "unmeasured");
  if (clocks.length) { add("loops", "loops measured", clocks.length, "clocks", "/demo"); add("loops", "loops on time", clocks.filter(c => c.status === "ticking" || c.status === "idle").length, "clocks[].status", "/demo"); add("broke", "loops late or stopped", clocks.filter(c => c.status === "late" || c.status === "stopped").length, "clocks[].status", "/demo"); }
  const q = (th.queue || {}).by_status; if (q) { add("loops", "backlog items closed by a passing probe", (q.closed || 0) + (q.done || 0), "throughput.queue.by_status", "/api/live"); add("loops", "backlog items open", q.open, "throughput.queue.by_status.open", "/api/live"); }
  const st = (d.settlement || {}).counts; if (st) { add("broke", "attempts parked after repeated failure", st.parked, "settlement.counts.parked", "/api/live"); add("broke", "attempts that failed", st.failed, "settlement.counts.failed", "/api/live"); }
  add("broke", "fixes the loops made to themselves", (d.loop_improvements || []).length || null, "loop_improvements", "/live");
  const mc = th.model_cost; if (mc) { add("cost", "model calls", mc.calls, "throughput.model_cost.calls", "/api/live"); add("cost", "model cost in US dollars", mc.usd, "throughput.model_cost.usd", "/api/live"); add("cost", "model calls that failed", Object.values(mc.by_model || {}).reduce((a, m) => a + (m.failed || 0), 0), "throughput.model_cost.by_model[].failed", "/api/live"); }
  return out;
}

const GROUPS = [["shipped", "What it shipped", "Code merged and deployed, with who drove it."], ["loops", "Which loops ran", "Each loop is a clock; its status is measured from recorded runs."], ["broke", "What broke, and what it did about it", "Failures are part of the record. The fixes listed are changes the loops made to their own steps."], ["cost", "What it cost", "Model calls recorded by the system's own cost log."]];
export function caseBody(d) {
  const f = facts(d), list = (d.loop_improvements || []).slice(-5).reverse();
  const sec = ([id, title, cap]) => { const rows = f.filter(x => x.group === id); if (!rows.length) return "";
    return "<h2>" + esc(title) + "</h2><p class=\"meta\">" + esc(cap) + "</p><div class=\"us-wrap\"><table class=\"us-table\"><thead><tr><th scope=\"col\">Measure</th><th scope=\"col\">Value</th><th scope=\"col\">Record</th></tr></thead><tbody>"
      + rows.map(x => "<tr><td>" + esc(x.label) + "</td><td data-fact=\"" + esc(x.source) + "\">" + esc(x.value) + "</td><td><a href=\"" + esc(x.record) + "\">" + esc(x.source) + "</a></td></tr>").join("") + "</tbody></table></div>"
      + (id === "broke" && list.length ? "<ul>" + list.map(x => "<li><strong>" + esc(x.loop) + "</strong>: " + esc(x.improvement) + "</li>").join("") + "</ul>" : ""); };
  return "<div class=\"head\"><h1>Customer zero: Ultrastable running on itself</h1><p>Ultrastable's first customer is Ultrastable. This page is generated from the system's own record, and each value links to where it was read. A measure the record does not hold is left out.</p>"
    + "<p class=\"meta\">Record as of " + esc(d.generated || "unknown") + ".</p></div>" + (f.length ? GROUPS.map(sec).join("") : "<p>The record holds no measured values yet.</p>")
    + "<div class=\"us-actions\"><a class=\"btn btn-primary\" href=\"/demo\">See it running</a><a class=\"btn\" href=\"/pilot\">Apply for a pilot</a></div>";
}

export async function caseResponse(u, request, env, shell, HTML, bundleAt = null) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(JSON.stringify({ error: "read-only" }), { status: 405, headers: { "content-type": "application/json; charset=utf-8", allow: "GET, HEAD" } });
  const r = await load(env);
  const body = r ? caseBody(await overlay(JSON.parse(r.body), env, r.generated, Date.now(), bundleAt)) : "<div class=\"head\"><h1>Customer zero: Ultrastable running on itself</h1><p>The record has not been published yet. The <a href=\"/live\">live page</a> shows it as soon as it is.</p></div>";
  return new Response(shell({ path: "/customer-zero", title: "Customer zero: Ultrastable running on itself", description: "What the system shipped, which loops ran, what broke and what it cost, each value linked to its record." }, body), { status: r ? 200 : 503, headers: HTML });
}
