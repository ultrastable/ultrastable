// Interview logic for the Worker. Mirrors bootstrap/interview.py and shares bootstrap/questions.json.
import spec from '../../bootstrap/questions.json' with { type: 'json' };

export const QUESTIONS = spec.questions;
export const PHASES = spec.phases;

export function nextQuestion(answers) {
  return QUESTIONS.find(q => !has(answers[q.id])) || null;
}
const has = v => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && v.length === 0);

export function validate(q, value) {
  if (q.kind === 'text') {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${q.id}: text answer required`);
    return value.trim().slice(0, 2000);
  }
  const ids = new Set(q.choices.map(c => c.id));
  const vals = Array.isArray(value) ? value : [value];
  if (!vals.length || vals.some(v => !ids.has(v))) throw new Error(`${q.id}: choose from the listed options`);
  if (q.kind === 'choice') {
    if (vals.length !== 1) throw new Error(`${q.id}: choose exactly one`);
    return vals[0];
  }
  return [...new Set(vals)];
}

export function progress(answers) {
  const out = {};
  for (const ph of PHASES) {
    const qs = QUESTIONS.filter(q => q.phase === ph);
    const total = qs.reduce((n, q) => n + q.weight, 0);
    const got = qs.filter(q => has(answers[q.id])).reduce((n, q) => n + q.weight, 0);
    out[ph] = total ? Math.round((got / total) * 100) / 100 : 1;
  }
  return out;
}

export async function loadAnswers(db) {
  const { results } = await db.prepare('SELECT qid, value FROM interview_answers').all();
  return Object.fromEntries(results.map(r => [r.qid, JSON.parse(r.value)]));
}

export async function saveAnswer(db, qid, value) {
  const q = QUESTIONS.find(x => x.id === qid);
  if (!q) throw new Error(`unknown question ${qid}`);
  const v = validate(q, value);
  await db.prepare('INSERT INTO interview_answers (qid, value) VALUES (?, ?) ON CONFLICT(qid) DO UPDATE SET value=excluded.value, answered_at=datetime(\'now\')')
    .bind(qid, JSON.stringify(v)).run();
  return v;
}
