// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Cost-aware model ladder (US-SPEC-09). Ports: db, fetch, now, config, env (secret presence only).
import { ADAPTERS } from './providers/index.js';

const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export function periodStart(period, nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  if (period === 'day') return iso(Date.UTC(y, m, day));
  if (period === 'week') return iso(Date.UTC(y, m, day - ((d.getUTCDay() + 6) % 7)));
  if (period === 'month') return iso(Date.UTC(y, m, 1));
  throw new Error('unknown period: ' + period);
}

// A secret must never reach a stored or returned message.
function scrub(text, env, config) {
  let s = String(text ?? '');
  for (const p of Object.values(config.providers || {})) {
    const v = p.key_env ? env?.[p.key_env] : null;
    if (v && v.length > 3) s = s.split(v).join('[redacted]');
  }
  return s.slice(0, 300);
}

// A model the provider says is gone (HTTP 410, or an error naming a deprecation) is skipped for this long; its successor is the
// next configured rung of the same provider. A call refused before any model ran costs nothing.
const RETIRE_MS = 7 * 24 * 3600 * 1000;
const isGone = msg => /http 410|deprecat|retired|\b5028\b/i.test(String(msg || ''));

export function createRouter({ db, fetch, now = () => Date.now(), config, env = {}, ai = null, killSwitch = null, matrix = null }) {
  const rungs = config.rungs || ['small', 'medium', 'large'];
  const providers = config.providers || {};
  const order = config.fallbacks || Object.keys(providers);

  async function first(sql, ...a) { return (await db.prepare(sql).bind(...a).first()) || null; }
  async function all(sql, ...a) { return (await db.prepare(sql).bind(...a).all()).results || []; }
  async function run(sql, ...a) { return db.prepare(sql).bind(...a).run(); }

  async function spend(period = 'day', filter = {}) {
    const since = periodStart(period, now());
    const where = ['at >= ?'], args = [since];
    if (filter.role) { where.push('role = ?'); args.push(filter.role); }
    const w = where.join(' AND ');
    const tot = await first(`SELECT COALESCE(SUM(cost_usd),0) AS usd, COUNT(*) AS calls, COALESCE(SUM(tokens_in),0) AS tin, COALESCE(SUM(tokens_out),0) AS tout FROM router_calls WHERE ${w}`, ...args);
    const by_role = await all(`SELECT COALESCE(role,'') AS role, SUM(cost_usd) AS usd, COUNT(*) AS calls FROM router_calls WHERE ${w} GROUP BY role`, ...args);
    const by_model = await all(`SELECT provider, model, SUM(cost_usd) AS usd, COUNT(*) AS calls FROM router_calls WHERE ${w} AND provider IS NOT NULL GROUP BY provider, model`, ...args);
    return { period, since, usd: tot.usd, calls: tot.calls, tokens_in: tot.tin, tokens_out: tot.tout, by_role, by_model };
  }

  async function setSwitch(name, on, reason = '') {
    await run(`INSERT INTO router_switches (name, is_on, reason, set_at) VALUES (?,?,?,?)
               ON CONFLICT(name) DO UPDATE SET is_on=excluded.is_on, reason=excluded.reason, set_at=excluded.set_at`,
      name, on ? 1 : 0, reason, iso(now()));
  }
  // A `model:<id>` switch is a retirement and lapses after retire_ms; every other switch stays until it is released.
  async function engagedSwitches() {
    const t = now(), keep = config.retire_ms ?? RETIRE_MS;
    return new Set((await all(`SELECT name, set_at FROM router_switches WHERE is_on = 1`))
      .filter(r => !String(r.name).startsWith('model:') || !r.set_at || Date.parse(r.set_at.replace(' ', 'T') + 'Z') + keep > t).map(r => r.name));
  }

  // 'ok' | 'soft' | 'hard' for a role, with the binding cap.
  async function capState(role) {
    let out = { state: 'ok' };
    for (const cap of config.caps || []) {
      if (cap.scope === 'role' && cap.role !== role) continue;
      const s = await spend(cap.period, cap.scope === 'role' ? { role: cap.role } : {});
      if (cap.hard_usd != null && s.usd >= cap.hard_usd) return { state: 'hard', cap, spent: s.usd };
      if (cap.soft_usd != null && s.usd >= cap.soft_usd && out.state === 'ok') out = { state: 'soft', cap, spent: s.usd };
    }
    return out;
  }

  // Which roles a provider kind may serve. Config router.rung_roles overrides; a kind with no entry is unrestricted.
  const DEFAULT_RUNG_ROLES = { workers_ai: ['triage', 'review', 'reviewer', 'management', 'manager'] };
  const roleAllowed = (p, role) => {
    const allow = (config.rung_roles || {})[p.kind] || DEFAULT_RUNG_ROLES[p.kind];
    return !allow || !role || allow.includes(role);
  };
  const usable = p => ADAPTERS[p.kind]?.keyless ? !!ai : !!env[p.key_env]; // presence only
  const modelCost = (m, tin, tout) => (tin / 1000) * (m.usd_per_1k_in || 0) + (tout / 1000) * (m.usd_per_1k_out || 0);
  const isFree = m => !(m.usd_per_1k_in > 0) && !(m.usd_per_1k_out > 0);

  async function doerFamilies(itemId) {
    if (!itemId) return new Set();
    const rows = await all(`SELECT DISTINCT family FROM router_calls WHERE item_id = ? AND kind = 'doer' AND outcome = 'ok' AND family IS NOT NULL`, itemId);
    return new Set(rows.map(r => r.family));
  }

  async function record(row) {
    const res = await run(`INSERT INTO router_calls (at, role, item_id, kind, rung_requested, rung_used, provider, model, family,
               tokens_in, tokens_out, cost_usd, latency_ms, outcome, error, steered) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      iso(now()), row.role ?? null, row.item_id ?? null, row.kind ?? 'other', row.rung_requested ?? null, row.rung_used ?? null,
      row.provider ?? null, row.model ?? null, row.family ?? null, row.tokens_in || 0, row.tokens_out || 0,
      row.cost_usd || 0, row.latency_ms || 0, row.outcome, row.error ? scrub(row.error, env, config) : null, row.steered ? 1 : 0);
    return res.meta?.last_row_id ?? null;
  }

  async function fileGateRecord(what, why, scope) {
    const open = await first(`SELECT id FROM router_gate_records WHERE scope = ? AND status = 'open'`, scope);
    if (open) return open.id;
    const r = await run(`INSERT INTO router_gate_records (at, what, why_gated, default_in_effect, closing_probe, scope) VALUES (?,?,?,?,?,?)`,
      iso(now()), what, why, 'paid calls refused for this scope until the period resets or the cap is raised by reviewed change',
      'router spend(period) below the hard cap', scope);
    return r.meta.last_row_id;
  }

  // US-09-R05: while a hard cap is breached, reducing the overage is the top task: one priority-0 item per capped scope, closed
  // by the same reading (spend below the cap) on a later route call. The item is data, not an instruction to a person.
  const spendItemId = cap => 'SPEND-' + `${cap.scope}:${cap.role || ''}:${cap.period}`.replace(/[^\w.:-]/g, '_');
  async function fileSpendItem(cap, spent) {
    await run(`INSERT OR IGNORE INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, created_at, updated_at) VALUES (?,?,?,?,?,?,0,'open',?,?)`,
      spendItemId(cap), `Spend ${spent} reached the hard cap ${cap.hard_usd} (${cap.scope} ${cap.role || ''} ${cap.period}): reduce the overage`, 'fix', config.spend_owner_role || 'operations',
      'router spend(period) is below the hard cap', 'router spend(period) below the hard cap', iso(now()), iso(now()));
    // A later breach of the same scope reopens the item the earlier recovery closed: the fixed id would otherwise swallow every breach after the first.
    await run(`UPDATE items SET status='open', disposition=NULL, updated_at=? WHERE id=? AND status='done'`, iso(now()), spendItemId(cap));
  }
  async function closeSpendItems(role) {
    const open = await all(`SELECT id FROM items WHERE id LIKE 'SPEND-%' AND status NOT IN ('done','superseded','cancelled')`);
    if (!open.length) return;
    for (const cap of config.caps || []) {
      if (cap.hard_usd == null || (cap.scope === 'role' && cap.role !== role)) continue;
      const id = spendItemId(cap);
      if (!open.some(o => o.id === id)) continue;
      const s = await spend(cap.period, cap.scope === 'role' ? { role: cap.role } : {});
      if (s.usd < cap.hard_usd) await run(`UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')`, `spend ${s.usd} is below the hard cap ${cap.hard_usd}`, iso(now()), id);
    }
  }

  // Decide rung and candidates without calling anything.
  async function route(request = {}) {
    const role = request.role || null;
    const wanted = request.rung || 'small';
    const need = request.capabilities || [];
    if (!rungs.includes(wanted)) return { ok: false, refusal: 'unknown_rung', rung_requested: wanted };
    const sw = await engagedSwitches();
    // The global switch of core/router/caps is read through a port, so the claim service, the deploy path and the router stop together.
    if (sw.has('all') || (typeof killSwitch === 'function' && await killSwitch())) return { ok: false, refusal: 'kill_switch_all', rung_requested: wanted };

    const cs = await capState(role);
    if (cs.state === 'hard') await fileSpendItem(cs.cap, cs.spent); else await closeSpendItems(role);
    let idx = rungs.indexOf(wanted), steered = false;
    if (cs.state === 'soft' && idx > 0) { idx -= 1; steered = true; }
    const freeOnly = cs.state === 'hard';
    const exclude = request.kind === 'reviewer' ? await doerFamilies(request.item_id) : new Set();
    const list = request.providers || order;
    // US-09-R08, capability first: with a matrix port the models offered for a class are the admitted ones that passed their canaries.
    // No port, no task_class, or an empty answer falls back to the configured capabilities, and the plan says so.
    let allowed = null, matrixState = 'none';
    if (matrix && request.task_class) {
      const adm = await matrix({ task_class: request.task_class, need: request.need || {} });
      if (Array.isArray(adm) && adm.length) { allowed = new Set(adm.map(r => r.model)); matrixState = 'applied'; }
    }
    let sawFamilyBlock = false, sawPaidBlock = false, sawRoleBlock = false;

    const build = (i) => {
      const out = [];
      for (const name of list) {
        const p = providers[name];
        if (!p || sw.has('provider:' + name)) continue;
        if (!usable(p)) continue;
        if (!roleAllowed(p, role)) { sawRoleBlock = true; continue; }
        let m = p.models?.[rungs[i]], successor_of = null, usedRung = rungs[i];
        // A retired model gives way to the next configured rung of the same provider.
        if (m && sw.has('model:' + m.id)) {
          successor_of = m.id; m = null;
          for (let j = i + 1; j < rungs.length && !m; j++) { const c = p.models?.[rungs[j]]; if (c && !sw.has('model:' + c.id)) { m = c; usedRung = rungs[j]; } }
        }
        if (!m || !need.every(c => (m.capabilities || []).includes(c))) continue;
        if (allowed && !allowed.has(m.id)) continue;
        if (exclude.has(p.family)) { sawFamilyBlock = true; continue; }
        if (freeOnly && !isFree(m)) { sawPaidBlock = true; continue; }
        out.push({ provider: name, model: m.id, family: p.family, rung: usedRung, ...(successor_of ? { successor_of } : {}) });
      }
      return out;
    };
    let candidates = build(idx);
    // A cap never ends a task while a free or cheaper path exists: walk down the ladder.
    if (!candidates.length && (freeOnly || steered)) {
      for (let i = idx - 1; i >= 0 && !candidates.length; i--) { candidates = build(i); if (candidates.length) steered = true; }
    }
    if (!candidates.length) {
      if (freeOnly && sawPaidBlock) {
        const scope = `${cs.cap.scope}:${cs.cap.role || ''}:${cs.cap.period}`;
        const id = await fileGateRecord('Hard spend cap reached', `Spend ${cs.spent} reached hard cap ${cs.cap.hard_usd} (${scope})`, scope);
        return { ok: false, refusal: 'hard_cap', gate_record: id, rung_requested: wanted };
      }
      if (sawRoleBlock) return { ok: false, refusal: 'role_not_allowed', rung_requested: wanted };
      return { ok: false, refusal: sawFamilyBlock ? 'no_distinct_family' : 'no_capable_provider', rung_requested: wanted };
    }
    return { ok: true, rung_requested: wanted, rung: candidates[0].rung, steered, cap_state: cs.state, matrix: matrixState, candidates };
  }

  async function call(request = {}) {
    // US-09-R04: one iteration is bounded in steps, tokens, wall-clock time and spend (core/router/caps/bounds.js). A spent bound
    // refuses before any provider is called, whatever the cap state is.
    const bounds = request.bounds || null;
    let spentBound = bounds ? bounds.check() : { ok: true };
    if (spentBound.ok && request.deadline_ms != null && now() >= request.deadline_ms) spentBound = { ok: false, exceeded: 'wall' };
    if (!spentBound.ok) {
      await record({ role: request.role, item_id: request.item_id, kind: request.kind, rung_requested: request.rung || 'small', outcome: 'refused', error: 'bound_exceeded:' + spentBound.exceeded });
      return { ok: false, refusal: 'bound_exceeded', exceeded: spentBound.exceeded, attempts: [] };
    }
    const plan = await route(request);
    if (!plan.ok) {
      await record({ role: request.role, item_id: request.item_id, kind: request.kind, rung_requested: plan.rung_requested, outcome: 'refused', error: plan.refusal });
      return { ok: false, refusal: plan.refusal, gate_record: plan.gate_record, attempts: [] };
    }
    const attempts = [];
    for (const c of plan.candidates) {
      const p = providers[c.provider];
      const adapter = ADAPTERS[p.kind];
      const model = p.models[c.rung];
      const base = { role: request.role, item_id: request.item_id, kind: request.kind, rung_requested: plan.rung_requested, rung_used: c.rung, provider: c.provider, model: c.model, family: c.family, steered: plan.steered || c.rung !== plan.rung_requested };
      const t0 = now();
      try {
        if (!adapter) throw new Error('no adapter for kind ' + p.kind);
        const room = bounds ? bounds.check().remaining.tokens : Infinity;
        const req = { ...request, max_tokens: Math.max(1, Math.min(request.max_tokens || config.default_max_tokens || 1024, config.max_tokens_per_call || Infinity, room)) };
        delete req.bounds;
        let out;
        if (adapter.keyless) out = await adapter.invoke(ai, p, model, req);
        else {
          const key = env[p.key_env];
          const { url, init } = adapter.buildRequest(p, model, req, key);
          let res = await fetch(url, init);
          if (!res.ok) {
            // The body of a refusal that says a model is gone is kept (scrubbed when stored) so the retirement can be recognised.
            const note = [400, 404, 410].includes(res.status) ? ': ' + String(await res.text().catch(() => '')).slice(0, 160) : '';
            throw new Error('http ' + res.status + note);
          }
          let json;
          try { json = await res.json(); } catch (e) { if (!adapter.shouldFallback) throw e; json = null; }
          // An adapter may name a second endpoint for a 200 answer that is not a completion (MODELS-ORG-1).
          if (adapter.shouldFallback?.(json)) {
            const fb = adapter.fallbackRequest?.(p, model, req, key);
            if (!fb) throw new Error('empty answer');
            res = await fetch(fb.url, fb.init);
            if (!res.ok) throw new Error('http ' + res.status);
            json = await res.json();
          }
          out = adapter.parseResponse(json);
        }
        const cost = modelCost(model, out.tokens_in, out.tokens_out);
        if (bounds) bounds.charge({ steps: 1, tokens: out.tokens_in + out.tokens_out, usd: cost });
        const callId = await record({ ...base, tokens_in: out.tokens_in, tokens_out: out.tokens_out, cost_usd: cost, latency_ms: now() - t0, outcome: 'ok' });
        if (out.resolved_model) await run(`INSERT INTO router_upstream (call_id, at, provider, requested, resolved) VALUES (?,?,?,?,?)`, callId, iso(now()), c.provider, c.model, out.resolved_model);
        return { ok: true, provider: c.provider, model: c.model, rung: c.rung, steered: base.steered, text: out.text, tool_calls: out.tool_calls, tokens_in: out.tokens_in, tokens_out: out.tokens_out, cost_usd: cost, attempts };
      } catch (e) {
        const msg = scrub(e?.message, env, config);
        if (isGone(msg)) await setSwitch('model:' + c.model, true, 'retired: ' + msg.slice(0, 120)); // skipped for retire_ms; the next candidate serves
        attempts.push({ provider: c.provider, error: msg, ...(isGone(msg) ? { retired: c.model } : {}) });
        await record({ ...base, latency_ms: now() - t0, outcome: 'error', error: msg });
      }
    }
    return { ok: false, refusal: 'all_providers_failed', attempts };
  }

  async function handle(request) {
    const url = new URL(request.url);
    const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    if (url.pathname === '/spend' && request.method === 'GET') {
      try { return json(await spend(url.searchParams.get('period') || 'day')); } catch (e) { return json({ error: e.message }, 400); }
    }
    if (url.pathname === '/route' && request.method === 'POST') {
      let body;
      try { body = await request.json(); } catch { return json({ error: 'invalid json' }, 400); }
      const plan = await route(body);
      return json(plan, plan.ok ? 200 : 409);
    }
    return json({ error: 'not found' }, 404);
  }

  return { route, call, spend, handle, setSwitch };
}

// US-09-R14: pick the highest tier whose minimum monthly budget the stated budget meets; budget 0 selects the smallest.
export function selectTier(budget, tiers) {
  const sorted = [...tiers].sort((a, b) => a.budget_usd_per_month_min - b.budget_usd_per_month_min);
  let pick = sorted[0];
  for (const t of sorted) if (budget >= t.budget_usd_per_month_min) pick = t;
  return pick;
}

// Fetch-style entry: ctx.router is a router made by createRouter.
export function handle(request, ctx) { return ctx.router.handle(request); }
