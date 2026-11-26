// Anti-corruption layer for the discovery documents (llms.txt, AGENTS.md, A2A agent card, MCP server card,
// Agent Skills index, RFC 9727 api-catalog, RFC 9728 protected-resource metadata, OpenAPI 3.1).
// Each builder maps the transport-neutral surfaces, tools and identity onto one external format.
import { toolList, MCP_VERSIONS } from './mcp.js';

export const A2A_VERSION = '1.0';
export const AGENT_SKILLS_SCHEMA = 'https://schemas.agentskills.io/discovery/0.2.0/schema.json';
export const OPENAPI_VERSION = '3.1.0';
export const SKILL_NAME = 'ultrastable-operate';

const pub = s => s.filter(x => x.discoverable);

export function llmsTxt({ identity, origin, surfaces }) {
  const lines = [`# ${identity.name}`, '', `> ${identity.tagline} ${identity.stability_line}`, '',
    identity.description, '', '## Agent interfaces', ''];
  for (const s of pub(surfaces)) lines.push(`- [${s.path}](${origin}${s.path}): ${s.description}`);
  lines.push('', '## Optional', '', `- Owner screens (/, /next, /needs-you, /start) are for people; agents use /mcp.`);
  return lines.join('\n') + '\n';
}

export function agentsMd({ identity, origin }) {
  return `# AGENTS.md for ${identity.name}

${identity.tagline}
${identity.stability_line}

## How an agent works with this organisation
- Connect to the MCP server at ${origin}/mcp (Streamable HTTP, bearer token from the owner's secret store). Call \`tools/list\` first.
- Read state before acting: \`ultrastable_dashboard_state\`, \`ultrastable_tick_status\`, \`ultrastable_loop_registry\`, \`ultrastable_glossary_lookup\`.
- Work is claimed, verified and reported through the repositories and the work tracker, never only in chat. If it is not in code, it does not exist.
- Never handle secret values; reference bindings by name.
- Agents that speak A2A 1.0 send \`SendMessage\` to ${origin}/a2a (header \`A2A-Version: 1.0\`); each skill on the agent card is one read-only tool.
- Discovery: ${origin}/llms.txt, ${origin}/.well-known/agent-card.json, ${origin}/.well-known/mcp/server-card.json, ${origin}/openapi.json.
- Standards this service is held to: ${origin}/standards.json.
`;
}

