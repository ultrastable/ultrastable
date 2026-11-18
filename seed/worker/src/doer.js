// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// DOER-1 (workers#173): the tick's dispatch step only wrote a claim and a dispatches row; nothing ever acted on them, the reaper released the
// claim as stale and the item was claimed again (288 dispatches, 0 outcomes, 2026-11-10..14). This step runs right after dispatch, inside the
// same tick, on the server, and ends every claimed item in one of three states with an outcome row as evidence:
//   done     its done check is verified here (a later tick completed the failed step, the loop-breaker target has a doer again, a successor was filed)
//   parked   status 'blocked' with a blocker that names why and what closes it (owner-only identity step, code change outside the Worker, probe-gated)
//   waiting  no doer can act this tick (no AI binding for an item only the model can triage); the claim is kept and the loop-breaker still applies
// Rules run first and need no model. Workers AI (env.AI, the binding the tick Worker already has) is used only to file successor items and to
// triage items no rule covers, at most `max_ai` calls per tick. Never touches GitHub and never handles a secret.
import { ADAPTERS, parseJson } from './codeagent.js';
import { createRouter } from './airouter.js';  // AI-ROUTER-1
import { OWN_SQL, tenantOf } from './tenant.js';  // Q-TENANT-row-isolation: the doer works, settles and re-checks only its own tenant's items, claims and gate cards

const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();
const first = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).first()) || null;
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];

export const DOER = 'doer-v1';
// MODEL-TRUTH-1: what a dispatch row says ran when a rule settled the item with no model call.
export const RULES_MODEL = 'rules (no model)';
export const MAX_ITEMS = 8, MAX_AI = 3;

// Identity-bound work (IC-GATE-001): filing, signing, applying, entity and IP decisions, anything only the owner can review or submit.
export const OWNER_ONLY = /\bowner card\b|\bOC-\d|submission confirmation|confirmation emails?|submit(ted)? applications?|\bapplication\b.*\b(program|startups?)\b|form (an )?entity|\bassign ip\b|choose owning entity|attorney|filing receipt|\bfiling\b|reviewed by rowan|deck reviewed|approve operator outreach|first conversations logged|jurisdiction|install claude app|trademark registration/i;

// MODEL-REPLY-1: Workers AI may return an already-parsed object in `response`; callers need a string (parseJson called t.indexOf on it).
const textOf = r => { const v = (r && (r.response || (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content))) || ''; return typeof v === 'string' ? v : JSON.stringify(v); };

// REPLY-GATE-1 (2026-11-16): a deterministic check on every model reply before it is used, no model involved. An earlier fleet's register held 142
// failure modes in model output (empty, truncated at max_tokens, degenerate repetition) that reached its tables because the text was used as returned.
export function replyProblem(res, text) {
  const t = String(text || '').trim();
  if (!t) return 'empty reply';
  const fr = res && ((res.choices && res.choices[0] && res.choices[0].finish_reason) || res.finish_reason);
  if (fr === 'length') return 'cut off at max_tokens';
  const lines = t.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length >= 10 && new Set(lines).size / lines.length < 0.3) return 'repeated lines';
  const m = t.match(/(.{20,}?)\1{3,}/s);
  if (m) return 'repeated text';
  return null;
}

// PLAN-SKIP-1: a model the account's plan does not include (error 5035, 'not available on the Workers Free plan') is skipped for the life of the isolate.
const PLAN_BLOCKED = new Set();
async function ask(ctx, prompt, maxTokens = 900) {
  if (!ctx.ai || ctx.aiCalls >= ctx.maxAi) return null;
  ctx.aiCalls++;
  // AI-ROUTER-1: cache, dedupe, free models cheapest first, reply gate, per-kind learning; every call is recorded in airouter_calls. The tick's own
  // governor (ctx.ai, budget.js) still meters neurons and stops the loop with BudgetExhausted.
  const models = ADAPTERS.filter(a => !PLAN_BLOCKED.has(a.id)).sort((x, y) => x.price - y.price).map(a => ({ id: a.id, model: a.model, tier: 'free', extra: a.extra }));
  const router = createRouter({ db: ctx.db, ai: ctx.ai, models, now: () => ctx.now, config: { neurons_day_cap: 1e12 },
    onFail: (m, why) => { if (/not available on the Workers Free plan/i.test(why)) PLAN_BLOCKED.add(m.id); } });  // PLAN-SKIP-1
  try {
    const r = await router.call({ kind: 'doer', prompt, maxTokens, verify: t => { try { parseJson(t); return true; } catch (e) { return String(e && e.message); } } });
    const m = models.find(x => x.model === r.model);
    ctx.itemModel = r.model;  // MODEL-TRUTH-1: the dispatch row records the model that answered, never a config label
    return { json: parseJson(r.text), adapter: m ? m.id : r.model, model: r.model };
  } catch (e) { ctx.notes.push('doer: no model answered (' + String(e && e.message).slice(0, 200) + ')'); return null; }
}

