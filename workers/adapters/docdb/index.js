// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Document-database adapter (US-SPEC-14 section 4, "Document database"). Each L1 table is a collection keyed by its primary
// key. A document store has no SQL, so the store-handle steps cannot run on it: all eight L1 steps of core/src/tick.js (reconcile,
// reap_claims, probe_gates, score_predictions, accrue_trust, dispatch, execute, check_plus_share) are rewritten here against a small
// document port, with the same results (US-14-R11, R18). The one thing a document store cannot do is read a closing probe written as SQL:
// execute leaves such an item claimed for an executor that can, exactly as the SQL step does for a probe it cannot read.
//   - claim uniqueness: a create-only write keyed by item id (US-01-R02, US-01-T02);
//   - dispatch: an indexed query on (status, owner_role, priority), then a transactional claim (US-14-R11);
// The port (what a driver for a hosted document database has to offer):
//   create(coll, key, doc) -> true | false (false when the key exists; never overwrites)
//   get(coll, key) -> doc | null        set(coll, key, doc)        patch(coll, key, fields) -> true | false
//   remove(coll, key)                   add(coll, doc) -> key (store-assigned, increasing)
//   query(coll, { where: { field: value | [values] }, orderBy: [field, ...], limit }) -> [{ key, ...doc }], needs a declared index
//   scan(coll) -> every document        transaction(fn) -> runs fn(tx) alone, all-or-nothing; the calls on tx may return promises, so fn awaits them
// memoryDocStore() is the reference implementation of the port, used by the tests. No hosted driver is bundled.
export const COLLECTIONS = ['org', 'roles', 'items', 'claims', 'gate_cards', 'predictions', 'outcomes', 'trust_ledger', 'dispatches', 'tick_runs', 'doctrine_lineage'];
export const INDEXES = { items: [['status', 'owner_role', 'priority'], ['status']], claims: [['agent']], outcomes: [['surface', 'action_class']], gate_cards: [['status']], predictions: [['verdict']], dispatches: [['item_id', 'status']] };
const TERMINAL = ['done', 'superseded', 'cancelled'];
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));

/** The reference document store. `yieldEvery` makes every operation give up the event loop first, so concurrent callers
 *  interleave the way they do against a networked store; a test that passes only without it proves nothing. */
export function memoryDocStore({ indexes = INDEXES, yieldEvery = true } = {}) {
  let data = new Map(); let seq = 0; let lock = Promise.resolve();
  const coll = c => { if (!data.has(c)) data.set(c, new Map()); return data.get(c); };
  const tick = () => (yieldEvery ? new Promise(r => setImmediate(r)) : null);
  const covered = (c, fields) => fields.length === 0 || (indexes[c] || []).some(ix => fields.every(f => ix.includes(f)) && ix.slice(0, fields.length).every(f => fields.includes(f)));
  const ops = {
    create(c, key, doc) { const m = coll(c); if (m.has(String(key))) return false; m.set(String(key), clone(doc)); return true; },
    get(c, key) { const d = coll(c).get(String(key)); return d ? { key: String(key), ...clone(d) } : null; },
    set(c, key, doc) { coll(c).set(String(key), clone(doc)); },
    patch(c, key, fields) { const m = coll(c); const d = m.get(String(key)); if (!d) return false; m.set(String(key), { ...d, ...clone(fields) }); return true; },
    remove(c, key) { return coll(c).delete(String(key)); },
    add(c, doc) { const key = String(++seq).padStart(12, '0'); coll(c).set(key, clone(doc)); return key; },
    query(c, { where = {}, orderBy = [], limit = Infinity } = {}) {
      const fields = Object.keys(where);
      if (!covered(c, fields)) throw new Error(`no index on ${c} for (${fields.join(', ')}): declare one`);
      const rows = [...coll(c)].filter(([, d]) => fields.every(f => (Array.isArray(where[f]) ? where[f].includes(d[f]) : d[f] === where[f]))).map(([key, d]) => ({ key, ...clone(d) }));
      rows.sort((a, b) => { for (const f of orderBy) { if (a[f] !== b[f]) return (a[f] ?? '') < (b[f] ?? '') ? -1 : 1; } return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; });
      return rows.slice(0, limit);
    },
    scan(c) { return [...coll(c)].map(([key, d]) => ({ key, ...clone(d) })); },
  };
  const asyncOps = Object.fromEntries(Object.entries(ops).map(([n, f]) => [n, async (...a) => { await tick(); return f(...a); }]));
  return {
    ...asyncOps,
    /** Serialized and all-or-nothing: a throw inside fn restores the store as it was. */
    transaction(fn) {
      const runIt = async () => {
        const snapshot = new Map([...data].map(([c, m]) => [c, new Map([...m].map(([k, d]) => [k, clone(d)]))]));
        const seqBefore = seq;
        try { return await fn(ops); } catch (e) { data = snapshot; seq = seqBefore; throw e; }
      };
      const p = lock.then(runIt, runIt); lock = p.catch(() => {}); return p;
    },
    _size: c => coll(c).size,
  };
}

