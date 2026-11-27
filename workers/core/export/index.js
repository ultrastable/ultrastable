// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Export before drop (US-01-R04). Migrations are additive; one that drops or rewrites data is applied only after every
// affected table has been exported to an object store and the export has been read back and matched. No export, no migration.
// Ports: db (store handle), store (object store: put(key, text), get(key) -> { text() } | string | null; an R2 bucket fits),
// now. Nothing here deletes an export.
const stamp = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

// ---- Reading a migration the way SQLite reads it ----
// Three rounds of residuals came from one deny-list over a splitter that knew two of SQLite's four quoting forms: a backtick or bracket name holding
// ', -- or /* hid the statements after it while SQLite still ran them, and a CTE in front of an upsert read as additive. So now:
// 1. the lexer knows all four quoting forms ('...', "...", `...`, [...]) and reads a comment as whitespace only outside them;
// 2. a statement ends where SQLite's own completion state machine ends it (sqlite3_complete, complete.c; tools/apply_migrations.py calls it);
// 3. classification is default-deny: a statement counts as additive only on the allow-list in analyze(); anything else is destructive, and
//    unresolved when no table can be read from it;
// 4. what SQLite does past a statement's text counts, read from the schema the store holds and the file builds: a trigger a write fires, a REPLACE
//    conflict clause in a table (a plain insert or update into it overwrites rows) and a foreign key action (a delete or an update of a parent
//    deletes or rewrites rows of its children).
const SPACE = ' \t\n\f\r'; // SQLite's whitespace; a vertical tab is not
const isId = ch => ch !== undefined && (/[A-Za-z0-9_$]/.test(ch) || ch.charCodeAt(0) >= 0x80);
const upper = w => w.replace(/[a-z]/g, ch => ch.toUpperCase()); // SQLite folds ASCII only: a dotless i never spells TRIGGER
const lower = w => w.replace(/[A-Z]/g, ch => ch.toLowerCase());
const trimSpace = s => s.replace(/^[ \t\n\f\r]+|[ \t\n\f\r]+$/g, '');
const norm = s => Array.from(s.replace(/[ \t\n\f\r]+/g, ' ')).slice(0, 160).join('');

/** SQLite's tokens of `s`: [{ k: 'ws' | 'comment' | 'quote' | 'word' | 'semi' | 'other', a, b }], offsets into s. */
export function lex(s) {
  const out = []; const n = s.length; let i = 0;
  while (i < n) {
    const c = s[i]; let j = i + 1; let k;
    if (SPACE.includes(c)) { while (j < n && SPACE.includes(s[j])) j++; k = 'ws'; }
    else if (c === '-' && s[i + 1] === '-') { j = s.indexOf('\n', i + 2); if (j < 0) j = n; k = 'comment'; }
    else if (c === '/' && s[i + 1] === '*') { j = s.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; k = 'comment'; }
    else if (c === "'" || c === '"' || c === '`') {
      for (;;) { const e = s.indexOf(c, j); if (e < 0) { j = n; break; } j = e + 1; if (s[j] === c) { j++; continue; } break; }
      k = 'quote';
    } else if (c === '[') { const e = s.indexOf(']', j); j = e < 0 ? n : e + 1; k = 'quote'; }
    else if (c === ';') k = 'semi';
    else if (isId(c)) { while (j < n && isId(s[j])) j++; k = 'word'; }
    else k = 'other';
    out.push({ k, a: i, b: j }); i = j;
  }
  return out;
}

// sqlite3_complete's state machine (complete.c). Token classes: SEMI WS OTHER EXPLAIN CREATE TEMP TRIGGER END. A `;` ends a statement when it
// takes the state to 1; inside CREATE [TEMP] TRIGGER only `; END ;` does.
const TRANS = [[1, 0, 2, 3, 4, 2, 2, 2], [1, 1, 2, 3, 4, 2, 2, 2], [1, 2, 2, 2, 2, 2, 2, 2], [1, 3, 3, 2, 4, 2, 2, 2],
  [1, 4, 2, 2, 2, 4, 5, 2], [6, 5, 5, 5, 5, 5, 5, 5], [6, 6, 5, 5, 5, 5, 5, 7], [1, 7, 5, 5, 5, 5, 5, 5]];
