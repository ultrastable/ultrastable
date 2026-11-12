import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDb } from './d1shim.js';
import { d1Store } from '../src/agentic/adapters/d1-store.js';
import { memoryStore, staticRegistries } from '../src/agentic/adapters/memory.js';
import { assertPort, STORE_METHODS } from '../src/agentic/core/ports.js';

// The contract every StorePort adapter must satisfy. A new adapter (another database, another platform) passes this or it does not ship.
async function storeContract(store) {
  assertPort('store', store, STORE_METHODS);
  const d = await store.dashboard();
  assert.equal(typeof d.counts, 'object');
  assert.equal(typeof d.open_gate_cards, 'number');
  assert.ok(Array.isArray(d.next_items));
  assert.ok('last_tick' in d);
  assert.equal(d.counts.ready, 1);
  assert.equal(d.next_items[0].id, 'A');
  assert.equal(d.open_gate_cards, 1);
}

test('ports: store contract d1 and memory', async () => {
  const db = makeDb();
  db.raw.exec(`INSERT INTO items (id,title,owner_role,done_check,status,priority) VALUES ('A','t','pm','c','ready',1)`);
  db.raw.exec(`INSERT INTO gate_cards (id,what,why_gated,default_in_effect,closing_probe) VALUES ('G','w','y','d','manual')`);
  await storeContract(d1Store(db));
  await storeContract(memoryStore({ items: [{ id: 'A', title: 't', owner_role: 'pm', status: 'ready', priority: 1 }], gates: 1 }));
});

test('ports: registries missing source', async () => {
  const r = staticRegistries();
  assert.deepEqual(await r.glossary('x'), { source: 'missing', entries: [] });
  assert.equal((await staticRegistries({ loops: [{ id: 'a' }] }).loops('a')).entries.length, 1);
});

test('ports: adapter missing method rejected', () => {
  assert.throws(() => assertPort('store', { lastTick() {} }, STORE_METHODS), /missing dashboard/);
});
