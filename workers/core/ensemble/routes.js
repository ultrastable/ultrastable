// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Status of every piece is kept in core/ensemble/README.md.
// Route adapters for the free, keyless model routes: GitHub Models on a run's own token, and Workers AI through a tenant's model Worker on the run's OIDC token.
export const DEFAULT_WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
// Ask one named pool member (worker/src/ensemble-config.js). Never throws. The model that really answered is returned, because a route may serve another
// (an older model Worker serves one fixed model); the ensemble counts the vendor that really answered.
export async function askModel({ fetch: f = globalThis.fetch, secrets = {}, spec, prompt, maxTokens = 400 }) {
  try {
    if (spec.route === 'github-models') {
      const tok = secrets.GITHUB_MODELS_TOKEN || secrets.GITHUB_TOKEN; if (!tok) return { ok: false, error: 'no token' };
      const r = await f('https://models.github.ai/inference/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', authorization: `Bearer ${tok}` },
        body: JSON.stringify({ model: spec.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0 }) });
      if (!r.ok) return { ok: false, error: `HTTP ${r.status} ${String(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 90)}`.trim() };
      const j = await r.json(), text = String(j.choices?.[0]?.message?.content || '').trim();
      return text ? { ok: true, text, model: spec.model } : { ok: false, error: 'empty' };
    }
    if (spec.route === 'workers-ai') {
      if (!(secrets.PS_LLM_URL && secrets.ACTIONS_ID_TOKEN_REQUEST_URL && secrets.ACTIONS_ID_TOKEN_REQUEST_TOKEN)) return { ok: false, error: 'no oidc route' };
      const t = await f(`${secrets.ACTIONS_ID_TOKEN_REQUEST_URL}&audience=${secrets.LLM_AUDIENCE || 'tenant-llm'}`, { headers: { authorization: `Bearer ${secrets.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` } });
      if (!t.ok) return { ok: false, error: `oidc HTTP ${t.status}` };
      const { value } = await t.json();
      const r = await f(secrets.PS_LLM_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${value}` }, body: JSON.stringify({ prompt, max_tokens: maxTokens, model: spec.model }) });
      if (!r.ok) return { ok: false, error: `worker-ai HTTP ${r.status}` };
      const j = await r.json();
      return j.text ? { ok: true, text: j.text, model: j.model || DEFAULT_WORKERS_AI_MODEL } : { ok: false, error: 'empty' };
    }
    return { ok: false, error: 'unknown route' };
  } catch (e) { return { ok: false, error: String(e.message).slice(0, 80) }; }
}
