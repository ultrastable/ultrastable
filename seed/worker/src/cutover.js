// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// ACCOUNT-SPLIT-2: the two-account controller. The same tick code runs in the source account (quniverse) and the target account
// (ultrastable). Each beat, a tick reads its peer's /health (env.CUTOVER_PEER) and decides whether it runs the loops:
//   - a tick runs the loops only while it is 'primary' and no reachable peer is primary with a higher epoch (never two primaries);
//   - a 'standby' tick runs nothing but this check; it promotes itself (epoch = peer epoch + 1) the beat it holds a GitHub credential,
//     after a final copy of the source org database and switching the source's crons off and its site to forward here;
//   - a 'demoted' tick resumes (epoch + 1) only after its peer has been unreachable or not primary for RESUME_BEATS beats,
//     so the system never has zero hosts.
// While the target waits for its GitHub credential, the primary keeps one gate card open (default in effect: the source keeps running)
// and closes it the beat the target reports github_ok. Nothing here waits on a person reading anything.
export const DDL = "CREATE TABLE IF NOT EXISTS cutover_state (k TEXT PRIMARY KEY, v TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))";
export const RESUME_BEATS = 3;
export const GATE_ID = 'GATE-TARGET-GITHUB';
// Tables that belong to the account that holds them: never overwritten by the final copy.
export const LOCAL_TABLES = new Set(['credentials', 'credential_events', 'agent_keys', 'webhook_subscriptions', 'cutover_state', '_copy_progress', '_backup_dispatch_model_20261115']);
const CF = 'https://api.cloudflare.com/client/v4';

const get = async (db, k) => { const r = await db.prepare('SELECT v FROM cutover_state WHERE k = ?').bind(k).first(); return r ? r.v : null; };
const set = (db, k, v) => db.prepare("INSERT INTO cutover_state (k, v, at) VALUES (?, ?, datetime('now')) ON CONFLICT(k) DO UPDATE SET v = excluded.v, at = excluded.at").bind(k, String(v)).run();

export async function readState(db, env) {
  await db.prepare(DDL).run();
  return { slot: (await get(db, 'slot')) || env.SLOT || 'primary', epoch: Number((await get(db, 'epoch')) || env.EPOCH || 1), misses: Number((await get(db, 'peer_misses')) || 0), github_ok: (await get(db, 'github_ok')) === '1', promoted_at: await get(db, 'promoted_at') };
}

export async function peerHealth(env, f = fetch) {
  if (!env.CUTOVER_PEER) return null;
  try {
    const r = await f(String(env.CUTOVER_PEER).replace(/\/$/, '') + '/health', { headers: { 'cache-control': 'no-cache', 'user-agent': 'ultrastable-cutover' }, signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined });
    const j = await r.json().catch(() => null);
    return j && j.cutover ? { reachable: true, ...j.cutover } : { reachable: true, slot: 'primary', epoch: 1, legacy: true };  // a peer on older code is a primary at epoch 1
  } catch (e) { return { reachable: false, error: String(e && e.message).slice(0, 120) }; }
}

async function ensureGate(db, open, peerUrl) {
  const g = await db.prepare('SELECT status FROM gate_cards WHERE id = ?').bind(GATE_ID).first().catch(() => null);
  if (open && (!g || g.status !== 'open')) {
    if (g) await db.prepare("UPDATE gate_cards SET status = 'open', closed_at = NULL WHERE id = ?").bind(GATE_ID).run();
    else await db.prepare('INSERT INTO gate_cards (id, what, why_gated, default_in_effect, prepared_by_fleet, closing_probe) VALUES (?, ?, ?, ?, ?, ?)').bind(GATE_ID,
      `GitHub App credential for the tick in the ultrastable Cloudflare account (${peerUrl}/connect/github)`,
      "Installing a GitHub App on the owner's GitHub organization is an act in the owner's account (IC-GATE-001); moving the sealed key across accounts was refused by a permission check",
      'Every Cloudflare-side loop runs in the ultrastable account; merges run in GitHub Actions (lane.yml) and deploys through the OIDC route (deploy-ultrastable.yml); the tick lane, handoff and native executor resume the beat the tick holds the credential',
      'ACCOUNT-SPLIT-2 controller', `${peerUrl}/health shows cutover.github_ok = true`).run();
  } else if (!open && g && g.status === 'open') await db.prepare("UPDATE gate_cards SET status = 'closed', closed_at = datetime('now') WHERE id = ?").bind(GATE_ID).run();
}

