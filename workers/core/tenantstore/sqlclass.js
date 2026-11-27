// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Statement classification shared by the store and every SqlPort adapter (US-25-R03, R15). A statement is a READ only when it cannot change
// the database: its first keyword is SELECT, PRAGMA or EXPLAIN, or it is a WITH whose text holds no INSERT, UPDATE, DELETE or REPLACE INTO.
// Looking only at the first keyword would let `WITH ... INSERT` skip the storage ceiling and the per-statement write cap and be metered as a
// read. Comments and string literals are stripped first, so a keyword inside text can neither hide a write nor fake one. A misreading can only
// fail toward "write", which is the stricter path. Pure: no node: import, so it runs inside a deployed Worker.
const strip = (t) => String(t ?? '').replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').replace(/'(?:[^']|'')*'/g, "''").trim();
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
