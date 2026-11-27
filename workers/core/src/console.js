// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Guided console (US-SPEC-18). Three screens, buttons first, a prompt box second.
// The front end is the back end: every action below writes a record the tick already understands.
import { CONSOLE_HTML } from './console-ui.js';
import { sha256Hex, verifyAccessJwt } from '../doors/index.js';
import { verifyIapJwt } from '../doors/proxy.js';
import { listConnections, saveSecret, removeSecret } from './secrets-ui.js';
import { githubConnection } from '../githubapp/index.js';
import { firstRunDoor, doorStatus, page, SETUP } from './first-run.js';
import { HELP_SECTIONS } from './help-data.js';
import { readSession, canWrite } from '../auth/index.js';
import { SESSION_COOKIE } from '../githubapp/signin.js';
import { publicViewEnabled, renderPublicView, loadMeasures } from '../org/public-view.js';
import { plain } from '../walkthrough/plain.js';

// Request categories that SCOPE.md puts outside the default product (opt-in Capability Packs only). Each row is [pattern, what it is, the shipped pack that covers it]: the
// decline names that pack (US-00-T04), and says that no add-on covers it when the third field is null (the drafts pack drafts documents but never files one; no pack gives advice).
export const OUT_OF_SCOPE = [
  [/business plan|financial model|pitch deck|fundrais|investor|funding (application|round)/i, 'a business plan or funding material', 'drafts'],
  [/patent|trademark|copyright (filing|registration)/i, 'a patent or trademark filing', null],
  [/legal advice|tax advice|investment advice|medical advice/i, 'legal, tax, investment or medical advice', null],
  [/marketing campaign|social media (post|account)|cold (email|outreach)|ad campaign/i, 'marketing or outreach', 'social'],
];

const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
const one = (db, sql, ...a) => db.prepare(sql).bind(...a).first();
const run = (db, sql, ...a) => db.prepare(sql).bind(...a).run();

const SHOWN = 3;        // US-18-R05: at most three items per list ...
const SHOWN_DONE = 5;   // ... except "Finished lately", a read-only list of five (US-18-R05 exception, section 3)
const MAX_TEXT = 4000;  // US-18-R03: typed text is stored whole; longer text is refused with a message, never cut

