// CONSOLE-AGENT-1 (2026-11-14, owner: the command line "doesn't function like Claude Code or a top-tier server-side agent", and "these critiques also apply to Ultrastable").
// The owner console used to run only exact registered commands; any other line answered "Unknown command". This module is the agent behind it: a plain-English request runs a short
// tool loop on the Workers AI binding (the adapters of the tick worker's code agent, cheapest first) and always ends in a text answer.
//   read   (any signed-in session): `sql` runs one SELECT over an allow-list of tables (the web-analytics hits, tasks, checks, audit, queue, notifications) and `command` runs a read-only
//          registered command (status, tasks, analytics, snapshot, probe ...).
//   change (only with a code emailed in the last 15 minutes, the same step-up every mutating command already needs): `command` also runs done, snooze, delegate, fix, sync, dispatch,
//          note and undo, through runCommand, so every change is audited and undoable and `delegate`/`dispatch` hand the real work to the fleet and GitHub Actions.
// Never empty: a loop that ends without text gets one tool-less synthesis pass over what its tools returned; if that also gives nothing, a digest of the last results is the answer.
// Model list mirrors doctrine/code-agents.json (cheapest first). Inlined: seed/worker/src/codeagent.js no longer exports ADAPTERS on main (ZERO-MINUTES-1 rewrite).
import { routeChat } from "../seed/worker/src/airoute.js";
const ADAPTERS = [
  { id: "workers-ai-glm", model: "@cf/zai-org/glm-4.7-flash", family: "glm", price: 0.4605, extra: { reasoning_effort: "low", max_tokens: 8000 } },
  { id: "workers-ai-llama", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", family: "llama", price: 2.546, extra: { max_tokens: 3000 } },
  { id: "workers-ai-qwen-coder", model: "@cf/qwen/qwen2.5-coder-32b-instruct", family: "qwen", price: 1e6, extra: { max_tokens: 7000 } },
];

export const SQL_TABLES = ["hits", "tasks", "checks", "audit", "fleet_queue", "notifications", "analytics_meta"];
export const MAX_STEPS = 6;
export const ASK_PER_HOUR = 60;
const RESULT_CHARS = 3000;

const clip = (s, n) => { s = String(s == null ? "" : s); return s.length > n ? s.slice(0, n) + " ..." : s; };

// One SELECT, no comments, no second statement, only the tables above, at most 100 rows. Returns {ok, sql} or {ok:false, error}.
export function safeSelect(q) {
  let s = String(q || "").trim().replace(/;+\s*$/, "");
  if (!/^select\b/i.test(s)) return { ok: false, error: "only a single SELECT is allowed" };
  if (/;|--|\/\*/.test(s)) return { ok: false, error: "one statement, no comments" };
  if (/\b(insert|update|delete|drop|alter|create|attach|detach|pragma|replace|vacuum|reindex)\b/i.test(s)) return { ok: false, error: "read-only: this word is not allowed in a query" };
  for (const m of s.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_]*)/gi)) {
    if (!SQL_TABLES.includes(m[1].toLowerCase())) return { ok: false, error: "table '" + m[1] + "' is not readable here; allowed: " + SQL_TABLES.join(", ") };
  }
  if (!/\blimit\s+\d+/i.test(s)) s += " LIMIT 100";
  else s = s.replace(/\blimit\s+(\d+)/i, (x, n) => "LIMIT " + Math.min(100, +n));
  return { ok: true, sql: s };
}

export function parseAction(text) {
  const t = String(text || "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) {
    try {
      const j = JSON.parse(t.slice(a, b + 1));
      if (j && typeof j.answer === "string" && j.answer.trim()) return { answer: j.answer.trim() };
      if (j && typeof j.tool === "string") return { tool: j.tool, args: j.args && typeof j.args === "object" ? j.args : {} };
    } catch (e) { /* not JSON: the whole reply is treated as the answer below */ }
  }
  return t ? { answer: t } : { empty: true };
}

export function digest(steps, max = 3) {
  const d = steps.filter(s => s.result).slice(-max).map(s => "- " + s.label + ": " + clip(String(s.result).replace(/\s+/g, " "), 600));
  return d;
}
export function fallbackAnswer(steps, why) {
  const d = digest(steps), w = why || "the model ended the turn without writing a conclusion";
  return d.length
    ? "I gathered data but could not write a conclusion (" + w + "). The last results:\n" + d.join("\n") + "\nAsk again to continue from these."
    : "I could not answer: " + w + ", and nothing was read. Ask again, or type help for the commands.";
}

