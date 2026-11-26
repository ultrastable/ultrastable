// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The five self-hosting measures of US-SPEC-20 s6, computed from a list of merged pull requests (US-20-R02, R03, R04, R07, R18).
// The record rules are a port of tools/selfhost_check.py (the authority); core/steward/selfhost-contract.test.js runs both on the same
// bodies and requires the same verdicts. A value whose input is absent or incompletely read is `null` with a reason in
// `not_measured`, never 0 (NO-FABRICATION-1): zero is a reading, and an absent reading is not one.
//
//   measures({ prs, complete, now, window_days, execution, spec_truth })
//     prs:        [{ number, author, body, labels, files, merged_at }]  merged pull requests (adapters/github/pulls.js githubPulls)
//     complete:   false when the read was bounded before the end: nothing is then measured
//     execution:  { merged, traced } merged changes and those that trace to a tick-dispatched item (core/steward/stage.js reads them)
//     spec_truth: the count of false BUILT lines (tools/spec_truth.py), when the host has it

export const PROTECTED = [
  'AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.github/', '.cursor/', 'autonomy/', 'self/', 'SCOPE.md', 'LICENSE',
  'COMMERCIAL-TERMS.md', 'core/test/no-qnfo.test.js', 'agents/CONTRACT.md', 'tools/selfhost_check.py', 'tools/spec_truth.py',
  'tools/sync_agent_files.py', 'tools/sync_agent_bootstrap.py', 'tools/self_closed_lint.py',
];
export const EXEMPT_AUTHORS = ['dependabot[bot]', 'github-actions[bot]'];

const PREDICTION = /^[A-Za-z_][\w.]*\s*(>=|<=|>|<|=)\s*-?\d+(\.\d+)?\s+within\s+\d+\s*h\b/i;
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function field(body, name) {
  const m = new RegExp(`^\\s*[-*]?\\s*\\**${esc(name)}\\**:[ \\t]*(.+?)[ \\t]*$`, 'im').exec(body || '');
  return m ? m[1].trim() : null;
}
export const isPlaceholder = v => v === null || v === undefined || !String(v).trim() || /^([<[].*[>\]]|todo|tbd|\.\.\.|-)$/i.test(String(v).trim());
export const party = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const under = (f, p) => f === p || (p.endsWith('/') && f.startsWith(p));
export const protectedFiles = files => (files || []).filter(f => PROTECTED.some(p => under(f, p)));

/** The record problems of a pull request (the rules of tools/selfhost_check.py check()). An empty list is a complete record. */
export function recordProblems(body, author, files = [], labels = []) {
  if (EXEMPT_AUTHORS.includes(String(author || '').toLowerCase())) return [];
  const problems = [];
  const item = field(body, 'Item');
  if (isPlaceholder(item) || !/(#\d+|github\.com\/[^\s]+\/issues\/\d+)/.test(item || '')) problems.push('Item');
  const spec = field(body, 'Spec');
  if (isPlaceholder(spec) || !/US-\d{2}-R\d+|US-SPEC-\d+|n\/a/i.test(spec || '')) problems.push('Spec');
  const pred = field(body, 'Prediction');
  if (isPlaceholder(pred) || !(PREDICTION.test(pred || '') || /^n\/a\b.{3,}/i.test(pred || ''))) problems.push('Prediction');
  const ev = field(body, 'Evidence');
  if (isPlaceholder(ev) || (ev || '').length < 12 || !/\d/.test(ev || '')) problems.push('Evidence');
  const a = field(body, 'Author'), r = field(body, 'Reviewer');
  if (isPlaceholder(a)) problems.push('Author');
  if (isPlaceholder(r)) problems.push('Reviewer');
  else if (!isPlaceholder(a) && party(a) === party(r)) problems.push('Reviewer');
  if (protectedFiles(files).length) {
    const why = field(body, 'Protected-change');
    if (isPlaceholder(why) || (why || '').length < 12) problems.push('Protected-change');
    const ls = (labels || []).map(l => String(l).toLowerCase());
    if (!ls.includes('human-reviewed') && !ls.includes('protected-change')) problems.push('label');
  }
  return problems;
}

const asNumber = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const ratio = (n, d) => (d > 0 ? n / d : null);

export function measures({ prs, complete = true, now, window_days = 30, execution = null, spec_truth = null } = {}) {
  const not_measured = {};
  const out = { contract_coverage: null, spec_truth: null, execution_ratio: null, self_review_rate: null, protected_change_reviews: null, window_days, merged: null, not_measured };
  const cutoff = (now === undefined ? Date.now() : (typeof now === 'function' ? now() : Number(now))) - window_days * 86400000;
  if (!Array.isArray(prs)) {
    for (const k of ['contract_coverage', 'self_review_rate', 'protected_change_reviews']) not_measured[k] = 'the pull request list is absent';
  } else if (!complete) {
    for (const k of ['contract_coverage', 'self_review_rate', 'protected_change_reviews']) not_measured[k] = 'the pull request read was bounded before its end, so any count would understate';
  } else {
    const merged = prs.filter(p => p.merged_at && Date.parse(p.merged_at) >= cutoff);
    out.merged = merged.length;
    if (!merged.length) {
      for (const k of ['contract_coverage', 'self_review_rate']) not_measured[k] = 'no merged pull request in the window';
      out.protected_change_reviews = 0; // a count over an empty, completely read window is a true zero
    } else {
      const own = merged.filter(p => !EXEMPT_AUTHORS.includes(String(p.author || '').toLowerCase()));
      out.contract_coverage = ratio(merged.filter(p => recordProblems(p.body, p.author, p.files, p.labels).length === 0).length, merged.length);
      out.self_review_rate = ratio(own.filter(p => { const a = field(p.body, 'Author'), r = field(p.body, 'Reviewer'); return !isPlaceholder(a) && !isPlaceholder(r) && party(a) === party(r); }).length, own.length);
      if (own.length === 0) { out.self_review_rate = null; not_measured.self_review_rate = 'every merged pull request in the window is from an exempt author'; }
      out.protected_change_reviews = own.filter(p => {
        if (!protectedFiles(p.files).length) return false;
        const ls = (p.labels || []).map(l => String(l).toLowerCase());
        const why = field(p.body, 'Protected-change');
        return isPlaceholder(why) || (why || '').length < 12 || !(ls.includes('protected-change') || ls.includes('human-reviewed'));
      }).length;
    }
  }
  const sp = asNumber(spec_truth);
  if (sp === null) not_measured.spec_truth = 'tools/spec_truth.py has not been read'; else out.spec_truth = sp;
  const m = asNumber(execution?.merged), t = asNumber(execution?.traced);
  if (m === null || t === null) not_measured.execution_ratio = 'no merged-and-traced counts supplied';
  else if (m === 0) not_measured.execution_ratio = 'no merged change in the window';
  else out.execution_ratio = t / m;
  return out;
}
