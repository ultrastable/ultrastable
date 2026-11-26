// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// A small JavaScript lexer and a scope-aware reference check for the pack source scan (US-21-R15). The scan used to strip comments and match
// regexes over the text, which a string containing `//`, a destructured global, an alias or a one-line parameter elsewhere in the file all
// defeated. This reads tokens instead: strings, template text, comments and regex literals are never code, and a guarded global (fetch, a
// network constructor) is allowed only where an enclosing function or declaration binds that name, so the only `fetch` a pack can call is one
// it was handed. It is a best-effort static check, not a sandbox: a runtime control (a frozen globalThis in the pack isolate) is the stronger
// layer and is PLANNED (US-21 section 7). Pure; no node: import, so it runs inside a deployed Worker.

const KEYWORD_BEFORE_REGEX = /^(return|typeof|instanceof|in|of|new|delete|void|throw|case|do|else|yield|await)$/;
const isIdStart = (c) => /[A-Za-z_$]/.test(c);
const isIdPart = (c) => /[\w$]/.test(c);

// -> [{ t: 'id'|'num'|'str'|'tpl'|'re'|'p', v }]. Template expressions (${ ... }) are lexed as code; their text parts become `tpl` tokens.
export function lex(src) {
  const out = []; let i = 0, depth = 0; const tpl = [];
  const n = src.length;
  const prev = () => out[out.length - 1];
  const regexAllowed = () => { const p = prev(); if (!p) return true; if (p.t === 'num' || p.t === 'str' || p.t === 'tpl' || p.t === 're') return false; if (p.t === 'id') return KEYWORD_BEFORE_REGEX.test(p.v); return !(p.v === ')' || p.v === ']' || p.v === '}'); };
  const templateChunk = () => {           // read template text from i up to a closing backtick or the next ${ ; leaves i after it
    let j = i;
    while (j < n && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
    out.push({ t: 'tpl', v: src.slice(i, j) });
    if (src[j] === '$') { tpl.push(depth); i = j + 2; } else i = j + 1;
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1; out.push({ t: 'str', v: src.slice(i + 1, j) }); i = j + 1; continue; }
    if (c === '`') { i++; templateChunk(); continue; }
    if (c === '/' && regexAllowed()) {
      let j = i + 1, cls = false;
      while (j < n && (cls || src[j] !== '/') && src[j] !== '\n') { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      j++; while (j < n && isIdPart(src[j])) j++;
      out.push({ t: 're', v: src.slice(i, j) }); i = j; continue;
    }
    if (isIdStart(c)) { let j = i + 1; while (j < n && isIdPart(src[j])) j++; out.push({ t: 'id', v: src.slice(i, j) }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++; out.push({ t: 'num', v: src.slice(i, j) }); i = j; continue; }
    if (c === '{') { depth++; out.push({ t: 'p', v: '{' }); i++; continue; }
    if (c === '}') { if (tpl.length && tpl[tpl.length - 1] === depth) { tpl.pop(); i++; templateChunk(); continue; } depth--; out.push({ t: 'p', v: '}' }); i++; continue; }
    if (c === '=' && src[i + 1] === '>') { out.push({ t: 'p', v: '=>' }); i += 2; continue; }
    if (c === '?' && src[i + 1] === '.' && !/[0-9]/.test(src[i + 2] || '')) { out.push({ t: 'p', v: '?.' }); i += 2; continue; }
    if (c === '.' && src[i + 1] === '.' && src[i + 2] === '.') { out.push({ t: 'p', v: '...' }); i += 3; continue; }
    out.push({ t: 'p', v: c }); i++;
  }
  return out;
}

const NOT_FUNCTION_PAREN = /^(if|for|while|switch|with|catch|return|typeof|await|yield|in|of|new)$/;
const OPEN = { '(': ')', '[': ']', '{': '}' };

// Index of the token that closes the bracket opened at `open`, or -1.
function matching(toks, open) {
  const o = toks[open].v, c = OPEN[o]; let d = 0;
  for (let k = open; k < toks.length; k++) { if (toks[k].t !== 'p') continue; if (toks[k].v === o) d++; else if (toks[k].v === c && --d === 0) return k; }
  return -1;
}

// Names a parameter list (tokens between the parentheses) binds: every identifier except object keys that are renamed (`{ fetch: doFetch }` binds
// doFetch, not fetch) and identifiers inside a default value (`a = fetch` reads fetch, it does not bind it).
function boundNames(toks, from, to) {
  const names = new Set(); let skipDepth = null, d = 0;
  for (let k = from; k < to; k++) {
    const t = toks[k];
    if (t.t === 'p') {
      if (OPEN[t.v]) d++; else if (t.v === ')' || t.v === ']' || t.v === '}') d--;
      if (skipDepth !== null && d < skipDepth) skipDepth = null;
      if (skipDepth !== null && d === skipDepth && t.v === ',') skipDepth = null;
      if (skipDepth === null && t.v === '=' ) skipDepth = d;
      continue;
    }
    if (skipDepth !== null || t.t !== 'id') continue;
    const nx = toks[k + 1];
    if (nx && nx.t === 'p' && nx.v === ':') continue;       // a renamed key: the binding is what follows the colon
    names.add(t.v);
  }
  return names;
}

// Intervals [start, end] of token indexes in which a name is bound: function parameters over the function body, declarations over their block.
export function bindings(toks) {
  const scopes = [];
  const blocks = [];                      // brace pairs, to find the block a declaration lives in
  const stack = [];
  toks.forEach((t, k) => { if (t.t !== 'p') return; if (t.v === '{') stack.push(k); else if (t.v === '}' && stack.length) blocks.push([stack.pop(), k]); });
  const blockOf = (k) => { let best = [0, toks.length - 1]; for (const b of blocks) if (b[0] < k && k < b[1] && b[1] - b[0] < best[1] - best[0]) best = b; return best; };
  const bodyEnd = (k) => {                // k indexes the token after the parameter list or the arrow
    if (toks[k] && toks[k].v === '{' && toks[k].t === 'p') return matching(toks, k);
    let d = 0;                            // an expression body ends at a , ; or closer that leaves the starting nesting
    for (let j = k; j < toks.length; j++) {
      const t = toks[j]; if (t.t !== 'p') continue;
      if (OPEN[t.v]) d++; else if (t.v === ')' || t.v === ']' || t.v === '}') { if (d === 0) return j; d--; } else if ((t.v === ',' || t.v === ';') && d === 0) return j;
    }
    return toks.length - 1;
  };
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'p' && t.v === '(') {
      const close = matching(toks, k); if (close < 0) continue;
      const after = toks[close + 1], before = toks[k - 1];
      if (before && before.t === 'id' && NOT_FUNCTION_PAREN.test(before.v)) continue;
      if (after && after.t === 'p' && after.v === '=>') scopes.push({ start: k, end: bodyEnd(close + 2), names: boundNames(toks, k + 1, close) });
      else if (after && after.t === 'p' && after.v === '{' && before && (before.t === 'id' || (before.t === 'p' && before.v === '*'))) scopes.push({ start: k, end: matching(toks, close + 1), names: boundNames(toks, k + 1, close) });
    } else if (t.t === 'id' && toks[k + 1] && toks[k + 1].t === 'p' && toks[k + 1].v === '=>') {
      scopes.push({ start: k + 1, end: bodyEnd(k + 2), names: new Set([t.v]) });             // x => ...
    } else if (t.t === 'id' && (t.v === 'const' || t.v === 'let' || t.v === 'var')) {
      let j = k + 1, d = 0; const names = new Set();
      for (; j < toks.length; j++) {          // the binding pattern, up to the initializer
        const u = toks[j];
        if (u.t === 'p' && (u.v === '=' || u.v === ';') && d === 0) break;
        if (u.t === 'p') { if (OPEN[u.v]) d++; else if (u.v === ')' || u.v === ']' || u.v === '}') d--; continue; }
        if (u.t === 'id' && !(toks[j + 1] && toks[j + 1].t === 'p' && toks[j + 1].v === ':')) names.add(u.v);
        if (u.t === 'id' && u.v === 'of' || u.t === 'id' && u.v === 'in') break;
      }
      const b = blockOf(k); scopes.push({ start: k, end: b[1], names });
    } else if (t.t === 'id' && (t.v === 'function' || t.v === 'class')) {
      let j = k + 1; if (toks[j] && toks[j].v === '*') j++;
      if (toks[j] && toks[j].t === 'id') { const b = blockOf(k); scopes.push({ start: k, end: b[1], names: new Set([toks[j].v]) }); }
    }
  }
  return scopes;
}

