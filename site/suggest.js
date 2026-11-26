// SUGGEST-1 (owner, 2026-11-12): ideas the front door offers must rotate and respond to what the person types, never a fixed list.
// The bank is data (outcome-level, SAFE NOW wording, no mechanism). suggest() ranks it by overlap with the typed words, drops what the
// client already showed, and picks the rest by a seeded shuffle so each call differs. When a model is bound, worker.js asks it for
// follow-ups first and falls back here. Consumers: site/worker.js (GET /api/suggest), site/interview.js (chips and placeholder), site/site.test.mjs.
// IDEA-BANK-1 (Rowan, 2026-11-22): the bank is generated from doctrine/idea-bank.json by scripts/build_idea_bank.py, which boots every idea
// through the seed (read, qualify, instrument) and holds the domains diverse. Rows are [text, keywords, domain, reach].
import IB from "./idea-bank-data.js";
export const BANK = IB.BANK;

const words = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").split(/\s+/).filter((w) => w.length > 2);
const STOP = new Set(["the", "and", "for", "with", "that", "this", "want", "make", "need", "have", "app", "can", "you", "something", "build", "like", "from", "about", "into", "my", "our"]);

// Small deterministic generator so a seed gives a repeatable order and a new seed gives a new one.
function rng(seed) { let x = (Number(seed) || 1) >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; }

export function suggest(q, seen, seed, n) {
  const want = Math.max(1, Math.min(8, Number(n) || 4)), have = new Set((seen || []).map((s) => String(s).toLowerCase()));
  const qw = words(q).filter((w) => !STOP.has(w)), rnd = rng(seed);
  const scored = BANK.filter((b) => !have.has(b[0].toLowerCase())).map((b) => {
    const bw = new Set(words(b[0] + " " + b[1]));
    let hit = 0; for (const w of qw) { if (bw.has(w) || [...bw].some((x) => x.length > 4 && w.length > 4 && (x.startsWith(w) || w.startsWith(x)))) hit++; }
    return { t: b[0], s: hit * 10 + rnd() };
  }).sort((a, b) => b.s - a.s);
  const related = scored.filter((x) => x.s >= 10).slice(0, Math.ceil(want / 2) + 1), rest = scored.filter((x) => x.s < 10);
  // Unrelated picks spread across domains, so the chips show the range rather than four of one kind.
  const dom = new Map(BANK.map((b) => [b[0], b[2]])), used = new Set(), spread = [];
  for (const x of rest) if (!used.has(dom.get(x.t))) { used.add(dom.get(x.t)); spread.push(x); }
  for (const x of rest) if (!spread.includes(x)) spread.push(x);
  const picked = related.slice(0, qw.length ? want : 0).concat(spread.slice(0, want));
  return picked.slice(0, want).map((x) => x.t);
}

// LIVE-EXAMPLE-1: the deployed system that proves an idea (column 5 of the generated bank).
export function example(text) { const b = BANK.find((r) => r[0] === text); return b && b[4] ? b[4] : null; }
export default { BANK, suggest, example };
