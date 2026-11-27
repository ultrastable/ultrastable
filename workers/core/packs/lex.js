// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// A small JavaScript lexer and a scope-aware reference check for the pack source scan (US-21-R27). The scan used to strip comments and match
// regexes over the text, which a string containing `//`, a destructured global, an alias or a one-line parameter elsewhere in the file all
// defeated. This reads tokens instead: strings, template text, comments and regex literals are never code, and a guarded global (fetch, a
// network constructor) is allowed only where an enclosing function or declaration binds that name, so the only `fetch` a pack can call is one
// it was handed. It is a best-effort static check, not a sandbox: a runtime control (a frozen globalThis in the pack isolate) is the stronger
// layer and is PLANNED (US-21 section 7). Pure; no node: import, so it runs inside a deployed Worker.

// Whether a `/` starts a regular expression or divides is decided as the engine decides it, from what the code before it is (US-21-R27):
// every unclosed bracket is pushed with its kind (block statement, object literal, template expression, if/for/while/with head, grouping
// parenthesis, function declaration or expression), the same model acorn's tokenizer keeps. A `/` after `)` is a regex only if that `)`
// ended an if/for/while/with head; after `}` only if that `}` closed a statement block or a declaration; after `${` it is a regex;
// after a postfix ++ or -- it divides. Getting it wrong either way shifts where strings begin and end, so later code could vanish inside a
// string; neither direction is treated as safe.
// Reserved words after which an expression starts. `of` is one only where an expression cannot stand (`for (k of /x/)`); after `=` it is a name
// (`const of = 4; of / 2`). A keyword read as a property (`x.return / 2`) is a name too.
const KEYWORD_BEFORE_REGEX = /^(return|typeof|instanceof|in|new|delete|void|throw|case|do|else|yield|await)$/;
const BLOCK_AFTER = /^(else|do|try|finally)$/;                // `{` after these opens a block
const STATEMENT_PAREN = /^(if|for|while|with)$/;               // `(` after these opens a statement head
const IS_EXPR = { b_stat: false, b_expr: true, b_tmpl: true, p_stat: false, p_expr: true, f_stat: false, f_expr: true };
const isIdStart = (c) => /[A-Za-z_$]/.test(c);
const isIdPart = (c) => /[\w$]/.test(c);