/** Take the claim on an item for an agent. Exactly one caller wins, however many try at once (US-01-R02, US-14-R11). */
export async function claim(store, itemId, agent, nowIso) {
  return store.transaction(async tx => {                       // the transaction's calls may be awaited: a hosted driver's are asynchronous
    const item = await tx.get('items', itemId);
    if (!item) return { ok: false, reason: 'no_such_item' };
    if (!(await tx.create('claims', itemId, { item_id: itemId, agent, claimed_at: nowIso, heartbeat_at: nowIso }))) return { ok: false, reason: 'already_claimed' };
    await tx.patch('items', itemId, { status: 'claimed', updated_at: nowIso });
    return { ok: true };
  });
}

export function reliability(successes, outcomes, trust) { return (successes + trust.baseline * trust.prior_weight) / (outcomes + trust.prior_weight); }

async function ensureItem(store, item, nowIso) {
  return store.create('items', item.id, { title: item.title, kind: item.kind || 'fix', project: null, owner_role: item.owner_role, trigger_on: null, done_check: item.done_check,
    closing_probe: item.closing_probe || null, priority: item.priority ?? 10, status: 'ready', disposition: null, blocker: null, surface: item.surface || null, action_class: item.action_class || null, created_at: nowIso, updated_at: nowIso });
}

const WAITING = 'waiting on probe:';
const DOER = 'tick-doer';
const OPS = { '>=': (a, b) => a >= b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '<': (a, b) => a < b, '=': (a, b) => a === b };
/** The built-in metrics of core/src/tick.js, read from the documents. */
export const DOC_METRICS = {
  tick_runs_completed_1h: async (store, now) => (await store.scan('tick_runs')).filter(t => t.finished_at && t.finished_at >= iso(now - 3600e3) && t.steps_completed === t.steps_total).length,
  items_done: async store => (await store.query('items', { where: { status: 'done' } })).length,
  open_gate_cards: async store => (await store.query('gate_cards', { where: { status: 'open' } })).length,
  silent_drops_7d: async (store, now) => (await store.scan('outcomes')).filter(o => o.result === 'silent_drop' && o.at >= iso(now - 7 * 86400e3)).length,
};

/** Read an item's closing probe from the documents. Returns { ok, detail }, or null for a probe this store cannot read (SQL). */
async function docProbe(store, ctx, item) {
  const p = String(item.closing_probe || '').trim();
  let m;
  if ((m = /^TICKFAIL-([a-z0-9_]+)-/i.exec(item.key))) {
    const t = (await store.scan('tick_runs')).filter(r => r.started_at > (item.created_at || '') && r.finished_at && (r.errors == null || !String(r.errors).includes(`"${m[1]}:`))).sort((a, b) => (a.key < b.key ? -1 : 1))[0];
    return { ok: Boolean(t), detail: t ? `tick ${Number(t.key)} completed step ${m[1]} with no error` : `no tick since ${item.created_at} completed step ${m[1]}` };
  }
  if ((m = /^env:(\w+)$/.exec(p))) return { ok: Boolean(ctx.env && ctx.env[m[1]]), detail: `setting ${m[1]} is ${ctx.env && ctx.env[m[1]] ? 'present' : 'absent'}` };
  if ((m = /^item_done:(\S+)$/.exec(p))) { const d = await store.get('items', m[1]); return { ok: d?.status === 'done', detail: `item ${m[1]} is ${d?.status === 'done' ? 'done' : 'not done'}` }; }
  if ((m = /^trust_ledger rung = (\S+)$/.exec(p)) && item.surface && item.action_class) {
    const r = await store.get('trust_ledger', `${item.surface}|${item.action_class}`);
    return { ok: Boolean(r && r.rung === m[1]), detail: `${item.surface}/${item.action_class} rung is ${r ? r.rung : 'unset'}` };
  }
  return null;
}

