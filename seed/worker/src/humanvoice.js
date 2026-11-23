// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// HUMAN-VOICE-1 (Rowan, 2026-11-23): "Make all writing sound human. Everything." The one voice for every system: VOICE goes into every prose model
// call (routeChat adds it), lintVoice fails AI-sounding text before it ships (routeChat retries once with a rewrite; postquality blocks a post).
// The list mirrors doctrine/human-voice.json; test/humanvoice.test.js fails when they drift. Pure functions, no I/O.
export const VOICE = "Write like a person, not a press release. Use plain words and short sentences. Give one specific detail instead of a list. No buzzwords (leverage, seamless, robust, cutting-edge, unlock, empower, delve, game-changer, transformative, holistic, synergy). No 'not just X but Y'. No three-item lists for rhythm. No em-dashes. No stock opener such as 'In today's world' or 'Great question', and no summary closer such as 'In conclusion' or 'Overall'. Say the thing, then stop.";
export const PHRASES = ["leverage", "leveraging", "leverages", "delve", "delving", "seamless", "seamlessly", "robust", "cutting-edge", "cutting edge", "game-changer", "game changer", "game-changing", "revolutionize", "revolutionizing", "unlock", "unlocks", "unlocking", "empower", "empowers", "empowering", "synergy", "synergies", "holistic", "tapestry", "paradigm shift", "transformative", "ever-evolving", "harness the power", "elevate your", "navigate the complexities", "in today's", "it's worth noting", "it is worth noting", "in conclusion", "in summary", "furthermore", "moreover", "great question", "i hope this helps", "let's dive in", "dive into", "testament to", "a world where", "autonomous platform", "next-level", "supercharge", "streamline your", "unleash"];
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, "['’]");
const PHRASE_RE = new RegExp('\\b(' + PHRASES.map(esc).join('|') + ')\\b', 'gi');
const NOT_JUST = /\b(it'?s |is |are |was )?not (just|only|merely) [^.!?\n]{1,60}?,? (but|it'?s)\b/i;
const OPENER = /^\s*(great question|in today'?s|imagine a|ever wondered|picture this|let'?s dive|here'?s the thing)/i;
const CLOSER = /(^|\n|[.!?]\s+)(in (conclusion|summary|short)|overall|ultimately|to sum up)[,:]/i;
const TRIPLET = /\b[a-z][\w-]*, [a-z][\w-]*,? and [a-z][\w-]*\b/gi;
// Returns a list of plain-word reasons; empty means it reads as human. Code and URLs are ignored.
export function lintVoice(text) {
  const t = String(text || '').replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, ''), out = [];
  const hits = [...new Set((t.match(PHRASE_RE) || []).map(x => x.toLowerCase()))];
  if (hits.length) out.push('stock AI phrasing: ' + hits.slice(0, 5).join(', '));
  if (NOT_JUST.test(t)) out.push("'not just X but Y'");
  if (OPENER.test(t)) out.push('stock opener');
  if (CLOSER.test(t)) out.push('summary closer');
  if ((t.match(/—/g) || []).length > 1) out.push('em-dash chain');
  if ((t.match(TRIPLET) || []).length > 1) out.push('tidy three-item lists');
  return out;
}
export const human = t => lintVoice(t).length === 0;
// Puts VOICE first in a chat's system message (once).
export function withVoice(messages) {
  const ms = (messages || []).slice();
  if (ms.some(m => m.role === 'system' && String(m.content).includes(VOICE))) return ms;
  const i = ms.findIndex(m => m.role === 'system');
  if (i >= 0) ms[i] = { ...ms[i], content: VOICE + '\n\n' + ms[i].content }; else ms.unshift({ role: 'system', content: VOICE });
  return ms;
}
export function rewriteMessages(messages, draft, reasons) {
  return [...withVoice(messages), { role: 'assistant', content: draft }, { role: 'user', content: `Rewrite that so a person could have written it. Fix: ${reasons.join('; ')}. Keep every fact. Reply with the rewrite only.` }];
}
