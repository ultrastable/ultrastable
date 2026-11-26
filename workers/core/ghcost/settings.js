// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// core/ghcost: the organization and repository settings of US-SPEC-24 section 7.4 as a probe with read-back and an apply that
// changes nothing unless asked (US-24-R30 to R34). Ports: ctx.github with orgWorkflowPermissions, setOrgWorkflowPermissions,
// forkApproval, setForkApproval, repo, patchRepo (all in ./github.js or a fake). A setting that cannot be read is `unknown`,
// never `pass`. A write the platform refuses (HTTP 403) is recorded and left as a gate card with its default in effect; it is
// not retried on another route (the platform applies repository settings through its administration App, see the spec).
import { iso, nowMs, cfg, fileItem, closeItem, openCard, recordProbe } from './util.js';

const SQUASH_ONLY = { allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false, delete_branch_on_merge: true };
const slug = k => String(k).replace(/[^\w.-]/g, '-');
const msg = e => String(e?.message || e).slice(0, 200);

/** Read every setting; each row is { key, result: pass|fail|unknown, evidence, fix }. `fix` is the call settingsApply would make. */
export async function readSettings(ctx) {
  const c = cfg(ctx), s = c.settings || {}, rows = [];
  const accepted = s.fork_policies || ['all_external_contributors'];
  const add = (key, result, evidence, fix = null) => rows.push({ key, result, evidence, fix });
  const guard = async (key, fn) => { try { await fn(); } catch (e) { add(key, 'unknown', msg(e)); } };

  await guard('default_workflow_permissions', async () => {
    const p = await ctx.github.orgWorkflowPermissions();
    if (p?.default_workflow_permissions == null) return add('default_workflow_permissions', 'unknown', 'response has no default_workflow_permissions');
    const fix = { call: 'setOrgWorkflowPermissions', args: [{ default_workflow_permissions: 'read', can_approve_pull_request_reviews: false }] };
    add('default_workflow_permissions', p.default_workflow_permissions === 'read' ? 'pass' : 'fail', `default token ${p.default_workflow_permissions}`, fix);
    if (p.can_approve_pull_request_reviews == null) add('can_approve_pull_request_reviews', 'unknown', 'response has no can_approve_pull_request_reviews');
    else add('can_approve_pull_request_reviews', p.can_approve_pull_request_reviews === false ? 'pass' : 'fail', `workflows can approve pull requests: ${p.can_approve_pull_request_reviews}`, fix);
  });
  await guard('fork_approval', async () => {
    const f = await ctx.github.forkApproval();
    const policy = f?.approval_policy ?? f?.policy;
    if (!policy) return add('fork_approval', 'unknown', 'response has no approval policy');
    add('fork_approval', accepted.includes(policy) ? 'pass' : 'fail', `fork approval policy ${policy}`, { call: 'setForkApproval', args: [accepted[0]] });
  });
  const repos = c.repos || Object.keys(c.budget?.per_repo || {});
  for (const repo of repos) {
    await guard(`merge:${repo}`, async () => {
      const r = await ctx.github.repo(repo);
      const bad = Object.entries(SQUASH_ONLY).filter(([k, v]) => r?.[k] !== v).map(([k]) => k);
      add(`merge:${repo}`, bad.length ? 'fail' : 'pass', bad.length ? `not as required: ${bad.join(', ')}` : 'squash merge only, branch deleted on merge', { call: 'patchRepo', args: [repo, SQUASH_ONLY] });
      if (typeof s.discussions === 'boolean') { // R33 is a MAY: only judged when the configuration states a wish
        add(`discussions:${repo}`, r?.has_discussions === s.discussions ? 'pass' : 'fail', `has_discussions ${r?.has_discussions}, wanted ${s.discussions}`, { call: 'patchRepo', args: [repo, { has_discussions: s.discussions }] });
      }
    });
  }
  return rows;
}

/** Probe: record every row and file or close `GHCOST-SETTINGS-<key>` (priority 20). */
export async function settingsProbe(ctx) {
  const ts = iso(nowMs(ctx)), rows = await readSettings(ctx);
  for (const r of rows) {
    await recordProbe(ctx.db, `settings:${r.key}`, r.result, r.evidence, ts);
    const id = `GHCOST-SETTINGS-${slug(r.key)}`;
    if (r.result === 'fail') await fileItem(ctx.db, { id, title: `Setting ${r.key} is not as the specification requires: ${r.evidence}`, done_check: `the platform reads back the required value for ${r.key}`, closing_probe: `ghcost_probes: latest probe='settings:${r.key}' is pass`, priority: 20 }, ts);
    else if (r.result === 'pass') await closeItem(ctx.db, id, r.evidence, ts);
  }
  return { rows, failing: rows.filter(r => r.result === 'fail').map(r => r.key), unknown: rows.filter(r => r.result === 'unknown').map(r => r.key) };
}

/**
 * Apply (US-24-R34): without `apply` it returns the planned calls and makes none. With it, each call runs once, a refusal is
 * recorded, and every changed setting is read back; a row that does not read back as required is `unverified`.
 */
export async function settingsApply(ctx, { apply = false } = {}) {
  const ts = iso(nowMs(ctx)), before = await readSettings(ctx);
  const seen = new Set(), planned = [];
  for (const r of before.filter(x => x.result === 'fail' && x.fix)) {
    const k = JSON.stringify(r.fix); if (seen.has(k)) continue; seen.add(k); planned.push({ keys: before.filter(x => x.fix && JSON.stringify(x.fix) === k && x.result === 'fail').map(x => x.key), ...r.fix });
  }
  if (!apply) return { applied: false, planned, refused: [], unverified: [] };
  const refused = [];
  for (const p of planned) {
    try { await ctx.github[p.call](...p.args); }
    catch (e) {
      refused.push({ call: p.call, keys: p.keys, error: msg(e) });
      await recordProbe(ctx.db, `settings_write:${p.call}`, 'fail', msg(e), ts);
      if (/http 40[13]/.test(msg(e))) {
        await openCard(ctx.db, { id: 'GATE-GHCOST-SETTINGS-WRITE', what: `The platform refused the settings write ${p.call} (${p.keys.join(', ')})`,
          why_gated: 'Organization Actions permissions need an organization Administration permission that this credential does not hold; no other route is tried with a different credential (US-SPEC-06).',
          default_in_effect: 'Settings stay as they are; the lane merges on the built-in token and the probe keeps reading them.', closing_probe: `ghcost_probes: latest probe='settings:${p.keys[0]}' is pass` });
      }
    }
  }
  const after = await readSettings(ctx);
  const unverified = after.filter(r => r.result !== 'pass' && before.some(b => b.key === r.key && b.result === 'fail')).map(r => r.key);
  for (const r of after) await recordProbe(ctx.db, `settings:${r.key}`, r.result, r.evidence, ts);
  return { applied: true, planned, refused, unverified };
}

/**
 * Run the probe when it is due: opt-in with config.ghcost.settings.enabled, every `settings.every_ticks` ticks (default 144,
 * daily at a 10-minute tick). Called from the existing `ghcost_watchdog` step, so the tick gains no step of its own.
 */
export async function settingsDue(ctx, tick) {
  const s = cfg(ctx).settings;
  if (!s?.enabled || tick.tickId % (s.every_ticks || 144) !== 0) return null;
  return settingsProbe(ctx);
}
