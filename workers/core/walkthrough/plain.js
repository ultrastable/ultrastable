// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Plain words for the console screens (US-18-R06). The mapping is data (plain-words.json); this module only applies it. A role,
// surface, action class or rung with no entry still comes out as plain words (hyphens and underscores become spaces), never as an
// identifier. Item ids inside free text (blockers written by agents) are masked.
import WORDS from './plain-words.json' with { type: 'json' };

const humanize = s => String(s ?? '').replace(/[-_]+/g, ' ').trim();
// identifiers such as ELICIT-RERUN-DEMO-CHARTER, ASK-MI3X9A, FM-UNACCOUNTED: two or more capital letters, then a hyphen, then more of the id
const ID_RE = /\b[A-Z][A-Z0-9]+(?:-[A-Za-z0-9]+)+\b/g;

/** plain(kind, value) with kind role | rung | action ({surface, action_class} passed as value) | text. */
export function plain(kind, value) {
  if (kind === 'role') return WORDS.roles[value] || `the ${humanize(value)} role`;
  if (kind === 'rung') return WORDS.rungs[value] || humanize(value);
  if (kind === 'action') {
    const { surface, action_class } = value || {};
    return WORDS.actions[surface]?.[action_class] || `${humanize(action_class)} (${humanize(surface)})`;
  }
  if (kind === 'text') return String(value ?? '').replace(ID_RE, 'a work item').replace(/\s{2,}/g, ' ').trim();
  return humanize(value);
}
