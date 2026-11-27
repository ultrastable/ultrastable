// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SqlPort over node:sqlite for tests and the non-Cloudflare adapters (one file per tenant). node:sqlite does not report rows read,
// so rowsRead is conservative: rows returned, or the table row count when EXPLAIN QUERY PLAN shows a full SCAN. A write that carries limits
// ({ maxRowsRead, maxRowsWritten }, see core/tenantstore/store.js) is refused before it runs when its plan scans past maxRowsRead, and otherwise runs inside a savepoint and is rolled back when it crosses them, so a
// refused statement leaves the store as it was (US-25-R03, R15). storageBytes() is the file size (page_count x page_size).
import { DatabaseSync } from 'node:sqlite';
import { statementKind } from '../../core/tenantstore/sqlclass.js';

// CREATE TABLE ... AS SELECT is DDL that reads and writes rows: its scan is counted from the plan of the SELECT part, and the rows it writes
// are counted as the size of the table it creates, so a CTAS is metered and capped like an INSERT ... SELECT (US-25-R03, R15). A quoted or schema-qualified name falls back
// to the plain DDL path, which the storage ceiling still covers.
const CTAS = /^\s*create\s+(?:temp\s+|temporary\s+)?table\s+(?:if\s+not\s+exists\s+)?("[^"]+"|[A-Za-z_]\w*)\s+as\s+([\s\S]+)$/i;

export function openTenantSql(path = ':memory:') {
  const raw = new DatabaseSync(path);
  const scanRows = (text, params) => {
    let n = 0;
    for (const p of raw.prepare('EXPLAIN QUERY PLAN ' + text).all(...params)) {
      const m = /^SCAN (?:TABLE )?(\w+)/.exec(p.detail || '');
      // A SCAN of a CTE or subquery name is not a table scan (the table it reads is scanned on its own plan line), so only real tables count.
      if (m && !m[1].startsWith('sqlite_') && m[1] !== 'CONSTANT' && raw.prepare(`SELECT 1 FROM sqlite_master WHERE name = ? AND type IN ('table','view')`).get(m[1])) n = Math.max(n, raw.prepare(`SELECT COUNT(*) n FROM "${m[1]}"`).get().n);
    }
    return n;
  };
  return {
    raw,
    storageBytes() { return raw.prepare('PRAGMA page_count').get().page_count * raw.prepare('PRAGMA page_size').get().page_size; },
    exec(text, params = [], limits) {
      const st = raw.prepare(text);
      const kind = statementKind(text), isRead = kind === 'read';      // the same classification the store applies (a WITH ... INSERT is DML)
      if (isRead) {
        const rows = st.all(...params).map(r => ({ ...r }));
        let rowsRead = rows.length;
        if (!/^\s*(pragma|explain)\b/i.test(text)) rowsRead = Math.max(rowsRead, scanRows(text, params));
        return { rows, rowsRead, rowsWritten: 0 };
      }
      // DDL and writes. Reads a write performs (an UPDATE or DELETE that scans, an INSERT ... SELECT) are counted from the query plan.
      // sqlite reports the previous statement's change count for DDL, so only a DML statement has rows written.
      const dml = kind === 'dml';
      const ctas = kind === 'ddl' ? CTAS.exec(text) : null;
      let scanned = 0;
      if (dml) { try { scanned = scanRows(text, params); } catch { scanned = 0; } }
      else if (ctas) { try { scanned = scanRows(ctas[2], params); } catch { scanned = 0; } }
      const tableRows = name => raw.prepare(`SELECT COUNT(*) n FROM ${name.startsWith('"') ? name : `"${name}"`}`).get().n;
      const changes = r => (dml ? Number(r.changes) : ctas ? tableRows(ctas[1]) : 0);
      const readOf = written => (ctas ? Math.max(scanned, written) : scanned);   // a CTAS reads at least every row it copies
      if (!limits) { const r = st.run(...params), written = changes(r); return { rows: [], rowsRead: readOf(written), rowsWritten: written }; }
      // The plan's scan is known before the statement runs, so a write that would read past the cap is refused without running: it writes
      // nothing, not even rows a rollback would undo (US-25-R02, R03). A write that scans little but writes past the cap still runs and rolls back.
      if (limits.maxRowsRead && scanned > limits.maxRowsRead) throw Object.assign(new Error('statement_too_wide'), { code: 'statement_too_wide', rowsRead: scanned, rowsWritten: 0 });
      raw.exec('SAVEPOINT tenant_stmt');
      try {
        const r = st.run(...params), written = changes(r), read = readOf(written);
        if ((limits.maxRowsRead && read > limits.maxRowsRead) || (limits.maxRowsWritten && written > limits.maxRowsWritten)) {
          raw.exec('ROLLBACK TO tenant_stmt'); raw.exec('RELEASE tenant_stmt');
          throw Object.assign(new Error('statement_too_wide'), { code: 'statement_too_wide', rowsRead: read, rowsWritten: written });
        }
        raw.exec('RELEASE tenant_stmt');
        return { rows: [], rowsRead: read, rowsWritten: written };
      } catch (e) {
        if (e && e.code === 'statement_too_wide') throw e;
        raw.exec('ROLLBACK TO tenant_stmt'); raw.exec('RELEASE tenant_stmt'); throw e;
      }
    },
  };
}
