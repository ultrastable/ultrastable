// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Pack sandbox (US-21-R06, R08): a pack loop never receives the raw db, the tick context or an unbound guard.
//  - sandboxDb: a db port whose statements are checked before they are prepared. Writes only to the pack's own tables
//    (`<id>_*`), plus INSERT into `items` and INSERT or UPDATE-by-id on `predictions` for rows whose id starts with the pack id (checked when
//    the statement is bound); no DDL, no PRAGMA/ATTACH, no multi-statement text, no quoted identifiers; no access to the registry, switches,
//    consent tokens, trust ledger, roles, gate cards, suppression list or the schema tables; the approval queue is readable only as
//    `SELECT status, reason FROM guard_queue WHERE id = ?`, never the raw recipient or content (US-21-R08).
//  - sandboxCtx: the tick context without env, config or db.
//  - freezeGuard: the bound guard with no mutable surface.
//  - scanPackSource: static check at registration that a pack imports nothing that reaches the raw guard or the platform and holds no
//    ambient network path (global fetch, sockets, WebSocket, XMLHttpRequest): a pack sends only through the guard (US-21-R06, R15).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { lex, render, bindings, unboundReferences, moduleSpecifiers } from './lex.js';

const CORE_DIR = (() => { try { return fileURLToPath(new URL('../', import.meta.url)); } catch { return null; } })(); // not a URL inside a deployed Worker (error 10021)
export const SHARED_WRITE_TABLES = ['items', 'predictions'];
const NO_ACCESS = /\b(packs_registry|packs_switches|guard_consent)\b/i;
// Read as well as write is refused for these (US-21-R08): another pack's or the platform's records, and the schema. Checked after the write targets,
// so an attempted write still names the table it was aimed at.
const NO_READ = /\b(trust_ledger|roles|gate_cards|guard_suppression|sqlite_master|sqlite_schema|sqlite_temp_master|sqlite_temp_schema)\b/i;
const QUEUE_STATUS_READ = /^\s*select\s+(?:status|reason|id)(?:\s*,\s*(?:status|reason|id))*\s+from\s+guard_queue\s+where\s+id\s*=\s*\?\s*$/i;
const SCOPED_TABLES = ['items', 'predictions'];   // shared tables a pack writes only rows of its own to
const DDL = /^\s*(create|drop|alter|pragma|attach|detach|vacuum|reindex|analyze)\b|\bload_extension\b/i;
const WRITE_TARGET = /\b(?:insert\s+(?:or\s+\w+\s+)?into|replace\s+into|(?<!\bdo\s+)update(?:\s+or\s+\w+)?|delete\s+from)\s+([A-Za-z_][\w.]*)/gi;

// Strip comments and string literals so keywords inside text cannot hide or fake a table reference.
export function stripSql(sql) {
  return String(sql).replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''");
}

// A shared-table write is allowed only in a form whose row id can be checked when the statement is bound: INSERT (...id...) VALUES (?...) or
// UPDATE predictions SET ... WHERE id = ?. Returns { reason } when refused, { idArg } (the bound parameter holding the id) when allowed, or null.
function scopedWrite(s) {
  let plan = null;
  for (const m of s.matchAll(WRITE_TARGET)) {
    const t = m[1].toLowerCase();
    if (!SCOPED_TABLES.includes(t)) continue;
    const verb = m[0].slice(0, m[0].length - m[1].length).trim().toLowerCase();
    if (plan) return { reason: `shared_table_unscoped_write:${t}` };
    if (verb.startsWith('delete')) return { reason: `shared_table_delete:${t}` };
    if (verb.startsWith('update')) {
      if (t === 'items') return { reason: 'shared_table_update:items' };
      const w = /\bwhere\s+id\s*=\s*\?\s*$/i.exec(s);
      if (!w) return { reason: 'shared_table_unscoped_update:predictions' };
      plan = { idArg: (s.slice(0, w.index).match(/\?/g) || []).length };
    } else {
      const ins = /\binto\s+\w+\s*\(([^)]*)\)\s*values\s*\(([^)]*)\)/i.exec(s);
      if (!ins) return { reason: `shared_table_unscoped_insert:${t}` };
      const cols = ins[1].split(',').map(x => x.trim().toLowerCase()), vals = ins[2].split(',').map(x => x.trim());
      const at = cols.indexOf('id');
      if (at < 0 || vals[at] !== '?') return { reason: `shared_table_unscoped_insert:${t}` };
      plan = { idArg: vals.slice(0, at).filter(v => v === '?').length };
    }
  }
  return plan;
}

