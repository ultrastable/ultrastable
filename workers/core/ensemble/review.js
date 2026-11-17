// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Status of every piece is kept in core/ensemble/README.md.
// Cross-vendor review of a code change before an agent merges it. Reviewers are pool members from vendors other than the model that wrote the change.
import { candidates, askPanel, reviewPrompt, parseReview, reviewDecision, flaggedIds } from './index.js';
import { askModel } from './routes.js';

const ALIAS = { 'mistral-ai': 'mistral', 'ai21-labs': 'ai21' };
export function vendorOfModel(model, cfg) {
  const hit = cfg.pool.find(m => m.model === model); if (hit) return hit.vendor;
  const v = String(model || '').replace(/^@cf\//, '').split('/')[0].toLowerCase(); return ALIAS[v] || v;
}
export async function crossReview({ title, diff, authorModel, secrets, fetch: f, cfg, ask, seed = 0 }) {
  const doAsk = ask || ((spec, prompt, max) => askModel({ fetch: f, secrets, spec, prompt, maxTokens: max }));
  const author = vendorOfModel(authorModel, cfg), health = {};
  const r = await askPanel({ cands: candidates({ cfg, seed, flagged: flaggedIds({}, cfg) }), want: cfg.review_panel, ask: doAsk, prompt: reviewPrompt(title, diff), parse: parseReview, cfg, excludeVendors: [author], health, maxTokens: 250 });
  const votes = r.got.map(g => ({ id: g.member.id, vendor: g.member.vendor, model: g.model, ...g.parsed }));
  return { ...reviewDecision(votes), votes, author_vendor: author, tried: r.tried };
}