const KEYWORD_CLASS = { EXPLAIN: 3, CREATE: 4, TEMP: 5, TEMPORARY: 5, TRIGGER: 6, END: 7 };
const tokenClass = (s, t) => (t.k === 'semi' ? 0 : t.k === 'ws' || t.k === 'comment' ? 1
  : t.k === 'word' ? (KEYWORD_CLASS[upper(s.slice(t.a, t.b))] ?? 2) : 2);

/** Split a migration into statements where SQLite would. Each piece keeps its text, with every comment read as one space. */
export function splitStatements(sql) {
  const s = String(sql); const out = []; let state = 0; let code = '';
  const push = () => { const t = trimSpace(code); if (t) out.push(t); code = ''; };
  for (const t of lex(s)) {
    state = TRANS[state][tokenClass(s, t)];
    if (t.k === 'semi' && state === 1) { push(); state = 0; continue; }
    code += t.k === 'comment' ? ' ' : s.slice(t.a, t.b);
  }
  push();
  return out;
}

const PLAIN = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A quoted name as SQLite reads it ("..." and `...` with the quote doubled inside, [...], and '...' where a table name is expected). One left
// unterminated is kept as written, so it never reads as a plain name.
const unquote = t => {
  const q = t[0];
  if (!`"'\`[`.includes(q)) return t;
  if (t.length < 2 || t[t.length - 1] !== (q === '[' ? ']' : q)) return t;
  const inner = t.slice(1, -1);
  return q === '[' ? inner : inner.split(q + q).join(q);
};
const CONFLICT = new Set(['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE']);
const TAIL = new Set(['SELECT', 'VALUES', 'INSERT', 'REPLACE', 'UPDATE', 'DELETE']);
const BODY_START = new Set(['INSERT', 'UPDATE', 'DELETE', 'SELECT', 'REPLACE', 'WITH', 'VALUES']);
const EVENTS = new Set(['DELETE', 'INSERT', 'UPDATE']);
const LOSS_ACTION = new Set(['CASCADE', 'SET NULL', 'SET DEFAULT']);