function systemPrompt(commands, fresh, nowSec) {
  const list = Object.entries(commands).map(([k, v]) => "- " + k + (v.mut ? " (changes things)" : "") + ": " + v.doc).join("\n");
  return [
    "You are the Ultrastable owner console agent. You answer the owner's plain-English requests about their system and, when allowed, act on it.",
    "Reply with exactly ONE JSON object per turn and nothing else:",
    '  {"tool":"sql","args":{"query":"SELECT ..."}}      read data (one SELECT, tables: ' + SQL_TABLES.join(", ") + ")",
    '  {"tool":"command","args":{"line":"status"}}        run a console command',
    '  {"answer":"markdown text"}                         the final answer to the owner',
    "Tables: hits(at INTEGER epoch seconds, host, path, ref, country, device, bot INTEGER 0/1, vid, name) is the cookieless first-party web analytics: count rows where bot=0 AND name='pageview'; at the time of this request now=" + nowSec + ".",
    "tasks(id,title,area,kind 'owner'|'fleet',state,why,url), checks(name,ok,detail,at), audit(id,at,cmd,ok,result), fleet_queue(task_id,status), notifications(subject,sent).",
    "Commands:\n" + list,
    fresh ? "The owner entered a fresh code: commands that change things are allowed, and each is audited and can be undone." : "This session is read-only: do not run commands marked (changes things); say that a fresh emailed code is needed for them.",
    "Never invent numbers: every figure comes from a tool result. Finish with the answer as soon as the results are enough, in short markdown (a table for a ranking, bullets for findings).",
  ].join("\n");
}

async function callModel(env, messages, adapters) {
  // AI-ROUTER-1: through core/airouter (free first, learned order, cost and pass rate recorded). cache:false because each turn carries live tool results.
  try {
    const r = await routeChat(env, { kind: "console", models: adapters.map(a => ({ id: a.id, model: a.model, extra: a.extra })), messages, maxTokens: 1500, cache: false, config: { neurons_day_cap: 1500 } });
    return { text: r.text, model: r.model };
  } catch (e) {
    if (e && e.code === "airouter_exhausted" && !/error:/.test(String(e.message))) return { text: "", model: "" };  // every model answered with nothing: the caller's synthesis step handles an empty reply
    throw new Error("no model answered (" + String(e && e.message || e).slice(0, 200) + ")");
  }
}

export async function ask(env, text, { commands, exec, fresh, now = Date.now(), adapters } = {}) {
  const models = (adapters || ADAPTERS).slice().sort((x, y) => x.price - y.price).slice(0, 2);
  const steps = [];
  let needsCode = false, model = "";
  const messages = [{ role: "system", content: systemPrompt(commands, fresh, Math.floor(now / 1000)) }, { role: "user", content: String(text).slice(0, 2000) }];
  try {
    for (let i = 0; i < MAX_STEPS; i++) {
      const r = await callModel(env, messages, models); model = r.model;
      const act = parseAction(r.text);
      if (act.answer) return { ok: true, out: act.answer, steps: steps.map(({ label, ok }) => ({ label, ok })), needs_code: needsCode, model };
      if (act.empty) break;
      let result = "", ok = true, label = "";
      if (act.tool === "sql") {
        const g = safeSelect(act.args.query);
        label = "Reading the database";
        if (!g.ok) { result = "refused: " + g.error; ok = false; }
        else {
          try { const rows = (await env.DB.prepare(g.sql).bind().all()).results; result = JSON.stringify(rows); }
          catch (e) { result = "error: " + String(e && e.message || e).slice(0, 200); ok = false; }
        }
      } else if (act.tool === "command") {
        const line = String(act.args.line || "").trim(), name = line.split(/\s+/)[0];
        label = "Ran " + (name || "a command");
        const c = commands[name];
        if (!c) { result = "no such command: " + name; ok = false; }
        else if (c.mut && !fresh) { result = "refused: this changes things and needs a code emailed in the last 15 minutes"; ok = false; needsCode = true; }
        else { const o = await exec(line); result = clip(o && o.out != null ? o.out : JSON.stringify(o), 1500); ok = !!(o && o.ok); }
      } else { label = "Unknown tool"; result = "unknown tool '" + act.tool + "'"; ok = false; }
      steps.push({ label, ok, result });
      messages.push({ role: "assistant", content: r.text }, { role: "user", content: "Tool result (" + (ok ? "ok" : "failed") + "): " + clip(result, RESULT_CHARS) });
    }
    // CONSOLE-NEVER-EMPTY-1: no answer yet. One tool-less pass writes it from what the tools returned.
    messages.push({ role: "user", content: "Answer the request now in plain text from the tool results above. Do not call tools. If they do not contain the answer, say what is missing and what you tried." });
    const r = await callModel(env, messages, models); model = r.model;
    const act = parseAction(r.text);
    if (act.answer) return { ok: true, out: act.answer, steps: steps.map(({ label, ok }) => ({ label, ok })), needs_code: needsCode, model };
  } catch (e) {
    return { ok: steps.length > 0, out: fallbackAnswer(steps, String(e && e.message || e).slice(0, 160)), steps: steps.map(({ label, ok }) => ({ label, ok })), needs_code: needsCode, model };
  }
  return { ok: steps.length > 0, out: fallbackAnswer(steps), steps: steps.map(({ label, ok }) => ({ label, ok })), needs_code: needsCode, model };
}
