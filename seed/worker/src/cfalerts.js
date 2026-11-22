// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// CF-ALERTS-1 (UNATTENDED-365 dependency cloudflare-alerts): Cloudflare's own notifications (platform incidents, Worker error rates, usage and billing,
// certificates) reach a loop instead of a person's mailbox. Cloudflare posts each alert to /hook/cloudflare with the destination's secret in the
// cf-webhook-auth header; a verified alert is stored in cf_alerts and becomes one queue item per alert type per day (CF-ALERT-<type>-<day>) with a
// closing probe. The item closes itself once its alert type has been quiet for QUIET_HOURS, checked on the tick's hourly beat.
// The destination and policies are declared in POLICIES; an alert type Cloudflare does not offer on the account is reported, never faked.
export const QUIET_HOURS = 24;
export const POLICIES = [
  { alert_type: 'incident_alert', name: 'Ultrastable: Cloudflare incidents (CF-ALERTS-1)', filters: { incident_impact: ['INCIDENT_IMPACT_MAJOR', 'INCIDENT_IMPACT_CRITICAL'] } },
  { alert_type: 'workers_observability_alert', name: 'Ultrastable: Worker error rate (CF-ALERTS-1)', filters: { status: ['FIRING_FAILED'] } },  // the API refuses an empty filter (17103)
  { alert_type: 'billing_budget_alert', name: 'Ultrastable: month bill reached 10 USD (CF-ALERTS-1)', filters: { total_spend_dollars: ['10'] } },  // spend, not per-product usage: billing_usage_alert needs a product and limit
  { alert_type: 'universal_ssl_event_type', name: 'Ultrastable: certificate events (CF-ALERTS-1)', filters: {} },
];
const TYPE = /^[a-z0-9_]{1,64}$/;

function same(a, b) {  // constant-time comparison of two strings
  const x = new TextEncoder().encode(String(a || '')), y = new TextEncoder().encode(String(b || ''));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0 && x.length > 0;
}

async function ensureTable(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS cf_alerts (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, alert_type TEXT NOT NULL, name TEXT, text TEXT, item TEXT)').run();
}

// request: the POST to /hook/cloudflare; secret: the destination's secret (env.CF_ALERT_SECRET); fileItem: tick.js ensureItem bound to the DB
export async function onCloudflareAlert(request, { db, secret, fileItem, now = Date.now() }) {
  if (!secret) return Response.json({ error: 'alert destination not set up on this worker' }, { status: 503 });
  if (!same(request.headers.get('cf-webhook-auth'), secret)) return Response.json({ error: 'bad secret' }, { status: 401 });
  let a; try { a = JSON.parse((await request.text()) || '{}'); } catch { return Response.json({ error: 'bad json' }, { status: 400 }); }
  const type = TYPE.test(String(a.alert_type || '')) ? a.alert_type : 'unknown';
  const at = new Date(now).toISOString(), id = `CF-ALERT-${type.replace(/_/g, '-')}-${at.slice(0, 10)}`;
  const name = String(a.name || a.alert_type || 'Cloudflare alert').slice(0, 200), text = String(a.text || '').slice(0, 1000);
  await ensureTable(db);
  if (type === 'unknown' && /test/i.test(name + ' ' + text)) {  // the delivery check Cloudflare sends when the destination is created
    await db.prepare('INSERT INTO cf_alerts (at, alert_type, name, text, item) VALUES (?, ?, ?, ?, NULL)').bind(at, 'destination_test', name, text).run();
    return Response.json({ ok: true, test: true }, { status: 200 });
  }
  const filed = fileItem ? await fileItem({ id, kind: 'fix', owner_role: 'operations', priority: type === 'incident_alert' ? 2 : 5,
    title: `Cloudflare alert ${type}: ${name}`.slice(0, 400),
    done_check: `no ${type} alert from Cloudflare for ${QUIET_HOURS} hours (cf_alerts), and the condition named in the alert text is repaired`,
    closing_probe: `cfalert:${type}` }) : false;
  await db.prepare('INSERT INTO cf_alerts (at, alert_type, name, text, item) VALUES (?, ?, ?, ?, ?)').bind(at, type, name, text, id).run();
  return Response.json({ ok: true, item: id, filed: Boolean(filed) }, { status: 202 });
}

// hourly: an open CF-ALERT item whose type has been quiet for QUIET_HOURS is closed with that evidence
export async function settleCloudflareAlerts(db, { now = Date.now() } = {}) {
  await ensureTable(db);
  const open = (await db.prepare("SELECT id, closing_probe FROM items WHERE id LIKE 'CF-ALERT-%' AND status NOT IN ('done','superseded','cancelled')").all()).results || [];
  const closed = [], cutoff = new Date(now - QUIET_HOURS * 3600e3).toISOString(), nowIso = new Date(now).toISOString();
  for (const it of open) {
    const type = String(it.closing_probe || '').replace(/^cfalert:/, '');
    const last = await db.prepare('SELECT MAX(at) AS at FROM cf_alerts WHERE alert_type = ?').bind(type).first();
    if (last && last.at && last.at < cutoff) {
      await db.prepare("UPDATE items SET status='done', disposition=?, updated_at=? WHERE id=? AND status NOT IN ('done','superseded','cancelled')")
        .bind(`probe green: cfalert:${type} quiet since ${last.at}`, nowIso, it.id).run();
      closed.push(it.id);
    }
  }
  return { open: open.length, closed };
}
