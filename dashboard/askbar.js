// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// ASK-1 (OL-20261112-94; owner, 2026-11-12): the owner dashboard asks before it acts, like the front door. Agents answer every prompt and assume; this
// system asks where there is an unknown it should not pretend to know, and only there. The owner states a direction in the pill input (class us-ask) or by
// voice; clarify() returns at most MAX_QUESTIONS tap-to-answer either/or questions, each only when its two answers lead to a different plan; resolve() says
// what was understood and hands one refined line to the audited command path (dashboard/worker.js runCommand).
// A question the record can already answer is not asked: when the last SETTLED answers to it agree, that answer is assumed and shown as assumed. Every asked
// question is logged with its answer and whether the answer changed the plan (it differed from the default the system would have assumed), so the bank is
// scored: a question asked PRUNE_AFTER times whose answer never changed the plan is pruned and its default is assumed from then on.
// Consumers: dashboard/worker.js (POST /api/owner/ask, the owner page), dashboard/test/askbar.test.mjs.
export const MAX_QUESTIONS = 3, SETTLED = 3, PRUNE_AFTER = 5;

const CHANGE = /\b(add|build|create|change|update|fix|deploy|ship|merge|rewrite|migrate|move|rename|send|post|publish|enable|disable|turn (?:on|off)|start|stop|pause|resume|delete|remove|drop|retire|archive|kill|cancel|close)\b/i;
const DESTRUCTIVE = /\b(delete|remove|drop|retire|kill|cancel|stop|shut ?down|turn off|disable)\b/i;
const BIG = /\b(build|create|rewrite|migrate|redesign|launch)\b/i;
const QUESTION = /^\s*(what|which|who|when|where|why|how|is|are|was|were|do|does|did|can|could|should|will|would|show|list|tell)\b|\?\s*$/i;
const stem = d => String(d).trim().replace(/[.!\s]+$/, "");  // the direction without closing punctuation, so each answer adds one sentence
const words = d => String(d).trim().split(/\s+/).filter(Boolean).length;

// Each question: when(direction, ctx) says whether the answer would change the plan; apply(direction, answer) writes the answer into the line the agent receives.
export const QUESTIONS = [
  { id: "show-or-change", q: "Show how it is doing, or change something about it?", options: ["Show me", "Change something"], default: "Show me",
    when: d => !QUESTION.test(d) && !CHANGE.test(d) && words(d) <= 4,
    apply: (d, a) => a === "Show me" ? "How is " + stem(d) + " doing right now?" : stem(d) + ". The owner wants a change here: say what would change and why before changing anything." },
  { id: "pause-or-remove", q: "Pause it so it can be resumed, or remove it for good?", options: ["Pause", "Remove"], default: "Pause",
    when: d => DESTRUCTIVE.test(d) && !/\b(pause|resume|temporar\w*|for now|for good|permanent\w*|forever)\b/i.test(d),
    apply: (d, a) => stem(d) + (a === "Pause" ? ". Pause it so it can be resumed; remove nothing." : ". Remove it for good.") },
  { id: "one-or-all", q: "Only Ultrastable itself, or every system built on it?", options: ["Only Ultrastable", "Every system"], default: "Only Ultrastable",
    when: (d, ctx) => CHANGE.test(d) && !QUESTION.test(d) && (ctx.tenants || []).length > 0 && !/\b(all|every|each|only|just|ultrastable|platform|core)\b/i.test(d)
      && !(ctx.tenants || []).some(t => new RegExp("\\b" + String(t).replace(/[^a-z0-9 ]/gi, "").trim().replace(/\s+/g, "\\s+") + "\\b", "i").test(d)),
    apply: (d, a) => stem(d) + (a === "Every system" ? ". Apply it to every system built on Ultrastable." : ". Apply it to Ultrastable itself only.") },
  { id: "now-or-queue", q: "Start on it now, or put it in the fleet's queue?", options: ["Now", "Queue it"], default: "Now",
    when: d => BIG.test(d) && !QUESTION.test(d) && !/\b(now|today|tonight|tomorrow|later|queue|backlog|when|after|next|eventually)\b/i.test(d),
    apply: (d, a) => stem(d) + (a === "Queue it" ? ". Put it in the fleet's queue; do not start it in this session." : ". Start now.") },
];
const BY_ID = Object.fromEntries(QUESTIONS.map(q => [q.id, q]));

