// SPDX-License-Identifier: LicenseRef-Ultrastable-1.0
// Copyright (c) Ultrastable
// ISSUESYNC-1: roadmap items filed as docs/issues/ROADMAP-*.json reach the work queue by themselves, on the server. Until now a filed roadmap item became a queue item only through the
// Actions-run issue workflow, so while Actions is blocked (billing) or slow, originated improvements sat in the repository and nothing took them: an open loop on every improvement
// an agent originated. The tick now reads the repository over the GitHub API each pass and inserts at most `max` new open roadmap items (idempotent by id; a file whose Status is not
// open, or that carries no done check, is skipped). No model call, no new cron: it rides the existing tick.
const field = (body, name) => { const m = new RegExp('\\*\\*' + name + ':\\*\\*\\s*([^\\n]+)').exec(body || ''); return m ? m[1].trim() : ''; };
const b64 = s => { const bin = atob(String(s).replace(/\s/g, '')); return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))); };

export function parseRoadmapIssue(name, text) {
  let d; try { d = JSON.parse(text); } catch (e) { return { skip: 'not json' }; }
  const labels = d.labels || [], body = String(d.body || '');
  if (!labels.includes('roadmap')) return { skip: 'no roadmap label' };
  if (field(body, 'Status').toLowerCase() !== 'open') return { skip: 'not open' };
  const done = field(body, 'Done check'); if (!done) return { skip: 'no done check' };
  const id = String(d.id || name.replace(/\.json$/, '')); if (!/^[A-Za-z0-9._-]{3,80}$/.test(id)) return { skip: 'bad id' };
  const program = field(body, 'Program'), metric = field(body, 'Metric it should move');
  const rank = { Now: 70, Next: 55 }[d.milestone] || 40;
  return { item: { id, title: String(d.title || id).slice(0, 200), kind: 'roadmap', owner_role: field(body, 'Owner') || 'product-manager', done_check: done, closing_probe: done, priority: rank, surface: 'docs/issues' + (program ? ' ' + program : '') + (metric ? ' metric:' + metric : '') } };
}

export async function syncIssues({ db, token, repo, fetch: f = fetch, max = 5 }) {
  const out = { status: 'ok', inserted: [], skipped: [], errors: [] };
  if (!token || !repo) return { ...out, status: 'no-token' };
  const gh = async path => { const r = await f('https://api.github.com' + path, { headers: { authorization: 'Bearer ' + token, accept: 'application/vnd.github+json', 'user-agent': 'ultrastable-issuesync' } }); const t = await r.text(); return { ok: r.ok, status: r.status, json: t ? JSON.parse(t) : null }; };
  const list = await gh(`/repos/${repo}/contents/docs/issues?ref=main`);
  if (!list.ok || !Array.isArray(list.json)) return { ...out, status: 'errors', errors: [`list ${list.status}`] };
  // SUBREQUEST-METER-1: a file judged not to be an open item is remembered by its git sha and not fetched again until it changes. Before this every run re-read
  // every ROADMAP file (one call each, growing with the backlog), which alone exceeded the 50-subrequest cap of a Free-plan invocation.
  const seenRow = await db.prepare(`SELECT value FROM org WHERE key='issuesync_seen'`).first().catch(() => null);
  let seen = {}; try { seen = seenRow ? JSON.parse(seenRow.value) : {}; } catch { seen = {}; }
  const shaOf = {}, files = list.json.filter(x => /^ROADMAP-.+\.json$/.test(x.name)); for (const x of files) shaOf[x.name] = x.sha;
  const names = files.map(x => x.name);
  let dirty = false;
  for (const name of names) {
    if (out.inserted.length >= max) break;
    const id = name.replace(/\.json$/, '');
    if (shaOf[name] && seen[name] === shaOf[name]) continue;
    if (await db.prepare('SELECT id FROM items WHERE id = ?').bind(id).first()) continue;
    const file = await gh(`/repos/${repo}/contents/docs/issues/${encodeURIComponent(name)}?ref=main`);
    if (!file.ok || !file.json || !file.json.content) { out.errors.push(`${name} ${file.status}`); continue; }
    const p = parseRoadmapIssue(name, b64(file.json.content));
    if (!p.item) { out.skipped.push(`${name}: ${p.skip}`); if (shaOf[name]) { seen[name] = shaOf[name]; dirty = true; } continue; }
    if (p.item.id !== id && await db.prepare('SELECT id FROM items WHERE id = ?').bind(p.item.id).first()) continue;
    const i = p.item;
    await db.prepare("INSERT INTO items (id, title, kind, owner_role, done_check, closing_probe, priority, status, surface) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)").bind(i.id, i.title, i.kind, i.owner_role, i.done_check, i.closing_probe, i.priority, i.surface).run();
    out.inserted.push(i.id);
  }
  if (dirty) { for (const k of Object.keys(seen)) if (!(k in shaOf)) delete seen[k]; await db.prepare(`INSERT INTO org (key, value) VALUES ('issuesync_seen', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).bind(JSON.stringify(seen)).run(); }
  if (out.errors.length) out.status = 'errors';
  return out;
}
