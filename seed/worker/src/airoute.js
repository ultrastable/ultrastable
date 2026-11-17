// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// AI-ROUTER-1 (all callers): the one-call way for any Worker with env.AI and env.DB to send a chat through core/airouter (cache, dedupe, free first,
// learned routing, paid only inside the cap). A Worker with no env.DB still answers: it falls back to its first model directly and says so (routed:false).
import { createRouter } from './airouter.js';

// models: [{id, model, extra?}] (free Workers AI) or ready router models. Returns {text, model, cached, routed}.
export async function routeChat(env, { kind, models, messages, maxTokens = 600, verify = null, cache = true, config = {}, onFail = null }) {
  const ms = models.map(m => ({ tier: 'free', id: m.id || m.model, ...m }));
  if (!env.DB) {
    let last;
    for (const m of ms) { try { const r = await env.AI.run(m.model, { messages, ...(m.extra || {}), max_tokens: maxTokens }); return { text: String(r && (r.response ?? r.result) || ''), model: m.model, cached: false, routed: false }; } catch (e) { last = e; } }
    throw last || new Error('no model');
  }
  const r = await createRouter({ db: env.DB, ai: env.AI, models: ms, config, onFail }).call({ kind, messages, maxTokens, verify, cache });
  return { text: r.text, model: r.model, cached: !!r.cached, routed: true };
}
