// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// From what a person said to the rows a preview organization starts with. Pure text in, SQL out.
// The person's words are stored verbatim (US-SPEC-16 R07); nothing here interprets or rewrites them.

const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

export function slugify(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  return s || 'my-org';
}

/** Validate and normalize what the page collected. Throws a plain-words Error on a problem. */
export function cleanIdea({ idea, outcomes, limit }) {
  const text = String(idea || '').trim();
  if (text.length < 10) throw new Error('Please say a little more about what you want (at least a sentence).');
  if (text.length > 2000) throw new Error('Please keep it under 2000 characters; you can add detail later.');
  const outs = (Array.isArray(outcomes) ? outcomes : []).map(o => String(o || '').trim()).filter(Boolean).slice(0, 5);
  if (!outs.length) outs.push('Something I can see working');
  const lim = Number(limit || 0);
  if (!Number.isFinite(lim) || lim < 0 || lim > 1000) throw new Error('The monthly limit must be between 0 and 1000.');
  return { idea: text, outcomes: outs.map(o => o.slice(0, 200)), limit: lim };
}

/** SQL for a preview organization: org facts, one item per outcome, and the decision cards a preview always has. */
export function buildSeedSql({ idea, outcomes, limit }, { orgName, slug, now = new Date().toISOString() }) {
  const out = [];
  const org = (k, v) => out.push(`INSERT OR REPLACE INTO org (key, value) VALUES (${q(k)}, ${q(v)});`);
  org('org_name', orgName); org('slug', slug); org('idea', idea); org('budget_usd_per_month', String(limit)); org('created_via', 'web launcher (preview)'); org('created_at', now);
  outcomes.forEach((o, i) => {
    out.push(`INSERT OR IGNORE INTO items (id, title, kind, project, owner_role, done_check, closing_probe, priority, status) VALUES (${q(`OUT-${i + 1}`)}, ${q(o)}, 'work', ${q(`outcome-${i + 1}`)}, 'product-manager', ${q('You can see it working and it has been checked by someone other than the one who built it')}, 'manual', ${20 + i}, 'open');`);
  });
  const card = (id, what, why, def, probe) => out.push(`INSERT OR IGNORE INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES (${q(id)}, ${q(what)}, ${q(why)}, ${q(def)}, ${q('The preview is online so you can see it, its key is set and its heartbeat runs every 5 minutes.')}, ${q(probe)});`);
  card('CLAIM', 'Keep this preview: sign in to Cloudflare, or create a free account, using the private link you were given', 'Only you can sign in or create an account in your name', 'The preview is deleted automatically after about an hour', 'manual');
  card('HEARTBEAT', 'Keep the heartbeat going after the first hour: the preview already wakes itself every 5 minutes, and keeping it lets it carry on', 'A preview is deleted after about an hour; only you can keep it by signing in', 'The heartbeat stops when the preview is deleted, and the console you saw stays as a record of this hour', 'manual');
  if (limit > 0) card('LIMIT', `Approve spending up to ${limit} USD a month on AI models`, 'Spending is yours to approve', 'Spending stays at zero and only free models are used', 'manual');
  return out.join('\n') + '\n';
}

/** US-19-R11: once the address is known, the two cards a person closes by keeping the preview carry a machine probe instead of 'manual'. The probe is
 *  the grammar core/runner/ownerwatch.js evaluates (`http:<url>` is true when a plain GET answers 2xx). A preview behind Cloudflare's safety page
 *  answers automated clients with a refusal until it is claimed, so the probe stays false until then. One statement; the address holds no secret. */
export function claimProbeSql(url) {
  return `UPDATE gate_cards SET closing_probe = ${q(`http:${url}/health`)} WHERE id IN ('CLAIM', 'HEARTBEAT');`;
}
