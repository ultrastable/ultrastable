// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Calibration: probe every provider/rung with fixed probes, record results, steer away from a failing route and back.
// Ports: ctx = { db, now(), config, router }. A probe goes through router.call pinned to one provider, so the same
// path real work uses is the path measured. Rule: never switch off the last healthy route (no single point of failure).
const DEFAULTS = { fail_streak_off: 3, pass_streak_on: 2, max_latency_ms: 20000, owner_role: 'operations',
  ema_alpha: 0.2, dev_k: 3, min_samples: 10, burst_n: 5, retention_days: 90 };
/** Settings an adjustment may change (binding-only, reversible). Anything else is refused. */
export const ADJUSTABLE = ['fail_streak_off', 'pass_streak_on', 'max_latency_ms'];
const PROBES = [
  { name: 'echo-json', request: { messages: [{ role: 'user', content: 'Reply with exactly this JSON and nothing else: {"ok":true}' }], max_tokens: 32 },
    check: r => { try { return JSON.parse(String(r.text).trim().replace(/^```(json)?|```$/g, '')).ok === true; } catch { return false; } } },
  { name: 'nonempty', request: { messages: [{ role: 'user', content: 'Say OK.' }], max_tokens: 8 }, check: r => String(r.text || '').trim().length > 0 },
];
export const probes = PROBES.map(p => p.name);
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const nowMs = ctx => { const v = ctx.now(); return v instanceof Date ? v.getTime() : v; };

/** Exponential moving average. */
export const ema = (old, x, alpha = 0.2) => (old == null ? x : old + alpha * (x - old));

/** The settings in force: defaults, the host's config, then the adjustments that are applied or kept (a reverted one is not in force). */
export async function effectiveConfig(ctx) {
  const c = { ...DEFAULTS, ...(ctx.config || {}) };
  const rows = (await ctx.db.prepare(`SELECT key, new FROM router_adjustments WHERE status IN ('applied','kept') ORDER BY id`).all()).results || [];
  for (const r of rows) if (ADJUSTABLE.includes(r.key)) c[r.key] = Number(r.new);
  return c;
}

async function runProbe(ctx, c, provider, rung, p, label) {
  const t0 = nowMs(ctx);
  let ok = false, detail = '';
  try {
    const r = await ctx.router.call({ role: 'calibration', kind: 'calibration', rung, providers: [provider], ...p.request });
    ok = !!r.ok && p.check(r); detail = r.ok ? (ok ? 'ok' : 'check_failed') : String(r.refusal || 'failed');
  } catch (e) { detail = String(e?.message || e).slice(0, 200); }
  const ms = nowMs(ctx) - t0;
  if (ok && ms > c.max_latency_ms) { ok = false; detail = 'too_slow'; }
  // Variance-adaptive threshold: mean + k * mean absolute deviation, judged against the baseline before this run changes it.
  const base = await ctx.db.prepare('SELECT mean_ms, dev_ms, n FROM router_baseline WHERE provider=? AND rung=? AND probe=?').bind(provider, rung, label).first();
  let anomaly = false;
  if (ok && base && base.n >= c.min_samples && ms > base.mean_ms + c.dev_k * base.dev_ms) { anomaly = true; detail = `anomaly: ${ms} ms over ${(base.mean_ms + c.dev_k * base.dev_ms).toFixed(0)} ms`; }
  if (ok) { // only a healthy run teaches the baseline; failures are judged by the streak rule
    const mean = ema(base?.mean_ms, ms, c.ema_alpha), dev = ema(base?.dev_ms, Math.abs(ms - (base?.mean_ms ?? ms)), c.ema_alpha);
    await ctx.db.prepare(`INSERT INTO router_baseline (provider, rung, probe, mean_ms, dev_ms, n, updated_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(provider, rung, probe) DO UPDATE SET mean_ms=excluded.mean_ms, dev_ms=excluded.dev_ms, n=router_baseline.n+1, updated_at=excluded.updated_at`).bind(provider, rung, label, mean, dev, 1, iso(nowMs(ctx))).run();
  }
  await ctx.db.prepare('INSERT INTO router_calibration (at, provider, rung, probe, ok, latency_ms, detail) VALUES (?,?,?,?,?,?,?)')
    .bind(iso(nowMs(ctx)), provider, rung, label, ok ? 1 : 0, ms, detail).run();
  if (anomaly) await ctx.db.prepare("INSERT OR IGNORE INTO items (id,title,kind,owner_role,done_check,closing_probe,priority,status) VALUES (?,?,'fix',?,?,?,60,'open')")
    .bind('CAL-LAT-' + provider, `Provider ${provider} ${rung} ${label} is slower than its baseline: ${detail}`, c.owner_role, `${label} latency is back within mean + ${c.dev_k} deviations`, 'a calibration run inside the adaptive threshold for ' + provider).run();
  // A recurrence reopens the item an earlier recovery closed; a still-open one is left alone.
  if (anomaly) await ctx.db.prepare("UPDATE items SET status='open', disposition=NULL, updated_at=datetime('now') WHERE id=? AND status='done'").bind('CAL-LAT-' + provider).run();
  return { probe: label, ok, ms, anomaly };
}