async function settle(store, ctx, item, probe) {
  await store.remove('claims', item.key);
  if (probe.ok) {
    await store.patch('items', item.key, { status: 'done', blocker: null, disposition: `done by ${DOER} in tick ${ctx.tickId}: ${probe.detail}`.slice(0, 300), updated_at: ctx.nowIso });
    await store.add('outcomes', { item_id: item.key, agent: DOER, surface: 'work_tracker', action_class: 'execute', result: 'verified', evidence: probe.detail.slice(0, 300), at: ctx.nowIso });
    for (const d of await store.query('dispatches', { where: { item_id: item.key, status: 'queued' } })) await store.patch('dispatches', d.key, { status: 'done' });
    return 'done';
  }
  await store.patch('items', item.key, { status: 'blocked', blocker: `${WAITING} ${item.closing_probe || item.done_check} (${probe.detail})`.slice(0, 300),
    disposition: `parked by ${DOER} in tick ${ctx.tickId}: closes by its probe, rechecked every tick`, updated_at: ctx.nowIso });
  return 'parked';
}

export const STEPS = {
  /** Every item that left the active set has a disposition (US-01-R03, US-01-T03); items whose trigger is done become ready. */
  async reconcile(store, ctx) {
    const closed = await store.query('items', { where: { status: TERMINAL } });
    const drops = closed.filter(i => !i.disposition);
    for (const d of drops) {
      await store.patch('items', d.key, { status: 'open', updated_at: ctx.nowIso });
      await store.add('outcomes', { item_id: d.key, agent: null, surface: 'work_tracker', action_class: 'create_update_close', result: 'silent_drop', evidence: 'reopened by reconcile: no disposition', at: ctx.nowIso });
    }
    const done = new Set((await store.query('items', { where: { status: 'done' } })).map(i => i.key));
    let ready = 0;
    for (const i of await store.query('items', { where: { status: 'open' } })) {
      if (i.trigger_on == null || done.has(i.trigger_on)) { await store.patch('items', i.key, { status: 'ready', updated_at: ctx.nowIso }); ready++; }
    }
    ctx.notes.push(`reconciled: ${drops.length} reopened, ${ready} became ready`);
  },

  /** Claims with no heartbeat for claim_ttl_minutes are released (US-03-R06). A claim never heartbeated was dispatched and not worked: that is an
   *  outcome, and an item released unworked max_unworked_releases times is parked with a reason. Each release is one transaction. */
  async reap_claims(store, ctx) {
    const cutoff = iso(ctx.now - ctx.config.claim_ttl_minutes * 60e3);
    const maxRel = ctx.config.max_unworked_releases ?? 3;
    let released = 0, unworked = 0, parked = 0;
    for (const c of (await store.scan('claims')).filter(x => x.heartbeat_at < cutoff)) {
      const res = await store.transaction(async tx => {
        if (!(await tx.get('claims', c.key))) return null;              // another instance already released it
        const item = await tx.get('items', c.key);
        await tx.remove('claims', c.key);
        const live = item && item.status === 'claimed';
        if (c.heartbeat_at !== c.claimed_at) { if (live) await tx.patch('items', c.key, { status: 'ready', updated_at: ctx.nowIso }); return 'quiet'; }
        await tx.add('outcomes', { item_id: c.key, agent: c.agent, surface: 'dispatch', action_class: 'claim_release', result: 'unworked', evidence: `claim by ${c.agent} released after ${ctx.config.claim_ttl_minutes} min with no heartbeat`, at: ctx.nowIso });
        const n = (await tx.query('outcomes', { where: { surface: 'dispatch', action_class: 'claim_release' } })).filter(o => o.item_id === c.key && o.result === 'unworked').length;
        if (n >= maxRel) {
          if (live) await tx.patch('items', c.key, { status: 'blocked', blocker: `no executor worked this item: dispatched and released unworked ${n} times`, disposition: `parked: dispatched ${n} times, never worked; needs an executor that reads this store (issue #173)`, updated_at: ctx.nowIso });
          return 'parked';
        }
        if (live) await tx.patch('items', c.key, { status: 'ready', disposition: `released unworked (${n}/${maxRel}) ${ctx.nowIso}`, updated_at: ctx.nowIso });
        return 'unworked';
      });
      if (res) { released++; if (res === 'unworked') unworked++; if (res === 'parked') { unworked++; parked++; } }
    }
    if (released) ctx.notes.push(`released ${released} stale claim(s), ${unworked} unworked, ${parked} parked`);
  },

  /** Gate cards close themselves when their probe shows the owner's step is done. */
  async probe_gates(store, ctx) {
    const cards = await store.query('gate_cards', { where: { status: 'open' } });
    let closed = 0;
    for (const c of cards) {
      const [kind, arg] = String(c.closing_probe || '').split(':');
      let ok = false;
      if (kind === 'env') ok = Boolean(ctx.env && ctx.env[arg]);
      if (kind === 'item_done') ok = (await store.get('items', arg))?.status === 'done';
      if (ok) { await store.patch('gate_cards', c.key, { status: 'closed', closed_at: ctx.nowIso }); closed++; }
    }
    ctx.openGates = cards.length - closed;
    if (closed) ctx.notes.push(`closed ${closed} gate card(s) by probe`);
  },

  /** Predictions due now are graded against the built-in metrics, read from the documents, or a metric the caller supplies. */
  async score_predictions(store, ctx) {
    const due = (await store.query('predictions', { where: { verdict: null } })).filter(p => p.due_at <= ctx.nowIso);
    for (const p of due) {
      const own = (o, k) => o && Object.prototype.hasOwnProperty.call(o, k);
      const metric = own(DOC_METRICS, p.metric) ? DOC_METRICS[p.metric] : own(ctx.metrics, p.metric) ? ctx.metrics[p.metric] : null;
      const op = own(OPS, p.op) ? OPS[p.op] : null;
      const miss = async note => { await store.patch('predictions', p.key, { verdict: 'miss', observed: null }); ctx.notes.push(`prediction ${p.key}: ${note}`); };
      if (!metric || !op) { await miss('unknown metric or op, scored miss'); continue; }
      let observed;
      try {
        let timer;
        observed = await Promise.race([Promise.resolve(metric(store, ctx.now, p)), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('metric timed out')), 10000); })]).finally(() => clearTimeout(timer));
      } catch (e) { observed = NaN; ctx.notes.push(`prediction ${p.key}: metric ${p.metric} failed: ${String(e && e.message).slice(0, 120)}`); }
      if (typeof observed !== 'number' || !Number.isFinite(observed)) { await miss('metric returned no finite number, scored miss'); continue; }
      const verdict = op(observed, p.target) ? 'hit' : 'miss';
      await store.patch('predictions', p.key, { observed, verdict });
      ctx.notes.push(`prediction ${p.key}: ${p.metric}=${observed} ${verdict}`);
    }
  },

  /** Every claimed item whose probe the tick can read ends done (with evidence) or parked on that probe; parked items are re-read in a
   *  rotating window and close themselves when the probe passes. A probe that needs SQL leaves the claim for an executor that reads it. */
  async execute(store, ctx) {
    const max = ctx.config.execute_max_items ?? 20;
    const count = { done: 0, parked: 0, left: 0, reopened: 0 };
    const parkedAll = (await store.query('items', { where: { status: 'blocked' } })).filter(i => String(i.blocker || '').startsWith(WAITING)).sort((a, b) => (a.key < b.key ? -1 : 1));
    const start = parkedAll.length > max ? (ctx.tickId * max) % parkedAll.length : 0;
    for (const it of parkedAll.slice(start, start + max)) {
      const probe = await docProbe(store, ctx, it);
      if (probe && probe.ok) { await settle(store, ctx, it, probe); count.done++; count.reopened++; }
    }
    const roles = new Set((await store.scan('roles')).map(r => r.key));
    const claims = (await store.scan('claims')).filter(c => c.heartbeat_at === c.claimed_at && roles.has(c.agent));
    const claimed = [];
    for (const c of claims) { const it = await store.get('items', c.key); if (it && it.status === 'claimed') claimed.push({ it, at: c.claimed_at }); }
    claimed.sort((a, b) => (a.it.priority - b.it.priority) || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    for (const { it } of claimed.slice(0, max)) {
      const probe = await docProbe(store, ctx, it);
      if (!probe) { count.left++; continue; }
      count[await settle(store, ctx, it, probe)]++;
    }
    ctx.executed = count;
    ctx.notes.push(`executed: ${count.done} done (${count.reopened} from parked), ${count.parked} parked on a probe, ${count.left} left for an executor`);
  },

  /** Plus share over the last 20 closed items; below target opens a rebalance item. */
  async check_plus_share(store, ctx) {
    const rows = (await store.query('items', { where: { status: 'done' } })).sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0)).slice(0, 20);
    if (rows.length < 10) return;
    const share = rows.filter(r => r.kind === 'plus').length / rows.length;
    ctx.plusShare = share;
    if (share < ctx.config.plus_share / 2) {
      const made = await ensureItem(store, { id: `REBALANCE-${ctx.nowIso.slice(0, 10)}`, title: `Plus share ${(share * 100).toFixed(0)}% is under half the ${ctx.config.plus_share * 100}% target; rebalance and file the cause`,
        kind: 'fix', owner_role: 'portfolio-manager', done_check: 'plus share back over half the target over the next 20 closed items', priority: 5 }, ctx.nowIso);
      if (made) ctx.notes.push('rebalance item opened');
    }
  },

  /** Trust per (surface, action_class) from recorded outcomes; a crossed threshold opens a ladder item, once. */
  async accrue_trust(store, ctx) {
    const { trust, ladder, surfaces } = ctx.config.policy;
    const groups = new Map();
    for (const o of await store.scan('outcomes')) {
      const k = `${o.surface}|${o.action_class}`;
      const g = groups.get(k) || { surface: o.surface, action_class: o.action_class, ok: 0, severe: 0, n: 0 };
      g.n++; if (o.result === 'verified') g.ok++; if (o.result === 'hidden_failure' || o.result === 'silent_drop') g.severe++;
      groups.set(k, g);
    }
    for (const [k, r] of [...groups].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const rel = reliability(r.ok, r.n, trust);
      const cur = await store.get('trust_ledger', k);
      const rung = cur ? cur.rung : surfaces[r.surface]?.start_rung || 'observed';
      await store.set('trust_ledger', k, { surface: r.surface, action_class: r.action_class, rung, reliability: rel, outcomes: r.n, updated_at: ctx.nowIso });
      const idx = ladder.rungs.indexOf(rung);
      const ceilingIdx = ladder.rungs.indexOf(ladder.ceiling_by_max_permission[surfaces[r.surface]?.max_permission || 'none'] || 'observed');
      const promote = idx >= 0 && idx < ceilingIdx && r.n >= ladder.promote_when.min_outcomes && rel >= ladder.promote_when.min_reliability && r.severe === 0;
      const demote = idx > 0 && (rel < ladder.demote_when.reliability_below || r.severe > 0);
      if (promote || demote) {
        const to = ladder.rungs[promote ? idx + 1 : idx - 1];
        const made = await ensureItem(store, { id: `LADDER-${r.surface}-${r.action_class}-${to}`,
          title: `${promote ? 'Promote' : 'Demote'} ${r.surface}/${r.action_class} from ${rung} to ${to} (reliability ${rel.toFixed(2)} over ${r.n})`,
          kind: 'ladder', owner_role: 'operations', done_check: 'PR to autonomy/policy.json merged after review by a different agent',
          closing_probe: `trust_ledger rung = ${to}`, priority: demote ? 0 : 20, surface: r.surface, action_class: r.action_class }, ctx.nowIso);
        if (made) ctx.notes.push(`ladder item opened: ${r.surface}/${r.action_class} -> ${to}`);
      }
    }
  },

  /** Roles whose tick is due pull the top ready item for their role: an indexed query, then a transactional claim. A candidate
   *  another instance claimed in between is skipped and the next one tried. */
  async dispatch(store, ctx) {
    let n = 0;
    for (const role of await store.scan('roles')) {
      if (ctx.tickId % Math.max(1, role.tick_every || 1) !== 0) continue;
      const wip = (await store.query('claims', { where: { agent: role.key } })).length;
      if (wip >= ctx.config.max_wip_per_role) continue;
      const candidates = (await store.query('items', { where: { status: 'ready', owner_role: [...new Set([role.role, role.key])] }, orderBy: ['priority', 'created_at'] }))
        .filter(i => i.project == null || role.project == null || i.project === role.project)
        .sort((a, b) => (b.owner_role === role.key) - (a.owner_role === role.key));
      await store.patch('roles', role.key, { last_tick_at: ctx.nowIso });
      for (const item of candidates) {
        const won = await store.transaction(async tx => {
          const fresh = await tx.get('items', item.key);
          if (!fresh || fresh.status !== 'ready') return false;
          if (!(await tx.create('claims', item.key, { item_id: item.key, agent: role.key, claimed_at: ctx.nowIso, heartbeat_at: ctx.nowIso }))) return false;
          await tx.patch('items', item.key, { status: 'claimed', updated_at: ctx.nowIso });
          await tx.add('dispatches', { tick_id: ctx.tickId, role_id: role.key, item_id: item.key, model: role.model, status: 'queued', at: ctx.nowIso });
          return true;
        });
        if (won) { n++; break; }
      }
    }
    ctx.dispatched = (ctx.dispatched || 0) + n;
    ctx.notes.push(`dispatched ${n} item(s)`);
  },
};
/** The first three rewritten steps, kept as the name older callers know. */
export const STEP_ORDER = ['reconcile', 'accrue_trust', 'dispatch'];
/** All eight, in the order of core/src/tick.js STEP_ORDER. */
export const FULL_STEP_ORDER = ['reconcile', 'reap_claims', 'probe_gates', 'score_predictions', 'accrue_trust', 'dispatch', 'execute', 'check_plus_share'];