// One statement, as tokens toks[from, to) of src: { statement, findings, writes: [{ key, events, plain, table, unresolved? }], and what it does to the
// schema: trigger?, dropTrigger?, table? (a definition), alterAdd?, rename?, dropTable? }. `plain` marks an insert or update with no conflict verb of
// its own, which a REPLACE clause in the table's definition turns into a replace.
// The allow-list (additive): CREATE [TEMP] TABLE | VIEW | TRIGGER, CREATE VIRTUAL TABLE, CREATE [UNIQUE] INDEX, DROP INDEX | VIEW | TRIGGER,
// ALTER TABLE ... ADD, SELECT, VALUES, and INSERT [OR IGNORE | ABORT | FAIL | ROLLBACK] INTO with no DO UPDATE. A WITH statement is judged by the
// statement after its list. The destructive forms name their table; every other statement is unreadable, so destructive and unresolved.
function analyzeTokens(src, all, from = 0, to = all.length) {
  const toks = all.slice(from, to);
  const R = { statement: toks.length ? norm(src.slice(toks[0].a, toks[toks.length - 1].b)) : '', findings: [], writes: [] };
  const txt = i => src.slice(toks[i].a, toks[i].b);
  const W = i => (toks[i] && toks[i].k === 'word' ? upper(txt(i)) : null);
  const P = i => (toks[i] && toks[i].k === 'other' ? txt(i) : null);
  const bad = () => ({ statement: R.statement, findings: [{ table: null, kind: 'unreadable', statement: R.statement, unresolved: 'statement' }], writes: [] });
  const isName = i => Boolean(toks[i]) && (toks[i].k === 'word' || toks[i].k === 'quote');
  const name = i => {
    if (!isName(i)) return null;
    if (P(i + 1) === '.' && isName(i + 2)) return { schema: unquote(txt(i)), table: unquote(txt(i + 2)), next: i + 3 };
    return { schema: null, table: unquote(txt(i)), next: i + 1 };
  };
  const home = q => q.schema == null || ['main', 'temp'].includes(lower(q.schema));
  const keyOf = q => (home(q) ? '' : `${lower(q.schema)}.`) + lower(q.table);
  // a table in the main or temp schema is the bare name; one in an attached schema keeps its schema, so the exporter cannot resolve it and refuses
  const shown = q => {
    const d = { table: home(q) ? q.table : `${q.schema}.${q.table}` };
    if (!home(q)) d.unresolved = 'schema'; else if (!PLAIN.test(q.table)) d.unresolved = 'name';
    return d;
  };
  const write = (q, events, plain) => { R.writes.push({ key: keyOf(q), events, plain, ...shown(q) }); return R; };
  const lose = (kind, q, events, plain = false) => {
    const d = shown(q);
    R.findings.push({ table: d.table, kind, statement: R.statement, ...(d.unresolved ? { unresolved: d.unresolved } : {}) });
    return events ? write(q, events, plain) : R;
  };
  // the foreign keys a table definition (or an added column) declares, from token `from` on: REFERENCES parent [(cols)] [ON DELETE | UPDATE action]
  const references = (from, child) => {
    const out = [];
    for (let i = from; i < toks.length; i++) {
      if (W(i) !== 'REFERENCES') continue;
      const p = name(i + 1); if (!p) continue;
      let onDelete = null; let onUpdate = null; let d = 0;
      for (let k = p.next; k < toks.length; k++) {
        const c = P(k);
        if (c === '(') d++;
        else if (c === ')') { if (d === 0) break; d--; } else if (c === ',' && d === 0) break;
        else if (d === 0 && W(k) === 'ON' && (W(k + 1) === 'DELETE' || W(k + 1) === 'UPDATE')) {
          const act = W(k + 2) === 'SET' ? `SET ${W(k + 3)}` : W(k + 2);
          if (W(k + 1) === 'DELETE') onDelete = act; else onUpdate = act;
        }
      }
      out.push({ parent: keyOf(p), child: keyOf(child), childLabel: child.table, ...shown(child), onDelete, onUpdate });
    }
    return out;
  };
  if (!toks.length) return R;
  let s = 0;
  if (W(0) === 'WITH') {
    let depth = 0;
    for (s = 1; s < toks.length; s++) {
      const p = P(s);
      if (p === '(') depth++; else if (p === ')') depth--;
      else if (depth === 0 && TAIL.has(W(s))) break;
    }
    if (s >= toks.length) return bad();
  }
  const h = W(s);
  if (h === 'SELECT' || h === 'VALUES') return R;
  if (h === 'CREATE' && s === 0) {
    let j = 1; const temp = W(j) === 'TEMP' || W(j) === 'TEMPORARY'; if (temp) j++;
    if (W(j) === 'TABLE') {
      let k = j + 1; const ifNotExists = W(k) === 'IF' && W(k + 1) === 'NOT' && W(k + 2) === 'EXISTS'; if (ifNotExists) k += 3;
      const q = name(k);
      if (q) {
        let replace = false;
        for (let i = q.next; i < toks.length; i++) if (W(i) === 'ON' && W(i + 1) === 'CONFLICT' && W(i + 2) === 'REPLACE') replace = true;
        R.table = { key: keyOf(q), ifNotExists, replace, fks: references(q.next, q) };
      }
      return R;
    }
    if (W(j) === 'VIEW') return R;
    if (!temp && W(j) === 'VIRTUAL' && W(j + 1) === 'TABLE') return R;
    if (!temp && (W(j) === 'INDEX' || (W(j) === 'UNIQUE' && W(j + 1) === 'INDEX'))) return R;
    if (W(j) !== 'TRIGGER') return bad();
    // CREATE [TEMP] TRIGGER [IF NOT EXISTS] [schema.]name [BEFORE | AFTER | INSTEAD OF] DELETE | INSERT | UPDATE [OF ...] ON table [...] BEGIN ... END
    j++;
    if (W(j) === 'IF' && W(j + 1) === 'NOT' && W(j + 2) === 'EXISTS') j += 3;
    const nm = name(j); if (!nm) return bad();
    j = nm.next;
    if (W(j) === 'BEFORE' || W(j) === 'AFTER') j++; else if (W(j) === 'INSTEAD' && W(j + 1) === 'OF') j += 2;
    const event = W(j); if (!EVENTS.has(event)) return bad();
    while (j < toks.length && W(j) !== 'ON') j++;
    const on = name(j + 1); if (!on) return bad();
    let b = -1;
    for (let k = on.next; k < toks.length; k++) if (W(k) === 'BEGIN' && P(k - 1) !== '.' && BODY_START.has(W(k + 1))) { b = k; break; }
    const last = toks.length - 1;
    if (b < 0 || W(last) !== 'END' || b + 1 >= last) return bad();
    const findings = []; const writes = []; let st = b + 1;
    for (let k = b + 1; k <= last; k++) {
      if (k !== last && toks[k].k !== 'semi') continue;
      if (k > st) {
        const r = analyzeTokens(src, toks, st, k);
        if (r.trigger || r.dropTrigger || r.findings.some(f => f.unresolved === 'statement')) return bad();
        findings.push(...r.findings); writes.push(...r.writes);
      }
      st = k + 1;
    }
    R.trigger = { name: lower(nm.table), label: nm.table, key: keyOf(on), event, findings, writes };
    return R;
  }
  if (h === 'DROP' && s === 0) {
    if (W(1) === 'INDEX' || W(1) === 'VIEW') return R;
    let j = 2; if (W(j) === 'IF' && W(j + 1) === 'EXISTS') j += 2;
    const q = name(j);
    if (W(1) === 'TRIGGER' && q) { R.dropTrigger = lower(q.table); return R; }
    // with foreign keys on, a dropped table is emptied first, so its children's ON DELETE actions run (its triggers do not)
    if (W(1) === 'TABLE' && q) { R.dropTable = keyOf(q); return lose('drop table', q, ['DROP']); }
    return bad();
  }
  if (h === 'ALTER' && s === 0) {
    const q = W(1) === 'TABLE' ? name(2) : null;
    if (!q) return bad();
    const v = W(q.next);
    if (v === 'ADD') { R.alterAdd = { fks: references(q.next + 1, q) }; return R; }
    if (v === 'DROP') return lose('drop column', q);
    if (v === 'RENAME') {
      const to = W(q.next + 1) === 'TO' ? name(q.next + 2) : null;
      if (to) R.rename = { from: keyOf(q), to: keyOf(to), label: to.table, ...shown(to) };
      return lose('rename', q);
    }
    return bad();
  }
  if (h === 'DELETE') { const q = W(s + 1) === 'FROM' ? name(s + 2) : null; return q ? lose('delete rows', q, ['DELETE']) : bad(); }
  if (h === 'UPDATE') {
    let j = s + 1; let verb = null;
    if (W(j) === 'OR') { verb = W(j + 1); j += 2; if (!CONFLICT.has(verb)) return bad(); }
    const q = name(j);
    return q ? lose('rewrite rows', q, verb === 'REPLACE' ? ['UPDATE', 'DELETE'] : ['UPDATE'], verb === null) : bad();
  }
  if (h === 'INSERT' || h === 'REPLACE') {
    let j = s + 1; let verb = h === 'REPLACE' ? 'REPLACE' : null;
    if (h === 'INSERT' && W(j) === 'OR') { verb = W(j + 1); j += 2; if (!CONFLICT.has(verb)) return bad(); }
    const q = W(j) === 'INTO' ? name(j + 1) : null;
    if (!q) return bad();
    if (verb === 'REPLACE') return lose('replace rows', q, ['INSERT', 'DELETE']);
    for (let i = q.next; i < toks.length; i++) if (W(i) === 'DO' && W(i + 1) === 'UPDATE') return lose('upsert rows', q, ['INSERT', 'UPDATE'], verb === null);
    return write(q, ['INSERT'], verb === null);
  }
  if (h === 'TRUNCATE') { const j = W(s + 1) === 'TABLE' ? s + 2 : s + 1; const q = name(j); return q ? lose('truncate', q, ['DELETE']) : bad(); }
  return bad();
}
const analyze = st => analyzeTokens(st, lex(st).filter(t => t.k !== 'ws' && t.k !== 'comment'));

