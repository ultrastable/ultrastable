// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The generator that writes the plus (US-04-R06, R08, R10, R19): the propose port of runCycle, backed by a model port. It sends the
// step-404 evidence and asks for one JSON object; it checks the reply against the rules a plus must meet before proposePlus sees it
// (a measured outcome, a different guard, an angle other than the one that missed, additive and single for a plus, a doer and a
// revert path); one retry carries the refusal back to the model. A reply that still fails, or a model that cannot be called, throws:
// runCycle catches that and files the writing of the plus as a work item for the product manager, so a failed model never errors the tick.
const str = (v) => typeof v === 'string' && v.trim() !== '';
const normAngle = (a) => String(a || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// The first JSON object in a reply, with or without a code fence around it.
export function parseReply(text) {
  const t = String(text ?? '').replace(/```(?:json)?/gi, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b < a) return { error: 'the reply holds no JSON object' };
  try { const v = JSON.parse(t.slice(a, b + 1)); return v && typeof v === 'object' && !Array.isArray(v) ? { value: v } : { error: 'the reply is not a JSON object' }; }
  catch (e) { return { error: `the reply is not valid JSON: ${e.message}` }; }
}

// The first reason a reply cannot be a plus, or null. kind is 'plus' or 'simplify'.
export function planProblem(x, { kind, evidence }) {
  if (!str(x.title)) return 'title is missing';
  const pr = x.prediction || {};
  const fresh = new Set([evidence.usage, evidence.guard].filter(m => m && m.value !== null && m.value !== undefined).map(m => m.measure));
  if (!str(pr.metric) || !fresh.has(pr.metric)) return `prediction.metric must be a measure with a fresh reading: ${[...fresh].join(', ') || 'none is measured'}`;
  if (!['up', 'down'].includes(pr.direction)) return 'prediction.direction is up or down';
  if (!(typeof pr.size === 'number' && pr.size > 0 && pr.size <= 1)) return 'prediction.size is a fraction above 0 and at most 1 (0.10 for 10 percent)';
  const guard = str(x.guard) ? x.guard : evidence.guard?.measure;
  if (guard === pr.metric) return 'the guard measure must differ from the outcome measure';
  if (!fresh.has(guard)) return `the guard ${guard} has no fresh reading`;
  if (!str(x.angle)) return 'angle is missing';
  if (evidence.avoid_angle && normAngle(x.angle) === normAngle(evidence.avoid_angle)) return `the angle repeats the one that missed: ${evidence.avoid_angle}`;
  if (!str(x.doer)) return 'doer is missing';
  if (!str(x.revert_path)) return 'revert_path is missing';
  if (kind === 'plus') {
    if (x.additive !== true) return 'a plus is additive; removal belongs to a simplify cycle';
    if ((x.changes ?? 1) !== 1) return 'a plus is a single change';
  }
  return null;
}

function messages(kind, evidence, problems) {
  const brief = JSON.stringify({ product: evidence.product, usage: evidence.usage, guard: evidence.guard, friction: evidence.friction, last_kept: evidence.last_kept, recent_misses: evidence.recent_misses,
    avoid_angle: evidence.avoid_angle, seed: evidence.seed, sections: evidence.sections, slow_routes: evidence.slow_routes, feedback: evidence.feedback, comparables: evidence.comparables,
    principal_asks: evidence.principal_asks, owed_notes: evidence.owed_notes, unavailable: evidence.unavailable });
  const ask = [
    `Write one ${kind} for ${evidence.product}: ${kind === 'simplify' ? 'a change that removes complexity without losing a feature' : 'one additive, reversible improvement, a single change'}.`,
    'State the prediction before the change: the outcome measure, the direction (up or down) and the size as a fraction (0.10 is 10 percent). The guard measure is a different measure that must not get worse.',
    'Take an angle other than avoid_angle. Name the doer line (who or what makes the change) and the revert path.',
    'Answer with one JSON object: { "title", "prediction": { "metric", "direction", "size" }, "guard", "angle", "additive", "changes", "doer", "revert_path", "done_check", "evidence" }. No other text.',
    `Evidence: ${brief}`,
  ];
  const out = [{ role: 'system', content: 'You propose one measured improvement as a JSON object.' }, { role: 'user', content: ask.join('\n') }];
  for (const p of problems) out.push({ role: 'user', content: `Your last reply was refused: ${p}. Reply again with one corrected JSON object.` });
  return out;
}

// complete({ role, kind, messages }) -> { text } | string | { ok: false, error } (core/modelport complete and core/router call both fit).
export function createPlusProposer({ complete, maxRetries = 1 } = {}) {
  if (typeof complete !== 'function') throw new Error('createPlusProposer needs a complete port');
  return async function propose({ product, kind, evidence }) {
    const problems = [];
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const r = await complete({ role: 'manager', kind: 'plus', messages: messages(kind, { ...evidence, product: evidence.product ?? product }, problems) });
      if (r && r.ok === false) throw new Error(`the model could not be called: ${r.error}`);
      const text = typeof r === 'string' ? r : r?.text;
      const parsed = parseReply(text);
      const problem = parsed.error || planProblem(parsed.value, { kind, evidence });
      if (!problem) {
        const x = parsed.value;
        return { title: x.title, evidence: x.evidence ?? 'proposed from the gathered evidence', prediction: x.prediction, guard: x.guard || evidence.guard.measure, angle: x.angle,
          additive: x.additive === true, changes: x.changes ?? 1, doer: x.doer, revert_path: x.revert_path, ...(str(x.done_check) ? { done_check: x.done_check } : {}) };
      }
      problems.push(problem);
    }
    throw new Error(`the proposer's reply was refused: ${problems.at(-1)}`);
  };
}
