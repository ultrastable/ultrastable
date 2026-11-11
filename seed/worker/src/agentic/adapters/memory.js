// In-memory adapters: the second implementation that proves the ports are swappable, and the fixture for tests and local runs.
export function memoryStore({ tick = null, items = [], gates = 0 } = {}) {
  return {
    async lastTick() { return tick; },
    async dashboard() {
      const counts = {};
      for (const i of items) counts[i.status] = (counts[i.status] || 0) + 1;
      const next = items.filter(i => i.status === 'open' || i.status === 'ready')
        .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50)).slice(0, 5).map(({ id, title, owner_role }) => ({ id, title, owner_role }));
      return { counts, open_gate_cards: gates, next_items: next, last_tick: tick };
    },
  };
}

// Registries are owned by the glossary and loop-registry work (doctrine/glossary.json, doctrine/loops.json).
// This adapter only serves whatever data it is given and reports `source: "missing"` when there is none, so nothing is duplicated here.
export function staticRegistries({ glossary = null, loops = null } = {}) {
  const pick = (data, key, q) => {
    if (!Array.isArray(data)) return { source: 'missing', entries: [] };
    const entries = q ? data.filter(e => String(e[key]).toLowerCase() === String(q).toLowerCase()) : data;
    return { source: 'static', entries };
  };
  return { glossary: async term => pick(glossary, 'term', term), loops: async id => pick(loops, 'id', id) };
}
