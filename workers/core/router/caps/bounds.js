// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// One iteration-bounds contract (US-09-R04): steps, tokens, wall-clock time and spend are bounded together, and a bound that
// is spent is final for the iteration. core/router reads it through `request.bounds`. Ports: now() (ms), record(row) (optional;
// a router_gate_records-style row, written once when a bound is first exceeded).
const KEYS = { steps: 'steps', tokens: 'tokens', wall_ms: 'wall', usd: 'spend' };

export function createBounds(limits = {}, { now = Date.now, record = null } = {}) {
  for (const [k, v] of Object.entries(limits)) if (!(k in KEYS) || !(Number(v) >= 0)) throw new Error(`bounds: ${k} is not a bound or is negative (steps, tokens, wall_ms, usd)`);
  if (!Object.keys(limits).length) throw new Error('bounds: an iteration needs at least one bound');
  const started = now(), used = { steps: 0, tokens: 0, usd: 0 };
  let exceeded = null;
  const wall = () => now() - started;
  const remaining = () => ({
    steps: limits.steps == null ? Infinity : limits.steps - used.steps,
    tokens: limits.tokens == null ? Infinity : limits.tokens - used.tokens,
    wall_ms: limits.wall_ms == null ? Infinity : limits.wall_ms - wall(),
    usd: limits.usd == null ? Infinity : limits.usd - used.usd,
  });
  /** { ok, exceeded, remaining }: the first bound found spent, in the order steps, tokens, wall, spend; sticky once set. */
  function check() {
    if (!exceeded) {
      const r = remaining();
      for (const k of ['steps', 'tokens', 'wall_ms', 'usd']) if (limits[k] != null && r[k] <= 0) { exceeded = KEYS[k]; break; }
      if (exceeded && record) record({ what: `Iteration bound spent: ${exceeded}`, limit: limits, used: { ...used, wall_ms: wall() } });
    }
    return { ok: !exceeded, exceeded, remaining: remaining() };
  }
  function charge({ steps = 0, tokens = 0, usd = 0 } = {}) { used.steps += steps; used.tokens += tokens; used.usd += usd; return check(); }
  return { check, charge, limits: { ...limits }, used: () => ({ ...used, wall_ms: wall() }) };
}
