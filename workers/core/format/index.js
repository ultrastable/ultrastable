// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Status of every piece is kept in core/format/README.md.
// NUMFMT-1: one formatter for every number a reader sees. A measured or calculated value is shown to the precision it can be believed to,
// never as the raw float: percentages to a whole number (one decimal below 10), counts to two or three significant figures with a unit word
// ("1.0 million"), other values to three significant figures. Tenant-agnostic and dependency-free so it can lift into core unchanged.
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 20 });
const group = n => nf.format(n);
// two significant figures below 100, three from 100 up, always at least one decimal below 10 ("1.0")
const scaled = x => { const a = Math.abs(x); return a < 10 ? x.toFixed(1) : a < 100 ? String(Math.round(x)) : group(Number(x.toPrecision(3))); };
export function sig(v, digits = 3) { if (!Number.isFinite(v)) return ''; if (v === 0) return '0'; const r = Number(v.toPrecision(digits)); return Math.abs(r) >= 1000 ? group(r) : String(r); }
export function pct(v) { if (!Number.isFinite(v)) return ''; const a = Math.abs(v); return (a < 10 ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v))) + '%'; }
export function count(v) {
  if (!Number.isFinite(v)) return '';
  const a = Math.abs(v);
  if (a >= 1e9) return scaled(v / 1e9) + ' billion';
  if (a >= 1e6) return scaled(v / 1e6) + ' million';
  if (a >= 1e4) return Math.round(v / 1e3) + ' thousand';
  if (a >= 1e3) return group(Number(v.toPrecision(2)));
  return sig(v, 3);
}
// What the title says its value is measured in: the last parenthesis, e.g. "(% of female teachers)" or "(per 100 000 population)".
export function unitOf(title) {
  const m = /\(([^()]*)\)\s*[^()]*$/.exec(String(title || '')); if (!m) return { kind: 'plain', label: '', scale: 1 };
  const u = m[1].replace(/ | /g, ' ').replace(/(\d) (\d{3})\b/g, '$1,$2').trim();
  if (/^%|^percent|^proportion|^share/i.test(u)) return { kind: 'pct', label: '%', scale: 1 };
  if (/^in thousands?$|^thousands?$/i.test(u)) return { kind: 'plain', label: '', scale: 1e3 };
  if (/^in millions?$|^millions?$/i.test(u)) return { kind: 'plain', label: '', scale: 1e6 };
  if (/^(number|number of cases|total|gross|net|index|current|constant)/i.test(u) && !/\$/.test(u)) return { kind: 'plain', label: /^number/i.test(u) ? '' : u, scale: 1 };
  return { kind: 'plain', label: u, scale: 1 };
}
// A value of an indicator with the title's unit, rounded for reading: "28%", "1.0 million", "37.2 per 1,000 live births".
export function figure(v, title) {
  if (v == null || !Number.isFinite(+v)) return '';
  const u = unitOf(title), x = +v * u.scale;
  if (u.kind === 'pct') return pct(x);
  const n = u.scale > 1 || Math.abs(x) >= 1e3 ? count(x) : sig(x, 3);
  return u.label ? `${n} ${u.label}` : n;
}
// A yearly log change as a rate of change a reader can use: "down 3.2% a year".
export function rate(logChange) { if (!Number.isFinite(logChange)) return ''; const p = (Math.exp(logChange) - 1) * 100, a = Math.abs(p); const s = a < 0.05 ? '0' : a < 10 ? a.toFixed(1) : String(Math.round(a)); return (p < -0.05 ? 'down ' : p > 0.05 ? 'up ' : 'flat, ') + s + '% a year'; }
// Raw numbers in JSON feeds are rounded to six significant figures so float noise (82.0999908447266) is never published.
export const machine = v => Number.isFinite(v) ? Number(Number(v).toPrecision(6)) : v;
// Lint: text a reader sees must not carry false precision. Used by the page test.
// A decimal with more than five significant digits is false precision for anything measured or calculated (82.0999908447266, 45.800000000000004);
// an integer of seven or more digits without separators is a raw count. DOIs (10.5281/...), URLs and source codes (HIV_0000000023) are identifiers and pass.
export const FALSE_PRECISION = /(?<![\w.\/-])\d+\.\d{3,}(?![\d\/])|(?<![\w,.\/-])\d{7,}(?![\w,\/])/g;
const sigDigits = t => t.replace('.', '').replace(/^0+/, '').length;
export function falsePrecision(html) {
  const text = String(html).replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ');
  for (const m of text.matchAll(FALSE_PRECISION)) if (m[0].includes('.') ? sigDigits(m[0]) > 5 : true) return { match: m[0], context: text.slice(Math.max(0, m.index - 40), m.index + 50).replace(/\s+/g, ' ') };
  return null;
}