// -> [{ t: 'id'|'num'|'str'|'tpl'|'re'|'p', v }]. Template expressions (${ ... }) are lexed as code; their text parts become `tpl` tokens.
export function lex(src) {
  const out = []; let i = 0, nl = false;
  const n = src.length;
  const ctx = [{ k: 'b_stat', q: 0 }];   // open brackets; q counts the unmatched ? of a conditional inside each
  let exprAllowed = true;               // may an expression start here (so a `/` opens a regex)?
  const top = () => ctx[ctx.length - 1];
  const prev = () => out[out.length - 1];
  const afterDot = (k) => { const q = out[k - 1]; return !!(q && q.t === 'p' && (q.v === '.' || q.v === '?.')); };
  const keyword = (k, re) => { const p = out[k]; return !!(p && p.t === 'id' && !afterDot(k) && re.test(p.v)); };
  const punct = (k, ...vs) => { const p = out[k]; return !!(p && p.t === 'p' && vs.includes(p.v)); };
  // May an expression start right after the token at k (acorn's beforeExpr)?
  const beforeExpr = (k) => {
    const p = out[k]; if (!p) return false;
    if (p.t === 'id') return keyword(k, KEYWORD_BEFORE_REGEX);
    if (p.t === 'tpl') return !!p.open;
    if (p.t !== 'p') return false;
    return ![')', ']', '}', '.', '?.', '++', '--'].includes(p.v);
  };
  const push = (tok) => { out.push(tok); nl = false; return tok; };
  const braceIsBlock = () => {
    const parent = top().k, k = out.length - 1, p = out[k];
    if (parent === 'f_expr' || parent === 'f_stat') return true;              // a function or class body
    if (!p) return true;
    if (punct(k, ':') && !p.tern && (parent === 'b_stat' || parent === 'b_expr')) return parent === 'b_stat';   // a label or case, or an object key
    if (keyword(k, /^(return|yield)$/) || (p.t === 'id' && p.v === 'of' && !afterDot(k) && exprAllowed)) return nl;
    if (keyword(k, BLOCK_AFTER) || punct(k, ';', ')', '=>')) return true;
    if (punct(k, '}')) return exprAllowed;                                    // after a statement, a statement
    if (punct(k, '{')) return parent === 'b_stat';
    if (p.t === 'id' && !keyword(k, KEYWORD_BEFORE_REGEX)) return false;
    return !exprAllowed;
  };
  const close = () => {                 // `)` or `}`: what follows it is an expression continuation unless the bracket closed a statement part
    if (ctx.length === 1) { exprAllowed = true; return; }
    let o = ctx.pop();
    if (o.k === 'b_stat' && (top().k === 'f_stat' || top().k === 'f_expr')) o = ctx.pop();
    exprAllowed = !IS_EXPR[o.k];
  };
  const templateChunk = () => {           // read template text from i up to a closing backtick or the next ${ ; leaves i after it
    let j = i;
    while (j < n && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
    const open = src[j] === '$';
    push({ t: 'tpl', v: src.slice(i, j), open });
    if (open) { ctx.push({ k: 'b_tmpl', q: 0 }); exprAllowed = true; i = j + 2; } else { exprAllowed = false; i = j + 1; }
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { if (c === '\n') nl = true; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const j = src.indexOf('*/', i + 2), e = j < 0 ? n : j + 2; if (src.slice(i, e).includes('\n')) nl = true; i = e; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < n && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1; push({ t: 'str', v: src.slice(i + 1, j) }); exprAllowed = false; i = j + 1; continue; }
    if (c === '`') { i++; templateChunk(); continue; }
    if (c === '/' && exprAllowed) {
      let j = i + 1, cls = false;
      while (j < n && (cls || src[j] !== '/') && src[j] !== '\n') { if (src[j] === '\\') j++; else if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; j++; }
      j++; while (j < n && isIdPart(src[j])) j++;
      push({ t: 're', v: src.slice(i, j) }); exprAllowed = false; i = j; continue;
    }
    if (isIdStart(c)) {
      let j = i + 1; while (j < n && isIdPart(src[j])) j++;
      const v = src.slice(i, j), k = out.length;          // k: the index this token will take
      const dotted = punct(k - 1, '.', '?.');
      if (!dotted && (v === 'function' || v === 'class')) {
        let b = k - 1; if (v === 'function' && keyword(b, /^async$/)) b--;   // `async function` is decided by what precedes async
        const p = out[b], cur = top().k;
        const statement = !beforeExpr(b) || keyword(b, /^else$/) || (punct(b, ';') && cur !== 'p_stat') || (keyword(b, /^return$/) && nl)
          || (((punct(b, ':') && !p.tern) || punct(b, '{')) && cur === 'b_stat');
        ctx.push({ k: statement ? 'f_stat' : 'f_expr', q: 0 });
        push({ t: 'id', v }); exprAllowed = false; i = j; continue;
      }
      const was = exprAllowed;
      push({ t: 'id', v });
      exprAllowed = dotted ? false : v === 'of' ? !was : KEYWORD_BEFORE_REGEX.test(v);
      i = j; continue;
    }
    if (/[0-9]/.test(c)) { let j = i + 1; while (j < n && /[\w.]/.test(src[j])) j++; push({ t: 'num', v: src.slice(i, j) }); exprAllowed = false; i = j; continue; }
    if (c === '{') { ctx.push({ k: braceIsBlock() ? 'b_stat' : 'b_expr', q: 0 }); push({ t: 'p', v: '{' }); exprAllowed = true; i++; continue; }
    if (c === '}') { if (top().k === 'b_tmpl') { ctx.pop(); i++; templateChunk(); continue; } push({ t: 'p', v: '}' }); close(); i++; continue; }
    if (c === '(') { const k = out.length; const stat = keyword(k - 1, STATEMENT_PAREN) || (keyword(k - 1, /^await$/) && keyword(k - 2, /^for$/)); ctx.push({ k: stat ? 'p_stat' : 'p_expr', q: 0 }); push({ t: 'p', v: '(' }); exprAllowed = true; i++; continue; }
    if (c === ')') { push({ t: 'p', v: ')' }); close(); i++; continue; }
    if (c === '=' && src[i + 1] === '>') { push({ t: 'p', v: '=>' }); exprAllowed = true; i += 2; continue; }
    if (c === '?' && src[i + 1] === '.' && !/[0-9]/.test(src[i + 2] || '')) { push({ t: 'p', v: '?.' }); exprAllowed = false; i += 2; continue; }
    if (c === '?' && src[i + 1] === '?') { push({ t: 'p', v: '??' }); exprAllowed = true; i += 2; continue; }
    if ((c === '+' || c === '-') && src[i + 1] === c) { push({ t: 'p', v: c + c }); i += 2; continue; }   // ++ and -- leave exprAllowed as it was
    if (c === '.' && src[i + 1] === '.' && src[i + 2] === '.') { push({ t: 'p', v: '...' }); exprAllowed = true; i += 3; continue; }
    if (c === '?') top().q++;
    const tok = push({ t: 'p', v: c });
    if (c === ':' && top().q > 0) { top().q--; tok.tern = true; }                          // the : of a conditional, not a label or a key
    exprAllowed = !(c === ']' || c === '.');
    i++;
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

// For each `{`, what it opens: 'class' (a class body), 'object' (an object literal) or 'block'. A method shorthand binds its parameters only inside
// a class body or an object literal; elsewhere `name(args)` followed by `{` on the next line is a call and then a block.
const OBJECT_BEFORE = new Set(['=', '(', ',', ':', '[', '?', '||', '&&', '??', '!', '+', '-', '*', '%', '<', '>', '|', '&', '^', '~']);
function braceKinds(toks) {
  const kind = new Map();
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'p' || t.v !== '{') continue;
    let j = k - 1, cls = false;
    while (j >= 0 && !(toks[j].t === 'p' && (toks[j].v === ';' || toks[j].v === '{' || toks[j].v === '}'))) { if (toks[j].t === 'id' && toks[j].v === 'class') { cls = true; break; } j--; }
    const pv = toks[k - 1];
    if (cls && !(pv && pv.t === 'p' && pv.v === ')')) kind.set(k, 'class');
    else if (!pv || (pv.t === 'p' && OBJECT_BEFORE.has(pv.v)) || (pv.t === 'id' && pv.v === 'return')) kind.set(k, 'object');
    else kind.set(k, 'block');
  }
  return kind;
}
// Is the `(` at k the parameter list of a function or method whose body follows its `)`? `function f(...) {`, `function (...) {`, `function* f(...)
// {`, or a method `name(...) {` directly inside a class body or an object literal (after `{`, `,`, `}`, `;`, `*`, get, set, static or async).
const METHOD_AFTER = new Set(['get', 'set', 'static', 'async']);
function functionHead(toks, k, braceKind) {
  const before = toks[k - 1], b2 = toks[k - 2];
  if (!before) return false;
  if (before.t === 'id' && before.v === 'function') return true;
  if (before.t === 'p' && before.v === '*') return !!(b2 && b2.t === 'id' && b2.v === 'function');
  if (before.t !== 'id') return false;
  if (b2 && b2.t === 'id' && b2.v === 'function') return true;
  if (b2 && b2.t === 'p' && b2.v === '*' && toks[k - 3] && toks[k - 3].t === 'id' && toks[k - 3].v === 'function') return true;
  const okPrev = !b2 || (b2.t === 'p' && ['{', ',', '}', ';', '*'].includes(b2.v)) || (b2.t === 'id' && METHOD_AFTER.has(b2.v));
  if (!okPrev) return false;
  let d = 0;                              // the innermost brace that encloses k
  for (let j = k - 1; j >= 0; j--) {
    const u = toks[j]; if (u.t !== 'p') continue;
    if (u.v === '}') d++; else if (u.v === '{') { if (d === 0) { const kd = braceKind.get(j); return kd === 'class' || kd === 'object'; } d--; }
  }
  return false;
}

// Intervals [start, end] of token indexes in which a name is bound: function parameters over the function body, declarations over their block.
export function bindings(toks) {
  const scopes = [];
  const braceKind = braceKinds(toks);
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
      else if (after && after.t === 'p' && after.v === '{' && functionHead(toks, k, braceKind)) scopes.push({ start: k, end: matching(toks, close + 1), names: boundNames(toks, k + 1, close) });
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
