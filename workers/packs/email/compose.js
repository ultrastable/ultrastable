// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Newsletter composition from the claims registry (US-SPEC-21 s7, US-SPEC-22). The default writer is a deterministic template over fresh,
// public claims; a model may phrase through settings.ports.compose, and its output must still pass the checker, a function separate from
// the writer that rejects any sentence not backed by a claim, any number without a date and any link off the allowlist. A passing draft is
// only queued (email_messages); it leaves the organization through the send loop and guard.send, never from here.
import { publishableClaims, claimSentence, checkVoice } from '../../core/describe/index.js';
import { all, first, run, iso } from '../../core/kernel/util.js';
import { serviceFrom } from './loops.js';

const MARKER = /\s*\[claim:[A-Za-z0-9._-]+\]/g;
export const stripMarkers = s => String(s).replace(MARKER, '').replace(/[ \t]+\n/g, '\n').trim();
const URL_RE = /https?:\/\/[^\s<>()[\]"']+/g;
const hostAllowed = (host, allowlist) => allowlist.some(a => host === a || host.endsWith(`.${a}`));

export function cfg(settings = {}) {
  return { allowlist: [], link_url: null, claim_prefixes: null, repeat_days: 14, max_backlog: 3, max_sentences: 3, newsletter_subject: 'Latest updates', voiceRules: {}, ports: {}, ...settings };
}

// Marked text: one claim sentence per line, each with its [claim:id], and an optional link line.
export function defaultComposeNewsletter({ claims, maxSentences = 3, linkUrl = null }) {
  const picked = claims.slice(0, maxSentences).map(claimSentence);
  return picked.length ? picked.join('\n') + (linkUrl ? `\n${linkUrl}` : '') : '';
}

export function checkNewsletter(text, claims, { allowlist = [], voiceRules = {} } = {}) {
  const violations = [];
  const bad = (rule, detail) => violations.push({ rule, detail });
  text = String(text);
  for (const m of text.matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    let u; try { u = new URL(url); } catch { bad('url_invalid', url); continue; }
    if (u.protocol !== 'https:') bad('url_not_https', url); else if (!hostAllowed(u.hostname, allowlist)) bad('url_not_allowed', u.hostname);
  }
  const prose = text.split('\n').map(l => l.replace(URL_RE, 'link')).filter(l => l.trim() && l.trim() !== 'link');
  if (!prose.length) bad('no_claim', 'the newsletter has no claim-backed sentence');
  else for (const v of checkVoice(prose.join('\n'), claims, voiceRules).violations) bad(v.rule, `${v.detail}: ${String(v.sentence).slice(0, 80)}`);
  return { ok: violations.length === 0, violations };
}

export async function composeLoop({ db, ctx, now, settings, guard, secrets }) {
  const s = cfg(settings), t = now();
  const queued = (await first(db, `SELECT COUNT(*) AS n FROM email_messages WHERE status = 'queued' AND kind = 'newsletter'`)).n;
  if (queued >= s.max_backlog) { ctx?.notes?.push('email compose: backlog full'); return; }
  const claims = (await publishableClaims(db, t)).filter(c => !s.claim_prefixes || s.claim_prefixes.some(p => c.id.startsWith(p)));
  const used = new Set((await all(db, `SELECT DISTINCT claim_id FROM email_compose_log WHERE at >= ?`, iso(t - s.repeat_days * 86400e3))).map(r => r.claim_id));
  const fresh = claims.filter(c => !used.has(c.id));
  if (!fresh.length) { ctx?.notes?.push('email compose: no fresh claims'); return; }
  const compose = s.ports.compose || defaultComposeNewsletter;
  const raw = String(await compose({ claims: fresh.slice(0, s.max_sentences), maxSentences: s.max_sentences, linkUrl: s.link_url }) || '');
  let verdict = raw ? checkNewsletter(raw, claims, { allowlist: s.allowlist, voiceRules: s.voiceRules }) : { ok: false, violations: [{ rule: 'empty', detail: 'nothing composed' }] };
  if (verdict.ok && s.ports.checker) {
    try { verdict = await s.ports.checker(raw, claims, { allowlist: s.allowlist }); } catch (e) { verdict = { ok: false, violations: [{ rule: 'checker_error', detail: e.message }] }; }   // the second checker can only veto
  }
  if (!verdict.ok) {
    await run(db, `INSERT INTO email_compose_rejections (at, subject, body_text, violations) VALUES (?,?,?,?)`, iso(t), s.newsletter_subject, raw.slice(0, 2000), JSON.stringify(verdict.violations));
    ctx?.notes?.push(`email compose: rejected (${verdict.violations.map(v => v.rule).join(', ')})`);
    return;
  }
  const cited = [...new Set([...raw.matchAll(/\[claim:([A-Za-z0-9._-]+)\]/g)].map(m => m[1]))].sort();
  const q = await serviceFrom({ db, now, settings, guard, secrets }).queueMessage({ subject: s.newsletter_subject, text: stripMarkers(raw) });
  if (!q.ok) { ctx?.notes?.push(`email compose: not queued (${q.reason})`); return; }
  for (const id of cited) await run(db, `INSERT OR IGNORE INTO email_compose_log (message_id, claim_id, at) VALUES (?,?,?)`, q.messageId, id, iso(t));
  ctx?.notes?.push(`email compose: queued message ${q.messageId} from ${cited.length} claim(s)`);
}
