// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Merged pull requests with their files, for the self-hosting measures (core/steward/measures.js, US-SPEC-20 s6). Read only, paged and
// bounded like githubTracker in stage2.js. `complete` is false whenever a bound cut the read short, so a count is never silently low.
// The token is read from `env` by name and sent only as an Authorization header; fetch is the host's.

export function githubPulls({ fetch, repo, env = {}, tokenEnv = 'VCS_TOKEN', apiBase = 'https://api.github.com', maxPages = 5, maxFilePages = 3, since = null }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ''))) throw new Error('pulls: repo must be "owner/name"');
  const call = async path => {
    const t = env[tokenEnv]; if (!t) throw new Error('pulls: token variable ' + tokenEnv + ' is not set');
    const res = await fetch(apiBase + '/repos/' + repo + path, { headers: { accept: 'application/vnd.github+json', authorization: 'Bearer ' + t, 'user-agent': 'ultrastable-steward' } });
    if (!res.ok) throw new Error('pulls: GET ' + path.split('?')[0] + ' -> http ' + res.status);
    return res.json();
  };
  const cutoff = since ? Date.parse(since) : null;
  return {
    name: 'github',
    async mergedPulls() {
      const out = []; let complete = false;
      outer: for (let page = 1; page <= maxPages; page++) {
        const batch = await call(`/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`);
        for (const p of batch) {
          if (cutoff !== null && Date.parse(p.updated_at) < cutoff) { complete = true; break outer; } // sorted by update time: nothing older can have merged inside the window
          if (!p.merged_at) continue;
          let files = [], filesComplete = false;
          for (let fp = 1; fp <= maxFilePages; fp++) {
            const f = await call(`/pulls/${p.number}/files?per_page=100&page=${fp}`);
            files.push(...f.map(x => x.filename));
            if (f.length < 100) { filesComplete = true; break; }
          }
          out.push({ number: p.number, author: p.user?.login || '', body: p.body || '', labels: (p.labels || []).map(l => l.name), files, files_complete: filesComplete, merged_at: p.merged_at });
        }
        if (batch.length < 100) { complete = true; break; }
      }
      return { prs: out, complete: complete && out.every(p => p.files_complete) };
    },
  };
}
