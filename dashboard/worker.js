// ultrastable-dashboard: the owner's single pane of glass for Ultrastable (DASH-1, 2026-11-10).
// Public side: a generic holding page only (project rule PF-1: nothing public about the mechanisms until the provisional is filed).
// Owner side (/owner): email-me-a-code login, at-a-glance status, owner task queue with one-tap Done/Snooze/Not doing/Fix/Hand to fleet,
// a command line that runs registered commands, step-up codes for changes, an audit log with undo, and owner email notifications.
// Portable core: every platform touch goes through env.DB (SQL), env.SEND_EMAIL (mail) and fetch, so a Google Cloud adapter only
// has to supply those three. Cloudflare adapter = this file + wrangler.toml.
const VERSION = "0.1.0";
const COOKIE = "us_owner";
const OTP_MS = 10 * 60e3, SESSION_MS = 30 * 864e5, STEPUP_MS = 15 * 60e3;
const HOSTS = ["ultrastable.io", "ultrastable.app", "ultrastable.net"];
// Words that must never appear on the public pages before filing (disclosure guard, checked by the cron probe).
const GUARD_WORDS = ["probe", "revert", "prediction", "trust ledger", "plussing", "work claim", "virtual manager", "self-governing"];

const enc = new TextEncoder();
export async function sha256(s) { const b = await crypto.subtle.digest("SHA-256", enc.encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join(""); }
export function hex(n) { return [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, "0")).join(""); }
export function constEq(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function cookie(req, name) { const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + name + "=([^;]+)")); return m ? m[1] : ""; }
const SEC = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };
function json(o, status = 200, extra) { return new Response(JSON.stringify(o), { status, headers: { "Content-Type": "application/json", ...SEC, ...(extra || {}) } }); }
function page(html, status = 200) { return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", ...SEC, "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'" } }); }

// ---------- mail (owner notifications and codes) ----------
export async function sendMail(env, subject, text) {
  if (!env.OWNER_EMAIL) throw new Error("OWNER_EMAIL is not set");
  const from = env.MAIL_FROM || "owner@ultrastable.io";
  if (env.MAILER) return env.MAILER({ from, to: env.OWNER_EMAIL, subject, text });
  if (!env.SEND_EMAIL) throw new Error("SEND_EMAIL binding is missing");
  const { EmailMessage } = await import("cloudflare:email");
  const raw = ["From: Ultrastable <" + from + ">", "To: " + env.OWNER_EMAIL, "Subject: " + subject, "Message-ID: <" + hex(12) + "@ultrastable.io>", "Date: " + new Date().toUTCString(), "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", text].join("\r\n");
  await env.SEND_EMAIL.send(new EmailMessage(from, env.OWNER_EMAIL, raw));
}
async function notify(env, key, subject, text) {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO notifications(key,at,subject) VALUES(?1,?2,?3)").bind(key, Date.now(), subject).run();
  if (!r.meta || r.meta.changes === 0) return false;
  try { await sendMail(env, subject, text); await env.DB.prepare("UPDATE notifications SET sent=1 WHERE key=?1").bind(key).run(); return true; }
  catch (e) { await env.DB.prepare("UPDATE notifications SET error=?2 WHERE key=?1").bind(key, String(e.message || e).slice(0, 300)).run(); return false; }
}

// ---------- login by emailed code ----------
export async function requestCode(env) {
  const now = Date.now();
  const n = (await env.DB.prepare("SELECT COUNT(*) c FROM otp WHERE created_at>?1").bind(now - OTP_MS).first()).c;
  if (n >= 5) return { status: 429, body: { error: "too many codes requested; wait 10 minutes" } };
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, "0");
  const id = hex(16);
  await env.DB.prepare("UPDATE otp SET used=1 WHERE used=0").run();
  await env.DB.prepare("INSERT INTO otp(id,code_hash,created_at,expires_at,attempts,used) VALUES(?1,?2,?3,?4,0,0)").bind(id, await sha256(id + ":" + code), now, now + OTP_MS).run();
  try { await sendMail(env, "Your Ultrastable code: " + code, "Your Ultrastable owner code is " + code + ".\nIt works for 10 minutes. If you did not ask for it, ignore this message.\n"); }
  catch (e) { await env.DB.prepare("UPDATE otp SET used=1 WHERE id=?1").bind(id).run(); console.error("mail failed", e && e.message); return { status: 502, body: { error: "could not send the code email" } }; }
  return { status: 200, body: { ok: true, sent: true } };
}
export async function verifyCode(env, req, code) {
  const now = Date.now();
  if (!/^\d{6}$/.test(String(code || ""))) return { status: 400, body: { error: "enter the 6-digit code" } };
  const fails = (await env.DB.prepare("SELECT COUNT(*) c FROM otp WHERE created_at>?1 AND attempts>0").bind(now - OTP_MS).first()).c;
  if (fails >= 4) return { status: 429, body: { error: "too many wrong codes; wait 10 minutes" } };
  const row = await env.DB.prepare("SELECT * FROM otp WHERE used=0 AND expires_at>?1 ORDER BY created_at DESC LIMIT 1").bind(now).first();
  if (!row) return { status: 401, body: { error: "no valid code; email yourself a new one" } };
  if (row.attempts >= 5) return { status: 429, body: { error: "too many wrong codes; request a new one" } };
  if (!constEq(await sha256(row.id + ":" + code), row.code_hash)) {
    await env.DB.prepare("UPDATE otp SET attempts=attempts+1 WHERE id=?1").bind(row.id).run();
    return { status: 401, body: { error: "wrong code" } };
  }
  await env.DB.prepare("UPDATE otp SET used=1 WHERE id=?1").bind(row.id).run();
  const cur = await getSession(env, req);
  if (cur) { await env.DB.prepare("UPDATE sessions SET stepup_at=?2 WHERE hash=?1").bind(cur.hash, now).run(); return { status: 200, body: { ok: true, stepup: true } }; }
  const tok = hex(32);
  await env.DB.prepare("INSERT INTO sessions(hash,created_at,stepup_at,revoked) VALUES(?1,?2,?2,0)").bind(await sha256(tok), now).run();
  return { status: 200, body: { ok: true }, cookie: COOKIE + "=" + tok + "; Path=/; Max-Age=" + (SESSION_MS / 1000) + "; HttpOnly; Secure; SameSite=Strict" };
}
export async function getSession(env, req) {
  const tok = cookie(req, COOKIE); if (!tok) return null;
  const h = await sha256(tok);
  const r = await env.DB.prepare("SELECT hash,created_at,stepup_at,revoked FROM sessions WHERE hash=?1").bind(h).first();
  if (!r || r.revoked || Date.now() - r.created_at > SESSION_MS) return null;
  return { hash: h, fresh: Date.now() - r.stepup_at < STEPUP_MS };
}

