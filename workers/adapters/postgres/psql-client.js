// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// A Postgres client for tests with no Node driver (US-14-R11, T01): it runs the `psql` command line program, one process per query, and
// has the shape createPgStore takes: query(text, params) -> { rows, rowCount }. Reads come back as JSON (so numbers stay numbers); a
// statement that is not a read returns its command tag as rowCount, and rows from RETURNING id. Parameters are written into the text as
// quoted literals, so this client is for test data and never for untrusted input. Nothing here is imported by the core or by a host.
// startThrowawayCluster() starts a private cluster from the server binaries on this machine (as the postgres user when run as root),
// on a unix socket in a fresh directory, and removes it again; it returns null when there are no server binaries.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** Replace $1, $2 ... outside quoted text with literals. */
export function inlineParams(text, params = []) {
  const lit = v => (v === null || v === undefined ? 'NULL' : typeof v === 'boolean' ? (v ? '1' : '0') : typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'NULL') : `'${String(v).replace(/'/g, "''")}'`);
  let out = ''; let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length) { if (text[j] === c) { if (text[j + 1] === c) j += 2; else break; } else j++; }
      out += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === '$' && /\d/.test(text[i + 1] || '')) {
      let j = i + 1; while (/\d/.test(text[j] || '')) j++;
      const n = Number(text.slice(i + 1, j));
      if (n < 1 || n > params.length) throw new Error(`parameter $${n} was not supplied`);
      out += lit(params[n - 1]); i = j; continue;
    }
    out += c; i++;
  }
  return out;
}

const isRead = t => /^\s*(SELECT|WITH|VALUES)\b/i.test(t) && !/\bRETURNING\b/i.test(t);
const DROPPED = /terminating connection|server closed the connection|connection to server .* failed|could not connect|Connection (refused|reset)/i;

/** options: { url } for a connection string, or { host, user, database } for a socket directory; psql: the program; env: extra environment (PGOPTIONS to set a search path). */
export function psqlClient({ url = null, host = null, user = 'postgres', database = 'postgres', psql = 'psql', env = {} } = {}) {
  const target = url ? [url] : ['-h', host, '-U', user, '-d', database];
  const run = (args, input) => new Promise((resolve, reject) => {
    const child = spawn(psql, ['-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', ...target, ...args], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let out = ''; let err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => reject(e));
    child.on('close', code => {
      if (code === 0) return resolve(out);
      const e = new Error(String(err).trim().split('\n')[0] || `psql exited ${code}`);
      if (DROPPED.test(err)) { const admin = /administrator command/.test(err); e.name = admin ? 'AdminShutdown' : 'OperationalError'; e.code = admin ? '57P01' : '08006'; } else e.code = 'PSQL';
      e.detail = String(err).slice(0, 400);
      reject(e);
    });
    child.stdin.end(input == null ? undefined : input);
  });
  return {
    async query(text, params = []) {
      const sql = inlineParams(String(text).trim().replace(/;\s*$/, ''), params);
      if (isRead(sql)) {
        const out = (await run(['-c', `SELECT coalesce(json_agg(row_to_json(q)), '[]'::json) FROM (${sql}) q`])).trim();
        const rows = JSON.parse(out || '[]');
        return { rows, rowCount: rows.length };
      }
      const lines = (await run(['-c', sql])).trim().split('\n').filter(Boolean);
      const tag = lines.pop() || '';
      const m = /^(?:INSERT \d+|UPDATE|DELETE|MERGE|SELECT|COPY|FETCH|MOVE) (\d+)$/.exec(tag);
      const rows = /\bRETURNING\s+id\s*$/i.test(sql) && m ? lines.map(l => ({ id: Number(l) })) : [];
      return { rows, rowCount: m ? Number(m[1]) : 0 };
    },
    /** Run a multi-statement script in one process (a migration). */
    async script(sqlText) { await run([], sqlText); },
  };
}

const serverBins = () => {
  const root = '/usr/lib/postgresql';
  if (!existsSync(root)) return null;
  const dirs = readdirSync(root).sort((a, b) => Number(b) - Number(a)).map(v => path.join(root, v, 'bin'));
  return dirs.find(b => existsSync(path.join(b, 'initdb')) && existsSync(path.join(b, 'pg_ctl'))) || null;
};

/** Start a private cluster. Returns { host, user, database, stop() } or null when no server binaries exist. Throws when they exist but cannot start. */
export function startThrowawayCluster() {
  const bin = serverBins();
  if (!bin) return null;
  const root = process.getuid?.() === 0;
  const dir = mkdtempSync(path.join(tmpdir(), 'uspg-'));
  const as = (cmd, args) => (root ? spawnSync('runuser', ['-u', 'postgres', '--', cmd, ...args], { encoding: 'utf8' }) : spawnSync(cmd, args, { encoding: 'utf8' }));
  const fail = (what, r) => { rmSync(dir, { recursive: true, force: true }); throw new Error(`${what} failed: ${String(r.stderr || r.stdout || r.error).trim().split('\n').slice(-2).join(' ')}`); };
  if (root) spawnSync('chown', ['postgres:postgres', dir]);
  spawnSync('chmod', ['755', dir]);
  const init = as(path.join(bin, 'initdb'), ['-D', path.join(dir, 'data'), '-A', 'trust', '-U', 'postgres']);
  if (init.status !== 0) fail('initdb', init);
  const start = as(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-o', `-k ${dir} -c listen_addresses='' -c fsync=off -c max_connections=60`, '-l', path.join(dir, 'log'), '-w', 'start']);
  if (start.status !== 0) fail('pg_ctl start', start);
  return {
    host: dir, user: 'postgres', database: 'postgres',
    stop() { as(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'immediate', '-w', 'stop']); rmSync(dir, { recursive: true, force: true }); },
  };
}
