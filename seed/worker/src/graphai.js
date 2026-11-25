// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KGRAPH-AI-1: the Workers AI layer on top of the DATAGRAPH-1 graph (kg_nodes, kg_edges, kg_insights). Each pass works only on nodes changed since
// its cursor, in batches: it embeds their labels (kg_vec), asks a small model for relations between ids a label mentions (proposed kg_edges with
// source 'ai', which the datagraph settles like any other proposal), and summarizes open community insights (kg_summaries). The spend throttle's
// pace knob shrinks every batch and never turns the layer off. Its own daily neuron estimate is the cost probe: over its share files KG-COST.
export const DDL = [
  `CREATE TABLE IF NOT EXISTS kg_vec (id TEXT PRIMARY KEY, vec TEXT NOT NULL, at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kg_summaries (subject TEXT PRIMARY KEY, text TEXT NOT NULL, at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kg_ai_cursor (name TEXT PRIMARY KEY, at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS kg_cost (day TEXT PRIMARY KEY, neurons REAL NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0)`,
];
export const DEFAULTS = { embed_max: 64, extract_max: 8, summarize_max: 4, daily_neurons: 2500, embed_model: '@cf/baai/bge-small-en-v1.5', text_model: '@cf/meta/llama-3.1-8b-instruct-fast', cost: { embed: 1, extract: 40, summarize: 40 } };
const ID = /(?<![\w-])[A-Z][A-Z0-9]*(?:-[A-Za-z0-9]+)+\b/g;