// The identifiers in `guarded` that the code uses as a value without any enclosing binding. `typeof x` reveals nothing and is allowed.
export function unboundReferences(toks, guarded, scopes = bindings(toks)) {
  const hits = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'id' || !guarded.has(t.v)) continue;
    const pv = toks[k - 1], nx = toks[k + 1];
    if (pv && pv.t === 'p' && (pv.v === '.' || pv.v === '?.')) continue;                                   // a property of something else
    if (pv && pv.t === 'p' && (pv.v === '{' || pv.v === ',') && nx && nx.t === 'p' && nx.v === ':') continue; // an object key
    if (pv && pv.t === 'id' && pv.v === 'typeof') continue;
    if (scopes.some(s => s.start <= k && k <= s.end && s.names.has(t.v))) continue;
    hits.push(t.v);
  }
  return [...new Set(hits)];
}

// Code text with strings and template text blanked, and with them kept, for the regex checks that must not read text and the ones that must.
export function render(toks) {
  const code = [], withStrings = [];
  for (const t of toks) {
    if (t.t === 'str') { code.push('""'); withStrings.push(JSON.stringify(t.v)); } else if (t.t === 'tpl') { code.push('``'); withStrings.push('``'); } else if (t.t === 're') { code.push('/re/'); withStrings.push('/re/'); } else { code.push(t.v); withStrings.push(t.v); }
  }
  return { code: code.join(' '), withStrings: withStrings.join(' ') };
}

