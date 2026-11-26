// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// VENDORED from ultrastable workers/core/airouter/index.js (the standalone workers repo is archived) (TENANT-SYNC-1): edit it there, then copy. Never diverge.
// core/airouter (AI-ROUTER-1, 2026-11-17): the one place every tenant's model calls go through, so AI cost stays near zero and quality stays high.
//  1. cache + dedupe: an identical prompt of the same kind is answered from D1 (ttl) or from the call already in flight; no model, no neurons.
//  2. cheapest first: free Workers AI models are tried before any paid one, ordered by learned pass rate then cost.
//  3. quality gate: every reply passes a deterministic check (empty, cut off, repeated) and the task's own verify(); a failure escalates, never ships.
//  4. escalate only on verified need: a paid model runs only after every free model failed the gate for this call (or the kind's free pass rate is
//     proven below FREE_GIVE_UP), and only inside the tenant's hard monthly cap. Cap 0 (the default) means a paid model is never called.
//  5. it learns: each call is recorded (cost, neurons, pass/fail, reason) and the stats reorder the next routing, demote a failing model for a kind,
//     and let a model that keeps passing skip the dearer rungs. Ports: db, now, ai (env.AI-shaped), models[]; paid models bring their own run().
// The router never reads a secret: a paid model is a function the tenant binds (it holds its own key). Hard cap is enforced before the call.
export const RETIRE_MS = 7 * 864e5;
export const DEFAULTS = { monthly_usd_cap: 0, neurons_day_cap: 8000, cache_ttl_ms: 6 * 3600e3, min_calls_to_judge: 8, free_give_up: 0.2 };
export const DDL = [
  'CREATE TABLE IF NOT EXISTS airouter_cache (key TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, model TEXT NOT NULL, at INTEGER NOT NULL, hits INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS airouter_calls (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, model TEXT NOT NULL, tier TEXT NOT NULL, neurons REAL NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0, ok INTEGER NOT NULL, reason TEXT)',
  'CREATE INDEX IF NOT EXISTS airouter_calls_at ON airouter_calls (at)',
  'CREATE TABLE IF NOT EXISTS airouter_retired (model TEXT PRIMARY KEY, at INTEGER NOT NULL, reason TEXT)',
  'CREATE INDEX IF NOT EXISTS airouter_cache_at ON airouter_cache (at)',
  'CREATE TABLE IF NOT EXISTS airouter_stats (kind TEXT NOT NULL, model TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, passes INTEGER NOT NULL DEFAULT 0, usd REAL NOT NULL DEFAULT 0, PRIMARY KEY (kind, model))',
];
const ensured = new WeakSet();
export async function ensure(db) { if (ensured.has(db)) return; for (const s of DDL) await db.prepare(s).run(); ensured.add(db); }

const enc = new TextEncoder();
export async function cacheKey(kind, prompt) { const b = await crypto.subtle.digest('SHA-256', enc.encode(kind + '\n' + prompt)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }

const choice = o => o?.choices?.[0]?.message?.content ?? o?.choices?.[0]?.text;
// AIROUTER-EMPTY-1: a reasoning model (glm-4.7-flash) can answer with response "" and the text in choices; '??' stopped at the empty string,
// so 21 good-cost replies in three days were scored 'empty reply'. Take the first non-empty field instead.
export function textOf(out) { for (const r of [out?.response, out?.result, choice(out)]) { if (r == null) continue; const t = (typeof r === 'object' ? JSON.stringify(r) : String(r)).trim(); if (t) return t; } return ''; }
// Deterministic reply check (same signals as the tick's REPLY-GATE-1): returns a reason or null.
export function replyProblem(res, text) {
  const t = String(text || '').trim();
  if (!t) return 'empty reply';
  if (((res && res.choices && res.choices[0] && res.choices[0].finish_reason) || (res && res.finish_reason)) === 'length') return 'cut off at max_tokens';
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length >= 10 && new Set(lines).size / lines.length < 0.3) return 'repeated lines';
  if (/(.{20,}?)\1{3,}/s.test(t)) return 'repeated text';
  return null;
}
const estTokens = s => Math.ceil(String(s || '').length / 4);
export function neuronsOf(model, res, text, prompt) {
  const u = (res && res.usage) || {}, i = Number(u.prompt_tokens ?? u.input_tokens ?? estTokens(prompt)), o = Number(u.completion_tokens ?? u.output_tokens ?? estTokens(text));
  return Math.ceil(i * (model.neurons_in ?? 0.03) + o * (model.neurons_out ?? 0.2));
}
export function usdOf(model, res, text, prompt) {
  if (model.tier !== 'paid') return 0;
  const u = (res && res.usage) || {}, i = Number(u.prompt_tokens ?? u.input_tokens ?? estTokens(prompt)), o = Number(u.completion_tokens ?? u.output_tokens ?? estTokens(text));
  return (i * (model.usd_in_per_m || 0) + o * (model.usd_out_per_m || 0)) / 1e6;
}
const day = ms => new Date(ms).toISOString().slice(0, 10), month = ms => new Date(ms).toISOString().slice(0, 7);

