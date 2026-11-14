// PORTABILITY-1: a person's data is theirs to take and bring back. Export is everything an integration submitted (open standard JSON,
// schema ultrastable-export/v1); import is idempotent (same content, same id) so a bundle can be replayed safely. No tokens are ever in a bundle.
export const EXPORT_SCHEMA = "ultrastable-export/v1";
const sha = async t => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map(x => x.toString(16).padStart(2, "0")).join("");
const like = n => String(n).replace(/[!%_]/g, c => "!" + c);

export async function exportBundle(env, name, now = Date.now()) {
  const r = await env.ORG.prepare("SELECT id, title, kind, priority, status, surface, disposition, created_at FROM items WHERE surface = ? OR surface LIKE ? ESCAPE '!' ORDER BY id")
    .bind("integration:" + name, like("integration:" + name) + " %").all();
  const items = (r.results || []).map(i => ({ id: i.id, title: String(i.title).replace(/^IN-[^:]*:\s*/, ""), kind: String(i.kind).replace(/^intake-/, ""), priority: i.priority, status: i.status, detail: i.disposition || null, source: i.surface, created_at: i.created_at || null }));
  return { schema: EXPORT_SCHEMA, exported_at: new Date(now).toISOString(), owner: name, count: items.length, items };
}

export async function importBundle(env, name, bundle, now = Date.now()) {
  if (!bundle || bundle.schema !== EXPORT_SCHEMA || !Array.isArray(bundle.items)) return { status: 422, body: { error: "expected schema " + EXPORT_SCHEMA } };
  if (bundle.items.length > 500) return { status: 413, body: { error: "at most 500 items per import" } };
  let created = 0, skipped = 0;
  for (const it of bundle.items) {
    const title = String((it && it.title) || "").trim().slice(0, 200); if (!title) { skipped++; continue; }
    const kind = ["idea", "request", "bug", "question"].includes(it.kind) ? it.kind : "request";
    const id = "IM-" + (await sha(name + "|" + title + "|" + (it.detail || ""))).slice(0, 10);
    const have = await env.ORG.prepare("SELECT id FROM items WHERE id = ?").bind(id).first();
    if (have) { skipped++; continue; }
    await env.ORG.prepare("INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, surface, disposition) VALUES (?, ?, ?, 'product-manager', ?, ?, ?, 'open', ?, ?)")
      .bind(id, `${id}: ${title}`, "intake-" + kind, "product-manager triaged it: accepted with a plan, merged into an existing item, or declined with a reason", "GET /api/v1/work/" + id, Math.max(1, Math.min(90, Number(it.priority) || 50)), "integration:" + name + " import", String(it.detail || "").slice(0, 4000) || null).run();
    created++;
  }
  return { status: 200, body: { ok: true, created, skipped, at: new Date(now).toISOString() } };
}
