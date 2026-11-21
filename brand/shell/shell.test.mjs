// RUNS-ON-1 tests: artifact is current and hashed, the helper is inlinable, the CSS stays inside the core layer, the vocabulary renders, nothing private leaks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build, sha } from "./build.mjs";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(here(p), "utf8").replace(/\r\n/g, "\n");
const out = build();
const css = out["ultrastable-shell.css"], js = out["ultrastable-shell.js"], contract = JSON.parse(out["ultrastable-shell.json"]);
const NAMES = ["US_SHELL_CSS", "US_SHELL_CONTRACT", "US_SHELL_VERSION", "usEsc", "usSpec", "usFmt", "usVerdict", "usWorst", "usSustaining", "usStatusSentence", "usMark", "usTopBar", "usStatusPanel", "usFooter", "usPage"];
const US = new Function(js + "\nreturn {" + NAMES.join(",") + "};")();

test("artifact is current and its hashes match its bytes", () => {
  for (const f of Object.keys(out)) assert.equal(read("artifact/" + f), out[f], "artifact/" + f + " is stale: run node brand/shell/build.mjs");
  assert.equal(contract.css_sha256, sha(read("artifact/ultrastable-shell.css")));
  assert.equal(contract.js_sha256, sha(read("artifact/ultrastable-shell.js")));
  assert.equal(contract.content_hash, sha(read("artifact/ultrastable-shell.css") + "\n" + read("artifact/ultrastable-shell.js")));
  assert.match(contract.content_hash, /^[0-9a-f]{64}$/);
});

test("the helper can be inlined into any worker", () => {
  for (const [name, text] of Object.entries(out)) assert.ok(!/[^\x00-\x7f]/.test(text), name + " is ASCII-only (instances keep their workers ASCII: write a non-ASCII character as a \\u escape)");
  assert.ok(!/^\s*(import|export)\b/m.test(js), "no import or export");
  assert.ok(!js.includes("/*"), "no block comment (a worker wraps inlined code in comments)");
  for (const m of js.matchAll(/^(?:var|function)\s+([A-Za-z_$][\w$]*)/gm)) assert.ok(/^(US_|us)/.test(m[1]), "top-level name " + m[1] + " is not US_/us prefixed");
  assert.equal(US.US_SHELL_VERSION, contract.version);
  assert.equal(US.US_SHELL_CSS + "\n", css);
});

