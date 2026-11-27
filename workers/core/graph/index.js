// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Topology graph and blast radius: which files, modules or services depend on a thing, so a change names what it can break.
// Ports: ctx = { db, now(), config, sources }. sources is an ORDERED LIST of edge providers ({ name, list() -> [{path, text}] }):
// no single route (a failing source is skipped and recorded; edges from other sources remain). Edges can also be declared by hand.
// JS and TS: static import, `import type`, re-export, require and dynamic import() with a string literal. Python: `from X import`, `import X`.
const JS_IMPORT_RE = /(?:\bimport\s*\(\s*|\bimport\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?|\bexport\s+(?:type\s+)?[^'"]*?\s+from\s+|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;
const PY_FROM_RE = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm;
const PY_IMPORT_RE = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]+as[ \t]+\w+)?(?:[ \t]*,[ \t]*[\w.]+(?:[ \t]+as[ \t]+\w+)?)*)/gm;
const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const nowMs = ctx => { const v = ctx.now(); return v instanceof Date ? v.getTime() : v; };
const dirname = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
export function normalize(from, spec) {
  if (!spec.startsWith('.')) return null;                 // only in-repo relative imports are edges
  const parts = (dirname(from) ? dirname(from).split('/') : []).concat(spec.split('/'));
  const out = [];
  for (const s of parts) { if (s === '.' || s === '') continue; if (s === '..') out.pop(); else out.push(s); }
  return out.join('/');
}
/** A Python relative import (`.util`, `..core.x`) resolved against the importing file; null when it climbs above the repository root. */
export function normalizePy(from, spec) {
  const dots = /^\.*/.exec(spec)[0].length;
  if (!dots) return null;
  const dir = dirname(from) ? dirname(from).split('/') : [];
  if (dots - 1 > dir.length) return null;
  const base = dir.slice(0, dir.length - (dots - 1));
  return [...base, ...spec.slice(dots).split('.').filter(Boolean)].join('/');
}
const isPy = path => /\.py$/.test(path);
/**
 * Files a source file imports, as paths without an extension for Python and as written for JS and TS. Only in-repo imports are
 * edges: relative ones always, and a Python absolute import when its first segment is a top-level directory of `known` (a Set of
 * the repository's top-level directory names); declare() adds the rest.
 */
