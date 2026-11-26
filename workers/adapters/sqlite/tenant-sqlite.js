// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// SqlPort over node:sqlite for tests and the non-Cloudflare adapters (one file per tenant). node:sqlite does not report rows read,
// so rowsRead is conservative: rows returned, or the table row count when EXPLAIN QUERY PLAN shows a full SCAN. A write that carries limits
// ({ maxRowsRead, maxRowsWritten }, see core/tenantstore/store.js) runs inside a savepoint and is rolled back when it crosses them, so a
// refused statement leaves the store as it was (US-25-R03, R15). storageBytes() is the file size (page_count x page_size).
import { DatabaseSync } from 'node:sqlite';
import { statementKind } from '../../core/tenantstore/sqlclass.js';

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
      let scanned = 0;
      if (dml) { try { scanned = scanRows(text, params); } catch { scanned = 0; } }
      const changes = r => (dml ? Number(r.changes) : 0);
      if (!limits) { const r = st.run(...params); return { rows: [], rowsRead: scanned, rowsWritten: changes(r) }; }
      raw.exec('SAVEPOINT tenant_stmt');
      try {
        const r = st.run(...params), written = changes(r);
        if ((limits.maxRowsRead && scanned > limits.maxRowsRead) || (limits.maxRowsWritten && written > limits.maxRowsWritten)) {
          raw.exec('ROLLBACK TO tenant_stmt'); raw.exec('RELEASE tenant_stmt');
          throw Object.assign(new Error('statement_too_wide'), { code: 'statement_too_wide', rowsRead: scanned, rowsWritten: written });
        }
        raw.exec('RELEASE tenant_stmt');
        return { rows: [], rowsRead: scanned, rowsWritten: written };
      } catch (e) {
        if (e && e.code === 'statement_too_wide') throw e;
        raw.exec('ROLLBACK TO tenant_stmt'); raw.exec('RELEASE tenant_stmt'); throw e;
      }
    },
  };
}