// Returns a reason string when the statement is refused, else null. checkSql is the static half; the id of a shared-table row is checked at bind time.
export function checkSql(sql, packId) {
  const s = stripSql(sql);
  if (/["`\[]/.test(s)) return 'quoted_identifier';
  if (/;\s*\S/.test(s)) return 'multiple_statements';
  if (DDL.test(s)) return 'ddl_or_pragma';
  if (NO_ACCESS.test(s)) return 'forbidden_table';
  const own = `${packId}_`;
  for (const m of s.matchAll(WRITE_TARGET)) {
    const t = m[1].toLowerCase();
    if (!(t === packId || t.startsWith(own) || SHARED_WRITE_TABLES.includes(t))) return `write_outside_pack:${t}`;
  }
  if (NO_READ.test(s)) return 'forbidden_table';
  if (/\bguard_queue\b/i.test(s) && !QUEUE_STATUS_READ.test(s)) return 'forbidden_table_columns:guard_queue';
  const sw = scopedWrite(s);
  if (sw && sw.reason) return sw.reason;
  return null;
}

// A row id belongs to a pack when it is the pack id, starts with `<id>-` or `<id>_`, or starts with the pack id in capitals (the shipped packs file
// SOCIALVERIFY-12, DRAFTSTALE-3, CLOUDUNLOGGED-...). The host's own item ids (PACKFAIL-, PACKTRIAL-, PACKPLUS-) are never a pack's.
const HOST_ITEM_PREFIX = /^PACK(FAIL|TRIAL|PLUS)\b/;
const idOwned = (packId, id) => {
  const x = String(id ?? '');
  if (HOST_ITEM_PREFIX.test(x)) return false;
  return x === packId || x.startsWith(`${packId}-`) || x.startsWith(`${packId}_`) || x.startsWith(packId.toUpperCase());
};

export function sandboxDb(db, packId) {
  if (!/^[a-z][a-z0-9_]*$/.test(String(packId))) throw new Error('sandboxDb: bad pack id');
  return Object.freeze({
    prepare(sql) {
      const why = checkSql(sql, packId);
      if (why) throw new Error(`pack sandbox refused statement (${why})`);
      const plan = scopedWrite(stripSql(sql));
      const stmt = db.prepare(sql);
      if (!plan) return stmt;
      // A write to items or predictions: the row id must belong to this pack (its id, or <id>- or <id>_ first), so a pack cannot change or
      // take over another pack's or the platform's row (US-21-R08). Executing without binding is refused for such a statement.
      const refuse = () => { throw new Error('pack sandbox refused statement (shared_table_id_not_owned)'); };
      return Object.freeze({
        bind(...args) { if (!idOwned(packId, args[plan.idArg])) refuse(); return stmt.bind(...args); },
        run: refuse, all: refuse, first: refuse, raw: refuse,
      });
    },
  });
}

export function sandboxCtx(ctx, wrap = x => x) {
  return Object.freeze({ tickId: ctx.tickId, nowIso: ctx.nowIso, now: ctx.now, notes: wrap(ctx.notes), errors: wrap(ctx.errors) });
}

export function freezeGuard(g) {
  return Object.freeze({ ...g, consent: Object.freeze({ ...g.consent }) });
}

// ---- static source scan ----
const ALLOWED_CORE = [
  { file: 'kernel/util.js' }, { dir: 'describe/' },
  { file: 'packs/guard.js', names: ['sha256'] },     // a pure hash helper; createGuard stays out of reach
];
const BAD_NODE = /^(node:)?(fs|fs\/promises|child_process|net|http|https|http2|tls|dns|dns\/promises|inspector|worker_threads|vm|cluster|dgram|os|module|process)$/;
const BAD_SPECIFIER = /^cloudflare:/;   // cloudflare:sockets and friends open connections the guard cannot see (US-21-R15)
// Ambient network access (US-21-R15). A network call must go through a port the host injects, so the only `fetch` a pack may call is one
// its own code receives as a parameter or declares from an injected object; every global reach is refused. The checks read tokens (lex.js), so a
// string, comment or template text can neither hide a reach nor fake one.
const AMBIENT_NET = [
  [/\b(?:globalThis|self|window|global)\s*\.\s*fetch\b/, 'global fetch'],
  [/\bnew\s+(?:WebSocket|WebSocketPair|EventSource|XMLHttpRequest)\b|\bXMLHttpRequest\b/, 'a network constructor'],
  [/\bnavigator\s*\.\s*sendBeacon\b/, 'sendBeacon'],
];
// Names that reach the network when read from the global scope: used as a value they must be bound by an enclosing function or declaration.
const GUARDED_GLOBALS = new Set(['fetch', 'WebSocket', 'WebSocketPair', 'EventSource', 'XMLHttpRequest', 'navigator']);
const GLOBAL_OBJECTS = new Set(['globalThis', 'self', 'window', 'global']);
const GLOBAL_PROPS_REFUSED = new Set(['fetch', 'WebSocket', 'WebSocketPair', 'EventSource', 'XMLHttpRequest', 'navigator', 'process', 'eval', 'Function', 'constructor', 'require', 'import', 'caches']);

function* walk(dir) {
  for (const n of readdirSync(dir)) {
    if (n === 'node_modules') continue;
    const p = path.join(dir, n), st = statSync(p);
    if (st.isDirectory()) yield* walk(p); else if (/\.m?js$/.test(n) && !/\.test\.m?js$/.test(n)) yield p;
  }
}

// Problems one source text has apart from where its imports resolve (that needs the file's path): the same check for a file on disk and for a string.
export function scanSource(src, rel = 'source') {
  const errors = [];
  const toks = lex(src);
  const { code } = render(toks);
  if (/\beval\s*\(|\bnew\s+Function\s*\(|\bprocess\s*\.\s*(env|binding|dlopen)|\bglobalThis\s*\.\s*process/.test(code)) errors.push(`${rel}: uses eval, Function or process access`);
  for (let k = 0; k < toks.length; k++) {         // import( must take a string literal: a computed specifier cannot be checked
    if (toks[k].t === 'id' && toks[k].v === 'import' && toks[k + 1] && toks[k + 1].v === '(' && toks[k + 1].t === 'p' && !(toks[k + 2] && toks[k + 2].t === 'str' && toks[k + 3] && toks[k + 3].v === ')')) { errors.push(`${rel}: dynamic import with a computed specifier`); break; }
  }
  for (const [re, what] of AMBIENT_NET) if (re.test(code)) errors.push(`${rel}: reaches the network through ${what}; use an injected port (US-21-R15)`);
  const scopes = bindings(toks);
  for (const name of unboundReferences(toks, GUARDED_GLOBALS, scopes)) errors.push(`${rel}: uses ${name} without receiving it as a parameter or from an injected object; use an injected port (US-21-R15)`);
  for (let k = 0; k < toks.length; k++) {         // the global object itself: no computed access, no use as a value, no network or code-loading property
    const t = toks[k];
    if (t.t !== 'id' || !GLOBAL_OBJECTS.has(t.v)) continue;
    const pv = toks[k - 1], nx = toks[k + 1], nn = toks[k + 2];
    if (pv && pv.t === 'p' && (pv.v === '.' || pv.v === '?.')) continue;
    if (scopes.some(sc => sc.start <= k && k <= sc.end && sc.names.has(t.v))) continue;
    if (nx && nx.t === 'p' && nx.v === '[') {
      const lit = nn && nn.t === 'str' && toks[k + 3] && toks[k + 3].v === ']' ? nn.v : null;
      errors.push(lit && GLOBAL_PROPS_REFUSED.has(lit) ? `${rel}: reaches the network through global ${lit}; use an injected port (US-21-R15)` : `${rel}: computed access on ${t.v} (US-21-R15)`);
    }
    else if (nx && nx.t === 'p' && (nx.v === '.' || nx.v === '?.') && nn && nn.t === 'id') { if (GLOBAL_PROPS_REFUSED.has(nn.v)) errors.push(`${rel}: reads ${t.v}.${nn.v} (US-21-R15)`); }
    else if (!(pv && pv.t === 'id' && pv.v === 'typeof')) errors.push(`${rel}: uses ${t.v} as a value; read a named property or take an injected port (US-21-R15)`);
  }
  return { errors: [...new Set(errors)], toks };
}

export function scanPackSource(dir) {
  const errors = [];
  const root = path.resolve(dir);
  for (const f of walk(root)) {
    const rel = path.relative(root, f).split(path.sep).join('/');
    const scanned = scanSource(readFileSync(f, 'utf8'), rel);
    errors.push(...scanned.errors);
    for (const { spec, names } of moduleSpecifiers(scanned.toks)) {
      if (!spec.startsWith('.')) { if (BAD_NODE.test(spec) || BAD_SPECIFIER.test(spec)) errors.push(`${rel}: imports ${spec}`); continue; }
      const abs = path.resolve(path.dirname(f), spec);
      if (abs === root || abs.startsWith(root + path.sep)) continue;
      const inCore = path.relative(CORE_DIR, abs).split(path.sep).join('/');
      const ok = !inCore.startsWith('..') && ALLOWED_CORE.some(a => a.file ? inCore === a.file : inCore.startsWith(a.dir));
      const rule = ok && ALLOWED_CORE.find(a => a.file === inCore);
      if (!ok || (rule && rule.names && (!names.length || names.some(n => !rule.names.includes(n))))) errors.push(`${rel}: imports ${spec}, outside the pack and the allowed core helpers (US-21-R06)`);
    }
  }
  return errors;
}
