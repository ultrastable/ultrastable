// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// MANAGERS-1: every manager is a running loop, in every system. The register (autonomy/managers.json, carried into config.managers) says which
// managers this system runs. hireStep runs inside the tick's reconcile step (a cost-essential step, so it runs on a lean tick too): a manager
// that is on and has no row in `roles` is hired, so a manager added to the register after a system booted starts ticking on the next pass with
// no migration and no person. Nothing is ever deleted: a manager switched off keeps its rows and history and is skipped by dispatch.
// Reads: one SELECT over `roles` per tick. Writes: only when a manager is missing.

export function switchOf(reg, id) {
  const s = reg && reg.switch && reg.switch[id];
  return typeof s === 'string' ? { state: s, reason: '' } : (s || null);
}

// The managers this system runs: on by default; off only by a switch with a reason, and never for a core manager.
export function roster(reg) {
  if (!reg || !Array.isArray(reg.managers)) return [];
  return reg.managers.map(m => {
    const s = switchOf(reg, m.id);
    const wantsOff = s ? s.state === 'off' : m.default === 'off';
    const refused = wantsOff && (m.core ? 'core manager cannot be switched off' : (s && !String(s.reason || '').trim() ? 'off switch has no reason' : ''));
    return { id: m.id, core: Boolean(m.core), tick_every: Math.max(1, Number(m.tick_every) || 1), on: !wantsOff || Boolean(refused), refused: refused || null, reason: s ? s.reason || '' : '' };
  });
}

export function isOff(reg, role) {
  const m = roster(reg).find(x => x.id === role);
  return Boolean(m && !m.on);
}

export async function hireStep(db, ctx) {
  const reg = ctx.config && ctx.config.managers;
  const want = roster(reg);
  if (!want.length) return { hired: [], off: [], unregistered: [] };  // no register in this build: the roles table stays as the bootstrap left it
  const rows = (await db.prepare('SELECT id, role, model FROM roles').all()).results || [];
  const have = new Set(rows.map(r => r.role));
  const tier = (id) => (rows.find(r => /manager/.test(r.role) === /manager/.test(id)) || rows[0] || {}).model || 'tier:default';  // MODEL-TRUTH-1: a label, not what runs
  const hired = [];
  for (const m of want) {
    if (!m.on || have.has(m.id)) continue;
    await db.prepare('INSERT OR IGNORE INTO roles (id, role, project, tick_every, model) VALUES (?, ?, NULL, ?, ?)').bind(`${m.id}-1`, m.id, m.tick_every, tier(m.id)).run();
    hired.push(m.id);
  }
  const off = want.filter(m => !m.on).map(m => m.id), refused = want.filter(m => m.refused).map(m => `${m.id}: ${m.refused}`);
  if (hired.length) ctx.notes.push(`hired ${hired.length} manager(s) from the register: ${hired.join(', ')}`);
  if (refused.length) ctx.notes.push(`manager switch refused (${refused.join('; ')})`);
  return { hired, off, refused };
}
