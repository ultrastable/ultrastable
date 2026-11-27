// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-14-R07 and R14: every migration and every static SQL statement the modules send translates for Postgres, or is named in
// adapters/postgres/portability-baseline.json with a reason. The baseline only shrinks: a finding that is gone must be removed, and a
// new finding fails. Dynamic statements (a template expression inside) are scanned with the expression replaced by a stand-in identifier.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { translate, translateMigration } from './index.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BASE = JSON.parse(readFileSync(new URL('./portability-baseline.json', import.meta.url), 'utf8'));
const SKIP_DIR = new Set(['node_modules']);
const rel = f => path.relative(ROOT, f).split(path.sep).join('/');

function walk(dir, ok, out = []) {
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) { if (!SKIP_DIR.has(n)) walk(p, ok, out); } else if (ok(n, p)) out.push(p);
  }
  return out;
}
const migrations = [...walk(path.join(ROOT, 'core'), n => n.endsWith('.sql')), ...walk(path.join(ROOT, 'adapters'), n => n.endsWith('.sql'))].sort();
// SQLite by design, not a port target: the SQLite adapter itself and the per-tenant Durable Object storage (core/tenantstore, tenant-do.js,
// tenants-worker.js) whose storage is SQLite whatever store the organisation runs on; the Postgres adapter is the translator under test.
const BY_DESIGN = f => /\/adapters\/(sqlite|postgres)\/|\/core\/tenantstore\/|\/tenant-do\.js$|\/tenants-worker\.js$/.test(f.split(path.sep).join('/'));
const modules = [...walk(path.join(ROOT, 'core'), n => n.endsWith('.js') && !/\.test\.js$|testkit\.js$|\.generated\.js$/.test(n)), ...walk(path.join(ROOT, 'adapters'), n => n.endsWith('.js') && !/\.test\.js$|\.generated\.js$/.test(n))].filter(f => !BY_DESIGN(f)).sort();
// What is scanned: backtick strings that open with a statement keyword, PRAGMA strings, and single- or double-quoted strings that open with a statement
// keyword and carry FROM, INTO, SET, VALUES or WHERE (so prose is not read as SQL). A template expression inside a string is replaced by an identifier-shaped
// stand-in, so the static parts of a dynamic statement are translated too: an identifier after FROM, INTO, UPDATE, JOIN or TABLE, a number anywhere else. The stand-in is never what the module sends, only what the shim must survive; a finding that only the stand-in causes is named as such in the baseline.
const STATEMENT = /(`)((?:SELECT|INSERT|UPDATE|DELETE|REPLACE|WITH)\b[^`]*)`|(['"`])(PRAGMA\b[^'"`;]*)\3|'((?:SELECT|INSERT|UPDATE|DELETE|WITH)\s(?:[^'\\\n]|\\.)*)'|"((?:SELECT|INSERT|UPDATE|DELETE|WITH)\s(?:[^"\\\n]|\\.)*)"/g;
const SQLISH = /\b(FROM|INTO|SET|VALUES|WHERE)\b/;
const standIn = sql => sql.replace(/\$\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, (m, at) => (/\b(?:FROM|INTO|UPDATE|JOIN|TABLE|EXISTS)\s+$/i.test(sql.slice(0, at)) ? '__x__' : '1'));
// Output that is still SQLite-only after translation. Each name is a finding kind; the baseline lists (file, kind) pairs with a reason.
const LEFTOVER = { json_type: /\bjson_type\s*\(/i, strftime: /\bstrftime\s*\(/i, datetime_fn: /\bdatetime\s*\(/i, glob: /\bGLOB\b/i, printf: /\bprintf\s*\(/i, group_concat: /\bgroup_concat\s*\(/i, instr: /\binstr\s*\(/i, json_each: /\bjson_each\s*\(/i, replace_into: /\bINSERT\s+OR\s+/i };

const learned = { keys: new Map(), serialTables: new Set() };
for (const f of migrations) { try { translateMigration(readFileSync(f, 'utf8'), learned); } catch { /* reported by the migration test */ } }

test('US-14-R07: every migration under core/ and adapters/ translates; the only SQLite-only leftovers are in the baseline', () => {
  const found = {};
  for (const f of migrations) {
    let texts;
    try { texts = translateMigration(readFileSync(f, 'utf8'), { keys: new Map(), serialTables: new Set() }); } catch (e) { found[rel(f)] = [`throws: ${String(e.message).split(':')[0].slice(0, 60)}`]; continue; }
    const kinds = new Set();
    for (const t of texts) for (const [k, re] of Object.entries(LEFTOVER)) if (re.test(t.replace(/'(?:[^']|'')*'/g, "''"))) kinds.add(k);
    if (/\bjulianday\b/i.test(texts.join('\n'))) kinds.add('julianday');
    if (kinds.size) found[rel(f)] = [...kinds].sort();
  }
  compare(found, BASE.migrations, 'migrations');
});

test('US-14-R07 and R14: every static SQL statement in core/ and adapters/ translates to Postgres; refusals and leftovers are in the baseline', () => {
  const found = {}; let n = 0;
  for (const f of modules) {
    const src = readFileSync(f, 'utf8'); const kinds = new Set();
    for (const m of src.matchAll(STATEMENT)) {
      const quoted = m[5] ?? m[6];
      if (quoted !== undefined && !SQLISH.test(quoted)) continue;
      const sql = standIn(m[2] ?? m[4] ?? quoted);
      n++;
      let t;
      try { t = translate(sql, learned).text; } catch (e) { kinds.add(`refused: ${/rowid/.test(e.message) ? 'rowid' : /PRAGMA/.test(e.message) ? 'PRAGMA' : /json_extract/.test(e.message) ? 'json_extract path' : /hex\(/.test(e.message) ? 'hex' : /INSERT OR REPLACE/.test(e.message) ? 'INSERT OR REPLACE key' : String(e.message).slice(0, 40)}`); continue; }
      for (const [k, re] of Object.entries(LEFTOVER)) if (re.test(t.replace(/'(?:[^']|'')*'/g, "''"))) kinds.add(k);
    }
    if (kinds.size) found[rel(f)] = [...kinds].sort();
  }
  assert.ok(n >= 400, `scanned ${n} static statements`);
  compare(found, BASE.modules, 'modules');
});

test('US-14-R07: the sources of Postgres-only forms: sqlite_master and julianday and json_extract no longer reach the output', () => {
  const t = translate(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ? AND (julianday('now') - julianday(?)) > json_extract(?, '$.a')`).text;
  assert.ok(!/sqlite_master\s+WHERE/.test(t) || /\) AS sqlite_master WHERE/.test(t));
  assert.ok(!/julianday\(/.test(t) && !/json_extract\(/.test(t));
});

function compare(found, base, what) {
  const fresh = [], stale = [];
  for (const [f, kinds] of Object.entries(found)) for (const k of kinds) if (!(base[f]?.kinds || []).includes(k)) fresh.push(`${f}: ${k}`);
  for (const [f, e] of Object.entries(base)) {
    assert.ok(String(e.reason || '').trim().length > 10, `${f} needs a reason`);
    for (const k of e.kinds) if (!(found[f] || []).includes(k)) stale.push(`${f}: ${k}`);
  }
  assert.deepEqual(fresh, [], `${what}: a statement does not translate: fix it, or add it to adapters/postgres/portability-baseline.json with a reason`);
  assert.deepEqual(stale, [], `${what}: the baseline lists a finding that is gone: remove it (the baseline only shrinks)`);
}