// ---------- probes (at-a-glance status) ----------
async function setCheck(env, name, ok, detail) {
  await env.DB.prepare("INSERT INTO checks(name,ok,detail,at) VALUES(?1,?2,?3,?4) ON CONFLICT(name) DO UPDATE SET ok=?2,detail=?3,at=?4").bind(name, ok ? 1 : 0, String(detail).slice(0, 300), Date.now()).run();
}
export async function runProbes(env) {
  const out = [];
  const rec = async (n, ok, d) => { await setCheck(env, n, ok, d); out.push({ name: n, ok, detail: d }); };
  try { await env.DB.prepare("SELECT 1").first(); await rec("database", true, "D1 answers"); } catch (e) { await rec("database", false, String(e.message || e)); }
  await rec("owner_email", !!(env.OWNER_EMAIL && (env.SEND_EMAIL || env.MAILER)), env.OWNER_EMAIL ? "owner address and sender configured" : "OWNER_EMAIL missing");
  if (!env.NO_NET) {
    for (const h of HOSTS) {
      try { const r = await fetch("https://" + h + "/health", { signal: AbortSignal.timeout(5000) }); const j = await r.json(); await rec("site:" + h, r.status === 200 && j.ok === true, "HTTP " + r.status + (j.version ? " v" + j.version : "")); }
      catch (e) { await rec("site:" + h, false, String(e.message || e)); }
    }
    try {
      const r = await fetch("https://" + HOSTS[0] + "/", { signal: AbortSignal.timeout(5000) }); const t = (await r.text()).toLowerCase();
      const hit = GUARD_WORDS.filter(w => t.includes(w));
      await rec("disclosure_guard", hit.length === 0, hit.length ? "public page contains: " + hit.join(", ") : "public page carries no mechanism words");
    } catch (e) { await rec("disclosure_guard", false, String(e.message || e)); }
    if (env.GITHUB_TOKEN) {
      try { const r = await gh(env, "GET", ""); await rec("github", r.ok, "repo API HTTP " + r.status); } catch (e) { await rec("github", false, String(e.message || e)); }
    } else await rec("github", false, "no GITHUB_TOKEN set: issues are not syncing (owner task own-gh-token)");
  }
  return out;
}

