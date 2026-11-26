// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-02-R12: every role instruction file carries a "never" list that names at least three things: acting on another
// agent's live claim, handling secret values, and reviewing one's own work. This module is the checker. It reads text
// through a port (no file system here); the instruction files themselves are protected paths and change by a reviewed change.

// Each required entry has an id and the wordings that satisfy it. A bullet satisfies an entry when one of its patterns matches.
export const NEVER_REQUIRED = [
  { id: 'live-claim', re: [/\banother (agent|worker|persona)'?s?\b.{0,40}\b(live )?claim/i, /\bunder (another|someone else'?s?|an?other agent'?s?)\b.{0,30}\bclaim/i, /\b(live|held) claim\b.{0,40}\b(another|other)\b/i] },
  { id: 'secrets', re: [/\bsecret values?\b/i, /\b(handle|handling|print|paste|commit|log|read)\b.{0,30}\b(a |the )?(secret|token|password|key)s?\b/i] },
  { id: 'own-work', re: [/\breview(ing)?\b.{0,20}\b(your|one'?s|its|their|his|her|own)\b.{0,10}\bown\b.{0,10}\b(work|change|output)/i, /\breview(ing)?\b.{0,15}\bown work\b/i, /\breview(ing)? (yourself|oneself|itself)\b/i] },
];

// The bullets under the "## Never" heading. The section ends at the next heading, a blockquote or the first line of a
// generated block, so a rule written elsewhere in the file does not count for the list.
export function parseNever(text) {
  const lines = String(text ?? '').split(/\r?\n/);
  const at = lines.findIndex(l => /^#{1,6}\s*never\b/i.test(l.trim()));
  if (at < 0) return { has_section: false, bullets: [] };
  const bullets = [];
  for (const raw of lines.slice(at + 1)) {
    const l = raw.trim();
    if (/^#{1,6}\s/.test(l) || l.startsWith('>') || l.startsWith('<!--')) break;
    const m = /^[-*]\s+(.*\S)/.exec(l);
    if (m) bullets.push(m[1]);
    else if (bullets.length && l && !/^\d+[.)]\s/.test(l)) bullets[bullets.length - 1] += ` ${l}`; // a wrapped bullet continues
  }
  return { has_section: true, bullets };
}

// -> { ok, has_section, missing: [entry ids], bullets: n }
export function checkRoleInstruction(text, { required = NEVER_REQUIRED } = {}) {
  const { has_section, bullets } = parseNever(text);
  const missing = has_section ? required.filter(r => !bullets.some(b => r.re.some(re => re.test(b)))).map(r => r.id) : required.map(r => r.id);
  return { ok: has_section && missing.length === 0, has_section, missing, bullets: bullets.length };
}

// Check a set of instruction files through ports: list() -> [path], readFile(path) -> text. One result per file; a file that
// cannot be read is a failure with its reason, never a pass (US-00 evidence rule).
export async function checkRoleFiles({ list, readFile, required = NEVER_REQUIRED } = {}) {
  if (typeof list !== 'function' || typeof readFile !== 'function') throw new Error('checkRoleFiles needs list and readFile ports');
  const out = [];
  for (const path of await list()) {
    let text;
    try { text = await readFile(path); } catch (e) { out.push({ path, ok: false, has_section: false, missing: required.map(r => r.id), error: `cannot read: ${e.message}` }); continue; }
    out.push({ path, ...checkRoleInstruction(text, { required }) });
  }
  return out;
}
