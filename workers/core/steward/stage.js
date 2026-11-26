// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The self-hosting ladder as a computation (US-SPEC-20 s4, US-20-R10..R13, T20-6). A stage is never declared: it is read from
// evidence the organization recorded itself. Stage k holds only when its own evidence holds and every stage below it holds (R12),
// so losing a lower stage's evidence lowers the stage. A stage is *claimed* only when a probe its author did not write confirms it
// (R11). The published stage (the contract's text) may never exceed the computed one (R13).
//
// This is the repository-process ladder (stages 0..4). The seeded system's own ladder (unseeded..self-sustaining) is computed by
// seed/worker/src/ignition.js and is the model for the rules above; this module does not touch it.
//
// Pure of platform: ports are `db` (D1-shaped), `now()`, `probes` and `config`. Nothing here reads a network or a file.
//   probes.contract()  -> { record_check: { green, merged }, false_built }       stage 1 (CI record check, tools/spec_truth.py)
//   probes.stage2()    -> { result: 'pass'|'fail'|'unknown', reason? }           stage 2 (adapters/github/stage2.js stage2Probe)
//   probes.account()   -> { ok, detail? }                                        stage 3 (the self-hosted Worker answers its health)
//   config: { window_days = 14, min_ticks = 6, min_execution_ratio = 1, start_rung = 'observed',
//             stage_authors: { 1..4 }, probe_authors: { 1..4 } }
// Every stage reports { ok, unknown, why, numbers }. A probe that is absent or throws is unknown, never ok.

const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const nowMs = ctx => { const v = typeof ctx.now === 'function' ? ctx.now() : ctx.now; return v instanceof Date ? v.getTime() : Number(v ?? Date.now()); };
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const hasTable = async (db, name) => Boolean(await first(db, `SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name=?`, name));

export const STAGES = [0, 1, 2, 3, 4];

const unknown = why => ({ ok: false, unknown: true, why, numbers: {} });
const verdict = (ok, why, numbers = {}) => ({ ok: Boolean(ok), unknown: false, why, numbers });

async function guarded(fn, what) {
  try { return await fn(); } catch (e) { return unknown(`${what} could not be read: ${String(e?.message || e).slice(0, 160)}`); }
}

/** Stage 1: every merged pull request passes the record check, and spec truth reports no false BUILT. */
async function stage1(probes) {
  if (typeof probes.contract !== 'function') return unknown('no contract probe supplied (the CI record check results and tools/spec_truth.py)');
  return guarded(async () => {
    const c = await probes.contract();
    const green = Number(c?.record_check?.green), merged = Number(c?.record_check?.merged), fb = Number(c?.false_built);
    if (![green, merged, fb].every(Number.isFinite)) return unknown('the contract probe returned no numbers');
    if (merged === 0) return unknown('no merged pull request to read the record check from');
    const ok = green === merged && fb === 0;
    return verdict(ok, ok ? `every merged pull request passed the record check; no false BUILT` : `${merged - green} merged pull request(s) without a passing record check, ${fb} false BUILT line(s)`, { green, merged, false_built: fb });
  }, 'the contract probe');
}

/** Stage 2: items in the store match open issues. An unreadable tracker is unknown, never a match. */
async function stage2(probes) {
  if (typeof probes.stage2 !== 'function') return unknown('no stage 2 probe supplied (adapters/github/stage2.js stage2Probe)');
  return guarded(async () => {
    const r = await probes.stage2();
    if (r?.result === 'pass') return verdict(true, 'items in the store match open issues', { matched: r.matched?.length ?? null });
    if (r?.result === 'fail') return verdict(false, 'the store and the tracker disagree', { missing_on_tracker: r.missing_on_tracker?.length ?? null, only_on_tracker: r.only_on_tracker?.length ?? null });
    return unknown(r?.reason || 'the tracker could not be read completely');
  }, 'the stage 2 probe');
}