export function budget(k, spend) {
  const pace = Math.max(1, Number(spend && spend.knobs && spend.knobs.pace) || 1);
  return { pace, embed: Math.max(1, Math.floor(k.embed_max / pace)), extract: Math.max(1, Math.floor(k.extract_max / pace)), summarize: Math.max(1, Math.floor(k.summarize_max / pace)) };
}
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const one = async (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const runq = (db, sql, ...a) => db.prepare(sql).bind(...a).run();

export async function graphAiStep({ db, ai, config = {}, spend = null, ensureItem = null, now = Date.now() }) {
  const k = { ...DEFAULTS, ...(config.graph_ai || {}) };
  for (const s of DDL) await db.prepare(s).run();
  const nowIso = new Date(now).toISOString(), day = nowIso.slice(0, 10);
  const out = { embedded: 0, proposed: 0, summarized: 0, neurons: 0, errors: [], skipped: null };
  if (!ai) { out.skipped = 'no AI binding'; return out; }
  const b = budget(k, spend);
  const used = Number((await one(db, `SELECT neurons FROM kg_cost WHERE day=?`, day))?.neurons || 0);
  if (used >= k.daily_neurons) {
    out.skipped = 'daily share used';
    if (ensureItem) await ensureItem(db, { id: `KG-COST-${day}`, kind: 'improvement', owner_role: 'product-manager', priority: 1, title: `Knowledge graph AI used ${Math.round(used)} of ${k.daily_neurons} neurons today. Prediction: kg_cost <= ${k.daily_neurons} within 24 h.`, done_check: 'graph AI stays inside its daily share', closing_probe: 'GET /api/graph/ai' }).catch(() => false);
    return out;
  }
  const cur = (await one(db, `SELECT at FROM kg_ai_cursor WHERE name='nodes'`))?.at || '';
  const nodes = await all(db, `SELECT id, label, changed_at FROM kg_nodes WHERE changed_at > ? AND valid_to IS NULL ORDER BY changed_at LIMIT ?`, cur, b.embed);
  let calls = 0;
  if (nodes.length) {
    try {
      const r = await ai.run(k.embed_model, { text: nodes.map(n => String(n.label || n.id).slice(0, 500)) });
      calls++; out.neurons += k.cost.embed * nodes.length;
      const vs = (r && r.data) || [];
      for (let i = 0; i < nodes.length && i < vs.length; i++) { await runq(db, `INSERT INTO kg_vec (id, vec, at) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET vec=excluded.vec, at=excluded.at`, nodes[i].id, JSON.stringify(vs[i].map(x => Math.round(x * 1e4) / 1e4)), nowIso); out.embedded++; }
    } catch (e) { out.errors.push('embed: ' + (e && e.message)); }
    for (const n of nodes.filter(n => (String(n.label || '').match(ID) || []).length).slice(0, b.extract)) {
      try {
        const ids = [...new Set(String(n.label).match(ID))].slice(0, 6);
        const r = await ai.run(k.text_model, { messages: [{ role: 'system', content: 'Reply with JSON only: [{"dst":"<id>","rel":"<verb>"}] for each id the text clearly relates to. Use only the ids given.' }, { role: 'user', content: `Text: ${String(n.label).slice(0, 600)}\nIds: ${ids.join(', ')}` }], max_tokens: 200 });
        calls++; out.neurons += k.cost.extract;
        const m = String((r && r.response) || '').match(/\[[\s\S]*\]/);
        for (const x of m ? JSON.parse(m[0]) : []) {
          if (!x || !ids.includes(x.dst)) continue;
          const rel = String(x.rel || 'relates_to').toLowerCase().replace(/[^a-z_]/g, '_').slice(0, 32) || 'relates_to';
          const dst = (await one(db, `SELECT id FROM kg_nodes WHERE id LIKE ? AND valid_to IS NULL LIMIT 1`, '%:' + x.dst))?.id;
          if (!dst || dst === n.id) continue;
          await runq(db, `INSERT INTO kg_edges (src, rel, dst, status, confidence, source, why, first_seen) VALUES (?,?,?,'proposed',0.5,'ai',?,?) ON CONFLICT(src, rel, dst) DO NOTHING`, n.id, rel, dst, 'extracted by model from the node label', nowIso);
          out.proposed++;
        }
      } catch (e) { out.errors.push('extract: ' + (e && e.message)); }
    }
    await runq(db, `INSERT INTO kg_ai_cursor (name, at) VALUES ('nodes', ?) ON CONFLICT(name) DO UPDATE SET at=excluded.at`, nodes[nodes.length - 1].changed_at);
  }
  const comms = await all(db, `SELECT i.subject, i.text FROM kg_insights i LEFT JOIN kg_summaries s ON s.subject = i.subject WHERE i.kind='community' AND i.state='open' AND (s.at IS NULL OR s.at < i.last_seen) LIMIT ?`, b.summarize);
  for (const c of comms) {
    try {
      const r = await ai.run(k.text_model, { messages: [{ role: 'system', content: 'Summarize in one plain sentence what this group of records is about.' }, { role: 'user', content: String(c.text).slice(0, 1500) }], max_tokens: 80 });
      calls++; out.neurons += k.cost.summarize;
      const t = String((r && r.response) || '').trim().slice(0, 300);
      if (t) { await runq(db, `INSERT INTO kg_summaries (subject, text, at) VALUES (?,?,?) ON CONFLICT(subject) DO UPDATE SET text=excluded.text, at=excluded.at`, c.subject, t, nowIso); out.summarized++; }
    } catch (e) { out.errors.push('summarize: ' + (e && e.message)); }
  }
  if (calls) await runq(db, `INSERT INTO kg_cost (day, neurons, calls) VALUES (?,?,?) ON CONFLICT(day) DO UPDATE SET neurons=neurons+excluded.neurons, calls=calls+excluded.calls`, day, out.neurons, calls);
  return out;
}

export async function readGraphAi(db, now = Date.now()) {
  for (const s of DDL) await db.prepare(s).run();
  const day = new Date(now).toISOString().slice(0, 10);
  return { cost_today: await one(db, `SELECT neurons, calls FROM kg_cost WHERE day=?`, day) || { neurons: 0, calls: 0 }, share: DEFAULTS.daily_neurons,
    embedded: (await one(db, `SELECT COUNT(*) n FROM kg_vec`)).n, summaries: await all(db, `SELECT subject, text, at FROM kg_summaries ORDER BY at DESC LIMIT 20`) };
}
