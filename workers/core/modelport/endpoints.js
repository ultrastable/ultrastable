// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// More model routes shaped as core/modelport endpoints, async ({ model, messages, max_tokens }) => { text, tokens_in, tokens_out } (US-SPEC-14 section 3,
// Models row: "managed model endpoint by project and region"). Both take fetch and a token as ports; neither reads a secret from anywhere else, and
// neither puts the token in an error. They sit beside githubModelsEndpoint and workersAiEndpoint in core/ignorance/models.js and are used the same way.
//  - vertexEndpoint: Gemini on Vertex AI by project and location, through the generateContent REST route (the route platform/core/ultrastable/agents.py VertexAgent uses).
//  - openAiCompatibleEndpoint: any inference endpoint that speaks the chat-completions shape (a self-hosted server, a gateway).
const est = s => Math.ceil(String(s || '').length / 4);
const redact = (s, token) => String(s ?? '').split(token || '\u0000').join('[token]').slice(0, 160);
const tokenOf = async t => (typeof t === 'function' ? t() : t);

/** Messages in the chat shape to Vertex contents: system turns become systemInstruction, assistant becomes model. */
export function toVertexBody(messages = [], max_tokens = 900) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
  const contents = messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content ?? '') }] }));
  return { contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), generationConfig: { maxOutputTokens: max_tokens, temperature: 0 } };
}

export function vertexEndpoint({ fetch: doFetch = globalThis.fetch, project, location, tokenProvider, apiBase } = {}) {
  return async ({ model, messages, max_tokens = 900 }) => {
    if (!project) throw new Error('Vertex needs a project');
    if (!location) throw new Error('Vertex needs a location');
    const token = await tokenOf(tokenProvider);
    if (!token) throw new Error('no token for Vertex');
    const base = apiBase || `https://${location}-aiplatform.googleapis.com`;
    const url = `${base}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
    const res = await doFetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(toVertexBody(messages, max_tokens)) });
    const raw = await res.text(); let j = null;
    try { j = JSON.parse(raw); } catch { /* not JSON: reported below */ }
    if (!res.ok) throw new Error(`Vertex answered ${res.status}: ${redact(j?.error?.message || raw, token)}`);
    const text = (j?.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (!text) throw new Error(`Vertex returned no text${j?.candidates?.[0]?.finishReason ? ` (${j.candidates[0].finishReason})` : ''}`);
    const u = j.usageMetadata || {};
    return { text, tokens_in: Number.isFinite(u.promptTokenCount) ? u.promptTokenCount : est(JSON.stringify(messages)), tokens_out: Number.isFinite(u.candidatesTokenCount) ? u.candidatesTokenCount : est(text) };
  };
}

export function openAiCompatibleEndpoint({ fetch: doFetch = globalThis.fetch, url, tokenProvider } = {}) {
  return async ({ model, messages, max_tokens = 900 }) => {
    if (!url) throw new Error('no url for the inference endpoint');
    const token = await tokenOf(tokenProvider);
    const res = await doFetch(url, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, max_tokens, temperature: 0 }) });
    const raw = await res.text(); let j = null;
    try { j = JSON.parse(raw); } catch { /* not JSON */ }
    if (!res.ok) throw new Error(`the inference endpoint answered ${res.status}: ${redact(j?.error?.message || raw, token)}`);
    const text = j?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('the inference endpoint returned no completion');
    return { text, tokens_in: j.usage?.prompt_tokens ?? est(JSON.stringify(messages)), tokens_out: j.usage?.completion_tokens ?? est(text) };
  };
}
