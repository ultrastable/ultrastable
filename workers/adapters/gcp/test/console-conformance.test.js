// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// US-SPEC-18 T18-7: the console conformance suite (T18-1 to T18-6, core/test/console-conformance.js) run against the Cloud Run server over HTTP, the second
// platform adapter beside the in-process handler of core/test/console.test.js. The server is booted on an in-memory store with and without CONSOLE_TOKEN.
import test from 'node:test';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../sqlite/d1-sqlite.js';
import { createServer, loadConfig } from '../server.js';
import { runConsoleConformance, ORIGIN } from '../../../core/test/console-conformance.js';

const MIG = fileURLToPath(new URL('../../../core/migrations', import.meta.url));
const front = new URL(ORIGIN);

/** One HTTP request to the server as it arrives behind Cloud Run's front end: the public host and https in the forwarded headers. */
function call(port, path, { method = 'GET', headers = {}, body } = {}) {
  const form = body instanceof URLSearchParams;
  const data = body === undefined ? null : Buffer.from(form ? body.toString() : String(body));
  const hdrs = { host: front.host, 'x-forwarded-proto': front.protocol.replace(':', ''), ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}), ...headers, ...(data ? { 'content-length': String(data.length) } : {}) };
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: hdrs }, res => {
      const chunks = []; res.on('data', c => chunks.push(c)); res.on('error', reject);
      res.on('end', () => {
        const h = new Headers(); for (const [k, v] of Object.entries(res.headers)) for (const x of [].concat(v)) h.append(k, x);
        resolve(new Response([204, 304].includes(res.statusCode) ? null : Buffer.concat(chunks), { status: res.statusCode, headers: h }));
      });
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
}

const cloudRun = {
  name: 'Cloud Run',
  async boot({ token }) {
    const db = openDb(':memory:', MIG);
    const srv = createServer({ db, config: loadConfig({}), env: token ? { CONSOLE_TOKEN: token } : {} });
    // The composed organization's guards close a gate card that asks the owner for a secret unless the newest probe proved the capability missing on every route,
    // a permit names the card (core/access) and the ask carries its one link (core/ownerlink). The suite's secret card G2 stands for such a proven ask, so the probe
    // record, the permit and the link are written as those modules write them; the console's own handling of a secret card is what the suite then reads.
    db.raw.exec(`INSERT INTO ownerlink_actions (id, card_id, flow, title, link, created_at) VALUES ('OL-G2', 'G2', 'connect', 'Add the setting in Connect', '/console', datetime('now'));
      INSERT INTO access_state (capability, subject, status, probe_id, checked_at, expires_at, evidence) VALUES ('env', 'CLOUDFLARE_API_TOKEN', 'missing', 'p-conf', datetime('now'), datetime('now', '+1 day'), 'every route absent');
      INSERT INTO access_routes (capability, subject, route, outcome, detail, at, probe_id) VALUES ('env', 'CLOUDFLARE_API_TOKEN', 'env', 'absent', 'not set', datetime('now'), 'p-conf');
      INSERT INTO access_permits (card_id, capability, subject, at) VALUES ('G2', 'env', 'CLOUDFLARE_API_TOKEN', datetime('now'));`);
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const { port } = srv.address();
    return { call: (path, init) => call(port, path, init), sql: s => db.raw.exec(s), close: () => new Promise(r => srv.close(() => { db.close(); r(); })) };
  },
};

test('T18-7: the console conformance suite T18-1 to T18-6 passes against the Cloud Run server as it passes against the in-process handler', async t => {
  const subtests = [];
  runConsoleConformance((name, fn) => subtests.push(t.test(name, fn)), cloudRun);
  await Promise.all(subtests);
});
