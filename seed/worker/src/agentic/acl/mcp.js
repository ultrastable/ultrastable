// Anti-corruption layer for MCP. Everything protocol-specific (JSON-RPC framing, version negotiation, error codes,
// auth challenge, Origin check) is here; the core never sees it. When the spec moves, only this file changes
// and the contract test (contract/mcp-tools.v1.json) proves the tools did not.
import { validateArgs } from '../core/tools.js';

export const MCP_VERSIONS = ['2026-07-28', '2025-11-25', '2025-06-18']; // newest first
const E = { parse: -32700, request: -32600, method: -32601, params: -32602, internal: -32603 };

const rpc = (id, body, status = 200, headers = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, ...body }), { status, headers: { 'content-type': 'application/json', ...headers } });
const fail = (id, code, message, status = 200) => rpc(id, { error: { code, message } }, status);

export function toolList(tools) {
  return tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, annotations: { readOnlyHint: true, idempotentHint: true } }));
}

export async function handleMcp(request, { tools, ports, env, identity, origin }) {
  if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: { allow: 'POST' } });
  const o = request.headers.get('origin');
  if (o && new URL(o).host !== new URL(request.url).host && !(env?.MCP_ALLOWED_ORIGINS || '').split(',').includes(o))
    return new Response('forbidden origin', { status: 403 });
  const pv = request.headers.get('mcp-protocol-version');
  if (pv && !MCP_VERSIONS.includes(pv)) return fail(null, E.request, `unsupported protocol version ${pv}; supported: ${MCP_VERSIONS.join(', ')}`, 400);

  let msg;
  try { msg = await request.json(); } catch { return fail(null, E.parse, 'parse error', 400); }
  if (!msg || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, E.request, 'invalid request', 400);
  if (msg.id === undefined) return new Response(null, { status: 202 }); // notification

  const serverInfo = { name: identity.slug, title: identity.name, version: identity.version };
  const capabilities = { tools: { listChanged: false } };
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return rpc(msg.id, { result: { protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0], capabilities, serverInfo, instructions: identity.instructions } });
    }
    case 'server/discover': // 2026-07-28 stateless discovery; harmless on older clients
      return rpc(msg.id, { result: { supportedVersions: MCP_VERSIONS, capabilities, serverInfo } });
    case 'ping': return rpc(msg.id, { result: {} });
    case 'tools/list': return rpc(msg.id, { result: { tools: toolList(tools) } });
    case 'tools/call': {
      const auth = await ports.auth.verify(request, env);
      if (!auth.ok) {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32001, message: 'unauthorized' } }), {
          status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` } });
      }
      const tool = tools.find(t => t.name === msg.params?.name);
      if (!tool) return fail(msg.id, E.params, `unknown tool ${msg.params?.name}`);
      const bad = validateArgs(tool.inputSchema, msg.params?.arguments);
      if (bad) return fail(msg.id, E.params, bad);
      const callId = crypto.randomUUID();
      const attrs = { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': tool.name, 'gen_ai.tool.call.id': callId, 'gen_ai.tool.type': 'function' };
      try {
        const data = await tool.run(ports, msg.params?.arguments ?? {});
        ports.telemetry.span(`execute_tool ${tool.name}`, attrs);
        return rpc(msg.id, { result: { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data ?? {}, isError: false } });
      } catch (e) {
        ports.telemetry.span(`execute_tool ${tool.name}`, { ...attrs, 'error.type': e?.name || 'Error' });
        return rpc(msg.id, { result: { content: [{ type: 'text', text: 'tool failed: ' + (e?.name || 'Error') }], isError: true } });
      }
    }
    default: return fail(msg.id, E.method, `method not found: ${msg.method}`);
  }
}