// The module specifiers a file imports or re-exports, with the names each clause takes: [{ spec, names }]. A dynamic import with a string argument is
// included with names []; one with a computed argument is reported by the caller (it is not a token pattern a specifier can be read from).
export function moduleSpecifiers(toks) {
  const out = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'id' || (t.v !== 'import' && t.v !== 'export')) continue;
    if (toks[k - 1] && toks[k - 1].t === 'p' && toks[k - 1].v === '.') continue;
    const nx = toks[k + 1]; if (!nx) continue;
    if (t.v === 'import' && nx.t === 'p' && nx.v === '(') { if (toks[k + 2] && toks[k + 2].t === 'str') out.push({ spec: toks[k + 2].v, names: [] }); continue; }
    if (t.v === 'import' && nx.t === 'str') { out.push({ spec: nx.v, names: [] }); continue; }
    let j = k + 1, d = 0; const clause = [];
    for (; j < toks.length; j++) {
      const u = toks[j];
      if (u.t === 'p' && (u.v === ';' ) && d === 0) break;
      if (u.t === 'p' && OPEN[u.v]) d++; else if (u.t === 'p' && (u.v === '}' || u.v === ')' || u.v === ']')) d--;
      if (u.t === 'id' && u.v === 'from' && d === 0) { if (toks[j + 1] && toks[j + 1].t === 'str') out.push({ spec: toks[j + 1].v, names: clauseNames(clause) }); break; }
      if (t.v === 'export' && d === 0 && u.t === 'id' && /^(const|let|var|function|class|default|async)$/.test(u.v)) break;   // a declaration, not a re-export
      clause.push(u);
    }
  }
  return out;
}
function clauseNames(clause) {
  const text = clause.map(u => (u.t === 'p' ? u.v : u.v)).join(' ').replace(/[{}]/g, '');
  return text.split(',').map(x => x.trim().split(/\s+as\s+/)[0]).filter(Boolean);
}
