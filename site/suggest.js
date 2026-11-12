// SUGGEST-1 (owner, 2026-11-12): ideas the front door offers must rotate and respond to what the person types, never a fixed list.
// The bank is data (outcome-level, SAFE NOW wording, no mechanism). suggest() ranks it by overlap with the typed words, drops what the
// client already showed, and picks the rest by a seeded shuffle so each call differs. When a model is bound, worker.js asks it for
// follow-ups first and falls back here. Consumers: site/worker.js (GET /api/suggest), site/interview.js (chips and placeholder), site/site.test.mjs.
export const BANK = [
  ["A booking page for my small business", "booking appointments salon barber clinic studio schedule calendar"],
  ["A website for my club or community group", "club community group members neighbours neighbors society team events"],
  ["A shop that sells what I make", "shop store sell handmade products crafts orders payments"],
  ["A reminder that tells me when bills are due", "reminder bills due remind money budget finance alerts"],
  ["A page that tracks my habits and streaks", "habit habits streak tracker daily routine fitness goals"],
  ["A portfolio that shows my work", "portfolio work photos artist designer writer showcase gallery"],
  ["A sign-up list for our next event", "event signup sign-up rsvp list guests party meetup volunteers"],
  ["A recipe collection I can search", "recipe recipes cooking food meals kitchen collection search"],
  ["A tool that sorts my emails into what matters", "email inbox sort filter messages triage automation"],
  ["A study planner for exams", "study exam school student revision planner learning homework"],
  ["A simple CRM to follow up with customers", "customers clients follow up crm leads sales contacts"],
  ["A newsletter page people can join", "newsletter subscribe mailing list audience writer blog"],
  ["A price watcher that alerts me to drops", "price watch alert deals tracker shopping drop monitor"],
  ["A school or class notice board", "school class teacher parents notice board announcements students"],
  ["A fundraiser page with a progress bar", "fundraiser donate donation charity cause raise money progress"],
  ["A checklist app for my team's weekly routine", "checklist team weekly routine tasks operations staff process"],
  ["A daily report that summarises my numbers", "report daily summary numbers metrics dashboard stats analytics"],
  ["A directory of local businesses", "directory local businesses listings map neighbourhood town"],
  ["A quiz or learning game", "quiz game learning trivia flashcards kids teach"],
  ["A page that answers common customer questions", "faq support customers questions help answers service"],
  ["A tool that watches a website and tells me when it changes", "watch website changes monitor uptime down alert"],
  ["A trip planner for a group holiday", "trip travel holiday vacation plan itinerary group"],
  ["A rota that shares shifts fairly", "rota shifts schedule staff fair roster volunteers"],
  ["An invoice maker for freelancers", "invoice freelance billing quote client payment"],
  ["A journal that I can talk to and it remembers", "journal diary notes memory reflect voice talk"],
  ["A members area for my course", "course lessons members teach online class content"],
  ["A tool that turns my notes into a tidy summary", "notes summary summarise meeting minutes document"],
  ["A site that fixes or speeds up my slow one", "slow broken fix speed improve existing website performance"],
  ["A waiting list for my product launch", "launch waitlist waiting list product coming soon early access"],
  ["A pet care log for the whole family", "pet dog cat vet feeding family care log"],
  ["A stock or inventory counter for my shop", "inventory stock counter warehouse items supplies"],
  ["A feedback form that sorts replies by theme", "feedback survey form replies themes reviews responses"],
  ["A page for my band, show or podcast", "band show podcast music episodes fans tour"],
  ["An app to split costs with housemates", "split costs housemates bills share expenses flatmates"],
  ["A tool that books my regular tasks automatically", "automatic regular tasks recurring schedule automation routine"],
  ["A garden or plant care planner", "garden plants care water seasons planner allotment"]
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