// models: [{ id, model, tier:'free'|'paid', neurons_in?, neurons_out?, usd_in_per_m?, usd_out_per_m?, extra?, run?(input) }]. A free model runs on ai.run(model, input).
export function createRouter({ db, ai, models, now = () => Date.now(), config = {}, onFail = null }) {
  const cfg = { ...DEFAULTS, ...config }, inflight = new Map();
  let prunedDay = null;  // once a day per isolate: cache rows past 7 days and call rows past 30 days (stats are one row per kind and model, kept)
  const prune = async () => { const d = day(now()); if (prunedDay === d) return; prunedDay = d; await db.prepare('DELETE FROM airouter_cache WHERE at<?1').bind(now() - 7 * 864e5).run(); await db.prepare('DELETE FROM airouter_calls WHERE at<?1').bind(now() - 30 * 864e5).run(); };
  const spent = async () => { const r = await db.prepare('SELECT COALESCE(SUM(usd),0) u FROM airouter_calls WHERE at>=?1').bind(Date.parse(month(now()) + '-01T00:00:00Z')).first(); return Number(r && r.u) || 0; };
  const neuronsToday = async () => { const r = await db.prepare("SELECT COALESCE(SUM(neurons),0) n FROM airouter_calls WHERE at>=?1 AND tier='free'").bind(Date.parse(day(now()) + 'T00:00:00Z')).first(); return Number(r && r.n) || 0; };
  const stats = async kind => { const r = await db.prepare('SELECT model, calls, passes FROM airouter_stats WHERE kind=?1').bind(kind).all(); return Object.fromEntries((r.results || []).map(x => [x.model, x])); };
  const rate = s => s && s.calls >= cfg.min_calls_to_judge ? s.passes / s.calls : null;

  // AIROUTER-NO-RUN-1 (measured 2026-11-20): 35 calls to a model the platform deprecated that day and 14 refusals by the spend governor were charged
  // 1,561 estimated neurons although no model ran, which used a fifth of the day's free allowance and stopped the code agent early. A call that was
  // refused before any model ran costs nothing; a model the platform says is gone is retired for RETIRE_MS and probed again after that.
  const neverRan = reason => /^error: (\d+: .*was deprecated|AI budget:|Too many subrequests)/.test(String(reason || ''));
  const isGone = reason => /^error: (5028:|\d+: .*was deprecated)/.test(String(reason || ''));
  const retired = async () => { const r = await db.prepare('SELECT model FROM airouter_retired WHERE at>=?1').bind(now() - RETIRE_MS).all(); return new Set((r.results || []).map(x => x.model)); };

  async function record(kind, m, neurons, usd, ok, reason) {
    await db.prepare('INSERT INTO airouter_calls (at,kind,model,tier,neurons,usd,ok,reason) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)').bind(now(), kind, m.model, m.tier, neurons, usd, ok ? 1 : 0, reason || null).run();
    await db.prepare('INSERT INTO airouter_stats (kind,model,calls,passes,usd) VALUES (?1,?2,1,?3,?4) ON CONFLICT(kind,model) DO UPDATE SET calls=calls+1, passes=passes+?3, usd=usd+?4').bind(kind, m.model, ok ? 1 : 0, usd).run();
  }

  // Order for this kind: free models by learned pass rate (unknown = optimistic 0.5) then cheapest; a free model proven below free_give_up is dropped;
  // paid models follow, cheapest first. Paid ones are only reached after the free ones fail this call.
  async function plan(kind) {
    const st = await stats(kind), free = [], paid = [], dropped = [];
    const gone = await retired();
    for (const m of models) {
      if (gone.has(m.model)) continue;
      const r = rate(st[m.model]);
      if (m.tier === 'paid') paid.push({ m, r }); else if (r === null || r >= cfg.free_give_up) free.push({ m, r: r ?? 0.5 }); else dropped.push({ m, r });
    }
    // AIROUTER-REPROBE-1: lifetime pass rates never recover, so when every free model was dropped (and no paid one is allowed) the plan was empty
    // and every call ended "no model passed ()" for good. Re-probe the dropped free models, best rate first, so a recovered model is learned again.
    if (!free.length && !paid.length) free.push(...dropped.map(x => ({ m: x.m, r: x.r })));
    free.sort((a, b) => b.r - a.r || (a.m.neurons_out ?? 0.2) - (b.m.neurons_out ?? 0.2));
    paid.sort((a, b) => (a.m.usd_out_per_m || 0) - (b.m.usd_out_per_m || 0));
    return [...free.map(x => x.m), ...paid.map(x => x.m)];
  }

  async function call({ kind = 'general', prompt: promptIn, messages = null, maxTokens = 600, verify = null, cache = true, system = null }) {
    await ensure(db); await prune();
    const prompt = messages ? messages.map(x => String(x.content)).join('\n') : promptIn;  // messages: a ready chat (several turns); the key then covers every turn
    const key = await cacheKey(kind, messages ? JSON.stringify(messages) : (system || '') + '\n' + prompt);
    if (cache) {
      const c = await db.prepare('SELECT text, model, at FROM airouter_cache WHERE key=?1').bind(key).first();
      if (c && now() - c.at < cfg.cache_ttl_ms) { await db.prepare('UPDATE airouter_cache SET hits=hits+1 WHERE key=?1').bind(key).run(); return { text: c.text, model: c.model, cached: true, usd: 0, neurons: 0 }; }
    }
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      const tried = [], used = await neuronsToday(); let neuronsUsed = used, capSpent = null, stop = false;
      for (const m of await plan(kind)) {
        let input = { messages: messages || [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: prompt }], ...(m.extra || {}), max_tokens: maxTokens };
        if (m.tier !== 'paid' && neuronsUsed >= cfg.neurons_day_cap) { tried.push(m.id + ': daily free neurons used'); continue; }
        if (m.tier === 'paid') {
          const worst = ((estTokens(prompt) * (m.usd_in_per_m || 0)) + (maxTokens * (m.usd_out_per_m || 0))) / 1e6;
          capSpent ??= await spent();
          if (!(cfg.monthly_usd_cap > 0) || capSpent + worst > cfg.monthly_usd_cap) { tried.push(m.id + ': monthly cap'); continue; }
        }
        let res, text, reason = null;
        try { res = m.run ? await m.run(input) : await ai.run(m.model, input); text = textOf(res); reason = replyProblem(res, text); if (!reason && verify) { const v = await verify(text); if (v !== true && v != null) reason = typeof v === 'string' ? v : 'verify failed'; } }
        catch (e) { reason = 'error: ' + String(e && e.message).slice(0, 100); if (e && e.name === 'BudgetExhausted') stop = true; }  // the tenant's own governor said stop: no further model is tried
        const noRun = !res && neverRan(reason);
        const neurons = m.tier === 'paid' || noRun ? 0 : neuronsOf(m, res, text, prompt), usd = noRun ? 0 : usdOf(m, res, text, prompt);
        if (isGone(reason)) await db.prepare('INSERT INTO airouter_retired (model,at,reason) VALUES (?1,?2,?3) ON CONFLICT(model) DO UPDATE SET at=excluded.at, reason=excluded.reason').bind(m.model, now(), reason.slice(0, 200)).run();
        neuronsUsed += neurons; if (capSpent !== null) capSpent += usd;
        await record(kind, m, neurons, usd, !reason, reason);
        if (reason && onFail) { try { onFail(m, reason); } catch (e) { tried.push('hook: ' + String(e && e.message).slice(0, 60)); } }  // a hook never breaks routing; its error is in the exhausted message
        if (!reason) { if (cache) await db.prepare('INSERT INTO airouter_cache (key,kind,text,model,at,hits) VALUES (?1,?2,?3,?4,?5,0) ON CONFLICT(key) DO UPDATE SET text=excluded.text, model=excluded.model, at=excluded.at').bind(key, kind, text, m.model, now()).run(); return { text, model: m.model, cached: false, usd, neurons, escalated: tried.length > 0 }; }
        tried.push(m.id + ': ' + reason);
        if (stop) break;
      }
      const e = new Error('airouter: no model passed (' + tried.join('; ').slice(0, 300) + ')'); e.code = 'airouter_exhausted'; throw e;
    })().finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  }

  // Read-only summary for dashboards and the free-tier probe.
  async function report() {
    await ensure(db);
    return { month_usd: await spent(), cap_usd: cfg.monthly_usd_cap, neurons_today: await neuronsToday(), neurons_day_cap: cfg.neurons_day_cap,
      by_model: (await db.prepare('SELECT kind, model, calls, passes, usd FROM airouter_stats ORDER BY calls DESC LIMIT 50').all()).results };
  }
  return { call, report };
}