export async function probeOne(ctx, provider, rung) {
  const c = await effectiveConfig(ctx), out = [];
  for (const p of PROBES) { const r = await runProbe(ctx, c, provider, rung, p, p.name); out.push({ probe: r.probe, ok: r.ok, anomaly: r.anomaly }); }
  return out;
}

/** Probe all providers at all rungs; then update switches. Returns { switched_off, switched_on, healthy }. */
export async function calibrate(ctx, { providers, rungs }) {
  const c = await effectiveConfig(ctx);
  const names = Object.keys(providers);
  // A switched-off provider is probed too (else it could never recover): lift its switch for the probe, re-engage below if still failing.
  const wasOff = new Set((await ctx.db.prepare("SELECT name FROM router_switches WHERE is_on = 1 AND name LIKE 'provider:%'").all()).results.map(r => r.name.slice(9)));
  for (const n of names) {
    if (wasOff.has(n)) await ctx.router.setSwitch('provider:' + n, false, 'calibration: probing');
    for (const r of rungs) if (providers[n].models?.[r]) await probeOne(ctx, n, r);
  }
  const state = {};
  for (const n of names) {
    const rows = (await ctx.db.prepare('SELECT ok FROM (SELECT id, ok FROM router_calibration WHERE provider = ? ORDER BY id DESC LIMIT ?) ORDER BY id DESC').bind(n, Math.max(c.fail_streak_off, c.pass_streak_on) * PROBES.length).all()).results;
    const recent = rows.map(x => x.ok);
    state[n] = { failing: recent.length >= c.fail_streak_off && recent.slice(0, c.fail_streak_off).every(v => v === 0), passing: recent.slice(0, c.pass_streak_on * PROBES.length).every(v => v === 1) };
  }
  const healthy = names.filter(n => !state[n].failing);
  const off = [], on = [];
  for (const n of names) {
    if (state[n].failing && healthy.length > 0) {
      await ctx.router.setSwitch('provider:' + n, true, 'calibration: failing probes'); off.push(n);
      await ctx.db.prepare("INSERT OR IGNORE INTO items (id,title,kind,owner_role,done_check,closing_probe,priority,status) VALUES (?,?,'fix',?,?,?,55,'open')")
        .bind('CAL-' + n, 'Provider ' + n + ' fails calibration probes', c.owner_role, 'probes fail for ' + n, 'two consecutive calibration runs pass for ' + n).run();
      await ctx.db.prepare("UPDATE items SET status='open', disposition=NULL, updated_at=datetime('now') WHERE id=? AND status='done'").bind('CAL-' + n).run();
    } else if (wasOff.has(n) && !state[n].passing) {
      await ctx.router.setSwitch('provider:' + n, true, 'calibration: still failing'); off.push(n);
    } else if (state[n].passing) {
      await ctx.router.setSwitch('provider:' + n, false, 'calibration: recovered'); on.push(n);
      await ctx.db.prepare("UPDATE items SET status='done', disposition='probes pass again', updated_at=datetime('now') WHERE id=? AND status='open'").bind('CAL-' + n).run();
    }
  }
  return { switched_off: off, switched_on: on, healthy };
}

// ---- Schedules (daily, weekly stress, monthly cleanup) ----

const DAY = 86400000;
const lastAt = async (db, sql, ...a) => { const r = await db.prepare(sql).bind(...a).first(); return r?.at ? Date.parse(r.at.replace(' ', 'T') + 'Z') : null; };

/** Which scheduled run is due: 'daily' (last calibration older than a day), 'weekly_stress' (older than 7 days), 'monthly_cleanup' (older than 28 days with rows past retention). */
export async function scheduleDue({ db, now, kind, config = {} }) {
  const t = typeof now === 'function' ? now() : now, c = { ...DEFAULTS, ...config };
  if (kind === 'daily') { const l = await lastAt(db, `SELECT MAX(at) AS at FROM router_calibration WHERE probe NOT LIKE 'stress:%'`); return l == null || t - l >= DAY; }
  if (kind === 'weekly_stress') { const l = await lastAt(db, `SELECT MAX(at) AS at FROM router_calibration_summary WHERE kind='stress'`); return l == null || t - l >= 7 * DAY; }
  if (kind === 'monthly_cleanup') {
    const l = await lastAt(db, `SELECT MAX(at) AS at FROM router_calibration_summary WHERE kind='monthly'`);
    const old = (await db.prepare(`SELECT COUNT(*) AS n FROM router_calibration WHERE at < ?`).bind(iso(t - c.retention_days * DAY)).first()).n;
    return old > 0 && (l == null || t - l >= 28 * DAY);
  }
  throw new Error('unknown schedule: ' + kind);
}

