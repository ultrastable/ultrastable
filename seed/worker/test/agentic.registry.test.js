const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildDiscovery } = require('../src/agentic/acl/discovery.js');

test('registry: server.json publication', () => {
  const serverJsonPath = path.join(__dirname, '../../standards/server.json');
  assert.ok(fs.existsSync(serverJsonPath), 'seed/standards/server.json must exist');
  const serverJson = JSON.parse(fs.readFileSync(serverJsonPath, 'utf8'));
  assert.strictEqual(serverJson.schemaVersion, '0.2.0');
  assert.ok(serverJson.name && serverJson.name.length > 0, 'server.json must carry a verified namespace name');
  assert.strictEqual(serverJson.description && typeof serverJson.description, 'string');

  const discovery = buildDiscovery();
  const card = discovery.serverCard || discovery['/.well-known/mcp/server-card.json'];
  assert.ok(card, 'discovery must expose the MCP server card');
  assert.strictEqual(card.registry, 'published');
});
