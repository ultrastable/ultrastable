// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Statement classification shared by the store and every SqlPort adapter (US-25-R03, R15). A statement is a READ only when it cannot change
// the database: its first keyword is SELECT, PRAGMA or EXPLAIN, or it is a WITH whose text holds no INSERT, UPDATE, DELETE or REPLACE INTO.
// Looking only at the first keyword would let `WITH ... INSERT` skip the storage ceiling and the per-statement write cap and be metered as a
// read. Comments, string literals and quoted identifiers are removed by one left-to-right scan (stripSql), so a keyword inside text can neither
// hide a write nor fake one, and a `--` or `/*` inside a string is text, not the start of a comment. A misreading can only fail toward "write",
// which is the stricter path. Pure: no node: import, so it runs inside a deployed Worker. The pack sandbox (core/packs/sandbox.js) uses the same scan.

// Skip a run quoted with q (SQL doubles the quote to escape it); returns the index after the closing quote, or the end of the text.
function quotedEnd(s, i, q) {
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] !== q) continue;
    if (s[j + 1] === q) { j++; continue; }
    return j + 1;
  }
  return s.length;
}

/** One left-to-right scan: whichever of a comment (`--` to the end of the line, `/* ... *\/`), a string literal ('...') or a quoted identifier
 *  ("...", `...`, [...]) starts first is consumed whole. A comment becomes a space, a string `''`, a quoted identifier `"_"` (still visible as
 *  quoted, never as a keyword). An unterminated comment or string runs to the end of the text, as SQLite reads it. */
export function stripSql(text) {
  const s = String(text ?? ''); let out = '';
  for (let i = 0; i < s.length;) {
    const c = s[i], d = s[i + 1];
    if (c === '-' && d === '-') { const j = s.indexOf('\n', i + 2); i = j < 0 ? s.length : j; out += ' '; continue; }
    if (c === '/' && d === '*') { const j = s.indexOf('*/', i + 2); i = j < 0 ? s.length : j + 2; out += ' '; continue; }
    if (c === "'") { i = quotedEnd(s, i, "'"); out += "''"; continue; }
    if (c === '"' || c === '`') { i = quotedEnd(s, i, c); out += ' "_" '; continue; }
    if (c === '[') { const j = s.indexOf(']', i + 1); i = j < 0 ? s.length : j + 1; out += ' "_" '; continue; }
    out += c; i++;
  }
  return out;
}
const strip = (t) => stripSql(t).trim();
const DML_WORD = /\b(?:insert|update|delete)\b|\breplace\s+into\b/i;

// 'read' | 'dml' | 'ddl' (anything else that is not a read: CREATE, DROP, ALTER, ...).
export function statementKind(text) {
  const s = strip(text);
  const first = (/^\(*\s*([A-Za-z]+)/.exec(s) || [])[1]?.toLowerCase();
  if (first === 'pragma' || first === 'explain') return 'read';
  if (first === 'select' || first === 'values' || first === 'with') return DML_WORD.test(s) ? 'dml' : 'read';
  if (first === 'insert' || first === 'replace' || first === 'update' || first === 'delete') return 'dml';
  return 'ddl';
}
export const isWriteStatement = (text) => statementKind(text) !== 'read';
export const isDmlStatement = (text) => statementKind(text) === 'dml';
// A delete or drop frees space, so a store at its storage ceiling still accepts it.
export const freesSpace = (text) => /^\(*\s*(delete|drop)\b/i.test(strip(text));
// More than one statement: a ';' outside a comment, string or quoted name followed by anything but whitespace. The kind above reads the first
// statement only, and the Durable Object's exec runs every ';'-separated statement yet hands back a cursor for the final statement alone, so a
// trailing write would bypass the ceiling, the write cap, the rollback and the metering. The store refuses such a text before it runs (US-25-R03); the pack
// sandbox refuses it the same way (core/packs/sandbox.js checkSql).
export const isMultiStatement = (text) => /;\s*\S/.test(stripSql(text));