/** Whether a piece is one statement: it holds no `;` outside quotes and comments, or it is one whole trigger whose body was read. */
export function oneStatement(piece) {
  const s = String(piece);
  return !lex(s).some(t => t.k === 'semi') || Boolean(analyze(s).trigger);
}

/** The schema statements (CREATE TABLE, CREATE TRIGGER, ALTER TABLE ... ADD and RENAME) in force after `sql` runs, given those before it (`known`). */
export function schemaAfter(sql, known = []) {
  return [...known, ...splitStatements(sql).filter(st => { const a = analyze(st); return a.table || a.trigger || a.dropTrigger || a.alterAdd || a.rename || a.dropTable; })];
}

// What a statement does to the schema the classifier tracks: { triggers: name -> trigger, tables: key -> { replace }, fks: [edge] }.
function learn(reg, a) {
  if (a.trigger) reg.triggers.set(a.trigger.name, a.trigger);
  else if (a.dropTrigger) reg.triggers.delete(a.dropTrigger);
  if (a.table && !(a.table.ifNotExists && reg.tables.has(a.table.key))) {
    reg.tables.set(a.table.key, { replace: a.table.replace });
    reg.fks = reg.fks.filter(e => e.child !== a.table.key).concat(a.table.fks);
  }
  if (a.alterAdd) reg.fks = reg.fks.concat(a.alterAdd.fks);
  if (a.rename) {
    const { from, to } = a.rename;
    if (reg.tables.has(from)) { reg.tables.set(to, reg.tables.get(from)); reg.tables.delete(from); }
    for (const [n, t] of reg.triggers) if (t.key === from) reg.triggers.set(n, { ...t, key: to });
    reg.fks = reg.fks.map(e => {
      const out = { ...e };
      if (out.parent === from) out.parent = to;
      if (out.child === from) {
        Object.assign(out, { child: to, childLabel: a.rename.label, table: a.rename.table }); delete out.unresolved;
        if (a.rename.unresolved) out.unresolved = a.rename.unresolved;
      }
      return out;
    });
  }
  if (a.dropTable) {
    reg.tables.delete(a.dropTable);
    reg.fks = reg.fks.filter(e => e.child !== a.dropTable);
    for (const [n, t] of reg.triggers) if (t.key === a.dropTable) reg.triggers.delete(n);
  }
}
const newSchema = () => ({ triggers: new Map(), tables: new Map(), fks: [] });

