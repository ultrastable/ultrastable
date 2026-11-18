// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
const test = require('node:test');
const assert = require('node:assert');
const { wrapWithMcpAgent, aiGatewayFetch } = require('../src/agentic/adapters/cloudflare-agents.js');

test('cloudflare: McpAgent adapter wraps the fetch handler', async () => {
  const handler = wrapWithMcpAgent(async () => new Response('ok'));
  const res = await handler(new Request('https://example.org/mcp'));
  assert.ok(res instanceof Response);
  assert.ok(res.headers.get('mcp-session') !== undefined || res.status === 200);
});

test('cloudflare: AI Gateway base url routes model calls', () => {
  const url = aiGatewayFetch({ account: 'acct', gateway: 'ultrastable' });
  assert.ok(url.startsWith('https://gateway.ai.cloudflare.com/v1/acct/ultrastable/'));
});
