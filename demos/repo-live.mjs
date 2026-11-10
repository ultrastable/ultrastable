#!/usr/bin/env node
// Live view of this repository's own state: gap register, owner-only queue, recent ticks (commits) and gaplint result.
// PRIVATE demo: it reads internal records, so it is never part of the public bundle. Usage:
//   node demos/repo-live.mjs            # text summary
//   node demos/repo-live.mjs --html out.html   # self-contained page
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export function parseGaps(md) {
  const parts = md.split(/^## /m).slice(1), out = [];
  for (const p of parts) {
    const head = p.split("\n")[0]; const m = head.match(/(BG-\d+)/);
    if (!m) continue; const body = p.toLowerCase();
    const closed = /\bclosed\b/.test(head.toLowerCase()) || /status:\s*closed/.test(body);
    out.push({ id: m[1], title: head.replace(/^Owner card:\s*/, "").replace(/^BG-\d+:\s*/, "").replace(/\s*\(.*$/, "").trim() || head, state: closed ? "closed" : "open", hasProbe: body.includes("probe") });
  }
  return out;
}
export function parseOwnerTable(md) {
  const sec = md.split(/^## 4\./m)[1]; if (!sec) return [];
  return sec.split(/^## /m)[0].split("\n").filter((l) => l.startsWith("|") && !/^\|[-\s|]+\|?$/.test(l) && !/^\| Item/.test(l))
    .map((l) => { const c = l.split("|").map((x) => x.trim()).filter(Boolean); return { item: c[0], default: c[1] || "", probe: c[2] || "" }; });
}
export function commits(root, n = 12) {
  return execFileSync("git", ["-C", root, "log", `-${n}`, "--format=%h%x09%ad%x09%s", "--date=format:%Y-%m-%d %H:%M"], { encoding: "utf8" })
    .trim().split("\n").filter(Boolean).map((l) => { const [sha, when, subject] = l.split("\t"); return { sha, when, subject }; });
}
export function lint(root) {
  const r = spawnSync("python3", ["-m", "gaplint", root, "--json"], { encoding: "utf8", env: { ...process.env, PYTHONPATH: resolve(root, "products/gaplint") } });
  if (r.status !== 0 && r.status !== 1) return { error: (r.stderr || "gaplint failed").trim() };
  return { findings: JSON.parse(r.stdout) };
}
export function collect(root = ".") {
  root = resolve(root); const rd = (p) => (existsSync(resolve(root, p)) ? readFileSync(resolve(root, p), "utf8") : "");
  return { generated: new Date().toISOString(), gaps: parseGaps(rd("docs/BOOTSTRAP-GAPS.md")), ownerQueue: parseOwnerTable(rd("docs/PROJECT-MEMORY.md")), commits: commits(root), lint: lint(root) };
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
export function html(d) {
  const rows = (a, f) => a.map((x) => "<tr>" + f(x).map((c) => `<td>${esc(c)}</td>`).join("") + "</tr>").join("");
  const open = d.gaps.filter((g) => g.state === "open").length;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Repo live (private)</title><style>body{font:15px system-ui;margin:16px auto;max-width:960px;padding:0 16px;background:#f6f1e7;color:#14120f}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd5c5;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}h2{margin-top:24px}@media(prefers-color-scheme:dark){body{background:#0b1a15;color:#f6f1e7}td,th{border-color:#1f4a3c}}</style>
<h1>Repo live <small>(private, generated ${esc(d.generated)})</small></h1>
<p>${d.gaps.length} gaps (${open} open), ${d.ownerQueue.length} owner-only items, gaplint: ${d.lint.error ? "error " + esc(d.lint.error) : d.lint.findings.length + " finding(s)"}.</p>
<h2>Gap register</h2><table><tr><th>Id<th>Title<th>State<th>Probe</tr>${rows(d.gaps, (g) => [g.id, g.title, g.state, g.hasProbe ? "yes" : "NO"])}</table>
<h2>Owner-only queue (default in effect)</h2><table><tr><th>Item<th>Default<th>Closing probe</tr>${rows(d.ownerQueue, (o) => [o.item, o.default, o.probe])}</table>
<h2>Recent ticks</h2><table><tr><th>Commit<th>When<th>Subject</tr>${rows(d.commits, (c) => [c.sha, c.when, c.subject])}</table></html>`;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const d = collect("."); const i = process.argv.indexOf("--html");
  if (i > 0) { writeFileSync(process.argv[i + 1], html(d)); console.log("wrote", process.argv[i + 1]); }
  else { console.log(`gaps ${d.gaps.length} (${d.gaps.filter((g) => g.state === "open").length} open) | owner queue ${d.ownerQueue.length} | gaplint ${d.lint.error ? "error" : d.lint.findings.length + " findings"}`); d.commits.slice(0, 5).forEach((c) => console.log(" ", c.sha, c.subject)); }
}
