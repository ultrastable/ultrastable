// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The reviewer roster of the two-family review gate (US-07-R10), built on the model ladder (US-SPEC-09). Each reviewer is one
// provider of the router's configuration with its model family; the gate picks two of disjoint families that are not the
// author's, and every call goes out as a `reviewer` on the change id, so the router's own rule (a reviewer's family differs
// from the doer's family on the same item) holds a second time, in the layer that actually calls the model. A reply that is
// not the expected JSON, or a refused call, throws: the gate records it as a reviewer outage and fails open, logged (US-07-R11).
// The diff stays in its own field; the instructions are fixed text. Ports: router (createRouter from core/router).
import { BRIEF } from './review.js';

function parseJson(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1];
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * reviewersFromRouter(router, { providers, rung, role }) -> [{ name, family, review(input) }]. `providers` names the
 * router providers to offer as reviewers (default: every one the router can use for this request). A provider the router
 * cannot use now (no key, switched off, role not allowed) is left out; the gate then refuses with no_two_disjoint_families
 * and holds, rather than reviewing with fewer than two families.
 */
export async function reviewersFromRouter(router, { providers = [null], rung = 'medium', role = 'reviewer' } = {}) {
  const out = [];
  const seen = new Set();
  for (const name of providers) {
    const base = { role, kind: 'reviewer', rung, capabilities: ['json'], ...(name ? { providers: [name] } : {}) };
    const plan = await router.route(base);
    if (!plan.ok) continue;
    for (const c of plan.candidates) {
      if (seen.has(c.provider) || !c.family) continue;
      seen.add(c.provider);
      out.push({
        name: c.provider, family: c.family,
        async review(input) {
          const r = await router.call({ ...base, providers: [c.provider], item_id: input.change_id ?? null, json: true,
            messages: [
              { role: 'system', content: `${input.instructions} Check for: ${BRIEF.join('; ')}. Reply with one JSON object {"findings":[{"severity":"high|medium|low","title","trigger","evidence_line"}]} and nothing else. A finding needs a concrete trigger, and a high finding needs the exact diff line as evidence_line.` },
              { role: 'user', content: JSON.stringify(input.data) },
            ] });
          if (!r.ok) throw new Error(`reviewer call refused: ${r.refusal}`);
          const obj = parseJson(r.text);
          if (!obj || !Array.isArray(obj.findings)) throw new Error('the reviewer reply had no findings array');
          return { findings: obj.findings, cost_usd: r.cost_usd }; // any verdict field in the reply is ignored by the gate
        },
      });
    }
  }
  return out;
}
