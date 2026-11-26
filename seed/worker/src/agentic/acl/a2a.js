// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// Anti-corruption layer for the A2A 1.0 JSON-RPC binding (https://a2a-protocol.org/latest/specification/, read 2026-11-26).
// Everything A2A-specific (method names, version header, error codes, Message and Part shapes) is here; the core never sees it.
// The interface is honest about what a system does today: every skill on the agent card is one of the read-only tools the MCP
// server also serves, and a SendMessage answers at once with a Message (section 9.4.1 allows a message or a task as the result).
// No task is created, so GetTask and CancelTask answer TaskNotFoundError and streaming answers UnsupportedOperationError.
import { validateArgs } from '../core/tools.js';

export const A2A_VERSIONS = ['1.0']; // Major.Minor, section 3.6
// Section 5.4, JSON-RPC column.
export const A2A_ERRORS = { TaskNotFoundError: -32001, TaskNotCancelableError: -32002, PushNotificationNotSupportedError: -32003, UnsupportedOperationError: -32004,
  ContentTypeNotSupportedError: -32005, InvalidAgentResponseError: -32006, ExtendedAgentCardNotConfiguredError: -32007, ExtensionSupportRequiredError: -32008, VersionNotSupportedError: -32009 };
const E = { parse: -32700, request: -32600, method: -32601, params: -32602 };

const rpc = (id, body, status = 200, headers = {}) =>
  new Response(JSON.stringify({ jsonrpc: '2.0', id: id ?? null, ...body }), { status, headers: { 'content-type': 'application/json', ...headers } });
const fail = (id, code, message, status = 200, data) => rpc(id, { error: { code, message, ...(data ? { data } : {}) } }, status);
const named = (id, name, message, data) => fail(id, A2A_ERRORS[name], `${name}: ${message}`, 200, data);

/** The skill a message asks for: a data part {skill, arguments}, metadata.skill, or a text part that is exactly a skill id. */
export function requested(message, metadata, tools) {
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  const d = parts.map(p => p?.data).find(x => x && typeof x === 'object' && typeof x.skill === 'string');
  if (d) return { skill: d.skill, args: d.arguments ?? {} };
  const m = (message?.metadata && message.metadata.skill) || (metadata && metadata.skill);
  if (typeof m === 'string') return { skill: m, args: (message?.metadata?.arguments) ?? metadata?.arguments ?? {} };
  const text = parts.map(p => p?.text).filter(x => typeof x === 'string').join(' ').trim();
  return tools.some(t => t.name === text) ? { skill: text, args: {} } : { skill: null, text };
}

export async function handleA2a(request, { tools, ports, env, origin }) {
  if (request.method !== 'POST') return new Response('POST only', { status: 405, headers: { allow: 'POST' } });
  let msg;
  try { msg = await request.json(); } catch { return fail(null, E.parse, 'parse error', 400); }
  if (!msg || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, E.request, 'invalid request', 400);
  // Section 3.6: the client sends A2A-Version (header or request parameter); an empty value is read as 0.3, which this interface does not serve.
  const asked = (request.headers.get('a2a-version') || new URL(request.url).searchParams.get('A2A-Version') || '0.3').trim();
  if (!A2A_VERSIONS.includes(asked)) return named(msg.id, 'VersionNotSupportedError', `A2A-Version ${asked} is not served here`, { supported: A2A_VERSIONS, requested: asked });

  switch (msg.method) {
    case 'SendMessage': {
      // Section 7 leaves authentication to HTTP: the scheme is the bearer the agent card declares.
      const auth = await ports.auth.verify(request, env);
      if (!auth.ok) return rpc(msg.id, { error: { code: E.request, message: 'unauthorized' } }, 401, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` });
      const m = msg.params?.message;
      if (!m || typeof m.messageId !== 'string' || !m.messageId || !Array.isArray(m.parts) || !m.parts.length)
        return fail(msg.id, E.params, 'params.message needs a messageId and at least one part');
      const reply = parts => rpc(msg.id, { result: { message: { messageId: crypto.randomUUID(), contextId: m.contextId || crypto.randomUUID(), role: 'ROLE_AGENT', parts } } });
      const want = requested(m, msg.params?.metadata, tools);
      if (!want.skill) // not a skill request: say what can be asked, as data another agent can read
        return reply([{ text: 'Name one skill: a data part {"skill": "<id>", "arguments": {...}}.' }, { data: { skills: tools.map(t => ({ id: t.name, description: t.description, inputSchema: t.inputSchema })) } }]);
      const tool = tools.find(t => t.name === want.skill);
      if (!tool) return fail(msg.id, E.params, `unknown skill ${want.skill}`);
      const bad = validateArgs(tool.inputSchema, want.args);
      if (bad) return fail(msg.id, E.params, bad);
      const attrs = { 'gen_ai.operation.name': 'execute_tool', 'gen_ai.tool.name': tool.name, 'gen_ai.tool.call.id': crypto.randomUUID(), 'gen_ai.tool.type': 'function' };
      try {
        const data = await tool.run(ports, want.args);
        ports.telemetry.span(`execute_tool ${tool.name}`, attrs);
        return reply([{ data: data ?? {} }]);
      } catch (e) {
        ports.telemetry.span(`execute_tool ${tool.name}`, { ...attrs, 'error.type': e?.name || 'Error' });
        return named(msg.id, 'InvalidAgentResponseError', 'skill failed: ' + (e?.name || 'Error'));
      }
    }
    case 'GetTask': case 'CancelTask':
      return named(msg.id, 'TaskNotFoundError', `no task ${String(msg.params?.id ?? '')}: this interface answers every message at once and creates no task`);
    case 'SendStreamingMessage': case 'SubscribeToTask': case 'ListTasks':
      return named(msg.id, 'UnsupportedOperationError', `${msg.method} is not served: capabilities.streaming is false and no task is created`);
    case 'GetExtendedAgentCard':
      return named(msg.id, 'ExtendedAgentCardNotConfiguredError', 'the public agent card is the whole card');
    default:
      if (/PushNotification/.test(msg.method)) return named(msg.id, 'PushNotificationNotSupportedError', 'capabilities.pushNotifications is false');
      return fail(msg.id, E.method, `method not found: ${msg.method}`);
  }
}