const hasTable = async (db, name) => Boolean(await one(db, `SELECT 1 AS x FROM sqlite_master WHERE name=?`, name).catch(() => null));
const safeLink = l => typeof l === 'string' && (/^https:\/\//.test(l) || /^\/(?!\/)/.test(l)) ? l : null;
/** The kind of a decision card follows its closing probe: env: is a step in the person's cloud account, elicit_answered: is a question
 *  that closes when it is answered, everything else is a manual step a person can confirm (US-18 section 4). */
export const cardKind = probe => String(probe || '').startsWith('env:') ? 'secret' : String(probe || '').startsWith('elicit_answered:') ? 'ask' : 'manual';

/** The three screens as plain data. Each screen is small on purpose (bite-sized). Every list that is cut says how many were left out
 *  (`*_more`); words for roles, surfaces and levels are the person's (US-18-R06), the raw values stay under `raw` for agents. */
export async function buildConsole(db, { org = 'your organization' } = {}) {
  const tick = await one(db, `SELECT started_at, finished_at, steps_completed, steps_total, report FROM tick_runs ORDER BY id DESC LIMIT 1`);
  const cards = await all(db, `SELECT id, what, why_gated, default_in_effect, closing_probe FROM gate_cards WHERE status='open' ORDER BY id LIMIT ${SHOWN}`);
  const moreCards = (await one(db, `SELECT COUNT(*) AS n FROM gate_cards WHERE status='open'`)).n - cards.length;
  const counts = Object.fromEntries((await all(db, `SELECT status, COUNT(*) AS n FROM items GROUP BY status`)).map(r => [r.status, r.n]));
  const active = (await all(db, `SELECT id, title, owner_role, status FROM items WHERE status IN ('claimed','ready') ORDER BY priority, id LIMIT ${SHOWN}`));
  const blocked = (await all(db, `SELECT id, title, blocker FROM items WHERE status='blocked' ORDER BY priority, id LIMIT ${SHOWN}`));
  const done = await all(db, `SELECT title, updated_at FROM items WHERE status='done' ORDER BY updated_at DESC, id DESC LIMIT ${SHOWN_DONE}`);
  const pred = await one(db, `SELECT SUM(verdict='hit') AS hit, COUNT(*) AS scored FROM predictions WHERE verdict IS NOT NULL`);
  // US-18 section 3: "places it now acts on its own" are the pairs at delegated or above (US-SPEC-06); observed and assisted only propose.
  const ownRows = await all(db, `SELECT surface, action_class, rung FROM trust_ledger WHERE rung NOT IN ('observed','assisted') ORDER BY reliability DESC, surface, action_class`);
  const links = (await hasTable(db, 'ownerlink_actions')) ? await all(db, `SELECT card_id, link FROM ownerlink_actions WHERE status='open' AND card_id IS NOT NULL`) : [];

  const tickOk = Boolean(tick && tick.steps_completed === tick.steps_total);
  const needsYou = cards.length + Math.max(0, moreCards);
  const headline = !tick ? 'Starting up. The first check has not run yet.'
    : !tickOk ? 'Something needs attention: the last check did not finish.'
    : needsYou ? `Running well. ${needsYou} thing${needsYou === 1 ? '' : 's'} need${needsYou === 1 ? 's' : ''} you.`
    : 'Running well. Nothing needs you.';
  const activeTotal = (counts.claimed || 0) + (counts.ready || 0);
  const suggestions = [];
  if (needsYou) suggestions.push('What do you need from me?');
  if (counts.blocked) suggestions.push('What is stuck?');
  if (counts.done) suggestions.push('What did you finish?');
  if (suggestions.length < SHOWN && activeTotal) suggestions.push('What are you working on?');
  if (suggestions.length < SHOWN) suggestions.push('How well is it doing?');
  return {
    org, headline, ok: tickOk, last_check: tick ? tick.finished_at || tick.started_at : null,
    now: {
      open: (counts.open || 0) + (counts.ready || 0) + (counts.claimed || 0), done: counts.done || 0, blocked: counts.blocked || 0,
      working_on: active.map(i => ({ id: i.id, title: plain('text', i.title), owner: plain('role', i.owner_role), status: i.status, raw: { owner_role: i.owner_role } })),
      working_on_more: Math.max(0, activeTotal - active.length),
      stuck: blocked.map(i => ({ id: i.id, title: plain('text', i.title), blocker: plain('text', i.blocker || ''), raw: { blocker: i.blocker } })),
      stuck_more: Math.max(0, (counts.blocked || 0) - blocked.length),
    },
    needs_you: {
      cards: cards.map(c => {
        const link = safeLink(links.find(l => l.card_id === c.id)?.link);
        return { ...c, kind: cardKind(c.closing_probe), ...(link ? { link } : {}) };
      }),
      more: Math.max(0, moreCards),
    },
    progress: {
      done_lately: done.map(i => ({ title: plain('text', i.title), updated_at: i.updated_at })), done_lately_more: Math.max(0, (counts.done || 0) - done.length),
      predictions: { hit: pred.hit || 0, scored: pred.scored || 0 },
      autonomy: ownRows.slice(0, SHOWN).map(r => ({ what: plain('action', r), level: plain('rung', r.rung), raw: { surface: r.surface, action_class: r.action_class, rung: r.rung } })),
      autonomy_more: Math.max(0, ownRows.length - SHOWN),
    },
    suggestions: suggestions.slice(0, SHOWN),
  };
}

/** Resolve a decision card from a button. Secrets cannot be set from a button, and a question closes only when it is answered, so
 *  those cards only explain (US-18-R09, section 4). */
export async function resolveCard(db, id, choice) {
  const card = await one(db, `SELECT id, what, default_in_effect, closing_probe, status FROM gate_cards WHERE id=?`, id);
  if (!card) return { status: 404, body: { error: 'no such card' } };
  if (card.status !== 'open') return { status: 409, body: { error: 'already closed' } };
  if (choice === 'explain') return { status: 200, body: { explain: explainCard(card) } };
  const kind = cardKind(card.closing_probe);
  if (kind === 'secret') return { status: 409, body: { error: 'This step happens in your cloud account; the card closes by itself when it is done.', explain: explainCard(card) } };
  if (kind === 'ask') return { status: 409, body: { error: 'This question closes when you answer it.', explain: explainCard(card) } };
  if (choice !== 'done' && choice !== 'default') return { status: 400, body: { error: 'choice must be done, default or explain' } };
  await run(db, `UPDATE gate_cards SET status='closed', closed_at=datetime('now') WHERE id=? AND status='open'`, id);
  await run(db, `INSERT INTO console_actions (kind, ref) VALUES (?, ?)`, choice === 'done' ? 'card_done' : 'card_default', id);
  return { status: 200, body: { ok: true } };
}

function explainCard(c) {
  const probe = c.closing_probe.startsWith('env:')
    ? 'This needs a value only you can add in your cloud account. The card closes by itself once it is there. You can connect it on the Connect screen.'
    : c.closing_probe.startsWith('elicit_answered:')
      ? 'This is a question only you can answer. Pick one of the answers when it appears; the card closes when you do.'
      : 'Press "I did it" when it is done, or "Use the default" to let the work carry on as described.';
  return `${c.what}. If you do nothing: ${c.default_in_effect}. ${probe}`;
}

// Questions the three screens already answer (US-18-R03, R04, R19): data, matched on the typed words. A question is the WHOLE text, matched as a sentence on its
// normalised form (lower case, no apostrophes or punctuation, and any leading run of the FILLER words dropped: please, hey, ok, okay, so, and, tell me, can you tell me, could you tell me). A request that merely contains such words ("What should
// be done about the logo colours?") is not a standing question: it is stored and becomes work (R03), never answered with an unrelated status line.
export const QUESTIONS = [
  ['needs', /^(?:(?:what|anything)(?: do| does)?(?: you| it)? (?:(?:need|want) (?:from|of) me|need)|what needs me|what(?: is|s| are)? waiting on me)$/],
  ['stuck', /^(?:(?:what|anything)(?: is| are)? (?:stuck|blocked)|whats (?:stuck|blocked))$/],
  ['finished', /^(?:what(?: did| have| has)?(?: you| it)? (?:finish|finished|complete|completed|done)|whats done|what is done)(?: lately| so far| recently)?$/],
  ['working', /^(?:what(?: are| is)? (?:you|it) (?:working on|doing)|where are things)(?: now| right now)?$/],
  ['how', /^(?:how well (?:is it|are you|are things) (?:doing|going)|how (?:is it|are things|are you) (?:doing|going)|hows (?:it|everything) (?:doing|going))$/],
];
const FILLER = /^(?:(?:please|hey|ok|okay|so|and|tell me|can you tell me|could you tell me)\s+)+/;
/** The standing question a typed text is, or null (US-18-R19). */
export function questionKind(text) {
  const n = String(text ?? '').toLowerCase().replace(/[\u2019']/g, '').replace(/[?!.,;:]+/g, ' ').replace(/\s+/g, ' ').trim().replace(FILLER, '');
  return QUESTIONS.find(([, re]) => re.test(n))?.[0] || null;
}
const SCREEN = { needs: 'needs', stuck: 'now', finished: 'prog', working: 'now', how: 'prog' };
const list = (xs, f, more, noun) => xs.map(f).join('; ') + (more ? `; and ${more} more ${noun}` : '');
function answerQuestion(kind, d) {
  if (kind === 'needs') return d.needs_you.cards.length ? `${d.needs_you.cards.length + d.needs_you.more} thing${d.needs_you.cards.length + d.needs_you.more === 1 ? '' : 's'} need you: ${list(d.needs_you.cards, c => c.what, d.needs_you.more, 'on the Needs you screen')}.` : 'Nothing needs you right now.';
  if (kind === 'stuck') return d.now.stuck.length ? `Stuck: ${list(d.now.stuck, i => `${i.title} (${i.blocker || 'no reason recorded'})`, d.now.stuck_more, 'on the Now screen')}.` : 'Nothing is stuck.';
  if (kind === 'finished') return d.progress.done_lately.length ? `Finished lately: ${list(d.progress.done_lately, i => i.title, d.progress.done_lately_more, 'on the Progress screen')}.` : 'Nothing has been finished yet.';
  if (kind === 'working') return d.now.working_on.length ? `Working on: ${list(d.now.working_on, i => i.title, d.now.working_on_more, 'on the Now screen')}.` : 'Nothing is being worked on right now.';
  const p = d.progress.predictions;
  return `${d.headline} ${p.scored ? `It called ${p.hit} of ${p.scored} outcomes right.` : 'Nothing has been scored yet.'}`;
}

/** A typed request is stored whole (US-18-R03). A question the screens already answer is answered from the records and creates no work;
 *  anything else becomes a work item the managers pick up, or a held scope-gate entry (SCOPE.md). */
export async function recordAsk(db, text) {
  const raw = String(text ?? '');
  const t = raw.trim();
  if (!t) return { status: 400, body: { error: 'empty request' } };
  if (t.length > MAX_TEXT) return { status: 413, body: { error: 'That is too long to keep as you wrote it. Please send it in two parts.' } };
  const q = t.length <= 100 ? questionKind(t) : null;
  if (q) {
    const answer = answerQuestion(q, await buildConsole(db, {}));
    await run(db, `INSERT INTO console_actions (kind, ref, text) VALUES ('question', NULL, ?)`, t);
    return { status: 200, body: { answered: true, held: false, answer, message: answer, screen: SCREEN[q] } };
  }
  const hit = OUT_OF_SCOPE.find(([re]) => re.test(t));
  const id = `ASK-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
  if (hit) {
    await run(db, `INSERT INTO items (id, title, kind, project, owner_role, done_check, closing_probe, priority, status, blocker)
      VALUES (?, ?, 'work', 'scope-gate', 'portfolio-manager', 'decision recorded on whether to enable a Capability Pack', 'manual', 30, 'blocked', ?)`,
      id, `Out of scope by default: ${t.slice(0, 120)}`, `Out of scope by default (SCOPE.md): ${hit[1]}. ${hit[2] ? `Held until the ${hit[2]} add-on is enabled.` : 'No add-on covers this.'}`);
    await run(db, `INSERT INTO console_actions (kind, ref, text) VALUES ('ask', ?, ?)`, id, t);
    return { status: 200, body: { id, held: true, pack: hit[2] ?? null, message: `That is ${hit[1]}, which Ultrastable does not do by default. I have noted it. ${hit[2] ? `It stays on hold until you choose to enable the ${hit[2]} add-on for it.` : 'No add-on covers it, so it stays on hold.'}` } };
  }
  await run(db, `INSERT INTO items (id, title, kind, project, owner_role, done_check, closing_probe, priority, status)
    VALUES (?, ?, 'work', 'requests', 'portfolio-manager', 'request understood, scoped, and answered or broken into items', 'manual', 20, 'open')`, id, `Request: ${t.slice(0, 160)}`);
  await run(db, `INSERT INTO console_actions (kind, ref, text) VALUES ('ask', ?, ?)`, id, t);
  return { status: 200, body: { id, held: false, message: 'Got it. It is on the list, and a manager will turn it into steps. You will see it under Now.' } };
}

// ---- access: default-deny. No CONSOLE_TOKEN configured means no console. Put Cloudflare Access in front in production. ----
const enc = new TextEncoder();
async function digest(s) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function tokenOk(given, expected) {
  const [a, b] = await Promise.all([digest(String(given || '')), digest(String(expected))]);
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
function cookie(req, name) { return (req.headers.get('cookie') || '').split(/;\s*/).map(p => p.split('=')).find(([k]) => k === name)?.[1]; }
const COOKIE = 'us_console';

const LOGIN = (msg = '') => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Sign in</title>
<body style="font:16px system-ui;max-width:22rem;margin:4rem auto;padding:0 1rem"><h1 style="font-size:1.3rem">Sign in</h1>${msg ? `<p>${msg}</p>` : ''}
<form method=post action=/console/login><label>Access key<br><input name=key type=password autocomplete=current-password style="width:100%;padding:.6rem;margin:.4rem 0"></label><button style="padding:.6rem 1rem">Open</button></form></body>`;

/** Route /console and /api/console/*. Returns null when the path is not ours.
 *  opts: { org, vault, doors (config.doors; omit = no first-run door), config (router providers name the keys to offer), l3 (console-l3 handle; serves /api/console/fleet/{state,digest,report-card}), decorate (async (body, { actor }) => body, applied to the GET /api/console data of a signed-in owner; core/org adds `screens`), mounts (owner-only handlers: async (request, { actor }) => Response | null, tried in order inside the signed-in surface; core/org mounts the walkthrough, the dashboard and the proxy guide here), fetch, now, envNames } */
export async function handleConsole(request, env, { org, vault, doors, config, l3, mounts = [], decorate = null, fetch: fetchFn, now = () => Date.now(), envNames = {} } = {}) {
  const url = new URL(request.url);
  const p = url.pathname;
  if (!(p === '/console' || p.startsWith('/console/') || p.startsWith('/api/console') || p === '/api/staff' || p.startsWith('/api/staff/'))) return null;
  const api = p.startsWith('/api/');
  const isPost = request.method === 'POST';
  const clock = typeof now === 'function' ? now : () => now;
  const access = doors?.access?.team_domain && doors?.access?.aud ? doors.access : null;
  // Google IAP (US-18-R09): a request through the configured Identity-Aware Proxy carries a signed header; ES256, issuer, audience and expiry are
  // checked by verifyIapJwt. Only when doors.iap.audience is set; like Cloudflare Access it makes the proxy the door, so no first-run key is issued.
  const iap = doors?.iap?.audience ? doors.iap : null;
  const iapOk = async () => (iap ? (await verifyIapJwt(request.headers.get('x-goog-iap-jwt-assertion'), { audience: iap.audience, fetch: fetchFn, now: clock() })).ok : false);

  // OWNER-AUTH-1 (c): once GitHub sign-in is connected, the us_session cookie is the only sign-in path (CONSOLE_TOKEN and the first-run key stop working).
  if (await githubSigninActive(vault, config)) {
    const session = await readSession(decodeURIComponent(cookie(request, SESSION_COOKIE) || ''), { key: await vault.read('SESSION_KEY'), now: clock() });
    const accessOk = (access ? await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), { ...access, fetch: fetchFn, now: clock() }) : false) || await iapOk();
    if (p === '/console/first-run') return Response.json({ error: 'not found' }, { status: 404 });
    if (p === '/console/login') return Response.json({ error: 'keys are no longer used; sign in with GitHub at /console/github/signin' }, { status: 410 });
    if (!canWrite(session) && !accessOk) return readOnlyView(request, { db: env.DB, config, session, clock });
    const actor = session?.login || 'access';
    return ownerRoutes(request, env, { org, vault, doors, config, l3, mounts, decorate, now: clock, envNames, confirm: true, actor });
  }

  // Which door is open? A configured token, else an Access team, else the one-time first-run key (src/first-run.js).
  let issuedHash = null;
  if (!env.CONSOLE_TOKEN && !access && !iap) {
    const door = await firstRunDoor(request, env, { doors, now: clock() });
    if (door.response) return door.response;
    issuedHash = door.issuedHash;
  }
  if (p === '/console/first-run') return Response.json({ error: 'not found' }, { status: 404 });

  const keyOk = async given => {
    if (!given) return false;
    if (env.CONSOLE_TOKEN && await tokenOk(given, env.CONSOLE_TOKEN)) return true;
    return issuedHash ? tokenOk(await sha256Hex(given), issuedHash) : false;
  };

  if (p === '/console/login' && isPost) {
    const form = await request.formData().catch(() => null);
    const given = form ? String(form.get('key') || '') : '';
    if (await keyOk(given)) {
      return new Response(null, { status: 303, headers: { location: '/console', 'set-cookie': `${COOKIE}=${encodeURIComponent(given)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000` } });
    }
    return page(LOGIN('That key did not work.'), 401);
  }
  let authed = await keyOk(decodeURIComponent(cookie(request, COOKIE) || ''));
  if (!authed && access) authed = await verifyAccessJwt(request.headers.get('cf-access-jwt-assertion'), { ...access, fetch: fetchFn, now: clock() });
  if (!authed && iap) authed = await iapOk();
  if (!authed) return api ? Response.json({ error: 'sign in' }, { status: 401 }) : page(LOGIN(), 401);

  return ownerRoutes(request, env, { org, vault, doors, config, l3, mounts, decorate, fetch: fetchFn, now: clock, envNames, confirm: false, actor: null });
}

/** The owner-write routes a mount serves (the walkthrough, the read-back and the profile; core/walkthrough), and the person's screen for a role (core/staff: act and reverse). */
export const MOUNTED_WRITES = ['/api/console/walkthrough/idea', '/api/console/walkthrough/answer', '/api/console/readback', '/api/console/profile'];
const STAFF_WRITE = /^\/api\/staff\/[^/]+\/(?:act|reverse)$/;
export const isMountedWrite = p => MOUNTED_WRITES.includes(p) || STAFF_WRITE.test(p);

/** The signed-in surface: the console page, its data and its write actions. With `confirm` (session mode) every write needs a
 *  second step, body.confirm === true (the page asks "are you sure"), and each success is recorded with who did it. */
async function ownerRoutes(request, env, { org, vault, doors, config, l3, mounts = [], decorate = null, fetch: fetchFn, now: clock, envNames, confirm, actor }) {
  const url = new URL(request.url);
  const p = url.pathname;
  const isPost = request.method === 'POST';
  // Owner-only mounted surfaces (issue #201). Reaching this function means the caller is signed in; a mount never runs for a viewer.
  // US-18-R15: in session mode the owner writes the walkthrough, the read-back and the profile mount are as much owner writes as a card press: they carry the same
  // origin and confirm checks and each success is recorded as signed_action with the login. (The dashboard's own POST /api/refresh is a recompute, not an owner write.)
  const mountedWrite = isPost && isMountedWrite(p.replace(/\/+$/, ''));
  if (mountedWrite) {
    const origin = request.headers.get('origin');
    if (!origin || origin !== url.origin) return Response.json({ error: 'cross-origin request refused' }, { status: 403 });
    if (confirm) {
      const sent = await request.clone().json().catch(() => ({}));
      if (sent.confirm !== true) return Response.json({ error: 'confirm required: press the button, then confirm' }, { status: 428 });
    }
  }
  for (const mount of mounts) {
    const r = await mount(request.clone(), { actor });
    if (!r) continue;
    if (mountedWrite && confirm && r.status === 200) {
      const said = await r.clone().json().catch(() => ({})); // a "Tell me more" press only explains and writes nothing to sign
      if (!said.explain) await run(env.DB, `INSERT INTO console_actions (kind, ref, text) VALUES ('signed_action', ?, ?)`, p.replace(/\/+$/, '').replace(/^\/api\/(?:console\/)?/, ''), actor);
    }
    return r;
  }
  if (l3 && request.method === 'GET' && p.startsWith('/api/console/fleet/')) {
    const inner = new URL(request.url); inner.pathname = '/api/' + p.slice('/api/console/fleet/'.length);
    return (await l3.handle(new Request(inner, { method: 'GET' }))) || Response.json({ error: 'not found' }, { status: 404 });
  }
  if (request.method === 'GET' && (p === '/console' || p === '/console/')) return page(CONSOLE_HTML);
  if (request.method === 'GET' && (p === '/api/console/records' || p === '/api/console/records/')) return records(env.DB, url);
  if (request.method === 'GET' && p === '/api/console') {
    const body = await buildConsole(env.DB, { org });
    body.connections = await listConnections(vault, envNames, { router: config?.router });
    // GitHub access is one click (US-30-R55): a link entry, never a field to paste a token into.
    if (vault) { try { const g = await githubConnection(vault); body.connections.push({ ...g, help: 'This lets the system open draft pull requests on your code host. Choose Connect GitHub and approve on the GitHub page; nothing is copied or pasted.' }); } catch { /* a missing connection entry never breaks the console */ } }
    body.doors = await doorStatus(env, { doors, now: clock() });
    body.help = HELP_SECTIONS; // generated from docs/help.md
    if (decorate) { try { Object.assign(body, await decorate(body, { actor })); } catch { /* a decorator never breaks the console */ } }
    return Response.json(body, { headers: { 'cache-control': 'no-store' } });
  }

  if (isPost) { // state-changing: same-origin only
    const origin = request.headers.get('origin');
    if (!origin || origin !== url.origin) return Response.json({ error: 'cross-origin request refused' }, { status: 403 });
    const body = await request.json().catch(() => ({}));
    if (confirm && body.confirm !== true) return Response.json({ error: 'confirm required: press the button, then confirm' }, { status: 428 });
    let r;
    if (p === '/api/console/card') r = await resolveCard(env.DB, String(body.id || ''), String(body.choice || ''));
    else if (p === '/api/console/ask') r = await recordAsk(env.DB, body.text);
    else if (p === '/api/console/secret') {
      r = await saveSecret(vault, body);
    } else if (p === '/api/console/secret/remove') r = await removeSecret(vault, body);
    else return Response.json({ error: 'not found' }, { status: 404 });
    const readOnlyPress = p === '/api/console/card' && body.choice === 'explain';
    if (confirm && r.status === 200 && !readOnlyPress) await run(env.DB, `INSERT INTO console_actions (kind, ref, text) VALUES ('signed_action', ?, ?)`, p.replace('/api/console/', ''), actor);
    return Response.json(r.body, { status: r.status });
  }
  return Response.json({ error: 'not found' }, { status: 404 });
}

// US-18-R08: everything the person owns is reachable as records through the interface an agent uses. Read-only, owner-only, an allow-list of
// tables (never the vault, sessions or secrets), columns that look like secrets are dropped, pages are at most 100 rows and say where the next begins.
export const RECORD_TABLES = ['items', 'claims', 'gate_cards', 'predictions', 'outcomes', 'console_actions', 'trust_ledger', 'tick_runs', 'elicit_needs', 'elicit_assumptions', 'elicit_glossary', 'elicit_audit', 'walkthrough_state', 'walkthrough_profiles', 'predict_decisions', 'predict_predictions'];
const SECRETISH = /secret|token|key|password|hash|credential/i;
const PAGE = 100;
async function records(db, url) {
  const present = new Set((await all(db, `SELECT name FROM sqlite_master WHERE type='table'`)).map(r => r.name));
  const allowed = [...RECORD_TABLES.filter(t => present.has(t)), ...[...present].filter(t => /^lifecycle_[a-z_]+$/.test(t)).sort()];
  const table = url.searchParams.get('table');
  const noStore = { 'cache-control': 'no-store' };
  if (!table) return Response.json({ tables: allowed }, { headers: noStore });
  if (!allowed.includes(table)) return Response.json({ error: 'not a table you can read here', tables: allowed }, { status: 404, headers: noStore });
  const cols = (await all(db, `SELECT name FROM pragma_table_info(?)`, table)).map(r => r.name).filter(c => !SECRETISH.test(c));
  if (!cols.length) return Response.json({ error: 'nothing readable in that table' }, { status: 404, headers: noStore });
  const limit = Math.min(PAGE, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(PAGE), 10) || PAGE));
  const after = Math.max(0, Number.parseInt(url.searchParams.get('after') || '0', 10) || 0);
  const rows = await all(db, `SELECT rowid AS _rowid, ${cols.map(c => `"${c}"`).join(', ')} FROM "${table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`, after, limit + 1);
  const page = rows.slice(0, limit);
  const next = rows.length > limit ? page[page.length - 1]._rowid : null;
  if (url.searchParams.get('format') === 'ndjson') {
    return new Response(page.map(r => JSON.stringify(r)).join('\n') + (page.length ? '\n' : ''), { headers: { 'content-type': 'application/x-ndjson', 'x-next-after': next === null ? '' : String(next), ...noStore } });
  }
  return Response.json({ table, columns: cols, rows: page, next, omitted_columns: 'columns that look like secrets are never returned' }, { headers: noStore });
}

