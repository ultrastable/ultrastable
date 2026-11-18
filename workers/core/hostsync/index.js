// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// HOSTSYNC-1 (Rowan, 2026-11-18): the repository and every system that hosts an Ultrastable system stay one state. Repo to host: what was
// deployed is recorded as expected, and a host that no longer matches it is redeployed. Host to repo: the host's live runtime state (module hash,
// binding names, cron schedules, workers.dev, compatibility) is written back into the repository as data. Names only: no secret value, binding
// value or variable text is ever read, kept or written. Tenant-agnostic: a host is any adapter { id, observe(script) -> state }.
const j = v => JSON.stringify(v);
const names = a => (a || []).map(b => (typeof b === 'string' ? b : b.name)).sort();

/** Keep only the fields the contract allows; a stray value or text field cannot pass through. */
export function sanitize(s) {
  if (!s) return null;
  return {
    script: s.script, found: !!s.found, sha256: s.sha256 || null,
    bindings: (s.bindings || []).map(b => ({ type: String(b.type), name: String(b.name) })).sort((a, b) => (a.name + a.type).localeCompare(b.name + b.type)),
    crons: (s.crons || []).slice().sort(), workers_dev: s.workers_dev == null ? null : !!s.workers_dev,
    domains: (s.domains || []).slice().sort(), routes: (s.routes || []).slice().sort(),
    migrations: Object.fromEntries(Object.entries(s.migrations || {}).map(([k, v]) => [k, (v || []).map(String)])),
    compat_date: s.compat_date || null, compat_flags: (s.compat_flags || []).slice().sort(),
    deployment: s.deployment ? { id: s.deployment.id, created_on: s.deployment.created_on } : null,
    read_errors: (s.read_errors || []).slice(),
  };
}

/**
 * Compare what the repository says should be live (desired: { sha256?, crons?, bindings?: [names], workers_dev? }) with what the host reports.
 * Every difference is one item with a direction: 'repo-to-host' (the host must be redeployed from the repository) or 'host-to-repo' (the host
 * holds state the repository does not declare; the snapshot records it and a change to the declaration closes it).
 */
export function diff(desired, observed) {
  const out = [], script = (observed && observed.script) || (desired && desired.script);
  if (!observed || !observed.found) return [{ script, field: 'found', expected: true, observed: false, direction: 'repo-to-host' }];
  const d = desired || {};
  if (d.sha256 && d.sha256 !== observed.sha256) out.push({ script, field: 'sha256', expected: d.sha256, observed: observed.sha256, direction: 'repo-to-host' });
  if (d.crons && j([...d.crons].sort()) !== j(observed.crons)) out.push({ script, field: 'crons', expected: [...d.crons].sort(), observed: observed.crons, direction: 'repo-to-host' });
  if (d.bindings) {
    const want = names(d.bindings), have = names(observed.bindings);
    const missing = want.filter(n => !have.includes(n)), extra = have.filter(n => !want.includes(n));
    if (missing.length) out.push({ script, field: 'bindings', expected: want, observed: have, missing, direction: 'repo-to-host' });
    if (extra.length) out.push({ script, field: 'bindings', expected: want, observed: have, extra, direction: 'host-to-repo' });
  }
  for (const f of ['domains', 'routes']) if (d[f] && j([...d[f]].sort()) !== j(observed[f] || [])) out.push({ script, field: f, expected: [...d[f]].sort(), observed: observed[f] || [], direction: 'repo-to-host' });
  // D1 migrations: every migration the repository ships (desired.migrations: { databaseId: [names] }) must be applied on the host.
  for (const [db, want] of Object.entries(d.migrations || {})) {
    const have = (observed.migrations || {})[db];
    if (!have) { out.push({ script, field: 'migrations', database: db, observed: null, direction: 'repo-to-host' }); continue; }
    const missing = want.filter(n => !have.includes(n));
    if (missing.length) out.push({ script, field: 'migrations', database: db, missing, direction: 'repo-to-host' });
  }
  if (typeof d.workers_dev === 'boolean' && observed.workers_dev !== null && d.workers_dev !== observed.workers_dev) out.push({ script, field: 'workers_dev', expected: d.workers_dev, observed: observed.workers_dev, direction: 'repo-to-host' });
  return out;
}

/**
 * One reconciliation pass over every declared script.
 *   host: adapter { id, observe(script) }                 declared: { scripts: { name: desired } }
 *   write(path, text) puts a file in the repository       read(path) -> text|null       record(event) -> audit trail
 *   redeploy(script, items) asks the repository's deploy route to deploy it again (a workflow dispatch, a gateway call)
 * Returns { state, drift, redeployed, wrote }. A script that cannot be read is drift, never silently absent.
 */
export async function reconcile({ host, declared, write, read, record = async () => {}, redeploy = null, now = () => new Date().toISOString(), path = 'ops/hosting/state.json' }) {
  const scripts = {}, drift = [], redeployed = [];
  for (const script of Object.keys(declared.scripts || {})) {
    let obs;
    try { obs = sanitize(await host.observe(script)); } catch (e) { obs = { script, found: false, read_errors: [String(e.message || e).slice(0, 200)] }; }
    scripts[script] = obs;
    const items = diff({ script, ...declared.scripts[script] }, obs);
    if (obs.read_errors && obs.read_errors.length && !obs.found) items.push({ script, field: 'read', observed: obs.read_errors, direction: 'repo-to-host' });
    drift.push(...items);
    for (const it of items) await record({ kind: 'host-drift', host: host.id, subject: script, summary: it.field + ' ' + it.direction, data: it });
    const toHost = items.filter(i => i.direction === 'repo-to-host' && i.field !== 'read');
    if (toHost.length && redeploy) {
      try { await redeploy(script, toHost); redeployed.push(script); await record({ kind: 'host-redeploy', host: host.id, subject: script, summary: 'redeploy requested', data: { fields: toHost.map(i => i.field) } }); }
      catch (e) { await record({ kind: 'host-redeploy-failed', host: host.id, subject: script, summary: String(e.message || e).slice(0, 200) }); }
    }
  }
  const state = { host: host.id, scripts };
  const text = JSON.stringify(state, null, 1) + '\n';
  const before = read ? await read(path) : null;
  const wrote = before !== text;
  if (wrote) { await write(path, text); await record({ kind: 'host-state', host: host.id, subject: path, summary: 'runtime state written back to the repository', data: { scripts: Object.keys(scripts).length, at: now() } }); }
  return { state, drift, redeployed, wrote };
}
