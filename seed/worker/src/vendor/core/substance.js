// VENDORED from ultrastable/workers core/substance/index.js so a seed checkout is self-contained (SEED-SELFCONTAINED-1); tests/foundation/test_failmine.py keeps it identical.
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SUBSTANCE-1 (Rowan, 2026-11-21): a change counts only when it alters executable behaviour. "They change a hash or they change a number that
// should be dynamic anyway ... the illusion of productivity that absolutely must be stopped." Line-based on diff hunks, the same algorithm as
// foundation/substance.py, so it works on the `patch` text GitHub returns for a pull request's files: comments and whitespace are dropped, numbers
// and volatile strings (hashes, timestamps, dates, versions) are normalized, import-only lines are set aside; whatever still differs is behaviour.
// Both implementations pass doctrine/substance-vectors.json; CONFIG equals doctrine/substance.json (substance.test.js checks both).
export const CONFIG = {
  code_ext: ['.py', '.js', '.mjs', '.cjs', '.ts', '.sql', '.sh', '.toml', '.yml', '.yaml'],
  config_globs: ['doctrine/*.json', 'autonomy/*.json', 'seed/autonomy/*.json', 'seed/worker/*.json', 'actions-budget.json', 'spark.json'],
  generated_globs: ['site/*-data.js', 'spinoffs/registry.js', 'site/pins.json', 'site/probes.json', 'core-contract.json', 'doctrine/triggers.json', 'doctrine/decision-ledger.json',
    'instances/ultrastable/own-database.json', 'docs/security/multi-tenant-controls.json', 'seed/self/*', 'README.md', 'platform/adapters/README.md'],
  record_globs: ['*.jsonl', '*.md', '*.txt', 'docs/*', 'ops/*', 'ledger/*', 'doctrine/writeback/*', 'outreach/applications/*', '*.svg', '*.png', '*.pdf'],
  doc_keys: ['_doc', 'why', 'note', '_comment', 'description', '_why', 'reason'],
};
export const TRIVIAL = ['literal', 'comment', 'format', 'import'];

const STR = String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|` + '`(?:\\\\.|[^`\\\\])*`';
const NUM = String.raw`\b0[xX][0-9a-fA-F]+\b|\b\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?\b`;
const COMMENT = { hash: '#.*$', js: String.raw`//.*$|/\*.*?\*/|/\*.*$|^\s*\*(?!\*).*$`, sql: '--.*$', none: '(?!x)x' };
const LANG = { '.py': 'hash', '.sh': 'hash', '.toml': 'hash', '.yml': 'hash', '.yaml': 'hash', '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.ts': 'js', '.sql': 'sql', '.json': 'none' };
const RX = Object.fromEntries(Object.entries(COMMENT).map(([k, c]) => [k, new RegExp(`(?<s>${STR})|(?<c>${c})|(?<n>${NUM})|(?<i>[A-Za-z_$][\\w$]*)|(?<p>\\S)`, 'gm')]));
const VOLATILE = /^(?:[0-9a-f]{7,64}|\d{4}-\d{2}-\d{2}(?:[T ][\d:.]+Z?(?:[+-]\d\d:?\d\d)?)?|v?\d+(?:\.\d+)+(?:[-+][\w.-]*)?|[\d.,\s%]+)$/;
const IMPORT = { hash: /^\s*(?:import\s|from\s+\S+\s+import\s)/, js: /^\s*(?:import[\s{*'"]|export\s+\*?\s*\{?[^=]*\bfrom\s)|\brequire\(/ };

// fnmatch semantics: * matches any run of characters, slashes included.
const globRx = g => new RegExp('^' + g.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
const match = (path, globs) => globs.some(g => globRx(g).test(path));
const ext = p => { const b = p.split('/').pop(); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : ''; };

export function fileClass(path, c = CONFIG) {
  if (match(path, c.generated_globs)) return 'generated';
  if (match(path, c.record_globs)) return 'record';
  if (match(path, c.config_globs)) return 'config';
  return c.code_ext.includes(ext(path)) ? 'code' : 'record';
}

function line(text, lang, docKeys) {
  let raw = [], norm = []; const comments = [];
  for (const m of text.matchAll(RX[lang])) {
    const g = m.groups, t = m[0];
    if (g.c !== undefined) { comments.push(t.trim()); continue; }
    raw.push(t);
    if (g.n !== undefined) norm.push('N#');
    else if (g.s !== undefined) norm.push(VOLATILE.test(t.slice(1, -1).trim()) ? 'S#' : t);
    else norm.push(t);
  }
  if (docKeys.size && raw.length >= 2 && raw[0][0] === '"' && docKeys.has(raw[0].slice(1, -1)) && raw[1] === ':') { comments.push(text.trim()); raw = []; norm = []; }
  const imp = IMPORT[lang];
  return { raw, norm, comments, import: Boolean(raw.length && imp && imp.test(text)) };
}

// One of behaviour | literal | comment | format | import | generated | record.
export function classifyFile(path, status, removed, added, c = CONFIG) {
  const fc = fileClass(path, c);
  if (fc === 'generated' || fc === 'record') return fc;
  const lang = fc === 'config' ? 'none' : (LANG[ext(path)] || 'hash');
  const keys = new Set(fc === 'config' || path.endsWith('.json') ? c.doc_keys : []);
  const rl = removed.map(x => line(x, lang, keys)), al = added.map(x => line(x, lang, keys));
  const tok = (ls, f) => ls.flatMap(x => x[f]).join('\u0000');
  if (status === 'added' || status === 'removed') return tok([...rl, ...al], 'raw') ? 'behaviour' : 'comment';
  if (tok(rl, 'raw') === tok(al, 'raw')) return tok(rl, 'comments') !== tok(al, 'comments') ? 'comment' : 'format';
  if (tok(rl, 'norm') === tok(al, 'norm')) return 'literal';
  const code = [...rl, ...al].filter(x => x.raw.length);
  if (code.length && code.every(x => x.import)) return 'import';
  return 'behaviour';
}

export function verdict(kinds) {
  if (kinds.includes('behaviour')) return 'substantive';
  return kinds.some(k => TRIVIAL.includes(k)) ? 'trivial' : 'record';
}

// GitHub's unified `patch` for one file -> removed and added lines.
export function splitPatch(patch) {
  const removed = [], added = [];
  for (const l of String(patch || '').split('\n')) {
    if (l.startsWith('@@') || l.startsWith('\\')) continue;
    if (l.startsWith('-')) removed.push(l.slice(1)); else if (l.startsWith('+')) added.push(l.slice(1));
  }
  return { removed, added };
}

// files: GitHub's GET /repos/{o}/{r}/pulls/{n}/files rows ({filename, status, patch}). A file with no patch (binary or too large) that is code
// counts as behaviour: an unreadable change is never called trivial.
export function classifyPrFiles(files, c = CONFIG) {
  const rows = (files || []).map(f => {
    const status = f.status === 'removed' ? 'removed' : f.status === 'added' ? 'added' : 'modified';
    const fc = fileClass(f.filename, c);
    if (f.patch == null && (fc === 'code' || fc === 'config')) return { path: f.filename, kind: 'behaviour' };
    const { removed, added } = splitPatch(f.patch);
    return { path: f.filename, kind: classifyFile(f.filename, status, removed, added, c) };
  });
  return { verdict: verdict(rows.map(r => r.kind)), files: rows };
}
