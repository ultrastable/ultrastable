// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// VERIFY-1: property-based conformance of the real spend governor (seed/worker/src/spend.js) to the model in foundation/verify.py.
// Prints one JSON line: the BANDS the model reads and the result of each property over a seeded random and boundary sample.
const { BANDS, level } = await import(process.argv[2] || new URL('../seed/worker/src/spend.js', import.meta.url).href);
let seed = 20261121; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const shares = [0, 0.4999, 0.5, 0.6999, 0.7, 0.8999, 0.9, 1, 10, 1e9, -1, NaN, Infinity];
for (let i = 0; i < 2000; i++) shares.push(rnd() * 3);
const fail = { returns_band: [], pace_finite: [], monotone: [], essential_never_off: [] };
const pace = (s) => { const r = level({ plan: 'paid', usd_today: s * 5, fixed_usd: 0 }, 5, new Date('2026-11-21T01:00:00Z')); return r; };
let prev = null;
for (const s of [...shares].filter(Number.isFinite).sort((a, b) => a - b)) {
  const r = pace(s);
  if (!BANDS.some(b => b.level === r.level)) fail.returns_band.push(s);
  if (!(Number.isFinite(r.knobs.pace) && r.knobs.pace >= 1)) fail.pace_finite.push(s);
  if (prev && r.knobs.pace < prev.knobs.pace) fail.monotone.push(s);
  if (!r.knobs.ai) fail.essential_never_off.push(s);
  prev = r;
}
for (const s of shares.filter(x => !Number.isFinite(x))) { const r = pace(s); if (!BANDS.some(b => b.level === r.level) || !Number.isFinite(r.knobs.pace)) fail.returns_band.push(String(s)); }
console.log(JSON.stringify({ bands: BANDS.map(b => ({ level: b.level, below: Number.isFinite(b.below) ? b.below : null, pace: b.pace })), samples: shares.length, fail }));