// stats: { [qid]: { asked, changed, recent: [answers, newest first] } } from the ask_log table (worker.js askStats).
export function standing(q, stats) {
  const s = (stats || {})[q.id] || { asked: 0, changed: 0, recent: [] };
  const recent = (s.recent || []).slice(0, SETTLED);
  if (recent.length === SETTLED && recent.every(a => a === recent[0]) && q.options.includes(recent[0])) return { answer: recent[0], source: "record" };
  if (s.asked >= PRUNE_AFTER && !s.changed) return { answer: q.default, source: "pruned" };
  return null;
}

// What the system would ask, and what it already knows. A registered command or a plain question gets no questions at all.
export function clarify(direction, ctx = {}) {
  const d = String(direction || "").trim(), first = d.split(/\s+/)[0] || "";
  const out = { direction: d, questions: [], assumed: [] };
  if (!d || (ctx.commands || []).includes(first)) return out;
  for (const q of QUESTIONS) {
    if (!q.when(d, ctx)) continue;
    const known = standing(q, ctx.stats);
    if (known) out.assumed.push({ id: q.id, question: q.q, answer: known.answer, source: known.source });
    else if (out.questions.length < MAX_QUESTIONS) out.questions.push({ id: q.id, q: q.q, options: q.options });
    else out.assumed.push({ id: q.id, question: q.q, answer: q.default, source: "default" });  // never more than MAX_QUESTIONS: the rest take their default, and say so
  }
  return out;
}

// Answers in hand: the refined line, what was understood in plain words, and the rows to log. Returns { pending } while a question is still unanswered.
export function resolve(direction, answers = {}, ctx = {}) {
  const c = clarify(direction, ctx);
  const pending = c.questions.filter(q => !BY_ID[q.id].options.includes(answers[q.id]));
  if (pending.length) return { pending, assumed: c.assumed, understood: understood(c.direction, [], c.assumed) };
  let line = c.direction; const log = [], said = [];
  for (const q of c.questions) {
    const def = BY_ID[q.id], a = answers[q.id];
    line = def.apply(line, a); said.push({ question: def.q, answer: a });
    log.push({ qid: q.id, question: def.q, answer: a, changed: a !== def.default ? 1 : 0, source: "asked" });
  }
  for (const a of c.assumed) line = BY_ID[a.id].apply(line, a.answer);
  return { line, log, assumed: c.assumed, understood: understood(c.direction, said, c.assumed) };
}

export function understood(direction, said, assumed) {
  const parts = ["You said: " + direction + "."];
  for (const s of said) parts.push(s.answer + " (" + s.question + ")");
  for (const a of assumed) parts.push("Assumed " + a.answer + " (" + a.question + ") " + (a.source === "record" ? "because your last answers to this agreed." : a.source === "pruned" ? "because your answer to this has never changed the plan." : "by default."));
  return parts.join(" ");
}

// Per question: how often it was asked and how often the answer changed the plan. The share is the question's score; a zero after PRUNE_AFTER asks prunes it.
export function score(stats) {
  return QUESTIONS.map(q => { const s = (stats || {})[q.id] || { asked: 0, changed: 0, recent: [] }; const st = standing(q, stats);
    return { id: q.id, question: q.q, asked: s.asked, changed: s.changed, changed_share: s.asked ? Math.round(100 * s.changed / s.asked) / 100 : null, state: st ? st.source : "asked" }; });
}
