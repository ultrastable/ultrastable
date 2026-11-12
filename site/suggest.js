// SUGGEST-1 (owner, 2026-11-12): ideas the front door offers must rotate and respond to what the person types, never a fixed list.
// The bank is data (outcome-level, SAFE NOW wording, no mechanism). suggest() ranks it by overlap with the typed words, drops what the
// client already showed, and picks the rest by a seeded shuffle so each call differs. When a model is bound, worker.js asks it for
// follow-ups first and falls back here. Consumers: site/worker.js (GET /api/suggest), site/interview.js (chips and placeholder), site/site.test.mjs.
export const BANK = [
  ["A website for our club that keeps improving its own search ranking and member features", "club association website members community seo society group"],
  ["A small-business site that gets faster, safer and more useful every week", "business website wordpress maintenance performance security small"],
  ["A personal signals desk that watches markets or the news against my own rules and keeps improving them", "personal signals stocks market news alerts watchlist tracker rules portfolio"],
  ["A personal companion that remembers, follows up and gets better at knowing what helps", "personal companion assistant reminders check-in habits journal wellbeing memory"],
  ["A booking and membership platform that grows features from how people use it", "booking membership platform features usage gym studio clinic appointments"],
  ["A WordPress site that stops rotting: updates, plugins, content and SEO kept current", "wordpress plugins updates seo content rot site slow broken"],
  ["A fleet of services that finds its own failures and fixes them", "services monitor failures fix incident reliability fleet uptime"],
  ["A publishing operation that drafts, revises and issues new editions on its own", "publish journal paper edition writing revise newsletter blog"],
  ["A compliance watcher that tracks rule changes and updates our controls", "compliance regulation audit policy rules controls legal"],
  ["A software portfolio where agents triage the backlog across many repos", "backlog repos portfolio engineering agents issues developers"],
  ["A support operation that learns from every ticket and fixes the cause", "support tickets customer service helpdesk cause faq"],
  ["A security program that scans, patches and proves each fix", "security vulnerability patch scan dependency"],
  ["A data pipeline that notices drift, repairs itself and logs why", "data pipeline drift etl quality warehouse reports numbers"],
  ["A growth engine that tests messages, measures results and keeps what works", "growth marketing outreach experiments conversion leads sales crm"],
  ["A cost controller that watches cloud spend and trims waste weekly", "cloud cost spend budget finops waste"],
  ["A knowledge base that audits itself and rewrites what has gone stale", "knowledge docs documentation stale wiki"],
  ["A grants and funding desk that finds calls, drafts and tracks deadlines", "grants funding proposals deadlines nonprofit fundraiser charity"],
  ["A model evaluation harness that re-tests every release against its own history", "model evaluation benchmark regression ai release"],
  ["An open-source project run by agents with maintainers deciding the few gates", "open source maintainer project community releases"],
  ["A local directory or marketplace that grows listings and quality on its own", "directory local businesses listings marketplace town"],
  ["A training program that adapts its curriculum to measured results", "curriculum training education learners outcomes course members"]
];

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
  const picked = related.slice(0, qw.length ? want : 0).concat(rest.slice(0, want));
  return picked.slice(0, want).map((x) => x.t);
}

export default { BANK, suggest };