// What a write does past its own text. A REPLACE clause in the table turns a plain insert or update into a replace; a write fires every trigger on
// its table for one of its events, and the trigger's losses and writes count against the firing statement (one trigger is followed once on a path,
// as SQLite does not recurse by default); a delete (or a drop) or an update of a parent runs its children's ON DELETE or ON UPDATE actions.
function effects(reg, w, statement, seen, findings) {
  const tag = d => (d.unresolved ? { unresolved: d.unresolved } : {});
  let events = w.events;
  if (w.plain && reg.tables.get(w.key)?.replace && !seen.has(`replace:${w.key}`)) {
    findings.push({ table: w.table, kind: 'replace rows', statement, ...tag(w), via: 'ON CONFLICT REPLACE' });
    if (!events.includes('DELETE')) events = [...events, 'DELETE'];
    seen = new Set(seen).add(`replace:${w.key}`);
  }
  for (const t of [...reg.triggers.values()]) {
    if (t.key !== w.key || !events.includes(t.event) || seen.has(t.name)) continue;
    const next = new Set(seen).add(t.name);
    for (const f of t.findings) findings.push({ ...f, statement, via: t.label });
    for (const w2 of t.writes) effects(reg, w2, statement, next, findings);
  }
  const del = events.includes('DELETE') || events.includes('DROP'); const upd = events.includes('UPDATE');
  for (const e of [...reg.fks]) {
    if (e.parent !== w.key || seen.has(`fk:${e.child}`)) continue;
    const kind = del && e.onDelete === 'CASCADE' ? 'delete rows'
      : (del && LOSS_ACTION.has(e.onDelete)) || (upd && LOSS_ACTION.has(e.onUpdate)) ? 'rewrite rows' : null;
    if (!kind) continue;
    findings.push({ table: e.table, kind, statement, ...tag(e), via: `foreign key of ${e.childLabel}` });
    const child = { key: e.child, events: kind === 'delete rows' ? ['DELETE'] : ['UPDATE'], plain: false, table: e.table, ...tag(e) };
    effects(reg, child, statement, new Set(seen).add(`fk:${e.child}`), findings);
  }
}

