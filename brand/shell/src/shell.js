// RUNS-ON-1: the Ultrastable runtime shell. One page skeleton, one status vocabulary and one mark shared by every system that runs on Ultrastable.
// Inlinable: no import, no export, no block comment, US_/us names only. An instance inlines this file verbatim (or loads it with new Function)
// and calls usTopBar, usStatusPanel and usFooter; colours come from the instance's --ds-* tokens, so an instance varies only its accent.
var US_SHELL_CSS = "__US_CSS__";
var US_SHELL_CONTRACT = __US_CONTRACT__;
var US_SHELL_VERSION = US_SHELL_CONTRACT.version;
function usEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function usSpec(key) { return US_SHELL_CONTRACT.vocabulary.filter(function (v) { return v.key === key; })[0] || null; }
function usNum(v) { if (v == null || v === "") return null; var n = Number(v); return isFinite(n) ? n : null; }
function usFmt(key, v) {
  var s = usSpec(key), n = usNum(v);
  if (n == null) return "n/a";
  if (s && s.format === "fixed2") return n.toFixed(2);
  if (s && s.format === "times") return (Math.round(n * 100) / 100).toString() + "\u00d7";
  return Math.round(n).toLocaleString("en-US");
}
// good | warn | bad from the vocabulary thresholds; none for a key with no polarity; unknown when the value (or its reference) is missing.
function usVerdict(key, values) {
  var s = usSpec(key), n = usNum(values && values[key]);
  if (!s) return "none";
  if (n == null) return "unknown";
  if (s.polarity === "none") return "none";
  if (s.relative_to) {
    var ref = usNum(values[s.relative_to]);
    if (ref == null) return "unknown";
    n = ref === 0 ? s.good : n / ref;
  }
  if (s.polarity === "higher") return n >= s.good ? "good" : n >= s.warn ? "warn" : "bad";
  return n <= s.good ? "good" : n <= s.warn ? "warn" : "bad";
}
function usWorst(values) {
  var rank = { good: 1, warn: 2, bad: 3 }, w = 0, out = "unknown";
  US_SHELL_CONTRACT.vocabulary.forEach(function (s) { var v = usVerdict(s.key, values); if (rank[v] && rank[v] > w) { w = rank[v]; out = v; } });
  return out;
}
function usSustaining(values) {
  var k = usNum(values && values.k_eff), g = usNum(values && values.open_ignition_gaps);
  if (k == null || g == null) return null;
  return k >= 1 && g === 0;
}
// One sentence: the verdict first, then the numbers behind it. Missing numbers are left out, never shown as zero.
function usStatusSentence(values) {
  values = values || {};
  var S = US_SHELL_CONTRACT.sentence, st = usSustaining(values), parts = [];
  var head = st === true ? S.sustaining : st === false ? S.not_yet : S.unknown;
  if (usNum(values.k_eff) != null) parts.push("criticality " + usFmt("k_eff", values.k_eff));
  var g = usNum(values.open_ignition_gaps);
  if (g != null) parts.push(g === 0 ? "no open ignition gaps" : g + " open ignition gap" + (g === 1 ? "" : "s"));
  var lr = usNum(values.loops_running), lt = usNum(values.loops_total);
  if (lr != null) parts.push(lr + (lt != null ? " of " + lt : "") + " loops running");
  var ii = usNum(values.items_in_24h), io = usNum(values.items_out_24h);
  if (ii != null && io != null) parts.push(ii + " items in and " + io + " out in 24 h");
  if (usNum(values.cost_vs_budget) != null) parts.push("cost at " + usFmt("cost_vs_budget", values.cost_vs_budget) + " budget");
  return head + (parts.length ? ": " + parts.join(", ") : "") + ".";
}
function usMark() {
  var m = US_SHELL_CONTRACT.mark;
  return '<a class="us-mark" href="' + usEsc(m.href) + '" rel="noopener" title="' + usEsc(m.title) + '" data-runs-on="ultrastable">' + usEsc(m.text) + "</a>";
}
// o: { name, sub, href, right } ; right is the instance's own controls (trusted HTML from the instance).
function usTopBar(o) {
  o = o || {};
  return '<header class="us-top" data-us-shell="' + usEsc(US_SHELL_VERSION) + '"><div class="us-top-in"><a class="us-name" href="' + usEsc(o.href || "/") + '"><i aria-hidden="true"></i>' + usEsc(o.name || "System") +
    (o.sub ? " <small>" + usEsc(o.sub) + "</small>" : "") + '</a><div class="us-right">' + (o.right || "") + usMark() + "</div></div></header>";
}
// values: { k_eff, open_ignition_gaps, loops_running, loops_total, loops_stalled, items_in_24h, items_out_24h, cost_vs_budget }; o: { as_of, sources }
function usStatusPanel(values, o) {
  values = values || {}; o = o || {};
  var tiles = US_SHELL_CONTRACT.vocabulary.map(function (s) {
    var v = usVerdict(s.key, values), of = s.of && usNum(values[s.of]) != null && usNum(values[s.key]) != null ? " <small>of " + usFmt(s.of, values[s.of]) + "</small>" : "";
    var src = o.sources && o.sources[s.key] ? " Source: " + o.sources[s.key] + "." : "";
    return '<li class="us-tile us-' + v + '" data-key="' + usEsc(s.key) + '" title="' + usEsc(s.define + src) + '"><span class="us-label">' + usEsc(s.label) + '</span><b class="us-val">' + usEsc(usFmt(s.key, values[s.key])) + of + "</b></li>";
  }).join("");
  var defs = US_SHELL_CONTRACT.vocabulary.map(function (s) {
    var src = o.sources && o.sources[s.key] ? " Source here: " + o.sources[s.key] + "." : "";
    return "<dt>" + usEsc(s.label) + "</dt><dd>" + usEsc(s.define + src) + "</dd>";
  }).join("");
  return '<section class="us-status" aria-label="System status" data-us-shell="' + usEsc(US_SHELL_VERSION) + '"><p class="us-sentence us-' + (usSustaining(values) === null ? "unknown" : usWorst(values)) + '" role="status">' + usEsc(usStatusSentence(values)) + "</p>" +
    '<ul class="us-tiles">' + tiles + "</ul>" + '<details class="us-defs"><summary>What these numbers mean</summary><dl>' + defs + "</dl></details>" +
    (o.as_of ? '<p class="us-asof">As of ' + usEsc(o.as_of) + "</p>" : "") + "</section>";
}
function usFooter() { return '<footer class="us-foot">' + usMark() + "</footer>"; }
// A whole page for a surface that has no head of its own. tokenCss is the portfolio layer (the --ds-* block); body is the instance's content.
function usPage(o) {
  o = o || {};
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + usEsc(o.title || o.name || "System") + "</title>" +
    (o.description ? '<meta name="description" content="' + usEsc(o.description) + '">' : "") + "<style>" + (o.tokenCss || "") + "\n" + US_SHELL_CSS + "\n" + (o.css || "") + '</style></head><body class="ds">' +
    usTopBar(o) + usStatusPanel(o.values, o) + '<main class="us-main">' + (o.body || "") + "</main>" + usFooter() + "</body></html>";
}
