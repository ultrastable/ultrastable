// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// core/modelservice: a keyless model route for any Ultrastable system (MODELSERVICE-1). A CI run of the named repository proves itself with its
// own GitHub OIDC token (no stored secret); the Worker verifies it and runs its Workers AI binding with a model from the allow-list.
// Tenants pass configuration only (audience, repository, allow-list, default model); the code is the same everywhere.
import { verifyOidc } from '../auth/actions-oidc.js';

// Workers AI models answer in several shapes: { response }, { result }, OpenAI-style { choices: [{ message: { content } }] }, or
// output[].content[].text. Every shape is read so a model is never scored "empty" for its format.
const choice = o => o?.choices?.[0]?.message?.content ?? o?.choices?.[0]?.text;
const outputText = o => Array.isArray(o?.output) ? o.output.flatMap(x => Array.isArray(x?.content) ? x.content : []).map(c => c?.text || '').join('') : '';
export function textOf(out) {
  const r = out && (out.response ?? out.result ?? choice(out) ?? (outputText(out) || undefined));
  return (r && typeof r === 'object' ? (choice(r) ?? JSON.stringify(r)) : String(r ?? '')).trim();
}
// A reasoning model can spend its whole budget thinking and return no answer; such a reply is retried once with a larger budget.
const truncated = out => (out?.choices?.[0]?.finish_reason === 'length') || (out?.usage && !textOf(out));

// DISCOVER-1: `${path}/embed` turns up to `maxTexts` texts into vectors with an allow-listed embedding model (default the first of `embedAllow`),
// behind the same OIDC check, so a CI run can keep a system's vector index current without holding a key.
export const EMBED_ALLOW = ['@cf/baai/bge-small-en-v1.5', '@cf/baai/bge-base-en-v1.5', '@cf/baai/bge-m3'];
export function createModelService({ audience, repository, allow = [], defaultModel, path = '/llm', maxPrompt = 40000, maxTokens = 4000, verify = verifyOidc, embedAllow = EMBED_ALLOW, maxTexts = 100 }) {
  if (!audience || !repository || !defaultModel) throw new Error('modelservice needs audience, repository and defaultModel');
  return {
    async fetch(request, env) {
      const { pathname } = new URL(request.url);
      if (pathname === '/health') return Response.json({ ok: true, ai: Boolean(env.AI), models: allow.length });
      const embedPath = pathname === path + '/embed';
      if (pathname !== path && !embedPath) return new Response('not found\n', { status: 404 });
      if (request.method !== 'POST') return new Response('POST only\n', { status: 405 });
      if (!env.AI || !env.AI.run) return Response.json({ error: 'no_ai_binding' }, { status: 503 });
      const v = await verify((request.headers.get('authorization') || '').replace(/^Bearer /, ''), { audience, repository });
      if (!v.ok) return Response.json({ error: 'forbidden', reason: v.reason }, { status: 403 });
      const b = await request.json().catch(() => null);
      if (embedPath) {
        const texts = b && Array.isArray(b.texts) ? b.texts : null;
        if (!texts || !texts.length || texts.length > maxTexts || texts.some(t => typeof t !== 'string' || t.length > 8000)) return Response.json({ error: 'bad_request' }, { status: 400 });
        const model = embedAllow.includes(b.model) ? b.model : embedAllow[0];
        try {
          const out = await env.AI.run(model, { text: texts });
          const data = out && (out.data || (out.response && out.response.data));
          if (!Array.isArray(data) || data.length !== texts.length) return Response.json({ error: 'model_error', model, detail: 'no vectors in the reply' }, { status: 502 });
          return Response.json({ model, dim: data[0].length, vectors: data });
        } catch (e) { return Response.json({ error: 'model_error', model, detail: String(e?.message || e).slice(0, 300) }, { status: 502 }); }
      }
      if (!b || typeof b.prompt !== 'string' || b.prompt.length > maxPrompt) return Response.json({ error: 'bad_request' }, { status: 400 });
      const model = allow.includes(b.model) ? b.model : defaultModel;
      const want = Math.min(Number(b.max_tokens) || 600, maxTokens);
      const run = n => env.AI.run(model, { messages: [{ role: 'user', content: b.prompt }], max_tokens: n });
      try {
        let out = await run(want);
        if (truncated(out) && want < maxTokens) out = await run(maxTokens);
        return Response.json({ text: textOf(out), model });
      } catch (e) {
        // the model's own error text comes back to the caller (it is the platform's message, never a secret) so the ensemble can record why
        return Response.json({ error: 'model_error', model, detail: String(e?.message || e).slice(0, 300) }, { status: 502 });
      }
    },
  };
}