async function outcome(db, ctx, item, result, evidence) {
  await run(db, `INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?, ?, 'work_tracker', 'execute', ?, ?, ?)`,
    item.id, DOER, result, String(evidence).slice(0, 600), ctx.nowIso);
}

async function settle(db, ctx, item, state, evidence, extra = {}) {
  if (state === 'done') {
    await run(db, `UPDATE items SET status='done', disposition=?, blocker=NULL, updated_at=? WHERE id=?`, ('done: ' + evidence).slice(0, 400), ctx.nowIso, item.id);
    await outcome(db, ctx, item, 'verified', evidence);
  } else if (state === 'parked') {
    await run(db, `UPDATE items SET status='blocked', blocker=?, updated_at=? WHERE id=?`, String(extra.blocker || evidence).slice(0, 400), ctx.nowIso, item.id);
    await outcome(db, ctx, item, 'parked', evidence);
  } else if (state === 'superseded') {
    await run(db, `UPDATE items SET status='superseded', disposition=?, updated_at=? WHERE id=?`, ('superseded: ' + evidence).slice(0, 400), ctx.nowIso, item.id);
    await outcome(db, ctx, item, 'superseded', evidence);
  }
  if (state !== 'waiting') {
    await run(db, `DELETE FROM claims WHERE item_id=?`, item.id);
    await run(db, `UPDATE dispatches SET status=?, model=? WHERE item_id=? AND status='queued'`, state, ctx.itemModel || RULES_MODEL, item.id);
  }
  ctx.doer[state] = (ctx.doer[state] || 0) + 1;
  return state;
}

// ---- handlers: each returns null (not mine) or a settled state ----

// TICKFAIL-<step>-<hour>: done when any tick that started after the item was filed completed that step without error.
async function tickfail(db, ctx, item) {
  const m = /^TICKFAIL-([a-z_]+)-/.exec(item.id);
  if (!m) return null;
  const step = m[1];
  const newer = await first(db, `SELECT id FROM items WHERE id LIKE ? AND id > ? AND status NOT IN ('done','superseded','cancelled') AND ${OWN_SQL()} ORDER BY id DESC LIMIT 1`, `TICKFAIL-${step}-%`, item.id, tenantOf(ctx));
  const ok = await first(db, `SELECT id, started_at FROM tick_runs WHERE started_at > ? AND finished_at IS NOT NULL AND (errors IS NULL OR errors NOT LIKE ?) ORDER BY id LIMIT 1`, item.created_at || '', `%${step}:%`);
  if (ok) return settle(db, ctx, item, 'done', `tick ${ok.id} (${ok.started_at}) completed step ${step} with no error`);
  if (newer) return settle(db, ctx, item, 'superseded', `same failure tracked by ${newer.id}`);
  return settle(db, ctx, item, 'parked', `step ${step} still failing in every tick since ${item.created_at}`, { blocker: `waiting on probe: a tick completes step ${step}; rechecked every tick by ${DOER}` });
}

// LOOPBREAK-<X>: the change of approach is this doer. Unblock X so the doer works it, and close the loop-breaker with that evidence.
async function loopbreak(db, ctx, item) {
  if (!item.id.startsWith('LOOPBREAK-')) return null;
  const target = item.id.slice('LOOPBREAK-'.length);
  const x = await first(db, `SELECT id, status, blocker FROM items WHERE id=? AND ${OWN_SQL()}`, target, tenantOf(ctx));
  if (!x) return settle(db, ctx, item, 'superseded', `target ${target} no longer exists`);
  if (x.status === 'blocked' && /^loop-breaker/.test(x.blocker || '')) {
    await run(db, `UPDATE items SET status='ready', blocker=NULL, updated_at=? WHERE id=? AND ${OWN_SQL()}`, ctx.nowIso, target, tenantOf(ctx));
    await run(db, `INSERT INTO outcomes (item_id, agent, surface, action_class, result, evidence, at) VALUES (?, ?, 'work_tracker', 'execute', 'released', ?, ?)`, target, DOER, `unblocked by ${item.id}: dispatches now reach a doer (${DOER})`, ctx.nowIso);
  }
  const has = await first(db, `SELECT COUNT(*) AS n FROM outcomes WHERE item_id=?`, target);
  return settle(db, ctx, item, 'done', `${target} has ${has.n} outcome(s); new approach: in-tick doer ${DOER} works every dispatch; ${target} is ${x.status === 'blocked' ? 'unblocked' : x.status}`);
}

