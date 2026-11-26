// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// REPO-STANDARD-1 (Rowan, 2026-11-25: "even the repos aren't being created correctly. They don't have the right merge rules ... standardized and
// consistent"): the one repository standard, as the tick Worker applies it with the administration app it already holds. The JSON between the
// markers is the `worker` block of github/repo-standard.json in the core; `python3 -m foundation repostd --check` fails when the two differ.
// applyStandard is called from the same code path that creates a repository (ensureTenantRepo, ensureAppRepo) and from /host/repo-settings, so a
// repository is standard from its first minute and is put back when it drifts. Every step records GitHub's answer; a refused step makes ok false
// and names the step, so nothing is skipped quietly.
export const REPO_STANDARD = /*repo-standard:begin*/{
  "settings": {
    "has_wiki": false,
    "allow_squash_merge": true,
    "allow_merge_commit": false,
    "allow_rebase_merge": false,
    "allow_auto_merge": true,
    "allow_update_branch": true,
    "delete_branch_on_merge": true,
    "squash_merge_commit_title": "PR_TITLE",
    "squash_merge_commit_message": "PR_BODY"
  },
  "security": {
    "vulnerability_alerts": true,
    "secret_scanning": "enabled",
    "secret_scanning_push_protection": "enabled"
  },
  "ruleset": {
    "name": "main-no-rewrite",
    "target": "branch",
    "enforcement": "active",
    "conditions": {
      "ref_name": {
        "include": [
          "~DEFAULT_BRANCH"
        ],
        "exclude": []
      }
    },
    "rules": [
      {
        "type": "deletion"
      },
      {
        "type": "non_fast_forward"
      }
    ],
    "bypass_actors": []
  },
  "private_plan_gated": [
    "allow_auto_merge",
    "security",
    "ruleset"
  ]
}/*repo-standard:end*/;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').slice(0, n);
const TOPIC = /^[a-z0-9][a-z0-9-]{0,49}$/;
// What the caller may ask for beyond the standard: a description, a homepage, topics, and (only for a repository the core's data names) public.
export function metadataOf(spec = {}) {
  const m = {};
  if (typeof spec.description === 'string' && spec.description.trim()) m.description = clean(spec.description, 300);
  if (typeof spec.homepage === 'string' && /^https:\/\/[a-z0-9.-]+(\/[^\s]*)?$/i.test(spec.homepage)) m.homepage = spec.homepage.slice(0, 200);
  const topics = Array.isArray(spec.topics) ? [...new Set(spec.topics.map(t => String(t).toLowerCase()).filter(t => TOPIC.test(t)))].slice(0, 20) : null;
  return { fields: m, topics: topics && topics.length ? topics : null, makePublic: spec.visibility === 'public' };
}
// A is (method, path, body) => {status, json} with the administration app's token. live is GET /repos/{repo}.
export async function applyStandard(A, repo, live, spec = {}) {
  const S = REPO_STANDARD, out = { repo, changed: [], steps: [], refused: [], gated: [] };
  if (live.archived) return { ...out, ok: true, archived: true };
  const { fields, topics, makePublic } = metadataOf(spec);
  const willBePrivate = !!live.private && !makePublic;
  const want = { ...S.settings, ...fields, ...(live.private && makePublic ? { private: false } : {}) };
  if (willBePrivate) for (const k of S.private_plan_gated) if (k in want) { delete want[k]; out.gated.push(k); }
  const drift = Object.fromEntries(Object.entries(want).filter(([k, v]) => (live[k] == null ? '' : live[k]) !== v && !(k === 'private' && live.private === false)));
  const step = (name, r, okStatus) => { const ok = okStatus.includes(r.status); out.steps.push(`${name}: HTTP ${r.status}`); if (!ok) out.refused.push(`${name}: HTTP ${r.status} ${clean(r.json && r.json.message, 120)}`.trim()); return ok; };
  if (Object.keys(drift).length) { if (step('settings ' + Object.keys(drift).join(','), await A('PATCH', `/repos/${repo}`, drift), [200])) out.changed.push(...Object.keys(drift)); }
  if (topics) {
    const have = Array.isArray(live.topics) ? [...live.topics].sort().join(',') : null;
    if (have !== [...topics].sort().join(',')) { if (step('topics', await A('PUT', `/repos/${repo}/topics`, { names: topics }), [200])) out.changed.push('topics'); }
  }
  // GH-ONLY-1: a system that runs on GitHub alone asks for Pages built by its own workflow (spec.pages === 'workflow'). A repository's own
  // GITHUB_TOKEN is refused this call, so the administration app turns it on once; an existing site is left as it is.
  if (spec.pages === 'workflow') {
    const pg = await A('GET', `/repos/${repo}/pages`);
    if (pg.status === 404) { if (step('pages', await A('POST', `/repos/${repo}/pages`, { build_type: 'workflow' }), [201])) out.changed.push('pages'); }
    else if (pg.status === 200 && pg.json && pg.json.build_type !== 'workflow') { if (step('pages build_type', await A('PUT', `/repos/${repo}/pages`, { build_type: 'workflow' }), [204])) out.changed.push('pages_build_type'); }
    else if (pg.status !== 200) step('pages read', pg, [200]);
  }
  if (willBePrivate) { for (const k of ['security', 'ruleset']) if (S.private_plan_gated.includes(k)) out.gated.push(k); return { ...out, ok: !out.refused.length }; }
  if (S.security.vulnerability_alerts) { const seen = await A('GET', `/repos/${repo}/vulnerability-alerts`); if (seen.status !== 204) { if (step('vulnerability alerts', await A('PUT', `/repos/${repo}/vulnerability-alerts`), [204])) out.changed.push('vulnerability_alerts'); } }
  const sa = live.security_and_analysis || {}, sec = {};
  for (const k of ['secret_scanning', 'secret_scanning_push_protection']) if (S.security[k] && (sa[k] || {}).status !== S.security[k]) sec[k] = { status: S.security[k] };
  if (Object.keys(sec).length) { if (step('secret scanning', await A('PATCH', `/repos/${repo}`, { security_and_analysis: sec }), [200])) out.changed.push(...Object.keys(sec)); }
  const rs = await A('GET', `/repos/${repo}/rulesets`);
  if (rs.status !== 200 || !Array.isArray(rs.json)) step('read rulesets', rs, []);
  else if (!rs.json.some(r => r.name === S.ruleset.name && r.enforcement === 'active')) {
    const old = rs.json.find(r => r.name === S.ruleset.name);
    if (step('ruleset ' + S.ruleset.name, old ? await A('PUT', `/repos/${repo}/rulesets/${old.id}`, S.ruleset) : await A('POST', `/repos/${repo}/rulesets`, S.ruleset), [200, 201])) out.changed.push('ruleset');
  }
  return { ...out, ok: !out.refused.length };
}
