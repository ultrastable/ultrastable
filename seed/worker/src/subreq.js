// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// SUBREQUEST-METER-1: one generic guard against the Workers Free plan's 50 subrequests per invocation ("Too many subrequests by single Worker invocation").
// Rotation (SUBREQUEST-ROTATION-1/2) spread the loops over four ticks, but a tick still shared its 50 calls with the tick steps and with loops that grew
// (issuesync re-read every roadmap file each run), so gate, issuesync and repo-access kept failing. The meter counts every fetch of the invocation, refuses a call
// that would pass the cap, and the scheduler turns a refusal into a DEFERRAL: the loop is recorded `deferred` (not failed), is carried to the front of the next
// invocation, and a loop is not started when its minimum cost no longer fits. No loop can fail for this reason again; it can only wait one tick, in order.
export const SUBREQUEST_CAP = 50;
export const SUBREQUEST_RESERVE = 4;
// PLAN-1: Workers Paid allows 10,000 subrequests per invocation. 1,000 is planned (GitHub's per-installation rate limit binds long before that), and each
// loop's share grows fivefold, so the loops that waited for rotation now run every tick.
export const PAID_SUBREQUEST_CAP = 1000;
export function capsFor(plan) {
  if (plan !== 'paid') return { cap: SUBREQUEST_CAP, shares: LOOP_MAX_COST, rotate: true };
  return { cap: PAID_SUBREQUEST_CAP, shares: Object.fromEntries(Object.entries(LOOP_MAX_COST).map(([k, v]) => [k, v * 5])), rotate: false };
}  // kept for the beat, the deferral record and any call the runtime makes for itself
// Minimum calls a loop needs to make progress; below it the loop is deferred before it starts. Measured from the loops' own call patterns.
export const LOOP_MIN_COST = { gate: 10, lane: 10, handoffs: 12, issuesync: 4, 'repo-access': 5, sweeper: 8, 'deploy-evidence': 5, 'watchdog-gh': 3, 'host-hooks': 4, hosts: 4, social: 6, executor: 6 };

// Most calls one loop may spend in one invocation. Without it the first loop to run (handoffs, ~40 calls) took the whole budget every tick and the loops behind it
// were deferred forever (seen live 2026-11-18 01:41 and 01:51 UTC: used 43-44 of 46 by handoffs). A loop that hits its share stops with the work it did and resumes next tick.
export const LOOP_MAX_COST = { handoffs: 16, lane: 12, gate: 12, issuesync: 8, 'repo-access': 8, sweeper: 10, 'deploy-evidence': 8, executor: 12, 'watchdog-gh': 4, 'host-hooks': 5, hosts: 5, social: 9 };  // SOCIAL-TENANTS-1: gate, calendar, tenant queue, token refresh and one post per linked channel is 6 to 8 calls; 5 starved every post after 2026-11-20 01:10 UTC

export class SubrequestBudgetError extends Error { constructor(msg) { super(msg); this.name = 'SubrequestBudgetError'; } }
const BUDGET_RE = /too many subrequests|subrequest budget/i;
export const isBudgetError = e => e instanceof SubrequestBudgetError || BUDGET_RE.test(String((e && e.message) || e || ''));
export const mentionsBudget = out => { try { return BUDGET_RE.test(typeof out === 'string' ? out : JSON.stringify(out)); } catch { return false; } };

export function createMeter({ cap = SUBREQUEST_CAP, reserve = SUBREQUEST_RESERVE } = {}) {
  const limit = Math.max(1, Number(cap) - Number(reserve));
  const m = {
    cap: Number(cap), limit, used: 0, refused: 0,
    remaining: () => Math.max(0, limit - m.used),
    exhausted: () => m.refused > 0 || m.used >= limit,
    scope: null,  // { start, max }: the share of the invocation the running loop may spend
    take(n = 1) { if (m.used + n > limit || (m.scope && m.used - m.scope.start + n > m.scope.max)) { m.refused++; return false; } m.used += n; return true; },
    wrap(f) { return (...a) => m.take() ? f(...a) : Promise.reject(new SubrequestBudgetError(`subrequest budget ${m.used}/${limit} used in this invocation`)); },
    // Counts every global fetch of this invocation, including the ones modules make without being handed a wrapped fetch. Returns the restore function.
    install(g = globalThis) {
      if (g.__subreq) return () => {};
      const orig = g.fetch; g.fetch = m.wrap(orig.bind(g)); g.__subreq = m;
      return () => { g.fetch = orig; delete g.__subreq; };
    },
    report: () => ({ used: m.used, limit, refused: m.refused }),
  };
  return m;
}

const KEY = 'deferred_loops';
export async function readDeferred(db) {
  try { const r = await db.prepare(`SELECT value FROM org WHERE key=?`).bind(KEY).first(); const v = r && JSON.parse(r.value); return Array.isArray(v) ? v : []; } catch { return []; }
}
export async function writeDeferred(db, list) {
  try { await db.prepare(`INSERT INTO org (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(KEY, JSON.stringify([...list])).run(); } catch (e) { return { error: 'deferred not recorded: ' + String((e && e.message) || e).slice(0, 160) }; }  // the caller's loop result carries it
}

// Wraps a loop body: deferral instead of failure. `deferred` (a Set) collects the loops to carry to the next invocation.
export function guarded(meter, deferred, failed, costs = LOOP_MIN_COST, shares = LOOP_MAX_COST) {
  const defer = (loop, why, extra = {}) => { deferred.add(loop); return { status: 'deferred', reason: why, ...meter.report(), ...extra }; };
  return async (loop, fn) => {
    const need = costs[loop] || 0;
    if (meter.remaining() < need) return defer(loop, `needs ${need} subrequests, ${meter.remaining()} left`);
    let out;
    meter.scope = shares[loop] ? { start: meter.used, max: shares[loop] } : null;
    try { out = await fn(); } catch (e) { if (isBudgetError(e)) return defer(loop, 'subrequest budget'); throw e; } finally { meter.scope = null; }
    if ((meter.refused > 0 || mentionsBudget(out)) && failed(out)) return defer(loop, 'subrequest budget', { partial: out });
    return out;
  };
}