// Final copy: every table of the source org database except LOCAL_TABLES, read through the Cloudflare D1 API, written locally.
export async function copyFromSource(env, db, f = fetch) {
  if (!env.SOURCE_CF_TOKEN || !env.SOURCE_ACCOUNT || !env.SOURCE_ORG_D1) return { ok: false, detail: 'source copy not configured' };
  const q = async sql => {
    const r = await f(`${CF}/accounts/${env.SOURCE_ACCOUNT}/d1/database/${env.SOURCE_ORG_D1}/query`, { method: 'POST', headers: { authorization: 'Bearer ' + env.SOURCE_CF_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ sql }) });
    const j = await r.json(); if (!j.success) throw new Error('source D1: ' + JSON.stringify(j.errors).slice(0, 160)); return j.result[0].results;
  };
  const tables = (await q("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'")).filter(t => !LOCAL_TABLES.has(t.name));
  const copied = {};
  for (const t of tables) {
    const cols = (await q(`SELECT name FROM pragma_table_info('${t.name.replace(/'/g, "''")}')`)).map(c => c.name);
    await db.prepare(`DROP TABLE IF EXISTS "${t.name}"`).run();
    await db.prepare(t.sql).run();
    let off = 0, n = 0;
    for (;;) {
      const rows = await q(`SELECT * FROM "${t.name}" LIMIT 1000 OFFSET ${off}`);
      const ins = `INSERT INTO "${t.name}" (${cols.map(c => `"${c}"`).join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
      for (const r of rows) { await db.prepare(ins).bind(...cols.map(c => (r[c] === undefined ? null : r[c]))).run(); n++; }
      off += rows.length; if (rows.length < 1000) break;
    }
    copied[t.name] = n;
  }
  const skipped = []; // SILENT-CATCH: a schema object that would not recreate (an index on a local-only table) is skipped and reported, not lost
  for (const o of await q("SELECT sql FROM sqlite_master WHERE type IN ('index','trigger','view') AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%'")) {
    try { await db.prepare(o.sql.replace(/^CREATE (UNIQUE )?INDEX (?!IF)/i, 'CREATE $1INDEX IF NOT EXISTS ').replace(/^CREATE (VIEW|TRIGGER) (?!IF)/i, 'CREATE $1 IF NOT EXISTS ')).run(); } catch (e) { skipped.push(`${String(o.sql).slice(0, 60)}: ${String(e && e.message).slice(0, 80)}`); }
  }
  return { ok: true, tables: Object.keys(copied).length, rows: Object.values(copied).reduce((a, b) => a + b, 0), skipped };
}

// The source's crons off and its site forwarding to this account. Each step is recorded; a failed step never blocks promotion,
// because the epoch rule already keeps the source from running loops.
export async function retireSource(env, f = fetch) {
  const out = [];
  if (!env.SOURCE_CF_TOKEN || !env.SOURCE_ACCOUNT) return [{ step: 'retire', ok: false, detail: 'source token not configured' }];
  const api = (method, path, body) => f(`${CF}/accounts/${env.SOURCE_ACCOUNT}${path}`, { method, headers: { authorization: 'Bearer ' + env.SOURCE_CF_TOKEN, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async r => ({ ok: r.ok, status: r.status }));
  for (const w of ['ultrastable-tick', 'ultrastable-dashboard', 'ultrastable-site']) out.push({ step: `crons off ${w}`, ...(await api('PUT', `/workers/scripts/${w}/schedules`, [])) });
  if (env.TARGET_SITE_ORIGIN) out.push({ step: 'source site forwards', ...(await api('PUT', '/workers/scripts/ultrastable-site/secrets', { name: 'UPSTREAM_ORIGIN', text: env.TARGET_SITE_ORIGIN, type: 'secret_text' })) });
  return out;
}

export async function decide(db, env, { fetch: f = fetch, githubOk = async () => false, copy = copyFromSource, retire = retireSource, now = () => new Date().toISOString() } = {}) {
  const me = await readState(db, env);
  const peer = await peerHealth(env, f);
  const notes = [];
  if (me.slot === 'standby') {
    const gh = await githubOk().catch(() => false);
    await set(db, 'github_ok', gh ? '1' : '0');
    if (!gh) return { run: false, slot: 'standby', epoch: me.epoch, github_ok: false, peer, notes: ['standby: waiting for a GitHub credential on this account'] };
    const c = await copy(env, db, f).catch(e => ({ ok: false, detail: String(e && e.message).slice(0, 160) }));
    notes.push('final copy: ' + JSON.stringify(c));
    if (!c.ok && env.SOURCE_CF_TOKEN) return { run: false, slot: 'standby', epoch: me.epoch, github_ok: true, peer, notes: [...notes, 'promotion deferred: final copy failed; retried next beat'] };
    const epoch = Math.max(me.epoch, (peer && peer.epoch) || 1) + 1;
    await set(db, 'epoch', epoch); await set(db, 'slot', 'primary'); await set(db, 'promoted_at', now()); await set(db, 'peer_misses', 0);
    notes.push('retire source: ' + JSON.stringify(await retire(env, f).catch(e => [{ ok: false, detail: String(e && e.message) }])));
    return { run: false, promoted: true, slot: 'primary', epoch, github_ok: true, peer, notes };
  }
  if (peer && peer.reachable && peer.slot === 'primary' && Number(peer.epoch) > me.epoch) {
    if (me.slot !== 'demoted') { await set(db, 'slot', 'demoted'); notes.push(`demoted: peer is primary at epoch ${peer.epoch} > ${me.epoch}`); }
    await set(db, 'peer_epoch', peer.epoch);  // remembered, so a later resume always lands above the epoch this tick last saw
    await set(db, 'peer_misses', 0);
    return { run: false, slot: 'demoted', epoch: me.epoch, github_ok: me.github_ok, peer, notes };
  }
  if (me.slot === 'demoted') {
    const misses = me.misses + 1; await set(db, 'peer_misses', misses);
    if (misses < RESUME_BEATS) return { run: false, slot: 'demoted', epoch: me.epoch, peer, notes: [`demoted: peer not primary or unreachable (${misses}/${RESUME_BEATS})`] };
    const epoch = Math.max(me.epoch, Number((await get(db, 'peer_epoch')) || 1), (peer && Number(peer.epoch)) || 1) + 1;
    await set(db, 'slot', 'primary'); await set(db, 'epoch', epoch); await set(db, 'peer_misses', 0);
    notes.push(`resumed as primary at epoch ${epoch}: peer absent for ${RESUME_BEATS} beats`);
  }
  // primary: mirror the target's readiness into one gate card while the peer is a standby without a credential
  const gh = await githubOk().catch(() => false);
  await set(db, 'github_ok', gh ? '1' : '0');
  if (peer && peer.reachable && peer.slot === 'standby') await ensureGate(db, !peer.github_ok, String(env.CUTOVER_PEER).replace(/\/$/, '')).catch(e => notes.push('gate: ' + e.message));
  else if (env.SELF_ORIGIN) await ensureGate(db, !gh, String(env.SELF_ORIGIN).replace(/\/$/, '')).catch(e => notes.push('gate: ' + e.message));  // a primary without its own GitHub credential
  else await ensureGate(db, false, '').catch(() => null);
  return { run: true, slot: 'primary', epoch: (await readState(db, env)).epoch, github_ok: gh, peer, notes };
}

export async function healthView(db, env) {
  const s = await readState(db, env).catch(() => ({ slot: env.SLOT || 'primary', epoch: Number(env.EPOCH || 1) }));
  return { slot: s.slot, epoch: s.epoch, github_ok: Boolean(s.github_ok), promoted_at: s.promoted_at || null, ready: s.slot === 'standby' ? Boolean(s.github_ok) : s.slot === 'primary' };
}
