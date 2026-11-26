// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Postgres dialect shim (US-SPEC-14 section 4, "Store dialect"). The core writes SQLite-flavoured SQL against the store handle
// (US-14-R02); this turns each statement into Postgres and wraps any client that has query(text, params) -> { rows, rowCount }
// into that handle. No driver is imported: the client is a port (node-postgres, a serverless driver or a pooled proxy all fit).
//   ?                       -> $1, $2, ...            (outside strings and comments)
//   INSERT OR IGNORE        -> INSERT ... ON CONFLICT DO NOTHING
//   datetime('now')         -> UTC text 'YYYY-MM-DD HH:MM:SS', so string comparison still orders time (US-14-R06, US-00-R05)
//   datetime('now', '-1 hour') and the like -> the same with an interval
//   INTEGER PRIMARY KEY AUTOINCREMENT -> BIGSERIAL PRIMARY KEY
//   last_row_id             -> RETURNING id, added to an INSERT into a table known to have a serial id
//   SUM(a = b) and other bare boolean sums -> SUM(CASE WHEN ... THEN 1 ELSE 0 END)
//   INSERT OR REPLACE INTO t (cols) -> ON CONFLICT (primary key of t) DO UPDATE SET every other column = excluded.col (key learned from
//                           the CREATE TABLE the shim translated; an unknown key is an error naming the table)
//   FROM sqlite_master      -> a sub-select over pg_tables, pg_views and pg_indexes with the columns name, type, sql, tbl_name
//   julianday(x)            -> days as a number (epoch / 86400 + 2440587.5), so differences in days and hours still work
//   json_extract(c, '$.a.b') -> (c::json #>> '{a,b}');  IFNULL -> COALESCE;  hex(randomblob(n)) -> upper-case hex from md5, n up to 32
//   refused with a message: rowid, PRAGMA (no Postgres form; write the column or the setting)
const NOW_TEXT = `to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')`;
const nowPlus = (mod) => {
  const m = /^\s*([+-]?\d+(?:\.\d+)?)\s+(second|minute|hour|day|month|year)s?\s*$/i.exec(mod);
  if (!m) throw new Error(`datetime modifier not supported by the Postgres shim: ${mod}`);
  return `to_char((now() AT TIME ZONE 'UTC') + interval '${m[1]} ${m[2].toLowerCase()}', 'YYYY-MM-DD HH24:MI:SS')`;
};

/** Split SQL into code and literal segments so rewrites never touch a string, a quoted name or a comment. */
function segments(sql) {
  const out = []; let i = 0; let code = '';
  const push = (text, lit) => { if (text) out.push({ text, lit }); };
  while (i < sql.length) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === c) { if (sql[j + 1] === c) j += 2; else break; } else j++; }
      push(code, false); code = ''; push(sql.slice(i, j + 1), true); i = j + 1; continue;
    }
    if (c === '-' && sql[i + 1] === '-') { let j = sql.indexOf('\n', i); if (j < 0) j = sql.length; push(code, false); code = ''; push(sql.slice(i, j), true); i = j; continue; }
    code += c; i++;
  }
  push(code, false);
  return out;
}