const pct = (xs, q) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]; };

/** Weekly stress: every probe, `burst_n` times in a row, per provider and rung; the p50 and p95 are stored as a summary. Probe rows are labelled `stress:<name>` and never move a switch. */
export async function weeklyStress(ctx, { providers, rungs }) {
  const c = await effectiveConfig(ctx), out = [];
  for (const n of Object.keys(providers)) for (const r of rungs) {
    if (!providers[n].models?.[r]) continue;
    for (const p of PROBES) {
      const ms = [], oks = [];
      for (let i = 0; i < c.burst_n; i++) { const x = await runProbe(ctx, c, n, r, p, 'stress:' + p.name); ms.push(x.ms); oks.push(x.ok); }
      const row = { provider: n, rung: r, probe: p.name, n: ms.length, ok_n: oks.filter(Boolean).length, p50: pct(ms, 0.5), p95: pct(ms, 0.95), mean: ms.reduce((a, b) => a + b, 0) / ms.length };
      await ctx.db.prepare(`INSERT INTO router_calibration_summary (kind, provider, rung, probe, n, ok_n, mean_ms, p50_ms, p95_ms, at) VALUES ('stress',?,?,?,?,?,?,?,?,?)`).bind(n, r, p.name, row.n, row.ok_n, row.mean, row.p50, row.p95, iso(nowMs(ctx))).run();
      out.push(row);
    }
  }
  return out;
}

/** Monthly cleanup: rows past `retention_days` are summarized per provider and probe first, and deleted only after the summary rows are written. */
export async function monthlyCleanup(ctx) {
  const c = await effectiveConfig(ctx), cutoff = iso(nowMs(ctx) - c.retention_days * DAY), ts = iso(nowMs(ctx));
  const groups = (await ctx.db.prepare(`SELECT provider, rung, probe, COUNT(*) AS n, SUM(ok) AS ok_n, AVG(latency_ms) AS mean_ms, MIN(at) AS from_at, MAX(at) AS to_at FROM router_calibration WHERE at < ? GROUP BY provider, rung, probe`).bind(cutoff).all()).results || [];
  for (const g of groups) await ctx.db.prepare(`INSERT INTO router_calibration_summary (kind, provider, rung, probe, n, ok_n, mean_ms, from_at, to_at, at) VALUES ('monthly',?,?,?,?,?,?,?,?,?)`).bind(g.provider, g.rung, g.probe, g.n, g.ok_n, g.mean_ms, g.from_at, g.to_at, ts).run();
  if (!groups.length) { await ctx.db.prepare(`INSERT INTO router_calibration_summary (kind, provider, n, ok_n, at) VALUES ('monthly','*',0,0,?)`).bind(ts).run(); return { deleted: 0, summaries: 0 }; }
  const del = await ctx.db.prepare(`DELETE FROM router_calibration WHERE at < ?`).bind(cutoff).run();
  return { deleted: del.meta.changes, summaries: groups.length };
}

// ---- Reversible adjustments, each verified on the next run ----

/** Apply one binding-only setting from the allowlist. `metric` is the reading the change is meant to improve (higher is better), taken now. */
export async function applyAdjustment({ ctx, key, value, metric, allow = ADJUSTABLE }) {
  if (!allow.includes(key) || !ADJUSTABLE.includes(key)) throw new Error(`calibration: ${key} is not on the allowlist of binding-only settings`);
  const old = (await effectiveConfig(ctx))[key];
  await ctx.db.prepare(`INSERT INTO router_adjustments (key, old, new, metric_before, applied_at, status) VALUES (?,?,?,?,?,'applied')`).bind(key, String(old), String(value), metric ?? null, iso(nowMs(ctx))).run();
  return { key, old, new: value };
}

/** On the next run: an adjustment whose metric got worse is reverted (status 'reverted', no longer in force); one that held is kept. */
export async function verifyAdjustments({ ctx, readMetric }) {
  const ts = iso(nowMs(ctx)), out = [];
  for (const a of (await ctx.db.prepare(`SELECT * FROM router_adjustments WHERE status='applied' AND applied_at < ? ORDER BY id`).bind(ts).all()).results || []) {
    const after = await readMetric();
    const regressed = a.metric_before != null && after != null && after < a.metric_before;
    await ctx.db.prepare(`UPDATE router_adjustments SET status=?, metric_after=?, verified_at=? WHERE id=?`).bind(regressed ? 'reverted' : 'kept', after, ts, a.id).run();
    out.push({ key: a.key, status: regressed ? 'reverted' : 'kept', before: a.metric_before, after });
  }
  return out;
}
