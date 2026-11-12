import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS, CONTRACT_VERSION } from '../src/agentic/handler.js';
import { toolList } from '../src/agentic/acl/mcp.js';

const snap = JSON.parse(readFileSync(new URL('../contract/mcp-tools.v1.json', import.meta.url), 'utf8'));

// Versioned interface contract. Within a major version tools may be added (record them in the snapshot) but never
// removed or have their input schema changed; that needs mcp-tools.v2.json and a major bump of contract_version in surfaces.json.
test('contract: tools match v1 snapshot', () => {
  assert.equal(snap.contract_version.split('.')[0], CONTRACT_VERSION.split('.')[0]);
  const live = Object.fromEntries(toolList(TOOLS).map(t => [t.name, t]));
  for (const t of snap.tools) {
    assert.ok(live[t.name], `tool removed: ${t.name}`);
    assert.deepEqual(live[t.name].inputSchema, t.inputSchema, `input schema changed: ${t.name}`);
  }
  assert.deepEqual(Object.keys(live).sort(), snap.tools.map(t => t.name).sort(), 'new tool not recorded in the snapshot');
});

test('contract: tool schemas are JSON Schema 2020-12 objects', () => {
  for (const t of TOOLS) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(t.inputSchema.additionalProperties, false, t.name + ' must reject unknown arguments');
    assert.match(t.name, /^[a-z][a-z0-9_]{2,63}$/);
    assert.ok(t.description.length > 20);
  }
});