/** What a migration would drop or rewrite: { destructive, tables, unresolved, findings: [{ table, kind, statement, unresolved?, via? }] }.
 *  Dropping a view, index or trigger loses no data. `schema` holds the CREATE TABLE and CREATE TRIGGER statements the store already has; with it
 *  and the file's own, a trigger a write fires, a REPLACE clause in a table and a foreign key action count, and `via` names what does the loss.
 *  `unresolved` lists the tables this store cannot export (another schema, a name that is not a plain identifier) and, for a statement on no
 *  allow-list, the statement itself; a finding carries `unresolved: 'schema' | 'name' | 'statement'`. */
export function classify(sql, { schema = [] } = {}) {
  const reg = newSchema();
  for (const t of schema) for (const st of splitStatements(t)) learn(reg, analyze(st));
  const findings = [];
  for (const st of splitStatements(sql)) {
    const a = analyze(st);
    findings.push(...a.findings);
    for (const w of a.writes) effects(reg, w, a.statement, new Set(), findings);
    learn(reg, a);
  }
  const tables = [...new Set(findings.filter(f => f.table != null).map(f => f.table))];
  const unresolved = [...new Set(findings.filter(f => f.unresolved).map(f => f.table ?? f.statement))];
  return { destructive: findings.length > 0, tables, unresolved, findings };
}

/** The CREATE TABLE and CREATE TRIGGER statements a store holds. A store whose schema cannot be read throws: it is never read as "nothing there". */
export async function storedSchema(db) {
  const r = await db.prepare(`SELECT sql FROM sqlite_master WHERE type IN ('table', 'trigger') AND sql IS NOT NULL`).all();
  return ((r && r.results) || []).map(x => x.sql).filter(x => typeof x === 'string');
}

/** The statements to run for `sql`, each checked to be one statement; a piece that is not throws, so nothing is half applied. */
export function runnable(sql) {
  const pieces = splitStatements(sql);
  const bad = pieces.find(p => !oneStatement(p));
  if (bad) throw new Error(`not one statement, refused before anything ran: ${norm(bad)}`);
  return pieces;
}

/** The reason a migration is refused for a table it cannot export, in the words both appliers use. */
export function unresolvedReason(c) {
  return c.findings.filter(f => f.unresolved).map(f => f.unresolved === 'schema' ? `${f.table} is in another schema and cannot be exported`
    : f.unresolved === 'name' ? `${f.table} cannot be resolved to a table name and cannot be exported`
      : `no table can be read from "${f.statement}"`).filter((r, i, a) => a.indexOf(r) === i).join('; ') + ', so the migration is refused';
}

async function sha256Hex(text) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return [...d].map(b => b.toString(16).padStart(2, '0')).join('');
}
const bodyText = async o => (o == null ? null : typeof o === 'string' ? o : typeof o.text === 'function' ? o.text() : String(o));

/** An object store held in memory, for tests and dry runs. */
export function memoryStore() {
  const m = new Map();
  return { m, async put(key, text) { m.set(key, String(text)); }, async get(key) { return m.has(key) ? { text: async () => m.get(key) } : null; } };
}

