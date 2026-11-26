// Composition root for the agentic surfaces. Routes come from seed/standards/surfaces.json, so a surface that is not
// registered there cannot be served and the lint cannot be bypassed by adding a route here.
import surfacesDoc from '../../../standards/surfaces.json' with { type: 'json' };
import standards from '../../../standards/standards.json' with { type: 'json' };
import { TOOLS } from './core/tools.js';
import { assertPort, STORE_METHODS, REGISTRIES_METHODS, AUTH_METHODS, TELEMETRY_METHODS } from './core/ports.js';
import { handleMcp } from './acl/mcp.js';
import { handleA2a } from './acl/a2a.js';
import * as D from './acl/discovery.js';

export const CONTRACT_VERSION = surfacesDoc.contract_version;
export const SURFACES = surfacesDoc.surfaces;
export const STANDARDS = standards;
export { TOOLS };

export const DEFAULT_IDENTITY = {
  slug: 'ultrastable-org', name: 'Ultrastable organisation', version: '1.0.0',
  tagline: 'Ultrastable is the foundation for any autonomous system.',
  stability_line: 'Ultra-stable: infrastructure that works so nobody notices.',
  description: 'An autonomous organisation run by virtual managers and staff on a heartbeat, with earned-trust autonomy.',
  instructions: 'Read dashboard and tick state first; record every result in the repositories.',
};

const json = (o, type = 'application/json') => new Response(JSON.stringify(o, null, 2), { headers: { 'content-type': type, 'cache-control': 'public, max-age=300' } });
const text = (s, type) => new Response(s, { headers: { 'content-type': type + '; charset=utf-8', 'cache-control': 'public, max-age=300' } });

export function createAgenticHandler({ store, registries, auth, telemetry, identity = DEFAULT_IDENTITY }) {
  const ports = {
    store: assertPort('store', store, STORE_METHODS),
    registries: assertPort('registries', registries, REGISTRIES_METHODS),
    auth: assertPort('auth', auth, AUTH_METHODS),
    telemetry: assertPort('telemetry', telemetry, TELEMETRY_METHODS),
    standards,
  };
  return async function handle(request, env) {
    const url = new URL(request.url);
    const surface = SURFACES.find(s => s.path === url.pathname && s.discoverable);
    if (!surface || surface.id === 'health') return null; // owner screens, health and analytics stay with the host Worker
    if (!surface.methods.includes(request.method)) return new Response('method not allowed', { status: 405, headers: { allow: surface.methods.join(', ') } });
    const ctx = { identity, origin: url.origin, surfaces: SURFACES, tools: TOOLS, env };
    switch (surface.id) {
      case 'mcp': return handleMcp(request, { tools: TOOLS, ports, env, identity, origin: url.origin });
      case 'a2a': return handleA2a(request, { tools: TOOLS, ports, env, identity, origin: url.origin });
      case 'llms-txt': return text(D.llmsTxt(ctx), 'text/plain');
      case 'agents-md': return text(D.agentsMd(ctx), 'text/markdown');
      case 'agent-card': return json(D.agentCard(ctx));
      case 'mcp-server-card': return json(D.mcpServerCard(ctx));
      case 'agent-skills-index': return json(await D.agentSkillsIndex(ctx));
      case 'agent-skill-operate': return text(D.skillMd(ctx), 'text/markdown');
      case 'api-catalog': return json(D.apiCatalog(ctx), 'application/linkset+json');
      case 'oauth-protected-resource': return json(D.protectedResource(ctx));
      case 'openapi': return json(D.openapi(ctx), 'application/vnd.oai.openapi+json');
      case 'standards': return json(standards);
      default: return null;
    }
  };
}
