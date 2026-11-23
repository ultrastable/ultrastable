// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// SEED-AUTONOMY-1: /health carries the stage the system read for itself, so a launcher can tell a seed that only ticks from one whose loops run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, existsSync, rmSync } from 'node:fs';

test('/health reports the ignition stage and what blocks the next one', async () => {
  const cfg = new URL('../src/config.js', import.meta.url);
  const made = !existsSync(cfg);
  if (made) writeFileSync(cfg, 'export default ' + JSON.stringify({ org_slug: 'test', budget: { usd_per_month: 0 } }) + ';\n');
  try {
    const mod = await import('../src/index.js');
    const snap = { stage: 'ticking', since: '2026-11-22 00:00:00', at: '2026-11-23 00:00:00', blocking: { stage: 'looping', why: 'not ticking: lane (failing)' }, holds: {} };
    const DB = { prepare(sql) { const o = { bind() { return o; }, run: async () => ({}), all: async () => ({ results: [] }),
      first: async () => /FROM org/i.test(sql) ? { value: JSON.stringify(snap) } : null }; return o; } };
    const r = await mod.default.fetch(new Request('https://x/health'), { DB }, { waitUntil() {} });
    const j = await r.json();
    assert.equal(j.ignition.stage, 'ticking');
    assert.equal(j.ignition.blocking.stage, 'looping');
    assert.match(j.ignition.blocking.why, /lane \(failing\)/);
    assert.equal(j.ignition.holds, undefined);  // the compact reading only
  } finally { if (made) rmSync(cfg); }
});