/** GitHub sign-in is on when the vault holds the App's OAuth credentials and the repository the role is read from is known.
 *  config.console.github_signin === false switches it off. Until then the older doors keep a fresh installation reachable. */
export async function githubSigninActive(vault, config) {
  if (!vault || !config?.vcs?.repo || config?.console?.github_signin === false) return false;
  try { return Boolean(await vault.has('GITHUB_APP_CLIENT_ID') && await vault.has('GITHUB_APP_CLIENT_SECRET')); } catch { return false; }
}

/** What anyone who is not an owner sees: the read-only dashboard when the owner turned the public view on, otherwise a sign-in
 *  page (no session) or a refusal (a signed-in viewer). Every other path is refused. Reads only. */
async function readOnlyView(request, { db, config, session, clock }) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, '');
  const api = p.startsWith('/api/');
  const open = publicViewEnabled(config);
  if (request.method === 'GET' && open && (p === '/console' || p === '/api/console/public')) {
    const m = await loadMeasures({ db, now: clock(), config });
    return p === '/api/console/public' ? Response.json(m, { headers: { 'cache-control': 'no-store' } }) : page(renderPublicView(m, { viewer: session?.login || null }));
  }
  if (api) return Response.json({ error: session ? 'owner only' : 'sign in' }, { status: session ? 403 : 401 });
  if (session) return SETUP(`<h1>Read-only</h1><p>${esc(session.login)} can view this organization, not change it.</p>`, 403);
  return SETUP('<h1>Sign in</h1><p><a href="/console/github/signin">Sign in with GitHub</a></p>', 401);
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