// ---------- GitHub (optional; needs a GITHUB_TOKEN secret) ----------
function gh(env, method, path, body) {
  const repo = env.GITHUB_REPO || "ultrastable/ultrastable";
  return fetch("https://api.github.com/repos/" + repo + path, { method, headers: { authorization: "Bearer " + env.GITHUB_TOKEN, accept: "application/vnd.github+json", "user-agent": "ultrastable-dashboard", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(8000) });
}
async function syncIssues(env) {
  if (!env.GITHUB_TOKEN) return { ok: false, out: "No GITHUB_TOKEN secret is set on this dashboard, so issues cannot be read. Tasks shown are the seeded copy." };
  const r = await gh(env, "GET", "/issues?state=open&per_page=100"); if (!r.ok) return { ok: false, out: "GitHub answered HTTP " + r.status };
  const list = (await r.json()).filter(i => !i.pull_request && !/^Project board:/.test(i.title));
  const now = Date.now(); const seen = new Set();
  for (const i of list) {
    const id = "gh-" + i.number, labels = (i.labels || []).map(l => l.name), ownerOnly = /\bROWAN\b/.test(i.body || "") && /Owner:\*\*[^\n]*ROWAN/.test(i.body || "") || labels.includes("legal");
    seen.add(id);
    await env.DB.prepare("INSERT INTO tasks(id,title,area,kind,state,why,url,source,priority,updated_at) VALUES(?1,?2,?3,?4,'open',?5,?6,'github',?7,?8) ON CONFLICT(id) DO UPDATE SET title=?2,area=?3,url=?6,updated_at=?8").bind(id, i.title.slice(0, 200), labels.filter(l => l.startsWith("ws:") || l.startsWith("m:")).join(" "), ownerOnly ? "owner" : "fleet", (i.body || "").replace(/\s+/g, " ").slice(0, 280), i.html_url, labels.includes("now") || labels.includes("m:Now") ? 1 : 5, now).run();
  }
  const open = (await env.DB.prepare("SELECT id FROM tasks WHERE source='github' AND state IN ('open','delegated','snoozed')").all()).results;
  let closed = 0; for (const t of open) if (!seen.has(t.id)) { await env.DB.prepare("UPDATE tasks SET state='done',updated_at=?2 WHERE id=?1").bind(t.id, now).run(); closed++; }
  return { ok: true, out: "Synced " + list.length + " open issues; " + closed + " closed upstream." };
}

// ---------- commands (the one execution path for typed commands and one-tap buttons) ----------
const fmtTask = t => t.id + " [" + t.kind + "|" + t.state + "] " + t.title;
async function getTask(env, id) { return env.DB.prepare("SELECT * FROM tasks WHERE id=?1").bind(id).first(); }
async function setState(ctx, id, state, snoozeUntil) {
  const t = await getTask(ctx.env, id); if (!t) return { ok: false, out: "No task " + id };
  await ctx.env.DB.prepare("UPDATE tasks SET state=?2,snooze_until=?3,updated_at=?4 WHERE id=?1").bind(id, state, snoozeUntil || null, Date.now()).run();
  ctx.undo = { task: id, state: t.state, snooze_until: t.snooze_until };
  return { ok: true, out: id + " is now " + state + "." };
}
const COMMANDS = {
  help: { mut: false, doc: "list commands", run: async () => ({ ok: true, out: Object.entries(COMMANDS).map(([k, v]) => k.padEnd(10) + (v.mut ? "* " : "  ") + v.doc).join("\n") + "\n* needs a code emailed in the last 15 minutes" }) },
  whoami: { mut: false, doc: "show session", run: async c => ({ ok: true, out: "owner session; step-up " + (c.fresh ? "active" : "not active") + "; version " + VERSION }) },
  status: { mut: false, doc: "checks and task counts", run: async c => { const s = await stateOf(c.env); return { ok: true, out: s.checks.map(k => (k.ok ? "ok   " : "FAIL ") + k.name + " - " + k.detail).join("\n") + "\nowner tasks open: " + s.counts.owner + ", fleet tasks open: " + s.counts.fleet + ", queued for fleet: " + s.counts.queued }; } },
  tasks: { mut: false, doc: "tasks [owner|fleet|all]", run: async (c, a) => { const k = a[0] || "all"; const r = (await c.env.DB.prepare("SELECT * FROM tasks WHERE state IN ('open','delegated') AND (?1='all' OR kind=?1) ORDER BY priority,id LIMIT 60").bind(k).all()).results; return { ok: true, out: r.length ? r.map(fmtTask).join("\n") : "Nothing open." }; } },
  task: { mut: false, doc: "task <id>", run: async (c, a) => { const t = await getTask(c.env, a[0]); return t ? { ok: true, out: fmtTask(t) + "\n" + (t.why || "") + "\n" + (t.url || "") } : { ok: false, out: "No task " + a[0] }; } },
  audit: { mut: false, doc: "audit [n]", run: async (c, a) => { const r = (await c.env.DB.prepare("SELECT id,at,cmd,ok FROM audit ORDER BY id DESC LIMIT ?1").bind(Math.min(+a[0] || 10, 50)).all()).results; return { ok: true, out: r.map(x => x.id + " " + new Date(x.at).toISOString().slice(0, 19) + " " + (x.ok ? "ok " : "err") + " " + x.cmd).join("\n") || "Empty." }; } },
  probe: { mut: false, doc: "run all checks now", run: async c => { const r = await runProbes(c.env); return { ok: r.every(x => x.ok), out: r.map(x => (x.ok ? "ok   " : "FAIL ") + x.name + " - " + x.detail).join("\n") }; } },
  done: { mut: true, doc: "done <id>", run: (c, a) => setState(c, a[0], "done") },
  snooze: { mut: true, doc: "snooze <id> [days]", run: (c, a) => setState(c, a[0], "snoozed", Date.now() + (+a[1] || 3) * 864e5) },
  dismiss: { mut: true, doc: "dismiss <id> (not doing)", run: (c, a) => setState(c, a[0], "dismissed") },
  delegate: { mut: true, doc: "delegate <id>: hand to the fleet", run: async (c, a) => {
    const t = await getTask(c.env, a[0]); if (!t) return { ok: false, out: "No task " + a[0] };
    if (t.kind === "owner" && t.identity) return { ok: false, out: t.id + " is identity-bound (money, signature, legal or account step); only the owner can do it." };
    const r = await c.env.DB.prepare("INSERT INTO fleet_queue(task_id,status,queued_at) VALUES(?1,'queued',?2)").bind(t.id, Date.now()).run();
    await setState(c, t.id, "delegated"); c.undo.queue = r.meta && r.meta.last_row_id;
    let extra = ""; const m = /^gh-(\d+)$/.exec(t.id);
    if (m && c.env.GITHUB_TOKEN) { const g = await gh(c.env, "POST", "/issues/" + m[1] + "/labels", { labels: ["fleet"] }); extra = " Labeled fleet on GitHub (HTTP " + g.status + ")."; }
    return { ok: true, out: t.id + " queued for the fleet." + extra };
  } },
  fix: { mut: true, doc: "fix <id>: run its fix, else hand to fleet", run: async (c, a) => {
    const t = await getTask(c.env, a[0]); if (!t) return { ok: false, out: "No task " + a[0] };
    if (t.fix_cmd) { const [n, ...r] = t.fix_cmd.split(/\s+/); const res = await COMMANDS[n].run(c, r); if (res.ok) await setState(c, t.id, "done"); return { ok: res.ok, out: "fix: " + t.fix_cmd + "\n" + res.out }; }
    return COMMANDS.delegate.run(c, a);
  } },
  sync: { mut: true, doc: "pull open GitHub issues into tasks", run: async c => syncIssues(c.env) },
  dispatch: { mut: true, doc: "dispatch <workflow.yml>: run a GitHub Actions workflow", run: async (c, a) => {
    if (!c.env.GITHUB_TOKEN) return { ok: false, out: "No GITHUB_TOKEN secret is set." };
    if (!/^[\w.-]+\.ya?ml$/.test(a[0] || "")) return { ok: false, out: "Give a workflow file name such as index.yml." };
    const r = await gh(c.env, "POST", "/actions/workflows/" + a[0] + "/dispatches", { ref: "main" }); return { ok: r.status === 204, out: "GitHub answered HTTP " + r.status };
  } },
  note: { mut: true, doc: "note <text>: add an owner note as a task", run: async (c, a) => { const id = "note-" + Date.now().toString(36); await c.env.DB.prepare("INSERT INTO tasks(id,title,kind,state,source,priority,updated_at) VALUES(?1,?2,'fleet','open','owner-note',3,?3)").bind(id, a.join(" ").slice(0, 200), Date.now()).run(); c.undo = { task: id, remove: 1 }; return { ok: true, out: "Added " + id + "." }; } },
  "notify-test": { mut: true, doc: "email the owner a test message", run: async c => { await sendMail(c.env, "Ultrastable test notification", "The dashboard can email you. Sent " + new Date().toISOString()); return { ok: true, out: "Test email sent." }; } },
  undo: { mut: true, doc: "undo the last change", run: async c => {
    const a = await c.env.DB.prepare("SELECT id,undo FROM audit WHERE undo IS NOT NULL AND undone=0 ORDER BY id DESC LIMIT 1").first(); if (!a) return { ok: false, out: "Nothing to undo." };
    const u = JSON.parse(a.undo);
    if (u.remove) await c.env.DB.prepare("DELETE FROM tasks WHERE id=?1").bind(u.task).run();
    else await c.env.DB.prepare("UPDATE tasks SET state=?2,snooze_until=?3,updated_at=?4 WHERE id=?1").bind(u.task, u.state, u.snooze_until || null, Date.now()).run();
    if (u.queue) await c.env.DB.prepare("DELETE FROM fleet_queue WHERE id=?1 AND status='queued'").bind(u.queue).run();
    await c.env.DB.prepare("UPDATE audit SET undone=1 WHERE id=?1").bind(a.id).run(); return { ok: true, out: "Undid audit " + a.id + "." };
  } },
};

export async function runCommand(env, session, line) {
  const parts = String(line || "").trim().split(/\s+/).filter(Boolean); if (!parts.length) return { status: 400, body: { error: "empty command" } };
  const cmd = COMMANDS[parts[0]]; if (!cmd) return { status: 404, body: { ok: false, out: "Unknown command. Type help." } };
  if (cmd.mut && !session.fresh) return { status: 200, body: { ok: false, needs_code: true, out: "This changes things, so it needs a code emailed in the last 15 minutes." } };
  const ctx = { env, fresh: session.fresh, undo: null }; let res;
  try { res = await cmd.run(ctx, parts.slice(1)); } catch (e) { res = { ok: false, out: "error: " + String(e.message || e).slice(0, 200) }; }
  await env.DB.prepare("INSERT INTO audit(at,cmd,ok,result,undo) VALUES(?1,?2,?3,?4,?5)").bind(Date.now(), line.slice(0, 200), res.ok ? 1 : 0, String(res.out).slice(0, 500), ctx.undo ? JSON.stringify(ctx.undo) : null).run();
  return { status: 200, body: res };
}

// ---------- state for the dashboard ----------
export async function stateOf(env) {
  const now = Date.now();
  await env.DB.prepare("UPDATE tasks SET state='open' WHERE state='snoozed' AND snooze_until<?1").bind(now).run();
  const q = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
  const checks = await q("SELECT name,ok,detail,at FROM checks ORDER BY ok,name");
  const owner = await q("SELECT id,title,why,if_wait,url,identity,fix_cmd,priority,state FROM tasks WHERE kind='owner' AND state='open' ORDER BY priority,id");
  const fleet = await q("SELECT id,title,area,url,fix_cmd,state FROM tasks WHERE kind='fleet' AND state IN ('open','delegated') ORDER BY state DESC,priority,id LIMIT 80");
  const c = k => env.DB.prepare("SELECT COUNT(*) c FROM tasks WHERE kind=?1 AND state='open'").bind(k).first().then(r => r.c);
  const queued = (await env.DB.prepare("SELECT COUNT(*) c FROM fleet_queue WHERE status='queued'").first()).c;
  const done = (await env.DB.prepare("SELECT COUNT(*) c FROM tasks WHERE state='done'").first()).c;
  const audit = await q("SELECT id,at,cmd,ok FROM audit ORDER BY id DESC LIMIT 8");
  const notes = await q("SELECT at,subject,sent,error FROM notifications ORDER BY at DESC LIMIT 6");
  return { version: VERSION, checks, owner, fleet, counts: { owner: await c("owner"), fleet: await c("fleet"), queued, done }, audit, notes, gate: "Public pages: generic holding page only, noindex, until the provisional is filed." };
}

// ---------- scheduled tick: probes, notifications, daily digest ----------
export async function tick(env, cron) {
  const res = await runProbes(env); const day = new Date().toISOString().slice(0, 10);
  for (const r of res.filter(x => !x.ok && x.name !== "github")) await notify(env, "fail:" + r.name + ":" + day, "Ultrastable check failing: " + r.name, r.name + " failed: " + r.detail + "\nOpen https://ultrastable.io/owner");
  const fresh = (await env.DB.prepare("SELECT id,title FROM tasks WHERE kind='owner' AND state='open' AND id NOT IN (SELECT substr(key,6) FROM notifications WHERE key LIKE 'task:%') ORDER BY priority LIMIT 50").all()).results;
  if (fresh.length) {
    const sent = await notify(env, "task:" + fresh[0].id, fresh.length + " new item(s) in your Ultrastable queue", fresh.map(t => "- " + t.title).join("\n") + "\nOpen https://ultrastable.io/owner and tap Done, Snooze or Hand to fleet.");
    if (sent) for (const t of fresh.slice(1)) await env.DB.prepare("INSERT OR IGNORE INTO notifications(key,at,subject,sent) VALUES(?1,?2,'(grouped)',1)").bind("task:" + t.id, Date.now()).run();
  }
  if (cron === "0 13 * * *") { const s = await stateOf(env); await notify(env, "digest:" + day, "Ultrastable daily digest", s.checks.map(k => (k.ok ? "ok   " : "FAIL ") + k.name + " - " + k.detail).join("\n") + "\n\nOwner queue: " + s.counts.owner + " open. Fleet: " + s.counts.fleet + " open, " + s.counts.queued + " queued, " + s.counts.done + " done.\nhttps://ultrastable.io/owner"); }
}

// ---------- pages ----------
const THEME = ":root{color-scheme:light dark;--bg:#f6f7f9;--sf:#fff;--ink:#14181f;--ink2:#515b69;--line:#d9dee6;--ac:#0b5fff;--on:#fff;--good:#0a7a3d;--bad:#b3261e;--warn:#8a5a00}@media(prefers-color-scheme:dark){:root{--bg:#0e1116;--sf:#161b22;--ink:#eef1f5;--ink2:#a9b3c1;--line:#2c3541;--ac:#6ea0ff;--on:#0e1116;--good:#4cc38a;--bad:#ff8a80;--warn:#f0b64a}}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}";
const FAVICON = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 64 64\"><rect width=\"64\" height=\"64\" rx=\"14\" fill=\"#0B5FFF\"/><path d=\"M20 13v21a12 12 0 0 0 24 0V13\" fill=\"none\" stroke=\"#fff\" stroke-width=\"7\" stroke-linecap=\"round\"/><circle cx=\"32\" cy=\"27\" r=\"4.5\" fill=\"#9DC1FF\"/></svg>";
const ICON = "<link rel=\"icon\" href=\"/favicon.svg\" type=\"image/svg+xml\">";
const LOGO = "<img src=\"/favicon.svg\" alt=\"\" width=\"40\" height=\"40\" style=\"vertical-align:middle;margin-right:10px\">";
function publicPage() {
  return page("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>Ultrastable</title>" + ICON + "<style>" + THEME + "main{min-height:100vh;display:grid;place-content:center;text-align:center;padding:16px}h1{font-size:34px;margin:0 0 8px}p{color:var(--ink2);margin:0}</style></head><body><main><h1>" + LOGO + "Ultrastable</h1><p>Software that stays up.</p><p style=\"margin-top:8px\">Coming soon.</p></main></body></html>");
}
const OWNER_CSS = "main{max-width:980px;margin:0 auto;padding:16px 16px 80px}h1{font-size:22px;margin:0}h2{font-size:17px;margin:24px 0 8px}.top{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.sp{margin-left:auto}.card{background:var(--sf);border:1px solid var(--line);border-radius:14px;padding:14px;margin:0 0 10px}.card h3{margin:0 0 4px;font-size:16px}.meta{color:var(--ink2);font-size:14px}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}button,.btn{min-height:48px;min-width:48px;padding:10px 16px;border-radius:10px;border:1px solid var(--line);background:var(--sf);color:var(--ink);font:600 15px system-ui;cursor:pointer}button.p{background:var(--ac);border-color:var(--ac);color:var(--on)}input{min-height:48px;padding:10px 12px;border-radius:10px;border:1px solid var(--line);background:var(--sf);color:var(--ink);font:16px system-ui;width:100%}.grid{display:grid;gap:8px;grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}.ok{color:var(--good);font-weight:700}.bad{color:var(--bad);font-weight:700}pre{background:var(--sf);border:1px solid var(--line);border-radius:10px;padding:10px;white-space:pre-wrap;word-break:break-word;font-size:13px;max-height:280px;overflow:auto;margin:8px 0 0}.pill{border-radius:99px;padding:4px 12px;font-weight:700;font-size:14px;border:1px solid var(--line)}.tag{font-size:12px;color:var(--warn);font-weight:700}a{color:var(--ac)}:focus-visible{outline:3px solid var(--ac);outline-offset:2px}";
const OWNER_JS = `
const $=s=>document.querySelector(s);const E=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function api(p,b){const r=await fetch(p,{method:b?'POST':'GET',headers:b?{'content-type':'application/json','x-us-ui':'1'}:{},body:b?JSON.stringify(b):undefined,credentials:'same-origin'});let j={};try{j=await r.json()}catch(e){}return{s:r.status,j}}
let pending=null;
function codeBox(msg,after){$('#gate').innerHTML='<div class="card"><h3>'+E(msg)+'</h3><div class="row"><button class="p" id="send">Email me a code</button></div><div id="cbox" class="row" hidden><input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="6-digit code" aria-label="6-digit code"><button class="p" id="ver">Verify</button></div><p class="meta" id="gm" role="status"></p></div>';
$('#send').onclick=async()=>{$('#gm').textContent='Sending...';const r=await api('/api/owner/code',{});$('#gm').textContent=r.s==200?'Code sent. Check your inbox.':(r.j.error||'Could not send.');if(r.s==200){$('#cbox').hidden=false;$('#code').focus()}};
$('#ver').onclick=async()=>{const r=await api('/api/owner/verify',{code:$('#code').value});if(r.s==200){$('#gate').innerHTML='';after()}else $('#gm').textContent=r.j.error||'Wrong code.'}}
async function run(line,quiet){const r=await api('/api/owner/run',{cmd:line});if(r.j.needs_code){pending=line;codeBox('Confirm it is you: email yourself a code to make this change.',async()=>{const l=pending;pending=null;await run(l)});return}
if(!quiet){$('#out').textContent='> '+line+'\\n'+(r.j.out||r.j.error||'')}await load();return r}
function task(t,own){const id=E(t.id);return '<div class="card"><h3>'+E(t.title)+'</h3>'+(t.identity?'<div class="tag">ONLY YOU CAN DO THIS</div>':'')+(t.why?'<div class="meta">'+E(t.why)+'</div>':'')+(t.if_wait?'<div class="meta"><b>If you wait:</b> '+E(t.if_wait)+'</div>':'')+(t.url?'<div class="meta"><a href="'+E(t.url)+'" rel="noopener">Open</a></div>':'')+'<div class="row"><button class="p" data-c="done '+id+'">Done</button>'+(t.identity?'':'<button data-c="fix '+id+'">'+(t.fix_cmd?'Fix it':'Hand to fleet')+'</button>')+'<button data-c="snooze '+id+' 3">Snooze 3d</button><button data-c="snooze '+id+' 7">7d</button><button data-c="dismiss '+id+'">Not doing</button></div></div>'}
async function load(){const r=await api('/api/owner/state');if(r.s==401){$('#app').hidden=true;codeBox('Owner sign-in. A code is emailed to the owner address.',load);return}
$('#app').hidden=false;const s=r.j;const bad=s.checks.filter(c=>!c.ok).length;
$('#pill').textContent=bad?bad+' check'+(bad>1?'s':'')+' failing':'All checks passing';$('#pill').className='pill '+(bad?'bad':'ok');
$('#checks').innerHTML=s.checks.map(c=>'<div class="card"><span class="'+(c.ok?'ok':'bad')+'">'+(c.ok?'OK':'FAIL')+'</span> <b>'+E(c.name)+'</b><div class="meta">'+E(c.detail)+'</div></div>').join('')||'<p class="meta">No checks yet. Type probe.</p>';
$('#counts').textContent='Your queue: '+s.counts.owner+' open. Fleet: '+s.counts.fleet+' open, '+s.counts.queued+' queued, '+s.counts.done+' done.';
$('#owner').innerHTML=s.owner.map(t=>task(t,1)).join('')||'<p class="meta">Nothing waiting on you.</p>';
$('#fleet').innerHTML=s.fleet.map(t=>'<div class="card"><b>'+E(t.title)+'</b> <span class="meta">'+E(t.area||'')+(t.state=='delegated'?' · with the fleet':'')+'</span><div class="row">'+(t.state=='delegated'?'':'<button data-c="fix '+E(t.id)+'">'+(t.fix_cmd?'Fix it':'Hand to fleet')+'</button>')+'<button data-c="done '+E(t.id)+'">Done</button><button data-c="dismiss '+E(t.id)+'">Not doing</button>'+(t.url?'<a class="btn" href="'+E(t.url)+'" rel="noopener">Open</a>':'')+'</div></div>').join('')||'<p class="meta">No fleet tasks.</p>';
$('#audit').textContent=s.audit.map(a=>a.id+' '+new Date(a.at).toISOString().slice(0,19)+' '+(a.ok?'ok ':'err')+' '+a.cmd).join('\\n')||'Empty.';
$('#notes').textContent=s.notes.map(n=>new Date(n.at).toISOString().slice(0,16)+' '+(n.sent?'sent':'FAILED '+(n.error||''))+' '+n.subject).join('\\n')||'None yet.';
$('#gate').dataset.gate=s.gate;$('#gatetxt').textContent=s.gate;
document.querySelectorAll('[data-c]').forEach(b=>b.onclick=()=>run(b.dataset.c))}
$('#cmd').onsubmit=e=>{e.preventDefault();const v=$('#line').value.trim();if(v){run(v);$('#line').value=''}};
$('#logout').onclick=async()=>{await api('/api/owner/logout',{});location.reload()};
load();`;
function ownerPage() {
  return page("<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>Ultrastable owner</title>" + ICON + "<style>" + THEME + OWNER_CSS + "</style></head><body><main><div class=\"top\"><h1>" + LOGO + "Ultrastable</h1><span id=\"pill\" class=\"pill\" role=\"status\">Loading</span><button class=\"sp\" id=\"logout\">Sign out</button></div><div id=\"gate\"></div><div id=\"app\" hidden><p class=\"meta\" id=\"gatetxt\"></p><p class=\"meta\" id=\"counts\"></p><h2>Needs you</h2><div id=\"owner\"></div><h2>Status</h2><div id=\"checks\" class=\"grid\"></div><h2>Fleet tasks</h2><div id=\"fleet\"></div><h2>Command line</h2><form id=\"cmd\"><div class=\"row\"><input id=\"line\" placeholder=\"type help\" aria-label=\"command\" autocapitalize=\"off\" autocomplete=\"off\"><button class=\"p\">Run</button></div></form><pre id=\"out\">Commands marked * ask for a fresh emailed code.</pre><h2>Audit log</h2><pre id=\"audit\"></pre><h2>Owner emails sent</h2><pre id=\"notes\"></pre></div></main><script>" + OWNER_JS + "</script></body></html>");
}

// ---------- router ----------
export async function route(req, env) {
  const u = new URL(req.url), p = u.pathname.replace(/\/$/, "") || "/";
  if (p === "/health") return json({ ok: true, worker: "ultrastable-dashboard", version: VERSION });
  if (p === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });
  if (p === "/favicon.svg") return new Response(FAVICON, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
  if (p === "/") return publicPage();
  if (p === "/owner") return ownerPage();
  if (p.startsWith("/api/owner/")) {
    if (req.method === "POST" && req.headers.get("x-us-ui") !== "1") return json({ error: "missing x-us-ui header" }, 400);
    if (p === "/api/owner/code" && req.method === "POST") { const r = await requestCode(env); return json(r.body, r.status); }
    if (p === "/api/owner/verify" && req.method === "POST") { let b = {}; try { b = await req.json(); } catch (e) { } const r = await verifyCode(env, req, b.code); return json(r.body, r.status, r.cookie ? { "Set-Cookie": r.cookie } : undefined); }
    const s = await getSession(env, req); if (!s) return json({ error: "sign in" }, 401);
    if (p === "/api/owner/logout" && req.method === "POST") { await env.DB.prepare("UPDATE sessions SET revoked=1 WHERE hash=?1").bind(s.hash).run(); return json({ ok: true }, 200, { "Set-Cookie": COOKIE + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict" }); }
    if (p === "/api/owner/state") return json(await stateOf(env));
    if (p === "/api/owner/run" && req.method === "POST") { let b = {}; try { b = await req.json(); } catch (e) { } const r = await runCommand(env, s, b.cmd); return json(r.body, r.status); }
    return json({ error: "not found" }, 404);
  }
  if (p.startsWith("/api/fleet/") && env.FLEET_TOKEN) {
    const ok = constEq(await sha256(req.headers.get("authorization") || ""), await sha256("Bearer " + env.FLEET_TOKEN)); if (!ok) return json({ error: "unauthorized" }, 401);
    if (p === "/api/fleet/queue") return json({ queue: (await env.DB.prepare("SELECT q.id,q.task_id,t.title,t.url,t.why FROM fleet_queue q JOIN tasks t ON t.id=q.task_id WHERE q.status='queued' ORDER BY q.id LIMIT 20").all()).results });
    if (p === "/api/fleet/ack" && req.method === "POST") { const b = await req.json(); await env.DB.prepare("UPDATE fleet_queue SET status=?2,result=?3,done_at=?4 WHERE id=?1").bind(+b.id, b.status === "done" ? "done" : "failed", String(b.result || "").slice(0, 500), Date.now()).run(); if (b.status === "done") await env.DB.prepare("UPDATE tasks SET state='done',updated_at=?2 WHERE id=(SELECT task_id FROM fleet_queue WHERE id=?1)").bind(+b.id, Date.now()).run(); return json({ ok: true }); }
  }
  return page("<!doctype html><meta charset=utf-8><meta name=robots content=noindex><title>Not found</title><p>Not found.</p>", 404);
}
export default {
  async fetch(req, env) { try { return await route(req, env); } catch (e) { console.error("unhandled", e && e.stack || e); return json({ error: "internal" }, 500); } },
  async scheduled(ev, env, ctx) { ctx.waitUntil(tick(env, ev.cron).catch(e => console.error("tick", e && e.stack || e))); }
};
