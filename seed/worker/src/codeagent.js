// Worker-native executor: closes ZERO-MINUTES-1 step (2).
// Replaces executor.yml Actions minutes (156 min/day projected) with a tick-driven
// code agent on the Cloudflare Worker. executor.yml stays as fallback only.

import { routeChat } from './airoute.js';  // AI-ROUTER-1
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

async function appToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({ iat: now - 60, exp: now + 600, iss: env.GITHUB_APP_ID }));
  const input = `${header}.${payload}`;
  const sig = await crypto.subtle.importKey(
    "pkcs8", str2buf(env.GITHUB_APP_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]
  ).then((k) => crypto.subtle.sign("RSASSA-PKCS1-v1_5", k, str2buf(input)));
  const jwt = `${input}.${btoaBytes(sig)}`;
  const inst = await fetch("https://api.github.com/app/installations", { headers: ghHeaders(jwt) });
  const installs = await inst.json();
  const org = installs.find((i) => i.account?.login === env.ORG);
  if (!org) throw new Error(`no installation for ${env.ORG} — NEEDS-YOU: Connect GitHub`);
  const tok = await fetch(`https://api.github.com/app/installations/${org.id}/access_tokens`, {
    method: "POST", headers: ghHeaders(jwt),
  });
  return (await tok.json()).token;
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "ultrastable-worker",
  };
}

function str2buf(s) {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

function btoaBytes(buf) {
  let s = "";
  const b = new Uint8Array(buf);
  for (const c of b) s += String.fromCharCode(c);
  return btoa(s);
}

async function getTopItem(env) {
  const row = await env.DB.prepare(
    "SELECT id, repo, title, body FROM items WHERE status = 'open' ORDER BY id LIMIT 1"
  ).first();
  return row;
}

async function aiPatch(env, item) {
  const res = await routeChat(env, { kind: 'executor-legacy', models: [{ model: MODEL }], maxTokens: 4096, messages: [
      { role: "system", content: "You make the smallest complete change that closes the item. Reply with one JSON object: {\"files\":[{\"path\":string,\"content\":string}]}. Full file contents. Never touch .github/ or autonomy/." },
      { role: "user", content: `ITEM ${item.id}: ${item.title}\n${item.body || ""}` },
  ], verify: t => { JSON.parse(t); return true; } });
  return JSON.parse(res.text);
}

async function writeFiles(env, token, repo, branch, files) {
  const ref = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers: ghHeaders(token) });
  const sha = (await ref.json()).object.sha;
  const commit = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
    method: "POST", headers: ghHeaders(token),
    body: JSON.stringify({ message: "worker-native executor: smallest complete change", tree: [], parents: [sha] }),
  });
  void commit;
  for (const f of files) {
    const cur = await fetch(`https://api.github.com/repos/${repo}/contents/${f.path}?ref=main`, { headers: ghHeaders(token) });
    const body = { message: `worker executor: ${itemTitle}`, content: btoa(unescape(encodeURIComponent(f.content))), branch };
    if (cur.ok) body.sha = (await cur.json()).sha;
    await fetch(`https://api.github.com/repos/${repo}/contents/${f.path}`, {
      method: "PUT", headers: ghHeaders(token), body: JSON.stringify(body),
    });
  }
}

let itemTitle = "";

export async function runExecutor(env) {
  const item = await getTopItem(env);
  if (!item) return { skipped: "no open items" };
  itemTitle = item.title;
  const token = await appToken(env);
  const patch = await aiPatch(env, item);
  if (!patch.files?.length) return { skipped: "agent produced no files" };
  if (patch.files.every(f => /^(docs\/issues\/|ops\/|doctrine\/writeback\/)/.test(f.path || ''))) return { skipped: "SAY-DO-1: the change touches only its item file and ledgers" };
  const branch = `worker-exec/${item.id}`;
  await writeFiles(env, token, item.repo, branch, patch.files);
  const pr = await fetch(`https://api.github.com/repos/${item.repo}/pulls`, {
    method: "POST", headers: ghHeaders(token),
    body: JSON.stringify({
      title: `[worker-exec] ${item.id}: ${item.title}`,
      head: branch, base: "main",
      body: `Closes ${item.id}.\n\nProvenance: host=cloudflare-worker, model=${MODEL}. No Actions executor run.`,
    }),
  });
  const prj = await pr.json();
  await env.DB.prepare(
    "INSERT INTO executor_runs (item_id, host, pr_number, status) VALUES (?, 'cloudflare-worker', ?, ?)"
  ).bind(item.id, prj.number, pr.ok ? "ok" : "fail").run();
  if (pr.ok) await env.DB.prepare("UPDATE items SET status = 'pr-open' WHERE id = ?").bind(item.id).run();
  return { pr: prj.number, host: "cloudflare-worker" };
}