/** Run the rewritten steps as one tick and record it. A failing step is recorded and the rest still run, as in the core. */
export async function runDocTick(store, { config, env = {}, metrics = {}, now = Date.now(), tickId, steps = FULL_STEP_ORDER } = {}) {
  const nowIso = iso(now);
  const key = await store.add('tick_runs', { started_at: nowIso, finished_at: null, steps_completed: 0, steps_total: steps.length, report: null, errors: null });
  const ctx = { config: { claim_ttl_minutes: 120, max_wip_per_role: 3, plus_share: 0.2, max_unworked_releases: 3, execute_max_items: 20, ...config }, env, metrics, now, nowIso, tickId: tickId ?? Number(key), notes: [], errors: [], dispatched: 0, openGates: 0 };
  let completed = 0;
  for (const name of steps) {
    try { await STEPS[name](store, ctx); completed++; } catch (e) { ctx.errors.push(`${name}: ${e.message}`); }
  }
  await store.patch('tick_runs', key, { finished_at: nowIso, steps_completed: completed, report: ctx.notes.join('; '), errors: ctx.errors.length ? JSON.stringify(ctx.errors) : null });
  return { tickId: ctx.tickId, completed, total: steps.length, dispatched: ctx.dispatched, errors: ctx.errors, notes: ctx.notes };
}

