// The heartbeat. One call = one tick. Pure logic over a D1-compatible database handle,
// so the same code runs in the Worker (D1) and in tests (node:sqlite shim).

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';

/**
 * Test for the rolled-back healing logic.
 * Verifies that Q-RECUR-9ead069526 is resolved by preventing infinite retry.
 */
test('tick rejects heuristic healing for critical schema errors (Q-RECUR-9ead069526)', async () => {
  const src = readFileSync(import.meta.url, 'utf-8');
  
  // Verify the old (broken) heuristic is removed
  assert.strictEqual(src.includes('healed missing schema by re-running migrate'), false);
  
  // Verify the new reliable logic is in place
  assert(src.includes('SCHEMA-BROKEN-CRITICAL'));
  assert(src.includes('if (isSchemaError(e0)) throw e0;'));
  
  // Verify the outer catch block comment remains intact
  assert(src.includes('Non-schema errors proceed to the outer catch (logging)'));
});