export function createExporter({ db, store, now = () => Date.now(), config = {} } = {}) {
  const clock = typeof now === 'function' ? now : () => now;
  const prefix = config.prefix || 'exports';
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
  const one = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  const safe = t => { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(t)) throw new Error(`not a table name: ${t}`); return t; };

  /** Export one table as JSON lines, read it back, and record the proof. Returns { ok, verified, key, rows, sha256 }. */
  async function exportTable(table, { migration = 'manual' } = {}) {
    if (!store || typeof store.put !== 'function' || typeof store.get !== 'function') return { ok: false, verified: false, error: 'no object store configured' };
    const rows = await all(`SELECT * FROM ${safe(table)}`);
    const body = rows.map(r => JSON.stringify(r)).join('\n');
    const sha = await sha256Hex(body);
    const at = stamp(clock());
    const key = `${prefix}/${migration}/${table}-${at.replace(/[^0-9]/g, '')}.jsonl`;
    let verified = false; let error = null;
    try {
      await store.put(key, body);
      const back = await bodyText(await store.get(key));
      if (back == null) error = 'export could not be read back';
      else {
        const parsed = back === '' ? [] : back.split('\n').map(l => JSON.parse(l));
        if (parsed.length !== rows.length) error = `read back ${parsed.length} rows, wrote ${rows.length}`;
        else if (await sha256Hex(back) !== sha) error = 'read-back body does not match what was written';
        else verified = true;
      }
    } catch (e) { error = `export failed: ${String(e?.message || e).slice(0, 160)}`; }
    await run(`INSERT INTO export_ledger (migration, table_name, object_key, row_count, sha256, verified, at) VALUES (?,?,?,?,?,?,?)`, migration, table, key, rows.length, sha, verified ? 1 : 0, at);
    return verified ? { ok: true, verified, key, rows: rows.length, sha256: sha } : { ok: false, verified, key, rows: rows.length, error };
  }

  /** Apply one migration. Additive: applied. Destructive: every affected table that exists is exported and verified first; any
   *  failure refuses the migration and leaves the store untouched. Each call is recorded in export_migrations. */
  async function applyMigration(name, sql, { also = [] } = {}) {
    // `also`: prepared statements that land with the migration (a caller's ledger row). With a store that offers batch() the migration and
    // they are one all-or-nothing call; without it they run in order. The store's schema is read first, so a trigger a write fires, a REPLACE
    // clause in a table and a foreign key action count.
    const c = classify(sql, { schema: await storedSchema(db) });
    const exports = [];
    if (c.destructive) {
      // a table this store cannot export (another schema, a name that is not a plain identifier, a statement on no allow-list or a piece that is
      // not one statement) refuses the whole migration before any export: it is never read as "nothing to lose"
      if (c.unresolved.length) {
        const reason = unresolvedReason(c);
        await run(`INSERT INTO export_migrations (name, destructive, tables, outcome, reason, at) VALUES (?,?,?,?,?,?)
          ON CONFLICT(name) DO UPDATE SET outcome=excluded.outcome, reason=excluded.reason, at=excluded.at`, name, 1, JSON.stringify(c.tables), 'refused', reason, stamp(clock()));
        return { ok: false, applied: false, refusal: 'table_unresolved', reason, exports, findings: c.findings };
      }
      for (const t of c.tables) {
        const exists = await one(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, t).catch(() => ({ name: t }));
        if (!exists) continue; // nothing to lose: the table is not there
        const e = await exportTable(t, { migration: name });
        exports.push({ table: t, ...e });
        if (!e.ok) {
          const reason = `export of ${t} not verified: ${e.error}`;
          await run(`INSERT INTO export_migrations (name, destructive, tables, outcome, reason, at) VALUES (?,?,?,?,?,?)
            ON CONFLICT(name) DO UPDATE SET outcome=excluded.outcome, reason=excluded.reason, at=excluded.at`, name, 1, JSON.stringify(c.tables), 'refused', reason, stamp(clock()));
          return { ok: false, applied: false, refusal: 'export_not_verified', reason, exports, findings: c.findings };
        }
      }
    }
    // what runs is what was classified: the same pieces, each checked to be one statement (a store that ran only the first statement of a
    // longer string would record the file as applied with the rest never run)
    const statements = runnable(sql);
    if (typeof db.batch === 'function') await db.batch([...statements.map(st => db.prepare(st)), ...also]);
    else { for (const st of statements) await run(st); for (const a of also) await a.run(); }
    await run(`INSERT INTO export_migrations (name, destructive, tables, outcome, reason, at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(name) DO UPDATE SET outcome=excluded.outcome, reason=excluded.reason, at=excluded.at`, name, c.destructive ? 1 : 0, JSON.stringify(c.tables), 'applied', null, stamp(clock()));
    return { ok: true, applied: true, destructive: c.destructive, exports, findings: c.findings };
  }

  /** Read an export back as rows (the restore path). */
  async function readExport(key) {
    const back = await bodyText(await store.get(key));
    if (back == null) return null;
    return back === '' ? [] : back.split('\n').map(l => JSON.parse(l));
  }

  return { exportTable, applyMigration, readExport, ledger: () => all(`SELECT * FROM export_ledger ORDER BY id`) };
}

/** Lint migration sources: [{ name, sql }], in the order they apply -> the destructive ones. The schema earlier files build (a trigger, a REPLACE
 *  clause, a foreign key) counts in later ones. The shipped migrations must return []. */
export function lintMigrations(files) {
  let schema = [];
  const out = [];
  for (const f of files) {
    const c = classify(f.sql, { schema });
    if (c.destructive) out.push({ name: f.name, findings: c.findings });
    schema = schemaAfter(f.sql, schema);
  }
  return out;
}