/** Stage 3: complete ticks in the window, merged changes that trace to a dispatch or a runner run, and a healthy self-hosted account. */
async function stage3(ctx, config, probes) {
  const { db } = ctx, days = config.window_days ?? 14, since = iso(nowMs(ctx) - days * 86400000);
  return guarded(async () => {
    const t = await first(db, `SELECT COUNT(*) AS n FROM tick_runs WHERE steps_total > 0 AND steps_completed = steps_total AND started_at >= ?`, since);
    const minTicks = config.min_ticks ?? 6;
    const merges = await first(db, `SELECT COUNT(*) AS n FROM outcomes WHERE action_class='merge' AND result='verified' AND at >= ?`, since);
    let traced = 0;
    if (merges.n > 0) {
      const withRunner = await hasTable(db, 'runner_runs');
      const sql = `SELECT COUNT(*) AS n FROM outcomes o WHERE o.action_class='merge' AND o.result='verified' AND o.at >= ?
        AND (EXISTS (SELECT 1 FROM dispatches d WHERE d.item_id = o.item_id)` + (withRunner ? ` OR EXISTS (SELECT 1 FROM runner_runs r WHERE r.item_id = o.item_id AND r.pr_number IS NOT NULL)` : '') + `)`;
      traced = (await first(db, sql, since)).n;
    }
    const ratio = merges.n > 0 ? traced / merges.n : null, minRatio = config.min_execution_ratio ?? 1;
    const numbers = { complete_ticks: t.n, min_ticks: minTicks, merged: merges.n, traced, execution_ratio: ratio };
    if (typeof probes.account !== 'function') return { ...unknown('no account probe supplied (the self-hosted Worker health)'), numbers };
    if (ratio === null) return { ...unknown('no verified merge outcome in the window, so the execution ratio is unmeasured'), numbers };
    const acct = await probes.account();
    if (!acct || typeof acct.ok !== 'boolean') return { ...unknown('the account probe returned no verdict'), numbers };
    const ok = t.n >= minTicks && ratio >= minRatio && acct.ok;
    const why = ok ? `${t.n} complete ticks, ${traced} of ${merges.n} merged changes trace to a tick, the account is healthy`
      : [t.n < minTicks && `${t.n} complete ticks (need ${minTicks})`, ratio < minRatio && `execution ratio ${ratio.toFixed(2)} (need ${minRatio})`, !acct.ok && `the account probe failed${acct.detail ? ': ' + acct.detail : ''}`].filter(Boolean).join('; ');
    return verdict(ok, why, numbers);
  }, 'the tick and outcome tables');
}

/** Stage 4: a trust rung moved by recorded outcomes, and an L2 manager role evidence row in the window. */
async function stage4(ctx, config) {
  const { db } = ctx, since = iso(nowMs(ctx) - (config.window_days ?? 14) * 86400000), start = config.start_rung || 'observed';
  return guarded(async () => {
    const moved = await first(db, `SELECT COUNT(*) AS n FROM trust_ledger WHERE rung != ? AND outcomes > 0`, start);
    if (!(await hasTable(db, 'kernel_step_evidence'))) return { ...unknown('the managerial (L2) evidence table is absent'), numbers: { rungs_moved: moved.n } };
    const l2 = await first(db, `SELECT COUNT(*) AS n FROM kernel_step_evidence WHERE ok = 1 AND at >= ?`, since);
    const ok = moved.n > 0 && l2.n > 0;
    return verdict(ok, ok ? `${moved.n} trust rung(s) moved by outcomes; ${l2.n} managerial step(s) recorded` : `${moved.n} trust rung(s) moved by outcomes (a start rung does not count), ${l2.n} managerial step(s) in the window`, { rungs_moved: moved.n, l2_steps: l2.n });
  }, 'the trust ledger');
}

/**
 * Compute the stage. `stage` is the highest k whose evidence and every lower stage's evidence hold (R12); `claimed` is the highest
 * such k whose probe's author differs from the stage's author at every stage up to k (R11); `blocked_at` is the first stage without evidence.
 */