// Owner-only identity-bound work: parked behind one consolidated gate card, default in effect.
async function ownerOnly(db, ctx, item) {
  if (!OWNER_ONLY.test(`${item.title} ${item.done_check}`)) return null;
  await ensureOwnerGate(db, ctx);
  return settle(db, ctx, item, 'parked', `identity-bound (IC-GATE-001): ${item.done_check}`, { blocker: `owner-only: identity-bound step (${item.done_check}); gate GATE-OWNER-ITEMS, default in effect: the fleet prepares drafts and keeps working other items` });
}

export async function ensureOwnerGate(db, ctx) {
  const T = tenantOf(ctx);
  const g = await first(db, `SELECT status FROM gate_cards WHERE id='GATE-OWNER-ITEMS' AND ${OWN_SQL()}`, T);
  if (g && g.status === 'open') return;
  if (g) { await run(db, `UPDATE gate_cards SET status='open', closed_at=NULL WHERE id='GATE-OWNER-ITEMS' AND ${OWN_SQL()}`, T); return; }
  await run(db, `INSERT INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES ('GATE-OWNER-ITEMS', ?, ?, ?, ?, 'owner_items:0')`,
    'Backlog items only the owner can do (filings, applications, entity and IP decisions, reviews in the owner\'s name)',
    'Irreversible and identity-bound: they commit the owner\'s legal or financial identity',
    'Parked with status blocked and blocker owner-only:...; the fleet keeps working every other item and never re-dispatches these',
    DOER);
}

// Probe-gated items close themselves when their probe goes green (selfaudit, criticality); policy ladders need a reviewed repo PR.
async function probeGated(db, ctx, item) {
  const p = item.closing_probe || '';
  if (/^selfaudit:/.test(p)) return settle(db, ctx, item, 'parked', `closes by probe ${p}; the fix is a code or config change outside the Worker`, { blocker: `probe-gated: closes when ${p} is green (checked every tick); needs a code change, routed to the repository executor queue` });
  if (item.id.startsWith('LADDER-')) return settle(db, ctx, item, 'parked', 'needs a reviewed PR to autonomy/policy.json', { blocker: 'needs-code: PR to autonomy/policy.json reviewed by a different agent' });
  return null;
}

// Built-in checks the Worker can evaluate itself: a closing probe that is one read-only SELECT returning > 0.
async function selfCheck(db, ctx, item) {
  const p = item.closing_probe || '';
  if (!/^\s*select\b/i.test(p) || p.includes(';')) return null;
  try {
    const r = await first(db, p);
    const v = Number(Object.values(r || {})[0]);
    if (v > 0) return settle(db, ctx, item, 'done', `closing probe returned ${v}: ${p}`);
  } catch (e) { ctx.notes.push(`doer: probe of ${item.id} failed: ${String(e.message).slice(0, 80)}`); }
  return null;
}

// Filing items: NEXT-<X> successors ("name the next improvement it unlocks") and ORIGIN-* criticality items ("pick the highest-value cost cut
// or verified-deploy gain and file it"). The model names one concrete item; a valid one is filed and the filing item is done.
async function successor(db, ctx, item, ensureItem) {
  const origin = item.id.startsWith('ORIGIN-') || /^criticality:/.test(item.closing_probe || '');
  if (!origin && !/^successor:/.test(item.closing_probe || '') && !item.id.startsWith('NEXT-')) return null;
  const base = item.id.replace(/^NEXT-/, '');
  const src = origin ? null : await first(db, `SELECT id, title, done_check FROM items WHERE id=? AND ${OWN_SQL()}`, base, tenantOf(ctx));
  const roles = (await all(db, `SELECT DISTINCT role FROM roles`)).map(r => r.role);
  const lead = origin
    ? `You run the backlog of Ultrastable, a platform that runs autonomous systems on Cloudflare Workers + D1. Task: ${item.title}\nName the single highest-value concrete change (a cost cut or a verified deploy gain). It must be small (one day) and checkable by a probe.`
    : `You run the backlog of Ultrastable, a platform that runs autonomous systems on Cloudflare Workers + D1. Item ${base}${src ? ` ("${src.title}", done check: ${src.done_check})` : ''} is finished or in progress. Name the single most valuable next improvement it unlocks. It must be concrete, small (one day), and checkable by a probe.`;
  const a = await ask(ctx, `${lead}\nAnswer with one JSON object only: {"title": string (max 120 chars), "owner_role": one of ${JSON.stringify(roles)}, "done_check": string, "closing_probe": string}`);
  if (!a) return settle(db, ctx, item, 'waiting', 'no model available this tick');
  const j = a.json || {};
  if (!j.title || !j.done_check || !roles.includes(j.owner_role)) return settle(db, ctx, item, 'parked', `model ${a.adapter} answered without a valid item: ${JSON.stringify(j).slice(0, 200)}`, { blocker: 'successor not filed: model answer invalid; retried when unblocked' });
  const id = (origin ? `FILED-${item.id}` : `PLUS-${base}`).slice(0, 80);
  await ensureItem(db, { id, kind: 'plus', owner_role: j.owner_role, priority: 30, title: String(j.title).slice(0, 200), done_check: String(j.done_check).slice(0, 300), closing_probe: String(j.closing_probe || '').slice(0, 300) || null });
  return settle(db, ctx, item, 'done', `filed ${id} (${j.owner_role}): ${String(j.title).slice(0, 120)} [${a.adapter}]`);
}