export function extractEdges(path, text, { known = new Set() } = {}) {
  const src = String(text), dst = new Set();
  if (isPy(path)) {
    for (const m of src.matchAll(PY_FROM_RE)) {
      const mod = m[1];
      if (mod.startsWith('.')) {
        const target = normalizePy(path, mod);
        if (target === null) continue;
        if (/^\.+$/.test(mod)) {   // `from . import a, b`: the names are the modules
          for (const n of m[2].replace(/[()]/g, ' ').split(',').map(x => x.trim().split(/\s+as\s+/)[0].trim()).filter(x => /^\w+$/.test(x))) dst.add(target ? `${target}/${n}` : n);
        } else if (target) dst.add(target);
      } else if (known.has(mod.split('.')[0])) dst.add(mod.split('.').join('/'));
    }
    for (const m of src.matchAll(PY_IMPORT_RE))
      for (const part of m[1].split(',')) { const mod = part.trim().split(/\s+as\s+/)[0].trim(); if (mod && known.has(mod.split('.')[0])) dst.add(mod.split('.').join('/')); }
    return [...dst];
  }
  for (const m of src.matchAll(JS_IMPORT_RE)) { const t = normalize(path, m[1] || ''); if (t) dst.add(t); }
  return [...dst];
}
export async function ingest(ctx) {
  const ts = iso(nowMs(ctx)), report = [];
  for (const s of ctx.sources || []) {
    try {
      const files = await s.list();
      const known = new Set(files.filter(f => f.path.includes('/')).map(f => f.path.split('/')[0]));
      for (const f of files) {
        await ctx.db.prepare('INSERT INTO graph_nodes (id, updated_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at').bind(f.path, ts).run();
        await ctx.db.prepare("DELETE FROM graph_edges WHERE src = ? AND source = ?").bind(f.path, s.name).run();
        for (const d of extractEdges(f.path, f.text, { known })) await ctx.db.prepare("INSERT OR IGNORE INTO graph_edges (src, dst, rel, source) VALUES (?,?, 'imports', ?)").bind(f.path, d, s.name).run();
      }
      // A file the source no longer lists loses the edges this source produced for it (US-12-R22); only after a listing that succeeded,
      // so a failing source never erases the graph. Its node goes too when no other source still has an edge from it.
      const listed = new Set(files.map(f => f.path)), pruned = [];
      for (const r of (await ctx.db.prepare('SELECT DISTINCT src FROM graph_edges WHERE source = ?').bind(s.name).all()).results || []) {
        if (listed.has(r.src)) continue;
        await ctx.db.prepare('DELETE FROM graph_edges WHERE src = ? AND source = ?').bind(r.src, s.name).run();
        const left = await ctx.db.prepare('SELECT COUNT(*) AS n FROM graph_edges WHERE src = ?').bind(r.src).first();
        if (!left.n) await ctx.db.prepare("DELETE FROM graph_nodes WHERE id = ? AND kind = 'file'").bind(r.src).run();
        pruned.push(r.src);
      }
      report.push(pruned.length ? { source: s.name, ok: true, files: files.length, pruned: pruned.sort() } : { source: s.name, ok: true, files: files.length });
    } catch (e) { report.push({ source: s.name, ok: false, error: String(e?.message || e).slice(0, 200) }); }
  }
  return report;
}
export async function declare(ctx, src, dst, rel = 'calls') {
  await ctx.db.prepare("INSERT OR IGNORE INTO graph_edges (src, dst, rel, source) VALUES (?,?,?, 'declared')").bind(src, dst, rel).run();
}
const TS_AS_JS = { '.ts': '.js', '.tsx': '.js', '.mts': '.mjs', '.cts': '.cjs' };
/**
 * The spellings under which an import can name the changed path `n`: the path itself; an extensionless path (Python modules, TS
 * and JS imports written without one); a TS file imported with its compiled `.js` name; a bare module name with any source
 * extension and as a directory index; and a package directory for its `index` or `__init__` file.
 */
export function dstSpellings(n) {
  const out = new Set([n]);
  const m = /^(.*?)(\.[mc]?[jt]sx?|\.py)$/.exec(n);
  if (m) {
    out.add(m[1]);
    if (TS_AS_JS[m[2]]) out.add(m[1] + TS_AS_JS[m[2]]);
  } else {
    for (const e of ['.js', '.mjs', '.ts', '.tsx', '.py']) out.add(n + e);
    for (const idx of ['/index.js', '/index.mjs', '/index.ts', '/__init__.py']) out.add(n + idx);
  }
  const dir = /^(.*)\/(?:index\.[mc]?[jt]sx?|__init__\.py)$/.exec(n);
  if (dir) out.add(dir[1]);
  return [...out];
}
/**
 * Everything that transitively depends on any of the changed paths (breadth first, cycle safe). `affected` never holds more than
 * `maxNodes` paths, however many dependents one node has: the walk stops adding at the bound. `truncated` is true exactly when a
 * dependent was left out because of the bound.
 */
export async function blastRadius(ctx, changed, { maxNodes = 500 } = {}) {
  const seen = new Set(changed), queue = [...changed], hit = [];
  const dependents = async n => {
    const sp = dstSpellings(n);
    return (await ctx.db.prepare(`SELECT DISTINCT src FROM graph_edges WHERE dst IN (${sp.map(() => '?').join(',')}) ORDER BY src`).bind(...sp).all()).results;
  };
  let truncated = false;
  while (queue.length && !truncated) {
    const rows = await dependents(queue.shift());
    for (const r of rows) {
      if (seen.has(r.src)) continue;
      if (hit.length >= maxNodes) { truncated = true; break; }
      seen.add(r.src); hit.push(r.src); queue.push(r.src);
    }
  }
  return { changed, affected: hit.sort(), truncated };
}
