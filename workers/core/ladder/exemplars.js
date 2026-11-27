// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// L5 exemplar bank (US-SPEC-09 section 4): verified outputs kept per task class and retrieved by similarity, so a recurring class
// is answered from its own history at no model cost, or a cheap rung is shown the nearest solved examples. No training is
// involved. A small model trained offline on an organization's history stays PLANNED (it needs that history and a host).
// Ports: db, now, embed(texts) -> number[][] (optional; without it the lookup is lexical, by token overlap, and serves only with a validate).
import { iso, msOf, all, run, first } from './util.js';
import { unit, dot } from '../connect/index.js';
import { recordAttempt } from './index.js';
import { cacheKey } from './cache.js';

export const DEFAULTS = { per_class: 200, threshold: 0.9, max_chars: 4000 };
const norm = t => String(t).replace(/\s+/g, ' ').trim();
const SECRET = /(sk-[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:api[_-]?key|secret|password|token)\s*[:=]\s*\S{6,})/i;
// Every token counts, the short ones included: 'order 42' and 'order 43' differ only in a token of two characters.
const tokens = t => new Set(norm(t).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean));
const numbers = t => [...tokens(t)].filter(w => /\d/.test(w)).sort().join(' ');
const jaccard = (a, b) => { let i = 0; for (const x of a) if (b.has(x)) i++; return a.size + b.size - i ? i / (a.size + b.size - i) : 0; };

/** Store a verified outcome. An unverified output and an input that looks like a secret are refused. Keeps the newest `per_class`. */
export async function recordExemplar(ctx, { task_class, input, output, verified, cost = 0 }) {
  if (verified !== true) return { stored: false, reason: 'only a verified outcome becomes an exemplar' };
  const text = norm(input), out = typeof output === 'string' ? output : JSON.stringify(output);
  if (SECRET.test(text) || SECRET.test(out)) return { stored: false, reason: 'looks like a secret' };
  const t = msOf(ctx.now ?? Date.now), max = ctx.max_chars ?? DEFAULTS.max_chars;
  let emb = null;
  if (typeof ctx.embed === 'function') emb = JSON.stringify(Array.from(unit((await ctx.embed([text]))[0])).map(x => Math.round(x * 1e5) / 1e5));
  // The row key is the SHA-256 of the normalized input, as for the L1 cache: a 32-bit hash plus a length let two different inputs
  // share a row, so the second answer was stored under the first input and served for it at no model cost. The input is written
  // on conflict too, so a row never pairs one input with another input's answer.
  await run(ctx.db, `INSERT INTO ladder_exemplars (task_class, input_hash, input, output, embedding, cost, at) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(task_class, input_hash) DO UPDATE SET input=excluded.input, output=excluded.output, embedding=excluded.embedding, cost=excluded.cost, at=excluded.at`,
    task_class, await cacheKey(text), text.slice(0, max), out.slice(0, max), emb, cost, iso(t));
  await run(ctx.db, `DELETE FROM ladder_exemplars WHERE task_class = ? AND id NOT IN (SELECT id FROM ladder_exemplars WHERE task_class = ? ORDER BY at DESC, id DESC LIMIT ?)`, task_class, task_class, ctx.per_class ?? DEFAULTS.per_class);
  return { stored: true };
}

/** The k nearest exemplars of a class: [{ input, output, similarity }]. */
export async function nearest(ctx, { task_class, input, k = 3 }) {
  const rows = await all(ctx.db, `SELECT input, output, embedding FROM ladder_exemplars WHERE task_class = ?`, task_class);
  if (!rows.length) return [];
  const text = norm(input), q = typeof ctx.embed === 'function' ? unit((await ctx.embed([text]))[0]) : null, qt = tokens(text);
  return rows.map(r => ({ input: r.input, output: r.output, similarity: q && r.embedding ? dot(q, JSON.parse(r.embedding)) : jaccard(qt, tokens(r.input)) }))
    .sort((a, b) => b.similarity - a.similarity).slice(0, k);
}

/**
 * Serve an answer from the bank as an L5 attempt at no model cost: the nearest exemplar must be at or above `threshold`, must
 * carry exactly the same numbers as the input (a stored answer for order 42 is never served for order 43) and
 * `validate(output, input)` must pass. Without an embedder the similarity is lexical and says nothing about meaning, so a caller
 * must supply `validate` to serve at all ('lexical_needs_validate'); lexical retrieval alone is for few-shot examples.
 * Otherwise { served: false } and the caller goes on to the cascade.
 */
export async function serve(ctx, { task_id, task_class, input, threshold = ctx.threshold ?? DEFAULTS.threshold, validate }) {
  if (typeof ctx.embed !== 'function' && typeof validate !== 'function') return { served: false, reason: 'lexical_needs_validate' };
  const [best] = await nearest(ctx, { task_class, input, k: 1 });
  if (!best || best.similarity < threshold) return { served: false, reason: best ? 'below_threshold' : 'empty_bank' };
  if (numbers(best.input) !== numbers(input)) return { served: false, reason: 'numbers_differ', similarity: best.similarity };
  if (typeof validate === 'function' && !(await validate(best.output, input))) return { served: false, reason: 'validation_failed', similarity: best.similarity };
  await recordAttempt(ctx.db, { task_id, task_class, layer: 'L5', model: 'exemplar-bank', cost: 0, verified: true, signal: null }, iso(msOf(ctx.now ?? Date.now)));
  return { served: true, layer: 'L5', output: best.output, similarity: best.similarity, cost: 0 };
}

/** Examples to put before a cheap rung's prompt: [{ input, output }]. */
export async function fewShot(ctx, { task_class, input, k = 3 }) {
  return (await nearest(ctx, { task_class, input, k })).map(({ input: i, output }) => ({ input: i, output }));
}

export const exemplarCount = async (db, task_class) => (await first(db, `SELECT COUNT(*) AS n FROM ladder_exemplars WHERE task_class = ?`, task_class)).n;