// Anything else: the model triages it into a verdict with a reason and a first concrete step, recorded as evidence; the item is parked so
// it is never re-dispatched blind. A verdict of owner_only joins the owner gate.
async function triage(db, ctx, item) {
  const a = await ask(ctx, `You triage a backlog item for Ultrastable (autonomous-system platform on Cloudflare Workers + D1 + GitHub). The in-Worker doer can only read and write the backlog database; it cannot edit code, browse, send mail or sign anything.\nITEM ${item.id} (${item.kind}, role ${item.owner_role}): ${item.title}\nDone check: ${item.done_check}\nClosing probe: ${item.closing_probe || 'none'}\nAnswer with one JSON object only: {"verdict": "owner_only" | "needs_code" | "needs_external" | "needs_research", "reason": string (max 200 chars), "first_step": string (max 200 chars)}`, 500);
  if (!a) return settle(db, ctx, item, 'waiting', 'no model available this tick');
  const j = a.json || {};
  const verdict = ['owner_only', 'needs_code', 'needs_external', 'needs_research'].includes(j.verdict) ? j.verdict : 'needs_code';
  if (verdict === 'owner_only') await ensureOwnerGate(db, ctx);
  const tag = verdict === 'owner_only' ? 'owner-only' : verdict.replace('_', '-');
  return settle(db, ctx, item, 'parked', `triaged by ${a.adapter}: ${verdict}: ${j.reason || ''} | first step: ${j.first_step || ''}`,
    { blocker: `${tag}: ${String(j.reason || '').slice(0, 200)} | first step: ${String(j.first_step || '').slice(0, 150)}` });
}

// Re-verifies parked items whose done check the Worker can evaluate (TICKFAIL waiting on a step), so they close without a new dispatch.
async function recheck(db, ctx) {
  const rows = await all(db, `SELECT * FROM items WHERE status='blocked' AND blocker LIKE 'waiting on probe:%' AND ${OWN_SQL()} LIMIT 20`, tenantOf(ctx));
  for (const it of rows) await tickfail(db, ctx, it);
}

export async function executeStep(db, ctx, ensureItem) {
  ctx.doer = {}; ctx.aiCalls = 0; ctx.maxAi = ctx.config.doer_max_ai ?? MAX_AI;
  await recheck(db, ctx);
  const items = await all(db, `SELECT i.* FROM items i JOIN claims c ON c.item_id = i.id WHERE i.status='claimed' AND (i.tenant_id IS NULL OR i.tenant_id = ?) AND (c.tenant_id IS NULL OR c.tenant_id = ?) ORDER BY i.priority, c.claimed_at LIMIT ?`, tenantOf(ctx), tenantOf(ctx), ctx.config.doer_max_items ?? MAX_ITEMS);
  for (const it of items) {
    ctx.itemModel = null;
    try {
      (await tickfail(db, ctx, it)) || (await loopbreak(db, ctx, it)) || (await ownerOnly(db, ctx, it)) || (await selfCheck(db, ctx, it))
        || (await probeGated(db, ctx, it)) || (await successor(db, ctx, it, ensureItem)) || (await triage(db, ctx, it));
    } catch (e) { ctx.notes.push(`doer: ${it.id} failed: ${String(e && e.message).slice(0, 120)}`); }
  }
  const parts = Object.entries(ctx.doer).map(([k, v]) => `${v} ${k}`);
  ctx.notes.push(`executed ${items.length} claimed item(s)${parts.length ? ': ' + parts.join(', ') : ''}${ctx.aiCalls ? `, ${ctx.aiCalls} model call(s)` : ''}`);
}

// Probe for workers#173 acceptance (b): claims the reaper released without any doer acting on them in the last 24 h. Target 0.
export const claimsReleasedUnworked24h = (db, now) => first(db,
  `SELECT COUNT(*) AS n FROM dispatches WHERE status='released' AND at >= ?`, new Date(now - 86400e3).toISOString().replace('T', ' ').slice(0, 19)).then(r => (r ? r.n : 0));
