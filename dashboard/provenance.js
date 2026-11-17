// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// PROVENANCE-1 on the edge: where every input and change came from, what it touched, what it did (doctrine/provenance.json, foundation/provenance.py).
// One D1 table, the same row shape as the repo ledger. Public views carry only rows marked public, with contact details, tokens and query strings removed.
// Capture points: owner commands (worker.js runCommand), tenant visitor suggestions (POST /api/suggest), loops and tenants (POST /api/fleet/provenance, FLEET_TOKEN).
import { say } from "../seed/worker/src/errors.js";  // USER-BACKEND-1: validation text is written for people
export const CLASSES = ["system", "loop", "owner", "end_user", "agent", "external"];
export const CHANNELS = ["commit", "pr", "issue", "command", "thread", "form", "api", "loop-run", "deploy", "migration", "scout"];
export const KINDS = ["change", "input", "decision", "deploy", "suggestion", "incident", "settlement"];
export const EFFECTS = ["pending", "kept", "reverted", "none"];
const SUGGEST_PER_HOUR = 20;

const RED = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[removed]"],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{12,}|eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}|[A-Fa-f0-9]{32,})\b/g, "[removed]"],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[removed]"],
  [/(?<!\w)\+?\d[\d\s().-]{8,}\d(?!\w)/g, "[removed]"],
  [/(https?:\/\/[^\s?#]+)\?[^\s#]*/g, "$1"],
];
export function redact(t) { let o = String(t == null ? "" : t); for (const [rx, to] of RED) o = o.replace(rx, to); return o.replace(/\s+/g, " ").trim(); }

export async function ensure(env) {
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS provenance(id TEXT PRIMARY KEY, at INTEGER NOT NULL, tenant TEXT NOT NULL DEFAULT 'ultrastable', class TEXT NOT NULL, actor TEXT NOT NULL, channel TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL, ref TEXT NOT NULL DEFAULT '', affected TEXT NOT NULL DEFAULT '[]', effect TEXT NOT NULL DEFAULT 'pending', effect_note TEXT NOT NULL DEFAULT '', public INTEGER NOT NULL DEFAULT 0, parent TEXT NOT NULL DEFAULT '')").run();
  await env.DB.prepare("CREATE INDEX IF NOT EXISTS provenance_at ON provenance(at)").run();
}

async function sha(s) { const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }

/** Validate and append one row. Summaries are stored redacted (the raw text of a visitor never rests here); returns the row. */
export async function add(env, o) {
  const cls = o.class, ch = o.channel, kind = o.kind;
  if (!CLASSES.includes(cls)) throw say("origin class must be one of " + CLASSES.join(", "));
  if (!CHANNELS.includes(ch)) throw say("channel must be one of " + CHANNELS.join(", "));
  if (!KINDS.includes(kind)) throw say("kind must be one of " + KINDS.join(", "));
  const effect = o.effect || "pending"; if (!EFFECTS.includes(effect)) throw say("effect must be one of " + EFFECTS.join(", "));
  const actor = redact(o.actor).slice(0, 60); if (!actor) throw say("an actor is required");
  const summary = redact(o.summary).slice(0, 500); if (!summary) throw say("a summary is required");
  const at = o.at || Date.now(), tenant = String(o.tenant || "ultrastable").replace(/[^a-z0-9-]/g, "").slice(0, 40) || "ultrastable";
  const affected = JSON.stringify((o.affected || []).slice(0, 8).map(a => redact(a).slice(0, 80)));
  const id = "pv-" + (await sha([tenant, cls, actor, ch, kind, summary, o.ref || "", o.parent || "", at].join("|"))).slice(0, 12);
  await ensure(env);
  await env.DB.prepare("INSERT OR IGNORE INTO provenance(id,at,tenant,class,actor,channel,kind,summary,ref,affected,effect,effect_note,public,parent) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)")
    .bind(id, at, tenant, cls, actor, ch, kind, summary, redact(o.ref).slice(0, 80), affected, effect, redact(o.note).slice(0, 200), o.public ? 1 : 0, o.parent || "").run();
  return { id, at, tenant, class: cls, actor, channel: ch, kind, summary, effect };
}

/** Settle an earlier row: the parent's effect becomes kept, reverted or none (event-sourced in the repo ledger, folded in place here). */
export async function settle(env, id, effect, note) {
  if (!["kept", "reverted", "none"].includes(effect)) throw new Error("effect must be kept, reverted or none");
  await ensure(env);
  const r = await env.DB.prepare("UPDATE provenance SET effect=?2,effect_note=?3 WHERE id=?1").bind(id, effect, redact(note).slice(0, 200)).run();
  return (r.meta && r.meta.changes) > 0;
}

/** Full timeline for the signed-in owner. */
export async function timeline(env, { tenant, cls, limit = 100 } = {}) {
  await ensure(env);
  const w = [], b = [];
  if (tenant) { b.push(tenant); w.push("tenant=?" + b.length); }
  if (cls) { b.push(cls); w.push("class=?" + b.length); }
  const rows = (await env.DB.prepare("SELECT id,at,tenant,class,actor,channel,kind,summary,ref,affected,effect,effect_note,public,parent FROM provenance" + (w.length ? " WHERE " + w.join(" AND ") : "") + " ORDER BY at DESC LIMIT " + Math.min(+limit || 100, 500)).bind(...b).all()).results;
  return rows.map(r => ({ ...r, affected: safe(r.affected) }));
}
function safe(s) { try { return JSON.parse(s); } catch (e) { return []; } }

/** What anyone may see: public rows only, no end-user detail beyond the class, no actor names for owner or visitors, redacted again on the way out. */
export async function publicView(env, { tenant, limit = 100 } = {}) {
  await ensure(env);
  const rows = (await env.DB.prepare("SELECT id,at,tenant,class,actor,channel,kind,summary,affected,effect FROM provenance WHERE public=1 AND kind!='settlement'" + (tenant ? " AND tenant=?1" : "") + " ORDER BY at DESC LIMIT " + Math.min(+limit || 100, 200)).bind(...(tenant ? [tenant] : [])).all()).results;
  const entries = rows.map(r => ({ id: r.id, at: new Date(r.at).toISOString(), tenant: r.tenant, origin: r.class, channel: r.channel, actor: ["loop", "system", "agent"].includes(r.class) ? r.actor : r.class,
    kind: r.kind, summary: redact(r.summary).slice(0, 200), affected: safe(r.affected).map(a => redact(a)).slice(0, 8), effect: r.effect }));
  const counts = {}; for (const e of entries) counts[e.origin] = (counts[e.origin] || 0) + 1;
  return { schema: "ultrastable-changelog/v1", counts_by_origin: counts, entries };
}

export const ORIGIN_LABEL = { system: "The system itself", loop: "An automated loop", owner: "The owner", end_user: "A visitor", agent: "A code agent", external: "Outside signal" };
const e = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function changelogHtml(view, { title = "Changelog", css = "", icon = "" } = {}) {
  const days = {}; for (const x of view.entries) (days[x.at.slice(0, 10)] = days[x.at.slice(0, 10)] || []).push(x);
  const body = Object.keys(days).sort().reverse().map(d => "<h2>" + e(d) + "</h2><ul>" + days[d].map(x =>
    "<li><span class=\"tag\">" + e(ORIGIN_LABEL[x.origin] || x.origin) + (x.actor !== x.origin ? " · " + e(x.actor) : "") + "</span> " + e(x.summary) +
    (x.affected.length ? " <span class=\"meta\">touched " + e(x.affected.join(", ")) + "</span>" : "") + " <span class=\"meta eff-" + e(x.effect) + "\">" + e(x.effect) + "</span></li>").join("") + "</ul>").join("") || "<p class=\"meta\">Nothing recorded yet.</p>";
  const chips = Object.entries(view.counts_by_origin).map(([k, n]) => "<span class=\"tag\">" + e(ORIGIN_LABEL[k] || k) + " " + n + "</span>").join(" ");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>" + e(title) + "</title>" + icon + "<style>" + css +
    "main{max-width:760px;margin:0 auto;padding:16px 16px 64px}h1{font-size:24px}h2{font-size:16px;margin:24px 0 8px}ul{padding:0;list-style:none}li{padding:8px 0;border-top:1px solid var(--line)}.tag{display:inline-block;font-size:14px;padding:0 8px;border:1px solid var(--line);border-radius:12px;background:var(--sf)}.meta{color:var(--ink2);font-size:14px}</style></head><body><main><h1>" + e(title) +
    "</h1><p class=\"meta\">Every change, with where it came from, what it touched and what it did. Contact details and private text are never shown.</p><p>" + chips + "</p>" + body + "</main></body></html>";
}

/** End-user suggestions (a tenant's visitors): stored private, summary redacted, never a name or address; counted per hour to stop floods. */
export async function suggest(env, body, tenant) {
  await ensure(env);
  const n = (await env.DB.prepare("SELECT COUNT(*) c FROM provenance WHERE class='end_user' AND at>?1").bind(Date.now() - 3600e3).first()).c;
  if (n >= SUGGEST_PER_HOUR) return { status: 429, body: { error: "too many suggestions this hour, try again later" } };
  const text = redact(body && body.text).slice(0, 500);
  if (text.length < 8) return { status: 400, body: { error: "write a sentence or two" } };
  const r = await add(env, { class: "end_user", actor: tenant + "-visitor", channel: "form", kind: "suggestion", summary: text, tenant, affected: [String((body && body.page) || "").replace(/[^\w/.-]/g, "").slice(0, 60)].filter(Boolean), public: false });
  return { status: 200, body: { ok: true, id: r.id } };
}
