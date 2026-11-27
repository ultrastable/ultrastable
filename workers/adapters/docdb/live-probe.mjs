// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The closing probe for the live act of US-14-R11 on a hosted document database: `FIRESTORE_PROJECT=<id> FIRESTORE_TOKEN=<short-lived token> node
// adapters/docdb/live-probe.mjs`. It creates one document in a probe collection, has twenty-five claimers race for it and prints one JSON line
// (winners must be 1), then removes what it wrote. It needs a project and a token, so it does nothing and exits 0 with a reason when either is
// absent: the driver itself is proved against a fake server in firestore.test.js. The token is read from the environment, never printed.
import { firestoreDocStore } from './firestore.js';
import { claim } from './index.js';

const project = process.env.FIRESTORE_PROJECT; const token = process.env.FIRESTORE_TOKEN;
if (!project || !token) { process.stdout.write(JSON.stringify({ ran: false, reason: 'FIRESTORE_PROJECT and FIRESTORE_TOKEN are not set' }) + '\n'); process.exit(0); }
const store = firestoreDocStore({ project, token });
const id = `probe-${Date.now()}`;
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
try {
  await store.set('items', id, { title: 'live probe', status: 'ready', owner_role: 'probe', priority: 0, created_at: now, updated_at: now });
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => claim(store, id, `probe-${i}`, now)));
  const winners = results.filter(r => r.ok).length;
  process.stdout.write(JSON.stringify({ ran: true, winners, ok: winners === 1 }) + '\n');
  process.exitCode = winners === 1 ? 0 : 1;
} finally { await store.remove('claims', id); await store.remove('items', id); }
