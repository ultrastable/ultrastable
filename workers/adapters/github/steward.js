// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Issue-ledger steward: mirrors work items to every configured sink and flags items that break the item format.
// Ports: ctx = { db, now(), config, sinks }. sinks is an ORDERED LIST of { name, upsert(item, prevRef) -> { ref } }: each item goes to
// EVERY sink independently (no single route), a failing sink is recorded per item and retried next sweep, and never blocks the others.
import { mirror as coreMirror, hygiene as coreHygiene } from '../../core/steward/index.js';

// US-SPEC-20 R11 / J-23: one implementation of the mirror, the item hash and the hygiene rule, in core/steward/index.js. This adapter
// used to carry its own copy, which could drift from the core's; it now re-exports them (an adapter may import core, never the reverse).
/** Hygiene: an item must carry an owner role, a done check and a closing probe (docs item format). */
export const hygiene = coreHygiene;

/** Push every changed item to every sink (core/steward mirror). `limit` is the batch size, as before. */
export async function mirror(ctx, { limit = 50 } = {}) {
  return coreMirror({ ...ctx, config: { ...(ctx.config || {}), batch: limit } });
}

/** Sink 1: GitHub issues over REST. Token read from env at request time, never stored or logged. */
export function githubSink({ fetch, repo, env = {}, tokenEnv = 'VCS_TOKEN', apiBase = 'https://api.github.com' }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) throw new Error('steward: repo must be "owner/name"');
  const call = async (method, path, body) => {
    const t = env[tokenEnv]; if (!t) throw new Error('steward: token variable ' + tokenEnv + ' is not set');
    const res = await fetch(apiBase + '/repos/' + repo + path, { method, headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + t, 'content-type': 'application/json', 'user-agent': 'ultrastable-steward' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error('steward: ' + method + ' ' + path + ' -> http ' + res.status);
    return res.json();
  };
  const text = it => '**' + it.id + '**\n\nOwner role: ' + it.owner_role + '\nDone check: ' + it.done_check + '\nClosing probe: ' + (it.closing_probe || '(missing)') + '\nDisposition: ' + (it.disposition || '-');
  return {
    name: 'github',
    async upsert(it, prev) {
      const state = ['done', 'superseded', 'cancelled'].includes(it.status) ? 'closed' : 'open';
      if (prev) { await call('PATCH', '/issues/' + prev, { title: it.title, body: text(it), state }); return { ref: prev }; }
      const r = await call('POST', '/issues', { title: it.title, body: text(it) });
      if (state === 'closed') await call('PATCH', '/issues/' + r.number, { state });
      return { ref: String(r.number) };
    },
  };
}
/** Sink 2: plain files (portable, no network): the port writes one JSON record per item. */
export const fileSink = ({ writeFile, dir = 'items' }) => ({ name: 'file', async upsert(it) { const p = dir + '/' + it.id + '.json'; await writeFile(p, JSON.stringify(it, null, 2)); return { ref: p }; } });

/** Merge host for core/codeloop over the same REST API. */
export function githubMergeHost({ fetch, repo, env = {}, tokenEnv = 'VCS_TOKEN', apiBase = 'https://api.github.com' }) {
  return { name: 'github', async merge({ pr, method = 'squash' }) {
    const t = env[tokenEnv]; if (!t) throw new Error('merge: token variable ' + tokenEnv + ' is not set');
    const res = await fetch(apiBase + '/repos/' + repo + '/pulls/' + pr + '/merge', { method: 'PUT', headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + t, 'content-type': 'application/json', 'user-agent': 'ultrastable-codeloop' }, body: JSON.stringify({ merge_method: method }) });
    if (res.ok) return { merged: true };
    return { merged: false, reason: 'http ' + res.status };
  } };
}
