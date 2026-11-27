// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Role handlers for the role runtime (US-SPEC-14 section 3): the container-job variant and the agent-engine variant. Both take the thing
// they drive as a port (core imports no platform): `execute` is adapters/cloudflare/containers/executor.js execute with its executors bound,
// and `createRuntime` is adapters/cloudflare/agents/runtime.js createAgentRuntime. A handler is async ({ role, item, complete }) -> { ok, detail }.

/** A container-job handler. buildJob({ role, item }) -> a job { command, files } (or null for nothing to run); execute(job) -> { ok, executor, stdout, ... }.
 *  A refusal (an invalid job, no executor, every executor failed) is a failed run with its reason, never a pass. */
export function containerHandler({ execute, buildJob } = {}) {
  if (typeof execute !== 'function' || typeof buildJob !== 'function') throw new Error('containerHandler needs execute and buildJob');
  return async ({ role, item }) => {
    const job = buildJob({ role, item });
    if (!job) return { ok: false, detail: 'no job could be built for this item' };
    const r = await execute(job);
    if (r.refusal) return { ok: false, detail: `${r.refusal}${r.detail ? `: ${r.detail}` : ''}${r.attempts?.length ? ` after ${r.attempts.map(a => a.executor).join(', ')}` : ''}` };
    return { ok: !!r.ok, detail: `${r.executor || 'executor'} exit ${r.exit_code ?? '?'}${r.stdout ? `: ${String(r.stdout).trim().slice(0, 120)}` : ''}` };
  };
}

/** An agent-engine handler: one bounded turn of the agent runtime per item. The session is the item id, so a role resumes its own conversation.
 *  prompt({ role, item }) -> the text the agent is given. A refusal (max_steps, the router refusing) is a failed run with its reason. */
export function agentHandler({ createRuntime, prompt = ({ item }) => `Work item ${item?.id}: ${item?.title}. Done check: ${item?.done_check}` } = {}) {
  if (typeof createRuntime !== 'function') throw new Error('agentHandler needs createRuntime');
  return async ({ role, item }) => {
    const agent = createRuntime({ role });
    const r = await agent.turn(`${role.id}:${item?.id ?? 'none'}`, prompt({ role, item }));
    return r.ok ? { ok: true, detail: String(r.text || '').slice(0, 200) } : { ok: false, detail: `the agent refused: ${r.refusal} after ${r.steps} step(s)` };
  };
}
