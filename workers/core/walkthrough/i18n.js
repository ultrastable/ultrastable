// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The console's language (US-SPEC-18 section 6): the fixed strings of the page are keyed in messages.json; a person's language applies a dictionary of the same keys.
// A key the dictionary lacks, a dictionary that is not an object, and a language with no dictionary all fall back to English one string at a time, so a language can
// never remove a button or a list. Right-to-left languages set the page direction. Producing a dictionary is core/i18n's job (translateBatch through a model port).
import MESSAGES from './messages.json' with { type: 'json' };

export const ENGLISH = MESSAGES.messages;
const RTL = new Set(['ar', 'he', 'fa', 'ur', 'ps', 'sd', 'yi', 'dv']);
export const dirFor = lang => (RTL.has(String(lang || 'en').toLowerCase().split('-')[0]) ? 'rtl' : 'ltr');

/** The table the page uses for a language: English, overlaid with the dictionary's own strings for keys English has (an unknown key or a non-string value is ignored). */
export function messagesFor(lang = 'en', dictionaries = {}) {
  const base = String(lang || 'en').toLowerCase(), short = base.split('-')[0];
  const dict = dictionaries?.[lang] || dictionaries?.[base] || dictionaries?.[short];
  const out = { ...ENGLISH };
  let translated = 0;
  if (dict && typeof dict === 'object') for (const k of Object.keys(ENGLISH)) if (typeof dict[k] === 'string' && dict[k].trim()) { out[k] = dict[k]; translated++; }
  return { lang: lang || 'en', dir: dirFor(lang), messages: out, translated, total: Object.keys(ENGLISH).length };
}
/** t(table, key, vars): the string for a key with {name} placeholders filled. */
export const t = (table, key, vars = {}) => String((table?.messages || ENGLISH)[key] ?? ENGLISH[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => (n in vars ? String(vars[n]) : `{${n}}`));