/** Index of the parenthesis that closes the one opened at `open` in `s`, skipping string literals; -1 when it never closes. */
function closeParen(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { i++; while (i < s.length && !(s[i] === c && s[i + 1] !== c)) { if (s[i] === c) i++; i++; } continue; }
    if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return i;
  }
  return -1;
}
/** Split on commas that are not inside parentheses or strings. */
function splitTop(s) {
  const out = []; let depth = 0; let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'" || c === '"') { let j = i + 1; while (j < s.length && !(s[j] === c && s[j + 1] !== c)) { if (s[j] === c) j++; j++; } cur += s.slice(i, j + 1); i = j; continue; }
    if (c === '(') depth++; else if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
/** Rewrite every call `name(args)` (not a method, not inside a longer word) with `fn(argList) -> text`. */
function rewriteCalls(s, name, fn) {
  const re = new RegExp(`(?<![\\w.])${name}\\s*\\(`, 'gi');
  let out = ''; let last = 0; let m;
  while ((m = re.exec(s))) {
    const open = m.index + m[0].length - 1; const close = closeParen(s, open);
    if (close < 0) break;
    out += s.slice(last, m.index) + fn(splitTop(s.slice(open + 1, close)).map(a => rewriteCalls(a, name, fn)));
    last = close + 1; re.lastIndex = close + 1;
  }
  return out + s.slice(last);
}
const unquote = n => String(n).trim().replace(/^["`\[]|["`\]]$/g, '');
const SQLITE_MASTER = `(SELECT tablename AS name, 'table' AS type, NULL::text AS sql, tablename AS tbl_name FROM pg_tables WHERE schemaname = current_schema() UNION ALL SELECT viewname, 'view', NULL::text, viewname FROM pg_views WHERE schemaname = current_schema() UNION ALL SELECT indexname, 'index', indexdef, tablename FROM pg_indexes WHERE schemaname = current_schema()) AS sqlite_master`;

/** The primary key of a CREATE TABLE statement: { table, cols } or null. Inline `PRIMARY KEY` and a table-level `PRIMARY KEY (a, b)` are read. */
export function primaryKeyOf(createSql) {
  const text = String(createSql).replace(/--[^\n]*/g, '');
  const head = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(/i.exec(text);
  if (!head) return null;
  const open = head[0].length - 1; const close = closeParen(text, open);
  const parts = splitTop(text.slice(open + 1, close < 0 ? undefined : close));
  for (const part of parts) {
    const table = /^(?:CONSTRAINT\s+\w+\s+)?PRIMARY\s+KEY\s*\(([^)]*)\)/i.exec(part);
    if (table) return { table: head[1].toLowerCase(), cols: table[1].split(',').map(unquote) };
  }
  for (const part of parts) {
    if (/^(CONSTRAINT|UNIQUE|FOREIGN|CHECK|PRIMARY)\b/i.test(part)) continue;
    if (/\bPRIMARY\s+KEY\b/i.test(part)) return { table: head[1].toLowerCase(), cols: [unquote(part.split(/\s+/)[0])] };
  }
  return { table: head[1].toLowerCase(), cols: [] };
}

/** Translate one statement. Returns { text, returning } where `returning` says the shim appended RETURNING id.
 *  `serialTables` is the set of tables whose id is a serial and `keys` maps a table to its primary key columns; translating DDL adds to both. */
export function translate(sql, { serialTables = new Set(), keys = new Map() } = {}) {
  let s = String(sql).trim().replace(/;\s*$/, '');
  // datetime('now'[, modifier]) spans a string literal, so it is rewritten before the split.
  s = s.replace(/datetime\(\s*'now'\s*(?:,\s*'([^']*)'\s*)?\)/gi, (_m, mod) => (mod ? nowPlus(mod) : NOW_TEXT));
  // SQLite sums a bare comparison as 0 or 1; Postgres needs the CASE spelled out. The argument may hold a string literal.
  s = s.replace(/\bSUM\(\s*((?:'[^']*'|[^()'])*?)\s*\)/gi, (m, expr) => {
    const bare = expr.replace(/'[^']*'/g, "''");
    return /^\s*CASE\b/i.test(bare) || !/(=|<>|!=|>|<|\bIS\s+(NOT\s+)?NULL\b)/i.test(bare) ? m : `SUM(CASE WHEN ${expr} THEN 1 ELSE 0 END)`;
  });
  s = s.replace(/\bFROM\s+sqlite_master\b/gi, `FROM ${SQLITE_MASTER}`);
  s = rewriteCalls(s, 'julianday', ([x]) => (/^\s*'now'\s*$/i.test(x) ? `(EXTRACT(EPOCH FROM now()) / 86400.0 + 2440587.5)` : `(EXTRACT(EPOCH FROM (${x})::timestamp) / 86400.0 + 2440587.5)`));
  s = rewriteCalls(s, 'json_extract', ([col, path]) => {
    const parts = /^\s*'\$((?:\.[A-Za-z_]\w*)+)'\s*$/.exec(path || '');
    if (!parts) throw new Error(`json_extract path not supported by the Postgres shim: ${path}`);
    const keysOf = parts[1].slice(1).split('.');
    return keysOf.length === 1 ? `(${col}::json ->> '${keysOf[0]}')` : `(${col}::json #>> '{${keysOf.join(',')}}')`;
  });
  s = rewriteCalls(s, 'hex', ([x]) => {
    const n = /^\s*randomblob\s*\(\s*(\d+)\s*\)\s*$/i.exec(x || '');
    if (!n || Number(n[1]) < 1 || Number(n[1]) > 32) throw new Error(`hex(${x}) is not supported by the Postgres shim: use hex(randomblob(n)) with n from 1 to 32`);
    const md5 = `md5(random()::text || clock_timestamp()::text)`;
    return `upper(substr(${md5} || ${md5}, 1, ${2 * Number(n[1])}))`;
  });
  s = s.replace(/\bIFNULL\s*\(/gi, 'COALESCE(');
  if (/^\s*PRAGMA\b/i.test(s)) throw new Error('PRAGMA has no Postgres form: the setting belongs to the SQLite handle only');
  if (/(?<![\w'"])rowid\b/i.test(segments(s).filter(g => !g.lit).map(g => g.text).join(' '))) throw new Error('rowid has no Postgres form: order or key by a real column');
  const ignore = /^\s*INSERT\s+OR\s+IGNORE\b/i.test(s);
  const rep = /^\s*(?:INSERT\s+OR\s+REPLACE|REPLACE)\s+INTO\s+["`]?(\w+)["`]?\s*(\(([^)]*)\))?/i.exec(s);
  let upsert = '';
  if (rep) {
    const table = rep[1].toLowerCase(); const pk = keys.get(table);
    const fail = why => new Error(`INSERT OR REPLACE into ${table} has no direct Postgres form here: ${why}; write ON CONFLICT (...) DO UPDATE`);
    if (!pk) throw fail('its primary key is not known to the shim (translate its CREATE TABLE first)');
    if (!pk.length) throw fail('the table has no primary key');
    if (!rep[3]) throw fail('the statement names no columns');
    const cols = rep[3].split(',').map(unquote);
    const rest = cols.filter(c => !pk.includes(c));
    upsert = rest.length ? ` ON CONFLICT (${pk.join(', ')}) DO UPDATE SET ${rest.map(c => `${c} = excluded.${c}`).join(', ')}` : ` ON CONFLICT (${pk.join(', ')}) DO NOTHING`;
    s = s.replace(/^\s*(?:INSERT\s+OR\s+REPLACE|REPLACE)\s+INTO\b/i, 'INSERT INTO');
  }
  const create = /^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/i.exec(s);
  let n = 0;
  const parts = segments(s).map(seg => {
    if (seg.lit) return seg.text;
    let t = seg.text;
    t = t.replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT');
    t = t.replace(/\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b/gi, 'BIGSERIAL PRIMARY KEY');
    t = t.replace(/\bAUTOINCREMENT\b/gi, '');
    t = t.replace(/\?/g, () => `$${++n}`);
    return t;
  });
  let text = parts.join('');
  if (create) { const pk = primaryKeyOf(sql); if (pk) keys.set(pk.table, pk.cols); }
  if (create && /\bBIGSERIAL PRIMARY KEY\b/.test(text) && /\(\s*id\s+BIGSERIAL\b/i.test(text.replace(/--[^\n]*/g, ''))) serialTables.add(create[1].toLowerCase());
  if (create) text = text.replace(/\bREAL\b/g, 'DOUBLE PRECISION');
  if (ignore && !/\bON\s+CONFLICT\b/i.test(text)) text += ' ON CONFLICT DO NOTHING';
  if (upsert) text += upsert;
  let returning = false;
  const ins = /^\s*INSERT\s+INTO\s+["`]?(\w+)/i.exec(text);
  if (ins && serialTables.has(ins[1].toLowerCase()) && !/\bRETURNING\b/i.test(text)) { text += ' RETURNING id'; returning = true; }
  return { text, returning, params: n };
}

/** Split a migration file into statements (quotes, comments and trigger bodies respected) and translate each. */
export function translateMigration(sql, opts = {}) {
  const out = []; let cur = '';
  for (const seg of segments(String(sql))) {
    if (seg.lit) { if (!seg.text.startsWith('--')) cur += seg.text; continue; }
    const pieces = seg.text.split(';');
    pieces.forEach((p, i) => { cur += p; if (i < pieces.length - 1) { if (cur.trim()) out.push(cur.trim()); cur = ''; } });
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map(st => translate(st, opts).text);
}

/** True for the errors that mean the connection dropped (a restart, an idle timeout): the names the platform's Python store retries on
 *  (OperationalError, InterfaceError, AdminShutdown, ConnectionDoesNotExist) and the Node socket errors. Any other error is the query's own. */
export function isDroppedConnection(e) {
  const names = ['OperationalError', 'InterfaceError', 'AdminShutdown', 'ConnectionDoesNotExist'];
  const codes = ['ECONNRESET', 'EPIPE', 'ECONNREFUSED', 'ETIMEDOUT', '57P01', '57P02', '57P03', '08000', '08003', '08006'];
  return names.includes(e?.name) || names.includes(e?.constructor?.name) || codes.includes(e?.code) || /connection (terminated|closed)|Connection terminated|server closed the connection/i.test(String(e?.message || ''));
}

/** The store handle (US-14-R02) over a Postgres client. `client.query(text, params)` must resolve to { rows, rowCount }.
 *  `reconnect` (optional, async) is called once when a query fails because the connection dropped, and the query is then retried once;
 *  every other error is rethrown unchanged, and a second failure is rethrown too (a loop never retries without end, GUIDING-DIRECTIVE 2). */
export function createPgStore(client, { serialTables = new Set(), keys = new Map(), reconnect = null } = {}) {
  if (!client || typeof client.query !== 'function') throw new Error('a client with query(text, params) is required');
  const send = async (text, args) => {
    try { return await client.query(text, args); } catch (e) {
      if (typeof reconnect !== 'function' || !isDroppedConnection(e)) throw e;
      await reconnect(e);
      return client.query(text, args);
    }
  };
  return {
    serialTables, keys,
    async migrate(sql) { for (const text of translateMigration(sql, { serialTables, keys })) await send(text, []); },
    prepare(sql) {
      const { text, returning } = translate(sql, { serialTables, keys });
      let args = [];
      const o = {
        bind(...a) { args = a.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v)); return o; },
        async all() { return { results: (await send(text, args)).rows || [] }; },
        async first() { return ((await send(text, args)).rows || [])[0] ?? null; },
        async run() {
          const r = await send(text, args);
          const id = returning && r.rows && r.rows[0] ? Number(r.rows[0].id) : null;
          return { meta: { changes: Number(r.rowCount ?? 0), last_row_id: id } };
        },
      };
      return o;
    },
  };
}

/** Wrap any store handle so every statement prepared through it is also translated for Postgres, in the same call. An untranslatable
 *  statement throws at prepare time (so a suite run through it fails on the first SQLite-only construct), and `onStatement` receives
 *  { sql, text, params } for each distinct statement. The statement itself still runs on the wrapped handle, so results are the real
 *  ones: this is how the whole core tick suite is read for portability without a Postgres server (US-14-R07, R14). */
export function recordStatements(handle, { onStatement = () => {}, serialTables = new Set(), keys = new Map() } = {}) {
  const seen = new Set();
  return {
    ...handle,
    raw: handle.raw,
    prepare(sql) {
      let t;
      try { t = translate(sql, { serialTables, keys }); } catch (e) { throw new Error(`the Postgres shim cannot translate this statement (${String(e.message).slice(0, 120)}): ${String(sql).slice(0, 160)}`); }
      if (!seen.has(sql)) { seen.add(sql); onStatement({ sql: String(sql), text: t.text, params: t.params }); }
      return handle.prepare(sql);
    },
  };
}
