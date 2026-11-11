// Ports: the only things the core knows about the outside world. Protocols (acl/), platforms and
// storage (adapters/) plug in here, so a new protocol, language or platform replaces an adapter,
// never the core. The ports have a contract test (test/agentic.ports.test.js) every adapter must pass.
//
//   StorePort        lastTick() -> row|null ; dashboard() -> {counts, next_items, open_gate_cards, last_tick}
//   RegistriesPort   glossary(term?) -> {source, entries} ; loops(id?) -> {source, entries}
//   AuthPort         verify(request, env) -> {ok, subject?, scopes?}
//   TelemetryPort    span(name, attributes) -> void   (attribute names follow OpenTelemetry GenAI conventions)
export const STORE_METHODS = ['lastTick', 'dashboard'];
export const REGISTRIES_METHODS = ['glossary', 'loops'];
export const AUTH_METHODS = ['verify'];
export const TELEMETRY_METHODS = ['span'];

export function assertPort(name, impl, methods) {
  const missing = methods.filter(m => typeof impl?.[m] !== 'function');
  if (missing.length) throw new Error(`${name} port: adapter is missing ${missing.join(', ')}`);
  return impl;
}
