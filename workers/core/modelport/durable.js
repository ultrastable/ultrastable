// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The role runtime as a Durable Object class (US-SPEC-14 section 3, Role runtime row): one object per role, addressed by the role id, that
// holds the role's lease in its own storage and works that role's queued dispatch rows from an alarm. The platform's DurableObject base class is
// passed in, so this file imports nothing platform-specific (the pattern of adapters/cloudflare/src/tenant-do.js, US-14-R01) and the tests run
// it on a fake ctx.storage. The work itself is core/modelport createRoleRuntime, given the DO's storage as its lease port, so a Durable Object run
// and an in-process run give the same results by construction.
//   runRole(roleId, { item })   one piece of work on this role's instance; { busy: true } while the lease is held
//   runDispatches({ limit })    this role's queued dispatch rows, in order
//   wake(delayMs)               arm the alarm; alarm() works the queue and re-arms itself while work remains
//   instances()                 this object's own lease, run count and last run
// handlers: { <role name>: async ({ role, item, complete }) => ({ ok, detail }) }, with `default` as the fallback (see handlers.js for the
// container-job and agent-engine handlers). models: a model port, or a function (env) => model port. dbOf: (env) => the store handle.
import { createRoleRuntime } from './index.js';

const iso = ms => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);

export const makeRoleRuntimeDO = (Base, { handlers = {}, models, dbOf, now = () => Date.now(), config = {}, rearm_ms = 60e3 } = {}) => class RoleRuntimeDO extends Base {
  constructor(ctx, env) { super(ctx, env); this.ctx = ctx; this.env = env; }

  /** The organization's store handle, from the platform bindings: the host says how (`dbOf: env => handle`), so this file names no binding. */
  db() { if (typeof dbOf !== 'function') throw new Error('makeRoleRuntimeDO needs dbOf: env => store handle'); return dbOf(this.env); }

  /** The lease port over this object's storage. Storage calls are atomic with respect to the object's other events, so get-then-put is safe. */
  leasePort() {
    const st = this.ctx.storage;
    return {
      acquire: async (roleId, holder, untilMs, nowMs) => {
        const cur = await st.get('lease');
        if (cur && cur.until > nowMs) return false;
        await st.put('lease', { holder, until: untilMs });
        return true;
      },
      release: async (roleId, holder, nowMs) => {
        const cur = await st.get('lease');
        if (cur && cur.holder === holder) await st.delete('lease');
        await st.put('runs', ((await st.get('runs')) || 0) + 1);
        await st.put('last_run_at', iso(nowMs));
      },
    };
  }

  runtime() {
    const port = typeof models === 'function' ? models(this.env) : models;
    return createRoleRuntime({ db: this.db(), models: port, handlers, now, config: { holder: `do:${this.ctx.id?.toString?.() ?? 'role'}`, ...config }, lease: this.leasePort() });
  }

  async runRole(roleId, opts = {}) {
    await this.ctx.storage.put('role_id', roleId);
    return this.runtime().runRole(roleId, opts);
  }

  async runDispatches({ limit = 20 } = {}) {
    const roleId = await this.ctx.storage.get('role_id');
    if (!roleId) return { done: 0, failed: 0, busy: 0, role: null };
    return { ...(await this.runtime().runDispatches({ limit, roleId })), role: roleId };
  }

  async wake(delayMs = 1000) { await this.ctx.storage.setAlarm(now() + delayMs); return true; }

  /** Work the queue; when a dispatch was busy or more are queued, arm the alarm again. */
  async alarm() {
    const r = await this.runDispatches();
    const roleId = await this.ctx.storage.get('role_id');
    const left = roleId ? (await this.db().prepare(`SELECT COUNT(*) AS n FROM dispatches WHERE status='queued' AND role_id=?`).bind(roleId).first()).n : 0;
    if (left > 0 && (await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(now() + rearm_ms);
    return r;
  }

  async instances() {
    const st = this.ctx.storage; const lease = await st.get('lease');
    const roleId = await st.get('role_id');
    return roleId ? [{ role_id: roleId, holder: lease?.holder ?? null, lease_until: lease ? iso(lease.until) : null, runs: (await st.get('runs')) || 0, last_run_at: (await st.get('last_run_at')) ?? null }] : [];
  }
};

/** The stub for a role: one object per role id, never a shared namespace id. The id is validated so a caller cannot invent an address. */
export function roleStub(env, roleId, binding = 'ROLE_RUNTIME') {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/i.test(String(roleId))) throw new Error('bad_role_id');
  return env[binding].get(env[binding].idFromName(String(roleId)));
}
