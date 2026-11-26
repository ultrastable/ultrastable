// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Adapter for GitHub Models, the free rung of the ladder (US-SPEC-09 section 4, L3): an OpenAI-shaped chat completions API on the
// code host, reached with the repository's own token. Three lessons from the executor ladder (foundation/agents.py, which this
// mirrors) are part of the adapter: the request carries a named user agent, because the edge answers an unnamed client with a stub
// (MODELS-UA-1); an over-long prompt is cut to its head and tail instead of being refused (FREE-LLM-1); and a 200 answer that is not
// JSON from the user endpoint is read again on the organization endpoint (MODELS-ORG-1). The key is read by name at call time.
export const kind = 'github_models';

const BASE = 'https://models.github.ai';
const UA = 'ultrastable-router/1';
const HEAD = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': UA };

/** Keep the head (instructions) and the tail (latest turn) of an over-long prompt within `cap` characters; fewer characters pass unchanged. */
export function fit(messages, cap) {
  const list = (messages || []).map(m => ({ ...m, content: String(m.content ?? '') }));
  const total = list.reduce((n, m) => n + m.content.length, 0);
  if (!cap || total <= cap) return list;
  const text = list.map(m => m.content).join('\n'), head = Math.floor(cap * 2 / 3);
  const cut = text.slice(0, head) + "\n[... trimmed to fit this model's request limit ...]\n" + text.slice(-(cap - head - 60));
  return [{ role: list[list.length - 1]?.role || 'user', content: cut }];
}

function body(provider, model, req) {
  const b = { model: model.id, messages: fit(req.messages, provider.max_prompt_chars), max_tokens: req.max_tokens };
  if (req.tools) b.tools = req.tools;
  if (req.json) b.response_format = { type: 'json_object' };
  return JSON.stringify(b);
}
const build = (url, provider, model, req, key) => ({ url, init: { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key, ...HEAD }, body: body(provider, model, req) } });

export function buildRequest(provider, model, req, key) {
  return build(String(provider.base_url || BASE).replace(/\/+$/, '') + '/inference/chat/completions', provider, model, req, key);
}
/** The organization endpoint, used when the user endpoint answers 200 with something that is not a completion. Needs provider.org. */
export function fallbackRequest(provider, model, req, key) {
  if (!provider.org) return null;
  return build(`${String(provider.base_url || BASE).replace(/\/+$/, '')}/orgs/${encodeURIComponent(provider.org)}/inference/chat/completions`, provider, model, req, key);
}
export const shouldFallback = json => !json || !Array.isArray(json.choices) || !json.choices.length;

export function parseResponse(json) {
  const msg = json?.choices?.[0]?.message || {};
  return { text: msg.content ?? '', tool_calls: msg.tool_calls || [], tokens_in: Number(json?.usage?.prompt_tokens) || 0, tokens_out: Number(json?.usage?.completion_tokens) || 0,
    resolved_model: typeof json?.model === 'string' ? json.model : null };
}
