// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The person-facing pack surface (US-21-R30): the one place a person sees a pack's enable card, enables or disables it, engages a
// kill switch, and approves or rejects a queued send. Plain JSON over fetch-style Request/Response, so any host can mount it.
// Default deny: authorize(request) must return the actor's name (a string) or the route answers 401. Every mutation is recorded in
// packs_actions with the actor; no response carries a recipient or message content beyond the decision card's own text.
//   GET  /packs                      every registered pack: card text, scope, class, ceiling, enabled, last channel probes
//   POST /packs/<id>/enable          { cardText }   (must equal the manifest card exactly; the actor becomes the recorded `by`)
//   POST /packs/<id>/disable
//   GET  /packs/switches             POST /packs/switches { scope, on, reason }
//   GET  /packs/queue                queued sends awaiting a person, as decision cards
//   POST /packs/queue/<id>/approve   POST /packs/queue/<id>/reject
//   POST /packs/bounces              provider delivery events behind a shared secret (not the person's login)
import { all, run, iso } from '../kernel/util.js';

const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

export function createPackRoutes({ packs, db, authorize, bounceSecret = null, now = Date.now } = {}) {
  if (!packs || typeof authorize !== 'function') throw new Error('packs and authorize are required');
  const note = (actor, action, target, result, detail = null) => run(db, `INSERT INTO packs_actions (at, actor, action, target, result, detail) VALUES (?,?,?,?,?,?)`, iso(now()), actor, action, String(target), result, detail);

  async function handle(request) {
    const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '') || '/', method = request.method;
    if (path === '/packs/bounces') return packs.bounces.handle(request, { secret: bounceSecret });
    if (!(path === '/packs' || path.startsWith('/packs/'))) return json({ error: 'not_found' }, 404);
    const actor = await authorize(request);
    if (typeof actor !== 'string' || !actor.trim()) return json({ error: 'unauthorized' }, 401);
    const body = async () => { try { return method === 'POST' ? await request.json() : {}; } catch { return null; } };
    let m;
    if (path === '/packs' && method === 'GET') return json({ packs: await packs.list() });
    if (path === '/packs/switches' && method === 'GET') return json({ switches: await packs.switches() });
    if (path === '/packs/switches' && method === 'POST') {
      const b = await body();
      if (!b || typeof b.scope !== 'string' || !/^(global|pack:[a-z][a-z0-9_]*|channel:[\w-]+)$/.test(b.scope) || typeof b.on !== 'boolean') return json({ error: 'bad_request' }, 400);
      await packs.setSwitch(b.scope, b.on, b.reason ?? null);
      await note(actor, 'switch', b.scope, 'ok', `${b.on ? 'on' : 'off'}${b.reason ? `: ${String(b.reason).slice(0, 120)}` : ''}`);
      return json({ ok: true, scope: b.scope, on: b.on });
    }
    if (path === '/packs/queue' && method === 'GET') return json({ queue: await packs.queue() });
    if ((m = /^\/packs\/queue\/(\d+)\/(approve|reject)$/.exec(path)) && method === 'POST') {
      const id = Number(m[1]);
      const r = m[2] === 'approve' ? await packs.guard.approve(id, { by: actor }) : await packs.guard.reject(id, { by: actor });
      await note(actor, m[2], id, r.decision === 'refused' && m[2] === 'approve' ? r.reason : 'ok', r.decision);
      return json({ decision: r.decision, reason: r.reason ?? null }, r.reason === 'not_pending' ? 404 : 200);
    }
    if ((m = /^\/packs\/([a-z][a-z0-9_]*)\/(enable|disable)$/.exec(path)) && method === 'POST') {
      const id = m[1];
      if (m[2] === 'disable') {
        const r = await packs.disablePack(id);
        await note(actor, 'disable', id, r.ok ? 'ok' : r.reason);
        return json(r, r.ok ? 200 : 404);
      }
      const b = await body();
      if (!b) return json({ error: 'bad_request' }, 400);
      const r = await packs.enablePack(id, { by: actor, cardText: b.cardText });
      await note(actor, 'enable', id, r.ok ? 'ok' : r.reason, r.ok ? r.decisionId : null);
      return json(r.ok ? { ok: true, decisionId: r.decisionId } : { ok: false, reason: r.reason, errors: r.errors ?? [] }, r.ok ? 200 : r.reason === 'unknown_pack' ? 404 : 409);
    }
    return json({ error: 'not_found' }, 404);
  }
  return { handle, actions: () => all(db, `SELECT * FROM packs_actions ORDER BY id`) };
}