export async function computeStage({ db, now, probes = {}, config = {} }) {
  const ctx = { db, now };
  const evidence = { 1: await stage1(probes), 2: await stage2(probes), 3: await stage3(ctx, config, probes), 4: await stage4(ctx, config) };
  const authors = config.stage_authors || {}, prober = config.probe_authors || {};
  const independent = {};
  for (const k of [1, 2, 3, 4]) {
    const a = authors[k], p = prober[k];
    independent[k] = Boolean(a && p && String(a).toLowerCase() !== String(p).toLowerCase());
    evidence[k].independent = independent[k];
    if (!independent[k]) evidence[k].claim_blocked = !a || !p ? 'probe_author_unknown' : 'probe_not_independent'; // circular proof: evidence holds, the claim does not
  }
  let stage = 0, claimed = 0, blocked_at = null, claimable = true;
  for (const k of [1, 2, 3, 4]) {
    if (!evidence[k].ok) { blocked_at = k; break; }
    stage = k;
    claimable = claimable && independent[k];
    if (claimable) claimed = k;
  }
  return { stage, claimed, blocked_at, evidence, computed_at: iso(nowMs(ctx)) };
}

/** What the contract or a status line says its stage is. `measured` is true when the text defers to the computation. */
export function parsePublishedStage(text) {
  const t = String(text || '');
  const m = /\bat\s+(?:\*\*)?stage\s+(\d)(?:\*\*)?/i.exec(t) || /\bcurrent stage:?\s*(?:\*\*)?(\d)(?:\*\*)?/i.exec(t) || /\bstage\s+(\d)\s+is\s+claimed\b/i.exec(t);
  return { stage: m ? Number(m[1]) : null, measured: /measured,?\s+never\s+declared|computed,?\s+never\s+declared/i.test(t) };
}

/**
 * US-20-R13 / T20-6: the published stage may not exceed the computed one. A text that says the stage is measured is accepted only when
 * a computation was supplied. With `strict`, the published stage may not exceed the independently *claimed* stage either (R11).
 */
export function checkPublished({ published, computed, strict = false }) {
  const problems = [];
  const pub = typeof published === 'number' ? { stage: published, measured: false } : (published || { stage: null, measured: false });
  if (!computed) { if (pub.stage !== null || pub.measured) problems.push('a stage is published but none was computed: the published stage must be backed by a computation'); return { ok: !problems.length, problems }; }
  if (pub.stage !== null && pub.stage > computed.stage) problems.push(`published stage ${pub.stage} exceeds the computed stage ${computed.stage} (US-20-R13)`);
  if (strict && pub.stage !== null && pub.stage > computed.claimed) problems.push(`published stage ${pub.stage} exceeds the independently confirmed stage ${computed.claimed} (US-20-R11)`);
  return { ok: !problems.length, problems, published_stage: pub.stage, computed_stage: computed.stage, claimed_stage: computed.claimed };
}

/** A tick step the host may register (core/org/surfaces.js is the integrator's): writes the stage into `org` and files STAGE-<k> for the first missing stage. */
export function stageStep({ db, now, probes, config = {} }) {
  return {
    name: 'stage',
    async run(_db, ctx) {
      const s = await computeStage({ db, now, probes, config });
      const at = iso(nowMs({ now }));
      await db.prepare(`INSERT INTO org (key, value) VALUES ('self_hosting_stage', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify({ stage: s.stage, claimed: s.claimed, blocked_at: s.blocked_at, at })).run();
      if (s.blocked_at) {
        const e = s.evidence[s.blocked_at];
        await db.prepare(`INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, created_at, updated_at) VALUES (?,?,?,?,?,?,20,?,?)
          ON CONFLICT(id) DO UPDATE SET title=excluded.title, updated_at=excluded.updated_at, status=CASE WHEN items.status='done' THEN 'open' ELSE items.status END, disposition=CASE WHEN items.status='done' THEN NULL ELSE items.disposition END`)
          .bind(`STAGE-${s.blocked_at}`, `Self-hosting stage ${s.blocked_at} has no evidence: ${e.why}`, 'work', 'operations', `computeStage reports stage >= ${s.blocked_at}`, 'computeStage returns stage >= ' + s.blocked_at, at, at).run();
      }
      await db.prepare(`UPDATE items SET status='done', disposition='the stage evidence now holds', updated_at=? WHERE id LIKE 'STAGE-%' AND CAST(substr(id,7) AS INTEGER) <= ? AND status NOT IN ('done','superseded','cancelled')`).bind(iso(nowMs({ now })), s.stage).run();
      ctx?.notes?.push?.(`stage ${s.stage} (claimed ${s.claimed})${s.blocked_at ? `, stage ${s.blocked_at} lacks evidence` : ''}`);
      return s;
    },
  };
}
