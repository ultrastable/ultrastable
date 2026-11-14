// RUNS-ON-1 build: bundles src/contract.json, src/shell.css and src/shell.js into artifact/ultrastable-shell.{css,js,json}.
//   node brand/shell/build.mjs           write artifact/
//   node brand/shell/build.mjs --check   write nothing; exit 1 when artifact/ is stale
// Hashes are sha256 over LF text. content_hash = sha256(css + "\n" + js). An instance that vendors artifact/ proves parity against content_hash.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const lf = (s) => s.replace(/\r\n/g, "\n");
export const sha = (s) => createHash("sha256").update(lf(s), "utf8").digest("hex");

export function build() {
  const contract = JSON.parse(readFileSync(here("src/contract.json"), "utf8"));
  const css = lf(readFileSync(here("src/shell.css"), "utf8")).trimEnd() + "\n";
  const inline = Object.assign({}, contract);
  delete inline._doc;
  const src = lf(readFileSync(here("src/shell.js"), "utf8"));
  if (!src.includes('"__US_CSS__"') || !src.includes("__US_CONTRACT__")) throw new Error("src/shell.js lost its placeholders");
  const js = src.replace('"__US_CSS__"', () => JSON.stringify(css.trimEnd())).replace("__US_CONTRACT__", () => JSON.stringify(inline)).trimEnd() + "\n";
  const json = JSON.stringify(Object.assign({}, contract, {
    files: { css: "ultrastable-shell.css", js: "ultrastable-shell.js" },
    css_sha256: sha(css), js_sha256: sha(js), content_hash: sha(css + "\n" + js)
  }), null, 2) + "\n";
  return { "ultrastable-shell.css": css, "ultrastable-shell.js": js, "ultrastable-shell.json": json };
}

function main(argv) {
  const out = build(), check = argv.includes("--check");
  let stale = 0;
  if (!check) mkdirSync(here("artifact"), { recursive: true });
  for (const [name, text] of Object.entries(out)) {
    const p = here("artifact/" + name);
    const cur = existsSync(p) ? lf(readFileSync(p, "utf8")) : null;
    if (cur === text) continue;
    if (check) { console.error("stale: brand/shell/artifact/" + name + " (run node brand/shell/build.mjs)"); stale++; }
    else { writeFileSync(p, text); console.log("wrote brand/shell/artifact/" + name + " (" + text.length + " bytes)"); }
  }
  const j = JSON.parse(out["ultrastable-shell.json"]);
  console.log("RUNS-ON-1 v" + j.version + " content_hash " + j.content_hash + (stale ? " STALE" : " current"));
  if (stale) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2));
