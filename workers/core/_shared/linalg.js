// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Small dense linear algebra, no dependencies. Matrices are arrays of rows.
export function solve(A, b) {
  const n = A.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) throw new Error('singular matrix');
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Normal-equations matrix X'X + lambda*I (the intercept in column 0 is not penalised).
export function gram(X, lambda) {
  const p = X[0].length;
  const G = Array.from({ length: p }, () => new Array(p).fill(0));
  for (const row of X) for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) G[i][j] += row[i] * row[j];
  for (let i = 1; i < p; i++) G[i][i] += lambda;
  return G;
}

export function ridgeFit(X, y, lambda = 1e-3) {
  const p = X[0].length;
  const b = new Array(p).fill(0);
  X.forEach((row, k) => { for (let i = 0; i < p; i++) b[i] += row[i] * y[k]; });
  return solve(gram(X, lambda), b);
}

export function inverse(A) {
  const n = A.length;
  const cols = [];
  for (let i = 0; i < n; i++) cols.push(solve(A, Array.from({ length: n }, (_, k) => (k === i ? 1 : 0))));
  return Array.from({ length: n }, (_, r) => cols.map(c => c[r]));
}

export const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
export const mean = a => a.reduce((s, v) => s + v, 0) / (a.length || 1);
export const sd = a => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
export function median(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
export const mad = a => { const m = median(a); return median(a.map(v => Math.abs(v - m))) * 1.4826; };

export function standardize(rows) { // rows: n x p -> { Z, means, sds }
  const p = rows[0].length;
  const means = [], sds = [];
  for (let j = 0; j < p; j++) { const col = rows.map(r => r[j]); means.push(mean(col)); sds.push(sd(col) || 1); }
  return { Z: rows.map(r => r.map((v, j) => (v - means[j]) / sds[j])), means, sds };
}

// Deterministic PRNG so every result is reproducible from its seed.
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function normal(r) { return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r()); }

export function nearest(Z, i, k, allowed) { // k nearest rows to row i among allowed indices
  const d = [];
  for (const j of allowed) if (j !== i) d.push([j, Z[i].reduce((s, v, c) => s + (v - Z[j][c]) ** 2, 0)]);
  return d.sort((a, b) => a[1] - b[1]).slice(0, k).map(x => x[0]);
}