/** Copy the L1 tables of a store handle into a document store (items, roles, claims, outcomes, trust_ledger, gate_cards, predictions, dispatches, tick_runs), keyed by primary key. */
export async function importFromStore(db, store) {
  const all = async sql => (await db.prepare(sql).bind().all()).results || [];
  for (const r of await all(`SELECT * FROM roles ORDER BY rowid`)) { const { id, ...d } = r; await store.set('roles', id, d); }
  for (const r of await all(`SELECT * FROM items ORDER BY rowid`)) { const { id, ...d } = r; await store.set('items', id, d); }
  for (const r of await all(`SELECT * FROM claims`)) await store.create('claims', r.item_id, r);
  for (const r of await all(`SELECT * FROM outcomes ORDER BY id`)) { const { id, ...d } = r; await store.add('outcomes', d); }
  for (const r of await all(`SELECT * FROM trust_ledger`)) await store.set('trust_ledger', `${r.surface}|${r.action_class}`, r);
  for (const r of await all(`SELECT * FROM gate_cards`)) { const { id, ...d } = r; await store.set('gate_cards', id, d); }
  for (const r of await all(`SELECT * FROM predictions`)) { const { id, ...d } = r; await store.set('predictions', id, d); }
  for (const r of await all(`SELECT * FROM dispatches ORDER BY id`)) { const { id, ...d } = r; await store.add('dispatches', d); }
  for (const r of await all(`SELECT * FROM tick_runs ORDER BY id`)) { const { id, ...d } = r; await store.add('tick_runs', d); }
}
