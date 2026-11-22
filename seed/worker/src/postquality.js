// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// POST-QUALITY-1 (Rowan, 2026-11-22): a post that trails off mid-sentence, opens with a template, carries two links, or calls contested evidence
// "something that works" reads as AI slop and costs trust. This gate runs in the core publisher (social.js) before any send, for every tenant.
// Hard failures block the post (recorded as 'blocked' with the reasons, never truncated into shape); the author fixes the text, not the gate.
// Pure functions, no I/O. `grade` is the evidence grade a post states: 'strong' | 'mixed' | 'weak' | undefined (no evidence claim).
const URL_RE = /https?:\/\/[^\s)]+/g;
const OPENERS = /^\s*(something that works|exciting news|excited to|big news|did you know|unlock|discover|in today'?s|we'?re thrilled)/i;
const SLOP = /\b(delve|leverag(e|ing)|game[- ]chang\w*|revolutioni[sz]\w*|tapestry|landscape of|cutting[- ]edge|seamless\w*|it'?s not just)\b/i;
const OVERCLAIM = /\b(works|proven|proves|backed by (a )?(trial|review|evidence)|evidence[- ]backed|definitive\w*|solved)\b/i;
const HEDGE = /\b(contested|mixed|disputed|unclear|early|weak\w*|not settled|little effect|may|might|some evidence|limited)\b/i;
export const stripUrls = t => String(t).replace(URL_RE, '').replace(/[ \t]+\n/g, '\n').trim();
export const urlsOf = t => String(t).match(URL_RE) || [];
export function lintPost(text, { limit = 280, grade } = {}) {
  const t = String(text || ''), body = stripUrls(t), fails = [];
  if (!body) return ['empty'];
  if (t.length > limit) fails.push(`over ${limit} characters`);
  if (/(…|\.\.\.)\s*$/.test(body) || /(…|\.\.\.)\s*\n/.test(t)) fails.push('trails off with an ellipsis');
  if (!(urlsOf(t).length ? /[.!?:"”')]$/ : /[.!?"”')]$/).test(body)) fails.push('ends mid-sentence');
  if (new Set(urlsOf(t)).size > 1) fails.push('more than one link');
  if (OPENERS.test(body)) fails.push('templated opener');
  if (SLOP.test(body)) fails.push('stock AI phrasing');
  if (grade === 'mixed' || grade === 'weak') {
    if (OVERCLAIM.test(body.replace(/\b(does|did|may|might) not work\b/gi, ''))) fails.push(`overclaims for ${grade} evidence`);
    if (!HEDGE.test(body)) fails.push(`does not say the evidence is ${grade}`);
  }
  return fails;
}
// Longest-first: the first candidate that fits whole is used. Nothing is clipped; with no fit the caller gets null and drops or rewrites the post.
export const fitWhole = (candidates, limit) => candidates.map(c => String(c).replace(/\s+/g, ' ').trim()).filter(Boolean).find(c => c.length <= limit) || null;