// CODEAGENT-RESTORE: #352 replaced this file and dropped the exports below; doer.js, executor.js, nativeexec.js, pr-executor.js and index.js import them.
// CODE-AGENTS-1 (worker side): the code agent that runs inside Cloudflare through the Workers AI binding (env.AI). The adapter list mirrors
// doctrine/code-agents.json (checked by tests/foundation/test_agents.py and test/codeagent.test.js). Cheapest known price first, unknown after.
// Returns {summary, files:[{path, content}]} for the executor to apply under its path guard. Nothing here touches GitHub: the PR step is the executor's.
export const ADAPTERS = [
  { id: 'workers-ai-glm', model: '@cf/zai-org/glm-4.7-flash', family: 'glm', price: 0.4605, extra: { reasoning_effort: 'low', max_tokens: 8000 } },
  { id: 'workers-ai-llama', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', family: 'llama', price: 2.546, extra: { max_tokens: 3000 } },
  { id: 'workers-ai-qwen-coder', model: '@cf/qwen/qwen2.5-coder-32b-instruct', family: 'qwen', price: 1e6, extra: { max_tokens: 7000 } },
  // LADDER-1: reasoning models answer in choices[0].message.content; they need room (8000 tokens) so reasoning cannot exhaust the reply. Price unknown, so after the priced rows.
  { id: 'workers-ai-gpt-oss', model: '@cf/openai/gpt-oss-20b', family: 'openai', price: 1e6, extra: { max_tokens: 8000 } },
  { id: 'workers-ai-qwen3', model: '@cf/qwen/qwen3.8-27b', family: 'qwen', price: 1e6, extra: { max_tokens: 8000 } },
];

// MODEL-REPLY-1: Workers AI may return an already-parsed object in `response`; callers need a string (parseJson called t.indexOf on it).
const text = r => { const empty = x => x == null || x === '' || (typeof x === 'object' && !Object.keys(x).length); const v = r && (!empty(r.response) ? r.response : (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content)); return empty(v) ? '' : (typeof v === 'string' ? v : JSON.stringify(v)); };

// LOOP-SHIP-1: the router's default cap (8,000 free neurons a day) stopped the code agent by noon on 2026-11-26: six orchestrator runs failed with
// 'daily free neurons used' and the loops merged nothing while sessions merged 13. The account is on Workers Paid, so neurons past the free 10,000
// are billed at about $0.011 per 1,000. The code agent gets its own cap (AI_CODE_NEURONS_DAY, default 150,000, roughly $1.50 a day), well inside the
// ~$5/day soft throttle; HALT and the budget governor still apply.
export function codeNeuronCap(env) { const n = Number(env && env.AI_CODE_NEURONS_DAY); return Number.isFinite(n) && n > 0 ? n : 150000; }

export async function invoke(env, adapter, prompt) {
  // AI-ROUTER-1: one adapter through core/airouter: identical prompts come from cache, cost and pass rate are recorded. The JSON check is the quality gate (a bad reply is never cached).
  const { max_tokens, ...extra } = adapter.extra || {};
  const r = await routeChat(env, { kind: 'codeagent', models: [{ id: adapter.id, model: adapter.model, extra }], messages: [{ role: 'user', content: prompt }], maxTokens: max_tokens || 3000, config: { neurons_day_cap: codeNeuronCap(env) }, verify: t => { parseJson(t); return true; } });
  return r.text;
}

// PATCH-EDIT-1 (worker side, mirrors foundation/agents.py): a reply may be JSON, or blocks: <<<FILE path>>> whole new file, <<<EDIT path>>> with <<<FIND>>> and <<<REPLACE>>>.
export const BLOCK_FORMAT = 'SUMMARY: one line\n<<<EDIT relative/path>>>\n<<<FIND>>>\na few lines copied exactly from the existing file\n<<<REPLACE>>>\nthe lines that replace them\n<<<END>>>\n'
  + '<<<FILE relative/path>>>\nfull content of a NEW file, written plainly with no escaping\n<<<END>>>\n(EDIT blocks for a file that exists, each FIND unique in the file; a FILE block only for a new file; nothing else in the reply)';
const FILE_RE = /<<<FILE ([^>\n]+)>>>\r?\n([\s\S]*?)\r?\n?<<<END>>>/g;
const EDIT_RE = /<<<EDIT ([^>\n]+)>>>\r?\n<<<FIND>>>\r?\n([\s\S]*?)\r?\n?<<<REPLACE>>>\r?\n?([\s\S]*?)\r?\n?<<<END>>>/g;

export function parseJson(t) {
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  let out = null;
  if (s >= 0 && e > s) { try { out = JSON.parse(t.slice(s, e + 1)); } catch (_) { out = null; } }
  if (out && typeof out === 'object' && (out.files || !/<<<(FILE|EDIT) /.test(t))) return out;
  const files = [], by = {};
  for (const m of t.matchAll(FILE_RE)) files.push({ path: m[1].trim(), content: m[2] + '\n' });
  for (const m of t.matchAll(EDIT_RE)) {
    const path = m[1].trim();
    if (!by[path]) { by[path] = { path, edits: [] }; files.push(by[path]); }
    by[path].edits.push({ find: m[2], replace: m[3] });
  }
  if (!files.length) throw new Error('no JSON or FILE/EDIT blocks in model answer');
  const sm = /^SUMMARY:\s*(.+)$/m.exec(t);
  return { summary: sm ? sm[1].trim() : '', files };
}

// The one place `find` names in `text`, replaced. Exact match first, then a match that ignores indentation (small models drop it), re-indenting the replacement.
export function applyEdit(text, find, replace, path = 'file') {
  if (!find.trim()) { if (text.trim()) throw new Error(`${path}: FIND is empty but the file exists`); return replace.endsWith('\n') ? replace : replace + '\n'; }
  const n = text.split(find).length - 1;
  if (n === 1) return text.replace(find, () => replace);
  if (n > 1) throw new Error(`${path}: the FIND text occurs ${n} times; add neighbouring lines so it is unique`);
  const want = find.replace(/^\n+|\n+$/g, '').split('\n').map(l => l.trim());
  const lines = text.split('\n');
  const hits = [];
  for (let i = 0; i + want.length <= lines.length; i++) if (want.every((w, k) => lines[i + k].trim() === w)) hits.push(i);
  if (hits.length !== 1) throw new Error(`${path}: the FIND text is not in the file (or matches more than one place); copy the lines exactly`);
  const i = hits[0], lead = l => l.slice(0, l.length - l.trimStart().length), f0 = find.replace(/^\n+/, '').split('\n')[0];
  const pad = lead(lines[i]).startsWith(lead(f0)) ? lead(lines[i]).slice(lead(f0).length) : '';
  const body = replace.replace(/^\n+|\n+$/g, '').split('\n').map(l => (l.trim() ? pad + l : l));
  lines.splice(i, want.length, ...(replace.trim() ? body : []));
  return lines.join('\n');
}

// Authors in routed order; a failure moves to the next adapter and is recorded in `tried`.
export async function runCodeAgent(env, prompt, adapters = ADAPTERS) {
  const tried = [];
  for (const a of [...adapters].sort((x, y) => x.price - y.price)) {
    try { return { ...parseJson(await invoke(env, a, prompt)), adapter: a.id, model: a.model, tried }; }
    catch (e) { tried.push({ adapter: a.id, error: String(e && e.message).slice(0, 120) }); }
  }
  throw new Error('no code agent produced a change: ' + JSON.stringify(tried));
}

// Live probe: one tiny call per adapter through the binding. Used by GET /agents/probe and by the deploy workflow's verify step.
export async function probe(env, adapters = ADAPTERS) {
  if (!env.AI) return { ok: false, detail: 'AI binding missing', adapters: [] };
  const out = [];
  for (const a of adapters) {
    try { const t = await invoke(env, { ...a, extra: { ...a.extra, max_tokens: 64 } }, 'Reply with the single word: pong'); out.push({ adapter: a.id, ok: t.trim().length > 0, answer: t.trim().slice(0, 24) }); }
    catch (e) { out.push({ adapter: a.id, ok: false, error: String(e && e.message).slice(0, 100) }); }
  }
  return { ok: out.some(x => x.ok), adapters: out };
}
