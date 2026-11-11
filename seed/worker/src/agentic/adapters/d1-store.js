// StorePort over Cloudflare D1 (also runs over the node:sqlite shim in tests). Replace this file to move to another database.
export function d1Store(db) {
  const lastTick = () => db.prepare(
    `SELECT id, started_at, finished_at, steps_completed, steps_total, report, errors FROM tick_runs ORDER BY id DESC LIMIT 1`).first();
  return {
    lastTick,
    async dashboard() {
      const { results: by } = await db.prepare(`SELECT status, COUNT(*) AS n FROM items GROUP BY status`).all();
      const counts = Object.fromEntries(by.map(r => [r.status, r.n]));
      const gates = await db.prepare(`SELECT COUNT(*) AS n FROM gate_cards WHERE status='open'`).first();
      const { results: next } = await db.prepare(
        `SELECT id, title, owner_role FROM items WHERE status IN ('open','ready') ORDER BY priority, created_at LIMIT 5`).all();
      return { counts, open_gate_cards: gates ? gates.n : 0, next_items: next, last_tick: (await lastTick()) || null };
    },
  };
}
