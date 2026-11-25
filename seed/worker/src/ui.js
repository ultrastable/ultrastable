// The front end is the back end: server-rendered pages, no build step, no JavaScript needed in the browser.
// Three bite-sized screens (Now, Next, Needs you) plus a one-question-at-a-time interview with big buttons.
import { QUESTIONS, PHASES, nextQuestion, progress } from './interview.js';

// DISCOVER-1: every page says it is built on Ultrastable and links the directory of systems built on it
const FOOTER = '<footer style="max-width:36rem;margin:0 auto;padding:0 16px 2rem;font-size:.9rem">Built on <a href="https://ultrastable.io/">Ultrastable</a> · <a href="https://ultrastable.io/directory">More systems built on it</a> · <a href="/.well-known/ultrastable.json">About this system</a></footer>';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>:root{color-scheme:light dark;--bg:#fff;--fg:#111;--mut:#667;--ac:#0b57d0;--card:#f3f5f9}@media(prefers-color-scheme:dark){:root{--bg:#111418;--fg:#eee;--mut:#9aa;--ac:#8ab4f8;--card:#1c2128}}
body{margin:0;background:var(--bg);color:var(--fg);font:18px/1.5 system-ui,sans-serif}main{max-width:36rem;margin:0 auto;padding:1rem 16px 5rem}
nav{display:flex;gap:.5rem;position:sticky;top:0;background:var(--bg);padding:.75rem 16px;max-width:36rem;margin:0 auto}nav a{flex:1;text-align:center;padding:.6rem;border-radius:.6rem;background:var(--card);color:var(--fg);text-decoration:none}
.card{background:var(--card);border-radius:.8rem;padding:1rem;margin:.8rem 0}.mut{color:var(--mut);font-size:.9rem}
button,.btn{display:block;width:100%;text-align:left;font:inherit;padding:.9rem 1rem;margin:.5rem 0;border-radius:.7rem;border:2px solid var(--ac);background:transparent;color:var(--fg);cursor:pointer;text-decoration:none;box-sizing:border-box}
.bar{height:.5rem;background:var(--card);border-radius:1rem;overflow:hidden}.bar i{display:block;height:100%;background:var(--ac)}textarea{width:100%;min-height:6rem;font:inherit;box-sizing:border-box;padding:.6rem}</style></head><body>
<nav><a href="/">Now</a><a href="/next">Next</a><a href="/needs-you">Needs you</a></nav><main>${body}</main>${FOOTER}</body></html>`;

export const html = (title, body, status = 200) => new Response(page(title, body), { status, headers: { 'content-type': 'text/html; charset=utf-8' } });

export function nowScreen({ org, lastTick, answers }) {
  const pr = progress(answers);
  const bars = PHASES.map(p => `<p>${esc(p)} <span class="mut">${Math.round(pr[p] * 100)}%</span></p><div class="bar"><i style="width:${pr[p] * 100}%"></i></div>`).join('');
  const rep = lastTick ? `<div class="card"><b>Latest report</b><p>${esc(lastTick.report).replace(/\n/g, '<br>')}</p></div>` : `<div class="card">No report yet. The first one appears after the first tick.</div>`;
  return page_('Now', `<h1>${esc(org)}</h1>${rep}<div class="card"><b>Where the project stands</b>${bars}</div>`);
}

export function nextScreen({ items }) {
  const rows = items.length ? items.map(i => `<div class="card">${esc(i.title)}<div class="mut">${esc(i.owner_role)}</div></div>`).join('') : '<div class="card">Nothing queued.</div>';
  return page_('Next', `<h1>What happens next</h1>${rows}`);
}

export function needsScreen({ cards, answers }) {
  const q = nextQuestion(answers);
  const ask = q ? `<a class="btn" href="/start">Answer the next question: ${esc(q.ask)}</a>` : '<div class="card">All questions answered.</div>';
  const gates = cards.length ? cards.map(c => `<div class="card"><b>${esc(c.what)}</b><p class="mut">${esc(c.why_gated)}</p><p>Until then: ${esc(c.default_in_effect)}</p></div>`).join('') : '<div class="card">Nothing needs you right now.</div>';
  return page_('Needs you', `<h1>Needs you</h1>${ask}${gates}`);
}

export function questionScreen(q, answers) {
  const hints = q.recall.map(r => `<p class="mut">${esc(r)}</p>`).join('');
  let form;
  if (q.kind === 'text') form = `<textarea name="value" required></textarea><button>Save</button>`;
  else if (q.kind === 'choice') form = q.choices.map(c => `<button name="value" value="${esc(c.id)}">${esc(c.label)}</button>`).join('');
  else form = q.choices.map(c => `<label class="card" style="display:block"><input type="checkbox" name="value" value="${esc(c.id)}"> ${esc(c.label)}</label>`).join('') + '<button>Save</button>';
  const n = QUESTIONS.filter(x => answers[x.id] !== undefined).length;
  return page_('Question', `<p class="mut">${esc(q.phase)} · ${n} of ${QUESTIONS.length} answered</p><h1>${esc(q.ask)}</h1>${hints}<form method="post" action="/start"><input type="hidden" name="qid" value="${esc(q.id)}">${form}</form>`);
}

export const doneScreen = () => page_('Done', '<h1>Thank you</h1><p>The managers have what they need to draft the charter and the specification.</p><a class="btn" href="/">See where things stand</a>');

function page_(title, body) { return html(title, body); }