// A2A 1.0 AgentCard (specification section 4.4.1, read 2026-11-26). Required: name, description, supportedInterfaces, version, capabilities,
// defaultInputModes, defaultOutputModes, skills. The first interface is the preferred one (section 8.3.1): the A2A JSON-RPC binding at /a2a,
// served by acl/a2a.js; the MCP server is listed second as a custom binding. Security is the 1.0 shape: a named scheme wrapping
// httpAuthSecurityScheme, and securityRequirements naming it (the 0.3 `security` list and top-level `url`/`protocolVersion` are gone).
export const A2A_CARD_REQUIRED = ['name', 'description', 'supportedInterfaces', 'version', 'capabilities', 'defaultInputModes', 'defaultOutputModes', 'skills'];
export function agentCard({ identity, origin, tools }) {
  return {
    name: identity.name,
    description: identity.description,
    supportedInterfaces: [
      { url: `${origin}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: A2A_VERSION },
      { url: `${origin}/mcp`, protocolBinding: 'MCP', protocolVersion: MCP_VERSIONS[0] },
    ],
    version: identity.version,
    documentationUrl: `${origin}/openapi.json`,
    capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false },
    securitySchemes: { bearer: { httpAuthSecurityScheme: { scheme: 'Bearer' } } },
    securityRequirements: [{ schemes: { bearer: { list: [] } } }],
    defaultInputModes: ['application/json', 'text/plain'],
    defaultOutputModes: ['application/json'],
    skills: tools.map(t => ({ id: t.name, name: t.name, description: t.description, tags: ['ultrastable', 'read-only'] })),
  };
}

export function mcpServerCard({ identity, origin, tools }) {
  return {
    serverInfo: { name: identity.slug, title: identity.name, version: identity.version },
    description: identity.description,
    transport: { type: 'streamable-http', endpoint: `${origin}/mcp` },
    protocolVersions: MCP_VERSIONS,
    authentication: { required: true, schemes: ['bearer'], resource_metadata: `${origin}/.well-known/oauth-protected-resource` },
    capabilities: { tools: { listChanged: false } },
    tools: toolList(tools).map(({ name, description }) => ({ name, description })),
  };
}

// Agent Skills specification (https://agentskills.io/specification, read 2026-11-26). `name`: 1-64 characters, lowercase letters, digits and
// hyphens, no leading, trailing or consecutive hyphen, equal to the parent directory name. `description`: 1-1024 characters, what the skill does
// and when to use it. The frontmatter is YAML, so a description is one plain scalar: it may not hold ": " or " #", or start with a YAML indicator.
export function skillProblems(md, dir) {
  const bad = [], m = /^---\n([\s\S]*?)\n---\n/.exec(md);
  if (!m) return ['SKILL.md does not start with a YAML frontmatter block'];
  const f = {};
  for (const line of m[1].split('\n')) {
    const k = /^([A-Za-z][A-Za-z0-9-]*):(?: (.*))?$/.exec(line);
    if (!k) { bad.push(`frontmatter line is not "key: value": ${line.slice(0, 40)}`); continue; }
    f[k[1]] = (k[2] ?? '').trim();
  }
  const name = f.name ?? '', desc = f.description ?? '';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) || name.length > 64) bad.push(`name "${name}" is not 1-64 lowercase letters, digits and single hyphens`);
  if (dir !== undefined && name !== dir) bad.push(`name "${name}" does not match its directory "${dir}"`);
  if (!desc || desc.length > 1024) bad.push(`description is ${desc.length} characters; the specification allows 1-1024`);
  if (/: | #/.test(desc) || /^[-?:,\[\]{}#&*!|>'"%@`]/.test(desc)) bad.push('description is not a plain YAML scalar (it holds ": " or " #", or starts with an indicator)');
  if (f.compatibility !== undefined && (!f.compatibility || f.compatibility.length > 500)) bad.push('compatibility must be 1-500 characters');
  for (const k of Object.keys(f)) if (!['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools'].includes(k)) bad.push(`unknown frontmatter field ${k}`);
  if (!md.slice(m[0].length).trim()) bad.push('SKILL.md has no instructions after the frontmatter');
  return bad;
}

const plain = s => String(s).replace(/:\s/g, ', ').replace(/\s#/g, ' ').replace(/\s+/g, ' ').trim();

export function skillMd({ identity, origin }) {
  return `---
name: ${SKILL_NAME}
description: ${plain(`Operate ${identity.name} through its MCP tools, which read dashboard and tick state, look up loops and glossary terms, and check the standards register. Use when asked about this organisation's state or how to work with it.`).slice(0, 1024)}
compatibility: Needs network access to ${origin} and an MCP or A2A client.
---

# Operate ${identity.name}

1. Connect an MCP client to ${origin}/mcp with the owner's bearer token.
2. Call \`ultrastable_dashboard_state\` for counts, gate cards and next items.
3. Call \`ultrastable_tick_status\` to confirm the last tick completed every step.
4. Use \`ultrastable_loop_registry\` and \`ultrastable_glossary_lookup\` for vocabulary before writing anything.
5. Record every result in the repositories, not in chat.

An agent that speaks A2A instead sends \`SendMessage\` to ${origin}/a2a with the header \`A2A-Version: 1.0\` and a data part \`{"skill": "<tool name>", "arguments": {}}\`; the skills are listed in ${origin}/.well-known/agent-card.json.
`;
}

export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'sha256:' + [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function agentSkillsIndex({ identity, origin }) {
  const body = skillMd({ identity, origin });
  return {
    $schema: AGENT_SKILLS_SCHEMA,
    skills: [{ name: SKILL_NAME, type: 'skill-md', description: `Operate ${identity.name} through its MCP tools.`, url: `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`, digest: await sha256(body) }],
  };
}

export function apiCatalog({ origin }) {
  return {
    linkset: [
      { anchor: `${origin}/mcp`, 'service-desc': [{ href: `${origin}/.well-known/mcp/server-card.json`, type: 'application/json' }] },
      { anchor: `${origin}/health`, 'service-desc': [{ href: `${origin}/openapi.json`, type: 'application/vnd.oai.openapi+json' }] },
    ],
  };
}

export function protectedResource({ origin, env }) {
  const issuer = env && env.OAUTH_ISSUER;
  return {
    resource: `${origin}/mcp`,
    ...(issuer ? { authorization_servers: [issuer] } : {}),
    bearer_methods_supported: ['header'],
    scopes_supported: ['read'],
    resource_name: 'Ultrastable MCP server',
  };
}

export function openapi({ identity, origin, surfaces }) {
  const paths = {};
  for (const s of surfaces.filter(x => x.discoverable && ['rest', 'mcp', 'discovery'].includes(x.kind))) {
    paths[s.path] = {};
    for (const m of s.methods) paths[s.path][m.toLowerCase()] = {
      operationId: s.id.replace(/-/g, '_'), summary: s.description,
      responses: { 200: { description: 'OK' }, ...(s.kind === 'mcp' ? { 401: { description: 'Bearer token required for tools/call' } } : {}), ...(s.id === 'health' ? { 503: { description: 'Last tick incomplete' } } : {}) },
    };
  }
  return { openapi: OPENAPI_VERSION, info: { title: identity.name, version: identity.version, description: identity.description }, servers: [{ url: origin }], paths,
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } } };
}
