// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Router-backed ports for ./schedule.js (US-SPEC-09 steps 2318 and 2320): `canary(model, task_class)` and `answer(model, decision)`
// built over core/router's `call`, so a scheduled canary or a shadow answer reaches the provider the router is configured with and
// is metered, capped and switched like any other call. The organization's labels and decision list (`label`, `decisions`) are its
// own data and stay host ports. Ports: router (createRouter result) and the configuration it was made with. Nothing here holds a key.
//
// A canary spec per task class: { messages, tools?, json?, max_tokens?, role?, checkTools?(tool_calls) -> bool, check?(text) -> bool }.
// tool_calls is tested only when the spec offers tools; schema only when the spec has a `check` or asks for json (the text must then
// parse as a JSON object). `canaries['*']` is the default spec.
const where = (config, model) => {
  for (const [name, p] of Object.entries(config.providers || {})) for (const [rung, m] of Object.entries(p.models || {})) if (m.id === model) return { provider: name, rung };
  return null;
};
const isObject = text => { try { const v = JSON.parse(text); return v !== null && typeof v === 'object' && !Array.isArray(v); } catch { return false; } };

async function pinned(router, config, model, req) {
  const at = where(config, model);
  if (!at) throw new Error(`ladder: model ${model} is not in the router configuration`);
  const r = await router.call({ ...req, kind: req.kind || 'canary', rung: at.rung, providers: [at.provider] });
  // An unreachable or refused path is no evidence about the model: throw, and schedule.js records an item and counts no canary.
  if (!r.ok) throw new Error(`ladder: the router refused the call (${r.refusal}${r.attempts?.length ? ': ' + r.attempts[0].error : ''})`);
  // A retired model gives way to its successor inside the router; the successor's answer says nothing about the model asked for.
  if (r.model !== model) throw new Error(`ladder: ${model} was answered by ${r.model}`);
  return r;
}

/** canary(model, task_class) -> { tool_calls, schema } for core/ladder/schedule.js `canaryRun`. */
export function createRouterCanary({ router, config, canaries = {} }) {
  return async (model, task_class) => {
    const spec = canaries[task_class] || canaries['*'];
    if (!spec || !Array.isArray(spec.messages)) throw new Error(`ladder: no canary spec for task class ${task_class}`);
    const r = await pinned(router, config, model, { role: spec.role || 'triage', messages: spec.messages, tools: spec.tools, json: spec.json, max_tokens: spec.max_tokens || 256 });
    const tool_calls = spec.tools ? (typeof spec.checkTools === 'function' ? !!spec.checkTools(r.tool_calls) : Array.isArray(r.tool_calls) && r.tool_calls.length > 0) : null;
    const schema = typeof spec.check === 'function' ? !!spec.check(r.text) : spec.json ? isObject(r.text) : null;
    return { tool_calls, schema };
  };
}

/**
 * answer(model, decision) -> the model's answer for `shadowRun`. `prompt(decision)` returns the messages; `parse(text, decision)` turns
 * the reply into the same value the organization's label holds (default: the trimmed text).
 */
export function createRouterAnswer({ router, config, prompt, parse = text => String(text).trim(), role = 'triage', max_tokens = 64 }) {
  if (typeof prompt !== 'function') throw new Error('ladder: createRouterAnswer needs a prompt(decision) function');
  return async (model, decision) => {
    const r = await pinned(router, config, model, { role, kind: 'shadow', messages: prompt(decision), max_tokens });
    return parse(r.text, decision);
  };
}