test("CSS stays in the core layer: tokens only, no colour, readable sizes, 44 px targets", () => {
  const design = JSON.parse(read("../../doctrine/design.json"));
  const kebab = (k) => k.replace(/([A-Z])/g, "-$1").replace(/([a-z])(\d)/g, "$1-$2").toLowerCase();
  const allowed = new Set(design.token_contract.map(kebab).concat(["font", "mono", "r-s", "r-m", "r-l"]));
  for (const m of css.matchAll(/var\(--ds-([a-z0-9-]+)\)/g)) assert.ok(allowed.has(m[1]), "--ds-" + m[1] + " is not in the token contract");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), "no raw hex colour");
  assert.ok(!/rgba?\(|hsla?\(/.test(css), "no literal colour function");
  for (const m of css.matchAll(/(\d+(?:\.\d+)?)px\/|font-size:(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1] || m[2]) >= design.invariants.min_text_px, "text under " + design.invariants.min_text_px + " px: " + m[0]);
  for (const sel of [".us-top .us-name{", ".us-foot .us-mark{", ".us-defs summary{"]) assert.match(css.slice(css.indexOf(sel)), /^[^}]*min-height:44px/, sel + " is a 44 px target");
  assert.match(css, /:focus-visible\{outline:3px/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.equal((css.match(/--ds-accent/g) || []).length > 0, true, "the instance accent is the only identity colour");
});

test("the shell's own rules outrank a host's generic element rules (.ds a and .ds p are 0,1,1)", () => {
  for (const sel of [".us-top .us-name{", ".us-top .us-mark,", ".us-foot .us-mark{", ".us-top .us-name:hover", ".us-status .us-sentence{", ".us-status .us-asof{"]) assert.ok(css.includes(sel), sel + " is scoped to two classes");
});

test("verdicts follow the vocabulary thresholds", () => {
  assert.equal(US.usVerdict("k_eff", { k_eff: 1.2 }), "good");
  assert.equal(US.usVerdict("k_eff", { k_eff: 0.6 }), "warn");
  assert.equal(US.usVerdict("k_eff", { k_eff: 0.1 }), "bad");
  assert.equal(US.usVerdict("k_eff", {}), "unknown");
  assert.equal(US.usVerdict("open_ignition_gaps", { open_ignition_gaps: 0 }), "good");
  assert.equal(US.usVerdict("open_ignition_gaps", { open_ignition_gaps: 5 }), "bad");
  assert.equal(US.usVerdict("items_out_24h", { items_in_24h: 10, items_out_24h: 12 }), "good");
  assert.equal(US.usVerdict("items_out_24h", { items_in_24h: 10, items_out_24h: 7 }), "warn");
  assert.equal(US.usVerdict("items_out_24h", { items_in_24h: 0, items_out_24h: 0 }), "good");
  assert.equal(US.usVerdict("items_out_24h", { items_out_24h: 3 }), "unknown");
  assert.equal(US.usVerdict("items_in_24h", { items_in_24h: 3 }), "none");
  assert.equal(US.usVerdict("cost_vs_budget", { cost_vs_budget: 1.1 }), "warn");
});

test("the status sentence leads with the verdict and never invents a zero", () => {
  assert.equal(US.usStatusSentence({ k_eff: 1.5, open_ignition_gaps: 0, loops_running: 9, loops_total: 9, items_in_24h: 4, items_out_24h: 6, cost_vs_budget: 0.8 }),
    "Self-sustaining: criticality 1.50, no open ignition gaps, 9 of 9 loops running, 4 items in and 6 out in 24 h, cost at 0.8× budget.");
  assert.equal(US.usStatusSentence({ k_eff: 0.4, open_ignition_gaps: 1 }), "Not yet self-sustaining: criticality 0.40, 1 open ignition gap.");
  assert.equal(US.usStatusSentence({}), "Status unknown.");
});

test("the skeleton renders every slot, escapes input and marks the system", () => {
  const v = { k_eff: 0.84, open_ignition_gaps: 5, loops_running: 40, loops_total: 44, loops_stalled: 4, items_in_24h: 12, items_out_24h: 15, cost_vs_budget: 1.1 };
  const top = US.usTopBar({ name: "A <b>", sub: "plane", right: '<span id="x"></span>' });
  assert.ok(top.includes('class="us-top" data-us-shell="' + contract.version + '"'));
  assert.ok(top.includes("A &lt;b&gt;") && top.includes('<span id="x"></span>') && top.includes(contract.mark.text) && top.includes(contract.mark.href));
  const panel = US.usStatusPanel(v, { as_of: "2026-11-14T12:00Z", sources: { k_eff: "deploy ledger" } });
  for (const s of contract.vocabulary) assert.ok(panel.includes('data-key="' + s.key + '"'), "tile for " + s.key);
  assert.match(panel, /us-sentence us-bad/);
  const partial = US.usStatusPanel({ loops_running: 3, loops_total: 3, loops_stalled: 0 });
  assert.match(partial, /us-sentence us-unknown/, "an unknown verdict is never coloured good by the few numbers that are known");
  assert.ok(panel.includes("40 <small>of 44</small>"));
  assert.ok(panel.includes("Source here: deploy ledger."));
  const page = US.usPage({ name: "Demo", tokenCss: ":root{}", values: v, body: "<p>hi</p>" });
  for (const slot of contract.skeleton.filter((s) => s.render !== "instance")) assert.equal(typeof US[slot.render], "function", slot.render);
  const at = (c) => page.indexOf('class="' + c);
  assert.ok(at("us-top") > 0 && at("us-top") < at("us-status") && at("us-status") < page.indexOf("<p>hi</p>") && page.indexOf("<p>hi</p>") < at("us-foot"), "slots in skeleton order");
  assert.equal((page.match(/data-runs-on="ultrastable"/g) || []).length, 2);
});

test("the exported artifact never names a customer", () => {
  const all = (css + js + out["ultrastable-shell.json"]).toLowerCase();
  assert.ok(!/qnfo/i.test(all), "the Ultrastable artifact never names a customer");
});
