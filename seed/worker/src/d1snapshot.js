// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// D1-SNAPSHOT-1 (UNATTENDED-365 dependency offsite-backup): once a day the tick copies its own D1 database into the R2 bucket bound as AUDIT, then reads
// the copy back and counts its rows before it counts as a backup. This is the daily second home beside the weekly restore drill (foundation/backup.py,
// dumps in the ops repository). Format: gzip NDJSON, one {"t": table, "r": row} line per row, so a restore is a plain replay of INSERTs.
// Tables that hold sealed credentials are left out, the same list as doctrine/backup.json exclude_tables (they are re-minted through /connect).
export const EXCLUDE = ['credentials', 'credential_events', 'agent_keys', 'webhook_subscriptions'];
export const PREFIX = 'backups/d1/', KEEP = 14, MAX_ROWS = 200000;

const day = (now) => new Date(now).toISOString().slice(0, 10);

async function gzip(text) {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
async function gunzip(bytes) {
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(s).text();
}
async function sha256(bytes) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...h].map(b => b.toString(16).padStart(2, '0')).join('');
}

// db: a D1 binding; bucket: an R2 binding. Returns a record of names, counts and a hash, never a row.
export async function snapshotD1(db, bucket, { name = 'ultrastable-org', now = Date.now(), keep = KEEP } = {}) {
  if (!bucket) return { skipped: 'no AUDIT bucket bound' };
  if (!db) return { skipped: 'no DB bound' };
  const key = `${PREFIX}${name}/${day(now)}.ndjson.gz`;
  if (await bucket.head(key)) return { skipped: 'already taken today', key };
  const listed = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'd1_%' ORDER BY name").all();
  const tables = (listed.results || []).map(r => r.name).filter(t => !EXCLUDE.includes(t) && /^[A-Za-z_][\w]*$/.test(t));
  const results = tables.length ? await db.batch(tables.map(t => db.prepare(`SELECT * FROM "${t}" LIMIT ${MAX_ROWS + 1}`))) : [];
  const lines = [], counts = {}, truncated = [];
  tables.forEach((t, i) => {
    let rows = (results[i] && results[i].results) || [];
    if (rows.length > MAX_ROWS) { truncated.push(t); rows = rows.slice(0, MAX_ROWS); }
    counts[t] = rows.length;
    for (const r of rows) lines.push(JSON.stringify({ t, r }));
  });
  const bytes = await gzip(lines.length ? lines.join('\n') + '\n' : '');
  const hash = await sha256(bytes), rows = lines.length;
  await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/gzip' }, customMetadata: { rows: String(rows), sha256: hash, tables: String(tables.length) } });
  // a copy counts only after it is read back whole: the stored bytes hash the same and replay to the same row count
  const back = await bucket.get(key);
  const backBytes = back ? new Uint8Array(await back.arrayBuffer()) : new Uint8Array();
  const backRows = backBytes.length ? await gunzip(backBytes).then(t => t.split('\n').filter(Boolean).length, () => -1) : -1;  // a corrupt copy is a failed readback, not a crash
  const readback = Boolean(back) && (await sha256(backBytes)) === hash && backRows === rows;
  const deleted = readback ? await prune(bucket, `${PREFIX}${name}/`, keep) : 0;  // never prune on a failed copy
  return { key, tables: tables.length, rows, bytes: bytes.length, sha256: hash, readback, excluded: EXCLUDE, truncated, deleted, counts };
}

async function prune(bucket, prefix, keep) {
  const keys = [];
  let cursor;
  do { const l = await bucket.list({ prefix, cursor }); keys.push(...l.objects.map(o => o.key)); cursor = l.truncated ? l.cursor : undefined; } while (cursor);
  const old = keys.sort().slice(0, Math.max(0, keys.length - keep));
  if (old.length) await bucket.delete(old);
  return old.length;
}
