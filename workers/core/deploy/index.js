// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Canonical change path (US-SPEC-07 section 4): lock, version check, ledger, publish, probes, keep or revert.
// Ports: db (D1-style), deployer {publish, liveVersion, rollback, liveDigest?}, fetch, now, sleep, lock, killSwitch, authorize?, confidence?. No ambient state.
import { dbLock } from './lock.js';
import { runProbes, probeName } from './probes.js';

const iso = (ms) => new Date(ms).toISOString();
const DEFAULTS = { lockTtlMs: 300000, windowMs: 30000, intervalMs: 2000, breakerThreshold: 3 };

async function sha256Hex(body) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function createDeploy({ db, deployer, fetch: fetchPort, now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)),
  config = {}, env = {}, lock, killSwitch, probes = {}, authorize, confidence }) {
  const cfg = { ...DEFAULTS, ...config };
  const lockPort = lock || dbLock(db, now);
  const nowIso = () => iso(now());
  const first = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results;
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();

  // Strip any configured secret value from text before it is stored (presence only, never values).
  const scrub = (s) => Object.values(env).filter(v => typeof v === 'string' && v.length >= 4)
    .reduce((t, v) => t.split(v).join('[redacted]'), String(s ?? ''));

  async function ledger(row) {
    const r = await run(`INSERT INTO deploy_ledger (unit, actor, kind, status, reason, expected_version, from_version, to_version, artifact_sha256, started_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, row.unit ?? '', row.actor ?? 'unknown', row.kind ?? 'deploy', row.status, scrub(row.reason) || null,
      row.expectedVersion ?? null, row.fromVersion ?? null, row.toVersion ?? null, row.sha ?? null, nowIso());
    return r.meta.last_row_id;
  }
  async function finish(id, status, reason, extra = {}) {
    await run(`UPDATE deploy_ledger SET status=?, reason=?, to_version=COALESCE(?, to_version), finished_at=? WHERE id=?`,
      status, scrub(reason) || null, extra.toVersion ?? null, nowIso(), id);
    return { id, status, reason: scrub(reason) || null, ...extra };
  }
  async function refuse(base, reason, extra = {}) {
    const id = await ledger({ ...base, status: 'refused', reason });
    return finish(id, 'refused', reason, extra);
  }
  async function unitDef(unit) {
    const row = await first(`SELECT probes_json, mode FROM deploy_units WHERE unit=?`, unit);
    return { probes: probes[unit] ?? (row ? JSON.parse(row.probes_json) : []), mode: (row && row.mode) || 'revert' };
  }
  async function killed() {
    if (killSwitch && await killSwitch()) return true;
    const r = await first(`SELECT value FROM deploy_config WHERE key='kill_switch'`);
    return Boolean(r && r.value === 'on');
  }
  async function recordProbes(id, phase, results) {
    for (const p of results) await run(`INSERT INTO deploy_probe_results (ledger_id, phase, probe, ok, detail, at) VALUES (?,?,?,?,?,?)`,
      id, phase, scrub(p.probe), p.ok ? 1 : 0, scrub(p.detail), nowIso());
  }
  const probeCtx = { db, fetch: fetchPort };

  async function openGate(unit, what) {
    const r = await run(`INSERT INTO deploy_records (kind, unit, what, default_in_effect, closing_probe, created_at) VALUES ('gate',?,?,?,?,?)`,
      unit, scrub(what), 'deploys of this unit are refused until a person closes this record', 'manual', nowIso());
    return r.meta.last_row_id;
  }

  // US-05-T04, US-07-T05: a reverted deploy files a failure item in the work tracker (seed table `items`). Where the module
  // runs with its own tables only (config.fileItems = false) the record stays in deploy_ledger.
  async function fileFailureItem(unit, ledgerId, prior, attempted, why) {
    if (cfg.fileItems === false) return null;
    const itemId = `DEPLOYFAIL-${unit}-${ledgerId}`;
    const t = nowIso().replace('T', ' ').slice(0, 19);
    try {
      await run(`INSERT OR IGNORE INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, created_at, updated_at) VALUES (?,?,'fix',?,?,?,0,'ready',?,?)`,
        itemId, scrub(`Deploy of ${unit} ${attempted} reverted to ${prior}: ${why}`).slice(0, 300), cfg.ownerRole ?? 'operations',
        `a deploy of ${unit} is kept with every revert probe passing`,
        `SELECT COUNT(*) FROM deploy_ledger WHERE unit = '${String(unit).replace(/'/g, "''")}' AND kind = 'deploy' AND status = 'kept' AND id > ${Number(ledgerId)}`, t, t);
      return itemId;
    } catch (e) { // a store without the work tracker: the reason is kept on the ledger row, never dropped
      await run(`UPDATE deploy_ledger SET reason = reason || ? WHERE id=?`, scrub(`; failure item not filed: ${e && e.message}`).slice(0, 200), ledgerId);
      return null;
    }
  }

  // US-07-R13: compare what was published with what the platform serves. `expected` is a sha256 string, or a map { file: sha256 }.
  // The deployer's optional liveDigest(unit) answers with a string or a map. A pair of different shapes cannot be compared and is
  // skipped on the record, never read as a match; a live digest that cannot be read is a mismatch (it is retried inside the window).
  async function digestCheck(unit, expected) {
    if (typeof deployer.liveDigest !== 'function') return { state: 'skipped', detail: 'the deployer has no liveDigest', live: null };
    let live;
    try { live = await deployer.liveDigest(unit); } catch (e) { return { state: 'mismatch', detail: `error: ${e && e.message}`, live: null }; }
    if (live === null || live === undefined || live === '') return { state: 'mismatch', detail: 'the platform reported no live digest', live: null };
    const map = (v) => v !== null && typeof v === 'object';
    if (map(expected) !== map(live)) return { state: 'skipped', detail: 'the live digest and the artifact digest are of different shapes (one per file, one whole)', live };
    if (!map(expected)) return expected === live ? { state: 'match', detail: `live ${String(live).slice(0, 12)} equals published`, live } : { state: 'mismatch', detail: `live ${String(live).slice(0, 12)} differs from published ${String(expected).slice(0, 12)}`, live };
    const bad = Object.entries(expected).filter(([k, h]) => live[k] !== h).map(([k]) => k);
    return bad.length ? { state: 'mismatch', detail: `file digest differs: ${bad.slice(0, 5).join(', ')}`, live } : { state: 'match', detail: `${Object.keys(expected).length} file digest(s) equal`, live };
  }

  async function deploy({ unit, artifact, expectedVersion, actor, surface = 'runtime', action_class = 'deploy_production', confidence: stated, decision_type }) {
    const base = { unit, actor, expectedVersion };
    if (!unit || !artifact) return refuse(base, 'bad_request');
    base.sha = await sha256Hex(artifact.body ?? artifact.version ?? '');
    if (await killed()) return refuse(base, 'kill_switch');
    const gate = await first(`SELECT id FROM deploy_records WHERE kind='gate' AND unit=? AND status='open'`, unit);
    if (gate) return refuse(base, 'loop_breaker_open', { gate: gate.id });
    if (artifact.sha256 && artifact.sha256 !== base.sha) return refuse(base, 'artifact_digest_mismatch');
    // US-06-R25: an action on a policy surface is authorized before it executes; an authorizer that fails, or answers anything
    // but allowed, refuses (unknown is not allowed). A refusal is a ledger row with its reason, and nothing is published.
    if (authorize) {
      let a;
      try { a = await authorize({ surface, action_class, target: unit, executor: actor }); }
      catch (e) { return refuse(base, `unauthorized: the authorizer failed: ${e && e.message}`); }
      if (!a || a.allowed !== true) {
        return refuse(base, `unauthorized: ${(a && (a.reason || a.refused)) || 'not allowed'}`, { ...(a && a.gate_card ? { gate_card: a.gate_card } : {}), ...(a && a.next ? { next: a.next } : {}) });
      }
    }
    // US-05-R13: stated confidence that gates an autonomous deploy is the calibrated one. Without a reading, the deploy is refused.
    if (confidence) {
      let c;
      try { c = await confidence({ unit, actor, confidence: stated, decision_type }); }
      catch (e) { return refuse(base, `confidence_unavailable: ${e && e.message}`); }
      if (!c || c.allowed !== true) return refuse(base, `confidence_below_gate: stated ${c ? c.stated : stated}, corrected ${c ? c.corrected : 'unknown'}`);
    }

    const token = await lockPort.acquire(unit, actor ?? 'unknown', cfg.lockTtlMs);
    if (!token) return refuse(base, 'locked');
    try {
      const live = await deployer.liveVersion(unit);
      if (expectedVersion !== live) return refuse({ ...base, fromVersion: live }, `stale_version: expected ${expectedVersion}, live ${live}`);
      const id = await ledger({ ...base, fromVersion: live, status: 'started' });
      const def = await unitDef(unit);
      await recordProbes(id, 'before', await runProbes(def.probes, probeCtx, {}));

      let published;
      try { published = await deployer.publish(unit, artifact); }
      catch (e) { return finish(id, 'failed', 'publish_error: ' + (e && e.message)); }
      const newVersion = (published && published.version) ?? artifact.version ?? null;
      await run(`UPDATE deploy_ledger SET to_version=? WHERE id=?`, newVersion, id);

      // Keep only if every probe passes within the window. The artifact digest comparison (US-07-R13) is one more `after` probe.
      const deadline = now() + cfg.windowMs;
      const expectedDigest = artifact.files && typeof artifact.files === 'object' ? artifact.files
        : artifact.sha256 ? artifact.sha256 : artifact.body !== undefined ? base.sha : null;
      let after, dg = null;
      for (;;) {
        after = await runProbes(def.probes, probeCtx, { version: newVersion });
        if (expectedDigest) {
          dg = await digestCheck(unit, expectedDigest);
          if (dg.state !== 'skipped') after.push({ probe: 'artifact:digest', ok: dg.state === 'match', detail: dg.detail });
        }
        if (after.every(p => p.ok) || now() >= deadline) break;
        await sleep(cfg.intervalMs);
      }
      await recordProbes(id, 'after', after);
      let digestNote = '';
      if (dg) {
        try {
          await run(`INSERT INTO deploy_digest_checks (ledger_id, state, expected, live, detail, at) VALUES (?,?,?,?,?,?)`,
            id, dg.state, JSON.stringify(expectedDigest), dg.live === null ? null : JSON.stringify(dg.live), scrub(dg.detail), nowIso());
        } catch (e) { digestNote = `; artifact:digest ${dg.state} not recorded: ${String(e && e.message).slice(0, 80)}`; } // a store without migration 0003
      }
      // US-05-R09: a probe marked `revert: false` (it depends on a shared resource under load) is recorded but never reverts.
      const excluded = new Set(def.probes.filter(d => d.revert === false).map(probeName));
      const failedAll = after.filter(p => !p.ok);
      const failed = failedAll.filter(p => !excluded.has(p.probe));
      if (!failed.length) {
        return finish(id, 'kept', (failedAll.length ? 'excluded_probe_failed: ' + failedAll.map(p => p.probe).join(', ') : '') + digestNote || null, { toVersion: newVersion });
      }
      const why = 'probe_failed: ' + failed.map(p => p.probe).join(', ') + digestNote;
      if (def.mode === 'observe') return finish(id, 'kept', why + ' (observe mode)', { toVersion: newVersion });

      try { await deployer.rollback(unit, live); } catch { /* verified below */ }
      const nowLive = await deployer.liveVersion(unit).catch(() => null);
      if (nowLive !== live) {
        const g = await openGate(unit, `rollback of ${unit} to ${live} could not be verified (live: ${nowLive})`);
        return finish(id, 'failed', why + '; rollback_unverified', { gate: g });
      }
      const result = await finish(id, 'reverted', why);
      result.item = await fileFailureItem(unit, id, live, newVersion, why);
      const recent = await all(`SELECT status FROM deploy_ledger WHERE unit=? AND kind='deploy' AND status IN ('kept','reverted','failed') ORDER BY id DESC LIMIT ?`, unit, cfg.breakerThreshold);
      if (recent.length >= cfg.breakerThreshold && recent.every(r => r.status === 'reverted')) {
        result.gate = await openGate(unit, `${cfg.breakerThreshold} consecutive reverted deploys of ${unit}; last reason: ${why}`);
      }
      return result;
    } finally {
      await lockPort.release(unit, token);
    }
  }

  // Compare the live version with what the ledger says it should be; file a record when they differ.
  async function reconcile(unit) {
    const live = await deployer.liveVersion(unit);
    const last = await first(`SELECT status, from_version, to_version FROM deploy_ledger WHERE unit=? AND status IN ('kept','reverted','failed','unlogged') ORDER BY id DESC LIMIT 1`, unit);
    if (!last) return { unit, status: 'no_baseline', live };
    const expected = last.status === 'kept' || last.status === 'unlogged' ? last.to_version : last.from_version;
    if (expected === live) return { unit, status: 'consistent', live };
    const id = await ledger({ unit, actor: 'reconcile', kind: 'unlogged', status: 'unlogged', fromVersion: expected, toVersion: live,
      reason: `live version ${live} differs from ledger version ${expected}; change made outside the path` });
    await run(`UPDATE deploy_ledger SET finished_at=? WHERE id=?`, nowIso(), id);
    const r = await run(`INSERT INTO deploy_records (kind, unit, what, default_in_effect, closing_probe, created_at) VALUES ('unlogged',?,?,?,?,?)`,
      unit, `UNLOGGED mutation of ${unit}: ledger expected ${expected}, live is ${live}`, 'live version is now the baseline; review the change', 'manual', nowIso());
    return { unit, status: 'unlogged', expected, live, ledgerId: id, record: r.meta.last_row_id };
  }

  const ledgerRows = (unit, limit = 50) => unit
    ? all(`SELECT * FROM deploy_ledger WHERE unit=? ORDER BY id DESC LIMIT ?`, unit, limit)
    : all(`SELECT * FROM deploy_ledger ORDER BY id DESC LIMIT ?`, limit);

  async function closeGate(id) {
    await run(`UPDATE deploy_records SET status='closed', closed_at=? WHERE id=? AND kind='gate'`, nowIso(), id);
  }

  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  async function handle(request, ctx = {}) {
    const url = new URL(request.url);
    const want = (ctx.env ?? env)[cfg.tokenEnv ?? 'DEPLOY_TOKEN'];
    if (!want || request.headers.get('x-deploy-token') !== want) return json({ error: 'unauthorized' }, 401);
    if (request.method === 'POST' && url.pathname === '/deploy') {
      let body; try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
      const res = await deploy({ unit: body.unit, artifact: body.artifact, expectedVersion: body.expectedVersion, actor: body.actor,
        ...(body.surface ? { surface: body.surface } : {}), ...(body.action_class ? { action_class: body.action_class } : {}), confidence: body.confidence, decision_type: body.decision_type });
      return json(res, res.status === 'kept' ? 200 : res.status === 'refused' ? 409 : 502);
    }
    if (request.method === 'POST' && url.pathname === '/reconcile') {
      const body = await request.json().catch(() => ({}));
      return json(await reconcile(body.unit));
    }
    if (request.method === 'GET' && url.pathname === '/ledger') return json({ rows: await ledgerRows(url.searchParams.get('unit')) });
    return json({ error: 'not_found' }, 404);
  }

  return { deploy, reconcile, handle, ledger: ledgerRows, closeGate };
}

export { dbLock, runProbes };
export { createMergeGuard } from './mergeguard.js';
export { reviewersFromRouter } from './review-ports.js';
