// Transport-neutral tool definitions. No MCP, HTTP or D1 appears here: a tool is a name, a JSON Schema
// (2020-12) for its input, and a function over ports. acl/mcp.js and acl/a2a.js translate these to protocols.
const none = { type: 'object', properties: {}, additionalProperties: false };

export const TOOLS = [
  {
    name: 'ultrastable_tick_status',
    description: 'Result of the most recent tick: steps completed, the four-line report, and any errors.',
    inputSchema: none,
    scope: 'read',
    run: ({ store }) => store.lastTick(),
  },
  {
    name: 'ultrastable_loop_registry',
    description: 'The registry of feedback loops this organisation runs. Pass loop_id for one loop.',
    inputSchema: { type: 'object', properties: { loop_id: { type: 'string', maxLength: 120 } }, additionalProperties: false },
    scope: 'read',
    run: ({ registries }, a) => registries.loops(a.loop_id),
  },
  {
    name: 'ultrastable_glossary_lookup',
    description: 'Definition of a term in the Ultrastable glossary. Omit term to list all terms.',
    inputSchema: { type: 'object', properties: { term: { type: 'string', maxLength: 120 } }, additionalProperties: false },
    scope: 'read',
    run: ({ registries }, a) => registries.glossary(a.term),
  },
  {
    name: 'ultrastable_dashboard_state',
    description: 'Dashboard state: item counts by status, open gate cards, next items, last tick.',
    inputSchema: none,
    scope: 'read',
    run: ({ store }) => store.dashboard(),
  },
  {
    name: 'ultrastable_standards_register',
    description: 'The standards register: each standard, its status, how this Worker supports it and the test that proves it. Filter by id or support level.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', maxLength: 80 }, support: { enum: ['supported', 'partial', 'planned', 'not_applicable'] } },
      additionalProperties: false,
    },
    scope: 'read',
    run: ({ standards }, a) => ({
      version: standards.version, checked: standards.checked,
      entries: standards.entries
        .filter(e => (!a.id || e.id === a.id) && (!a.support || e.support === a.support))
        .map(({ id, name, body, status, support, tracked, how, tests, gap }) => ({ id, name, body, status, support, tracked, how, tests, gap })),
    }),
  },
];

// Minimal JSON Schema check for the subset the tools use (object, string, enum, additionalProperties:false, maxLength).
export function validateArgs(schema, args) {
  const a = args ?? {};
  if (typeof a !== 'object' || Array.isArray(a)) return 'arguments must be an object';
  for (const k of schema.required || []) if (!(k in a)) return `missing ${k}`;
  for (const [k, v] of Object.entries(a)) {
    const p = schema.properties?.[k];
    if (!p) { if (schema.additionalProperties === false) return `unknown argument ${k}`; continue; }
    if (p.enum && !p.enum.includes(v)) return `${k} must be one of ${p.enum.join(', ')}`;
    if (p.type === 'string' && (typeof v !== 'string' || (p.maxLength && v.length > p.maxLength))) return `${k} must be a string up to ${p.maxLength || '∞'} chars`;
  }
  return null;
}
