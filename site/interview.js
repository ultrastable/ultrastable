// INTERVIEW-2 (owner, 2026-11-12): the front door is a conversation, not a form or a wizard. It looks like the chat threads people already use:
// a rounded pill input with a microphone for dictation, ideas that rotate and respond to what is typed (never a fixed list), short tap-to-answer
// questions inside the thread, and then each build step shown as it runs, the way the fleet command line shows a command executing. A person
// who writes code can skip ahead at any time. With no JavaScript it is a plain pill form that posts to /api/idea (the server-side questions run).
// Consumers: site/worker.js (renders askBar + CSS into / , /start and /setup; /api/suggest, /api/idea?json, /s/<id>/status feed it);
// tests in site/site.test.mjs.
import IB from "./idea-bank-data.js";
export const CSS = [
  ".us-iv [hidden]{display:none!important}",
  ".us-iv{max-width:720px;margin:18px 0 8px}",
  ".us-log{display:flex;flex-direction:column;gap:10px;margin:0 0 12px}.us-log:empty{display:none}",
  ".us-m{max-width:88%;padding:12px 16px;border-radius:20px;line-height:1.45;font-size:17px;word-wrap:break-word;animation:usin .18s ease-out}",
  ".us-m.bot{align-self:flex-start;background:var(--sf);border:1px solid var(--line);border-bottom-left-radius:6px}",
  ".us-m.me{align-self:flex-end;background:var(--ac);color:var(--on);border-bottom-right-radius:6px}",
  ".us-m ul{margin:0;padding-left:20px}.us-m p{margin:0 0 8px}.us-m p:last-child{margin:0}.us-m a{color:inherit;font-weight:600}",
  "@keyframes usin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.us-m{animation:none}}",
  ".us-steps{list-style:none;margin:0;padding:0;font:15px/1.4 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}",
  ".us-steps li{display:flex;gap:10px;align-items:flex-start;padding:5px 0;color:var(--ink2)}.us-steps li.run{color:var(--ink)}.us-steps li.ok{color:var(--ink)}.us-steps li.bad{color:var(--bad)}",
  ".us-steps .ic{width:18px;flex:none;text-align:center}.us-steps li.ok .ic{color:var(--good)}",
  ".us-steps li.run .ic::before{content:'';display:inline-block;width:11px;height:11px;border:2px solid var(--ac);border-right-color:transparent;border-radius:50%;animation:ussp .8s linear infinite}",
  "@keyframes ussp{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.us-steps li.run .ic::before{animation:none}}",
  ".us-ask{display:flex;align-items:center;gap:6px;background:var(--sf);border:1.5px solid var(--line);border-radius:999px;padding:6px 6px 6px 22px;box-shadow:0 2px 12px rgba(0,0,0,.08);margin:6px 0;transition:box-shadow .15s,border-color .15s;position:sticky;bottom:12px;z-index:5}",
  ".us-ask:focus-within{border-color:var(--ac);box-shadow:0 4px 20px rgba(201,61,0,.18)}",
  ".us-ask input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:inherit;font-size:18px;min-height:48px;outline:0}",
  ".us-ask input::placeholder{color:var(--ink2)}",
  ".us-rb{width:48px;height:48px;border-radius:50%;border:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:var(--ink);flex:none}",
  ".us-rb:hover{background:var(--sf2)}.us-rb svg{width:22px;height:22px;fill:currentColor}",
  ".us-rb.go{background:var(--ac);color:var(--on)}.us-rb.go:hover{filter:brightness(1.08)}.us-rb:disabled{opacity:.5;cursor:default}",
  ".us-rb.live{background:var(--ac);color:var(--on);animation:usp 1.2s infinite}",
  "@keyframes usp{0%{box-shadow:0 0 0 0 rgba(201,61,0,.5)}100%{box-shadow:0 0 0 16px rgba(201,61,0,0)}}@media(prefers-reduced-motion:reduce){.us-rb.live{animation:none}}",
  ".us-chips{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.us-chips.fade{opacity:0;transition:opacity .2s}",
  ".us-chip{border:1.5px solid var(--line);background:var(--sf);color:var(--ink);border-radius:999px;padding:9px 16px;min-height:44px;font:600 15px system-ui;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;text-align:left;transition:opacity .2s}",
  ".us-chip:hover{border-color:var(--ac)}.us-chip.pick{background:var(--soft);border-color:var(--ac)}.us-chip.quiet{border-style:dashed;color:var(--ink2)}",
  ".us-note{color:var(--ink2);font-size:14px;margin:6px 4px}",
  ".us-lane{border-top:1px solid var(--line);margin-top:28px;padding-top:6px}"
].join("\n");

const MIC = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z\"/></svg>";
const GO = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 12l16-8-6 16-3-7-7-1z\"/></svg>";

// The component. Progressive enhancement: the form works without JavaScript; the script turns it into the thread.
export function askBar(lead) {
  return "<section class=\"us-iv\" id=\"us-iv\" aria-label=\"Start with an idea\"><div class=\"us-log\" id=\"us-log\" role=\"log\" aria-live=\"polite\"></div>"
    + "<form method=\"post\" action=\"/api/idea\" class=\"us-ask\" id=\"us-ask\" role=\"search\">"
    + "<input id=\"us-in\" name=\"idea\" type=\"text\" maxlength=\"1500\" autocomplete=\"off\" enterkeyhint=\"send\" required aria-label=\"Tell me what is on your mind\" placeholder=\"" + (lead || "Say or type a few words…") + "\">"
    + "<button type=\"button\" class=\"us-rb\" id=\"us-mic\" aria-label=\"Dictate\" title=\"Dictate\" hidden>" + MIC + "</button>"
    + "<button type=\"submit\" class=\"us-rb go\" id=\"us-go\" aria-label=\"Send\" title=\"Send\">" + GO + "</button></form>"
    + "<div class=\"us-chips\" id=\"us-sug\" aria-label=\"Ideas to start from\"><a class=\"us-chip\" href=\"/start\">Make something new</a></div>"
    + "<p class=\"us-note\" id=\"us-hint\">One or two words is enough. Press the microphone to dictate. <a href=\"/engineers\">I write code: skip ahead</a></p></section>"
    + "<script>" + JS + "</script>";
}

// Client script. Plain source (no backticks) so String.raw keeps every regex escape. Questions are data; an utterance can pre-answer some of them.
export const JS = String.raw`(function () {
  var $ = function (i) { return document.getElementById(i); };
  var root = $('us-iv'); if (!root || root.getAttribute('data-on')) return; root.setAttribute('data-on', '1');
  var form = $('us-ask'), inp = $('us-in'), mic = $('us-mic'), go = $('us-go'), log = $('us-log'), sug = $('us-sug'), hint = $('us-hint');
  var Q = [
    { id: 'kind', q: 'Is it something people open and use, or something that quietly runs by itself?', o: [['A', 'People use it', 'an app or website people use'], ['B', 'Runs by itself', 'an automation that runs by itself']], k: { A: /\b(app|site|website|page|portal|store|shop|game|tool|list|board)\b/, B: /\b(automat|bot|schedul|remind|alert|monitor|sync|pipeline|watch)\w*/ } },
    { id: 'who', q: 'Is it just for you, or for other people too?', o: [['A', 'Just me', 'for personal use'], ['B', 'Other people', 'for other people, such as customers or a community']], k: { A: /\b(my own|for me|personal|myself)\b/, B: /\b(customers?|clients?|members?|neighbou?rs?|community|users?|everyone|people|team|guests|parents|students)\b/ } },
    { id: 'money', q: 'Should it earn money?', yn: 1, o: [['Y', 'Yes', 'it should earn money'], ['N', 'No', 'it does not need to earn money']], k: { Y: /\b(sell|earn|money|revenue|pay|charge|subscription|business|profit|shop|store)\b/ } },
    { id: 'start', q: 'Do you already have something started?', yn: 1, o: [['Y', 'Yes', 'there is existing work to build on'], ['N', 'No', 'starting from nothing']], k: { Y: /\b(already|existing|have a|my current|broken|slow|improve)\b/ } },
    { id: 'depth', q: 'Quick and simple first, or thorough and polished?', o: [['A', 'Quick first', 'a quick, simple first version'], ['B', 'Thorough', 'a thorough, polished version']], k: { A: /\b(quick|simple|fast|prototype|rough)\b/, B: /\b(polish|thorough|complete|professional|full)\b/ } }
  ];
  var S = { text: '', ans: {}, phase: 'idea', cur: null, id: null, busy: false, seed: Math.floor(Math.random() * 1e9), shown: [], pool: [] };
  // CLONE-PATH-1: a system started from the template arrives here by one link with its idea already written (?idea=...); nobody types it twice.
  try { var pre = new URLSearchParams(location.search).get('idea'); if (pre && inp && !inp.value) inp.value = pre.slice(0, 1500); } catch (e) { console.error('idea prefill', e); }
  var YES = /^(yes|yeah|yep|yup|sure|ok|okay|correct|right|true|definitely|please|of course)\b/, NO = /^(no|nope|nah|not|never|don'?t)\b/;
  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function scroll() { try { form.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } catch (e) { } }
  function say(who, nodeOrText) {
    var m = el('div', 'us-m ' + who);
    if (typeof nodeOrText === 'string') m.appendChild(el('p', null, nodeOrText)); else m.appendChild(nodeOrText);
    log.appendChild(m); scroll(); return m;
  }
  function chipRow(items, host) {
    var row = el('div', 'us-chips'); items.forEach(function (it) {
      var b = el(it.href ? 'a' : 'button', 'us-chip' + (it.cls ? ' ' + it.cls : ''), it.label);
      if (it.href) { b.href = it.href; if (it.blank) { b.target = '_blank'; b.rel = 'noopener'; } } else { b.type = 'button'; b.onclick = function () { if (it.once !== false) row.querySelectorAll('button').forEach(function (x) { x.disabled = true; }); it.fn(); }; }
      row.appendChild(b);
    });
    (host || log).appendChild(row); scroll(); return row;
  }

  // ---- suggestions: rotate by themselves, and re-rank as the person types ----
  var FALL = ${JSON.stringify(IB.FALLBACK)};
  var EX = ${JSON.stringify(Object.fromEntries(IB.BANK.map(function (b) { return [b[0], b[4]]; })))};
  function recent() { try { return JSON.parse(localStorage.getItem('us.recent') || '[]'); } catch (e) { return []; } }
  function remember(t) { try { var r = recent().filter(function (x) { return x !== t; }); r.unshift(t); localStorage.setItem('us.recent', JSON.stringify(r.slice(0, 5))); } catch (e) { } }
  function fetchSug(q, cb) {
    var url = '/api/suggest?n=4&seed=' + (S.seed++) + '&q=' + encodeURIComponent(q.slice(0, 200)) + '&seen=' + encodeURIComponent(S.shown.slice(-8).join('|'));
    fetch(url).then(function (r) { return r.json(); }).then(function (d) { S.ex = d.ex || S.ex || {}; cb(Array.isArray(d.s) && d.s.length ? d.s : null); }).catch(function () { cb(null); });
  }
  function drawSug(list) {
    if (S.phase !== 'idea') { sug.hidden = true; return; }
    sug.hidden = false; sug.classList.add('fade');
    setTimeout(function () {
      sug.textContent = ''; var r = recent()[0];
      if (r && !inp.value) { var c = el('button', 'us-chip pick', 'Pick up: ' + (r.length > 44 ? r.slice(0, 44) + '…' : r)); c.type = 'button'; c.onclick = function () { begin(r); }; sug.appendChild(c); }
      list.forEach(function (t) { if (S.shown.indexOf(t) < 0) S.shown.push(t); var c = el('button', 'us-chip', t); c.type = 'button'; c.onclick = function () { begin(t); }; sug.appendChild(c); var x = (S.ex || EX)[t]; if (x) { var a = el('a', 'us-live', 'See it running'); a.href = x; a.rel = 'noopener'; sug.appendChild(a); } });
      S.pool = list; sug.classList.remove('fade');
    }, 200);
  }
  function rotate() { if (S.phase !== 'idea' || document.hidden) return; fetchSug(inp.value, function (l) { drawSug(l || FALL.slice(S.seed % 3, S.seed % 3 + 4)); }); }
  function placeholder() { if (S.phase === 'idea' && !inp.value && S.pool.length) inp.placeholder = 'Try: ' + S.pool[Math.floor(Date.now() / 4000) % S.pool.length].replace(/^An? /, '').toLowerCase(); }
  var deb = null; inp.addEventListener('input', function () { clearTimeout(deb); if (S.phase === 'idea') deb = setTimeout(rotate, 450); });
  setInterval(rotate, 9000); setInterval(placeholder, 4000); rotate();

  // ---- dictation: fills the pill live, sends when the person stops speaking ----
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, rec = null;
  function micMsg(m) { hint.textContent = m === 'not-allowed' || m === 'service-not-allowed' ? 'The microphone is blocked for this site. Type instead, or allow the microphone in your browser and press it again.' : m === 'no-speech' ? 'I did not hear anything. Press the microphone and try again, or type.' : 'Dictation stopped. Press the microphone to try again, or type.'; }
  // META-SIGNAL-1: microphone events (codes only, never audio or text) go to the server's meta loop, which files roadmap items from patterns.
  function meta(code) { try { var b = JSON.stringify({ source: 'mic-event', code: code, surface: 'interview', at: new Date().toISOString() }); if (!(navigator.sendBeacon && navigator.sendBeacon('/api/meta/ingest', new Blob([b], { type: 'application/json' })))) fetch('/api/meta/ingest', { method: 'POST', body: b, keepalive: true, headers: { 'Content-Type': 'application/json' } }); } catch (e) { } }
  var dictated = '';
  inp.addEventListener('input', function () { if (dictated && inp.value !== dictated) { meta('edited-after-dictation'); dictated = ''; } });
  if (!SR) meta('unsupported');
  if (SR) {
    mic.hidden = false;
    mic.onclick = function () {
      if (mic.classList.contains('live')) { try { rec.stop(); } catch (e) { } return; }
      try { rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1; } catch (e) { micMsg('x'); return; }
      var heard = ''; mic.classList.add('live'); mic.setAttribute('aria-label', 'Listening. Press to stop');
      rec.onresult = function (e) { var t = ''; for (var k = 0; k < e.results.length; k++) t += e.results[k][0].transcript; heard = t; inp.value = t; };
      rec.onerror = function (e) { meta(e.error); micMsg(e.error); };
      rec.onend = function () { mic.classList.remove('live'); mic.setAttribute('aria-label', 'Dictate'); dictated = heard.trim() ? heard : ''; if (heard.trim()) form.requestSubmit ? form.requestSubmit() : submit(); };
      try { rec.start(); } catch (e) { mic.classList.remove('live'); meta('busy'); micMsg('busy'); }
    };
  }

  // ---- the conversation ----
  function infer() { var t = S.text.toLowerCase(); Q.forEach(function (q) { if (S.ans[q.id]) return; var hit = null, n = 0; Object.keys(q.k).forEach(function (c) { if (q.k[c].test(t)) { hit = c; n++; } }); if (n === 1 && hit) S.ans[q.id] = { c: hit, auto: 1 }; }); }
  function pending() { return Q.filter(function (q) { return !S.ans[q.id]; }); }
  function label(q, c) { var o = q.o.filter(function (x) { return x[0] === c; })[0]; return o ? o[2] : ''; }
  function shortLabel(q, c) { var o = q.o.filter(function (x) { return x[0] === c; })[0]; return o ? o[1] : ''; }
  function matchSpoken(q, t) {
    t = t.toLowerCase().trim(); if (q.yn) { if (YES.test(t)) return 'Y'; if (NO.test(t)) return 'N'; }
    if (!q.yn && /\b(a|first|option a)\b/.test(t)) return 'A'; if (!q.yn && /\b(b|second|option b)\b/.test(t)) return 'B';
    for (var k = 0; k < q.o.length; k++) { var w = q.o[k][1].toLowerCase().split(' '); if (t.indexOf(q.o[k][1].toLowerCase()) >= 0 || (w.length > 1 && t.indexOf(w[w.length - 1]) >= 0)) return q.o[k][0]; }
    if (/not sure|don'?t know|skip|either|maybe/.test(t)) return '?'; return null;
  }
  function begin(t) {
    t = String(t || '').trim(); if (!t) { inp.focus(); return; }
    S.text = (S.text ? S.text + '. ' : '') + t; inp.value = ''; inp.placeholder = 'Reply, or add more detail…'; sug.hidden = true; S.phase = 'asking';
    say('me', t); infer();
    var known = Object.keys(S.ans).map(function (id) { var q = Q.filter(function (x) { return x.id === id; })[0]; return q ? label(q, S.ans[id].c) : ''; }).filter(Boolean);
    var m = el('div'); m.appendChild(el('p', null, 'Got it.' + (known.length ? ' From what you said I took it as: ' + known.join('; ') + '.' : '')));
    m.appendChild(el('p', null, pending().length ? 'A couple of quick questions so I build the right thing. Tap an answer, or just say it.' : 'That is enough to start.')); say('bot', m);
    nextQ();
  }
  function nextQ() {
    var left = pending(); if (!left.length) return plan();
    var q = left[0]; S.cur = q; say('bot', q.q);
    var items = q.o.map(function (o) { return { label: o[1], fn: function () { answer(q, o[0], o[1]); } }; });
    items.push({ label: 'Not sure', cls: 'quiet', fn: function () { answer(q, '?', 'Not sure'); } });
    items.push({ label: 'That is enough, build it', cls: 'quiet', fn: function () { plan(); } });
    chipRow(items);
  }
  function answer(q, c, shown) { S.ans[q.id] = { c: c }; say('me', shown); S.cur = null; nextQ(); }
  function compose() { var parts = [S.text]; Q.forEach(function (q) { var a = S.ans[q.id]; if (a && a.c !== '?') parts.push(label(q, a.c)); }); return parts.join('. '); }
  function plan() {
    S.cur = null; S.phase = 'planned'; var m = el('div'); m.appendChild(el('p', null, 'Here is what I will build:')); m.appendChild(el('p', null, '\u201C' + S.text + '\u201D')); var ul = el('ul'); Q.forEach(function (q) { var a = S.ans[q.id]; if (a && a.c !== '?') ul.appendChild(el('li', null, label(q, a.c).replace(/^./, function (x) { return x.toUpperCase(); }))); }); if (ul.childNodes.length) m.appendChild(ul); say('bot', m);
    chipRow([{ label: 'Build it', cls: 'pick', fn: run }, { label: 'Start over', cls: 'quiet', fn: function () { location.reload(); } }]);
    inp.placeholder = 'Add more detail, then tap Build it…';
  }

  // ---- execution, shown the way a command line shows a command running ----
  var steps = null;
  function step(text) { var li = el('li', 'run'); li.appendChild(el('span', 'ic', '')); li.appendChild(el('span', null, text)); steps.appendChild(li); scroll(); return li; }
  function mark(li, ok, text) { li.className = ok ? 'ok' : 'bad'; li.firstChild.textContent = ok ? '✓' : '✗'; if (text) li.lastChild.textContent = text; }
  function post(path, fd) { return fetch(path, { method: 'POST', body: fd, headers: { Accept: 'application/json' } }).then(function (r) { return r.json().then(function (d) { if (!r.ok) throw new Error(d.error || 'failed'); return d; }); }); }
  function run() {
    if (S.busy) return; S.busy = true; S.phase = 'building'; remember(S.text.slice(0, 120));
    var wrap = el('div'); wrap.appendChild(el('p', null, 'On it. Each step shows as it happens.')); steps = el('ul', 'us-steps'); wrap.appendChild(steps); say('bot', wrap);
    var s1 = step('Understood your idea'); mark(s1, true);
    var s2 = step('Saving the plan'), prof = {}; Object.keys(S.ans).forEach(function (k) { prof[k] = S.ans[k].c; });
    var fd = new FormData(); fd.set('idea', compose().slice(0, 1900)); fd.set('profile', JSON.stringify({ said: S.text.slice(0, 500), space: prof, thread: true }));
    post('/api/idea', fd).then(function (d) { S.id = d.id; mark(s2, true, 'Plan saved'); return poll(d.id, step('Writing your site'), 0); }).catch(function (e) { mark(s2.className === 'run' ? s2 : step('Stopped'), false, 'That did not work: ' + (e.message || 'please try again')); fail(); });
  }
  function poll(id, li, n) {
    return fetch('/s/' + id + '/status', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.state === 'ready') { mark(li, true, 'Your site is written'); return audited(id, 0); }
      if (d.state === 'failed' || n > 8) { mark(li, false, 'The site could not be written this time. Your idea is saved and it is tried again by itself'); var keep = el('p'), a = el('a', null, 'Keep this page: it updates when your site is ready'); a.href = '/s/' + id + '/make'; keep.appendChild(a); say('bot', keep); return fail(); }
      return new Promise(function (ok) { setTimeout(ok, 1500); }).then(function () { return poll(id, li, n + 1); });
    }).catch(function () { mark(li, false, 'Lost the connection'); fail(); });
  }
  function audited(id, n) {
    var li = n === 0 ? (S.chk = step('Checking it against what you asked')) : S.chk;
    return fetch('/s/' + id + '/status?audit=1', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (d) {
      if (d.audit) { mark(li, true, 'Checked' + (d.audit.fixed && d.audit.fixed.length ? ' and fixed ' + d.audit.fixed.length + ' problem' + (d.audit.fixed.length > 1 ? 's' : '') : '')); return live(id, d.audit); }
      if (n > 10) { mark(li, true, 'Check still running; you can read it later'); return live(id, null); }
      return new Promise(function (ok) { setTimeout(ok, 2500); }).then(function () { return audited(id, n + 1); });
    }).catch(function () { mark(li, true, 'Check will finish in the background'); live(id, null); });
  }
  function live(id, a) {
    var li = step('Publishing'); mark(li, true, 'Live');
    var m = el('div'); var rest = a && a.gaps ? a.gaps.length : 0; m.appendChild(el('p', null, rest ? 'Your site is live, with limits I want you to know about.' : 'Your site is live.'));
    var vague = /basic html|css styling|structure is provided|javascript functions are defined/i; if (a && a.met && a.met.filter(function (x) { return !vague.test(x); }).length) m.appendChild(el('p', null, 'Working now: ' + a.met.filter(function (x) { return !vague.test(x); }).slice(0, 3).join('; ') + '.'));
    if (a && a.gaps && a.gaps.length) m.appendChild(el('p', null, (a.fixed && a.fixed.length ? 'I tried to fix these and could not confirm it: ' : 'Not yet: ') + a.gaps.slice(0, 2).map(function (g) { return g.what; }).join('; ') + '.'));
    say('bot', m); S.busy = false; S.phase = 'live'; inp.placeholder = 'Tell me what to change…';
    chipRow([{ label: 'Open my site', cls: 'pick', href: '/s/' + id, blank: true }, { label: 'What I checked', href: '/s/' + id + '/review', blank: true }, { label: 'Set up the organization', fn: function () { setupOrg(id); } }, { label: 'Start another', cls: 'quiet', fn: function () { location.reload(); } }]);
  }
  // ---- setup-org (ORG-THREAD-1): the organization around the site is set up here in the thread; each answer is saved on the server (/api/org) ----
  function orgPost(id, stepId, ans) { var fd = new FormData(); fd.set('id', id); if (stepId) { fd.set('step', stepId); fd.set('answer', ans); } return post('/api/org', fd); }
  function setupOrg(id) {
    if (S.busy) return; S.busy = true; say('me', 'Set up the organization');
    var wrap = el('div'); wrap.setAttribute('data-flow', 'setup-org'); wrap.appendChild(el('p', null, 'Setting up the organization that keeps this running.')); steps = el('ul', 'us-steps'); wrap.appendChild(steps); say('bot', wrap);
    var s1 = step('Reading your idea');
    orgPost(id).then(function (d) {
      mark(s1, true, 'Objective: ' + d.plan.objective);
      mark(step('Choosing what to measure'), true, 'Measures: ' + d.plan.measures.length + ' set from the first minute');
      mark(step('Choosing who works on it'), true, 'Roles: ' + d.plan.roles.map(function (r) { return r.id.replace('-', ' '); }).join(', '));
      S.busy = false; orgStep(id, d);
    }).catch(function (e) { mark(s1, false, 'That did not work: ' + (e.message || 'please try again')); S.busy = false; });
  }
  function orgStep(id, d) {
    if (!d.next) { say('bot', d.state === 'set_up' ? 'The organization is set up. It now runs and improves by itself.' : 'Saved. The steps you skipped are kept here; tap Set up the organization to pick them up.'); return; }
    var n = d.next, m = el('div'); m.appendChild(el('p', null, 'Step ' + (d.done + 1) + ' of ' + d.total + (n.optional ? ' (optional)' : '') + ': ' + n.ask)); m.appendChild(el('p', null, n.why)); say('bot', m);
    var go = function (ans, shown) { say('me', shown); orgPost(id, n.id, ans).then(function (x) { orgStep(id, x); }).catch(function () { say('bot', 'I could not save that. Tap Set up the organization to carry on.'); }); };
    var items = []; if (n.url) items.push({ label: n.label || 'Open it', href: n.url, blank: true });
    var yes = n.url && !n.have ? 'Done' : 'Yes'; items.push({ label: yes, cls: 'pick', fn: function () { go('done', yes); } }); items.push({ label: 'Not now', cls: 'quiet', fn: function () { go('skipped', 'Not now'); } });
    chipRow(items);
  }
  function fail() { S.busy = false; S.phase = 'planned'; chipRow([{ label: 'Try again', cls: 'pick', fn: run }]); }
  function change(t) {
    if (S.busy) return; S.busy = true; S.phase = 'building'; say('me', t);
    var wrap = el('div'); steps = el('ul', 'us-steps'); wrap.appendChild(steps); say('bot', wrap);
    var s = step('Applying your change'), fd = new FormData(); fd.set('id', S.id); fd.set('change', t);
    post('/api/change', fd).then(function () { return poll(S.id, s, 0); }).catch(function (e) { mark(s, false, 'That did not work: ' + (e.message || 'please try again')); S.busy = false; S.phase = 'live'; });
  }

  // ---- the one input does everything ----
  function submit() {
    var t = inp.value.trim(); if (!t) return;
    if (S.phase === 'idea') return begin(t);
    if (S.phase === 'live') { inp.value = ''; return change(t); }
    if (S.phase === 'building') { hint.textContent = 'Still working. I will be ready for more in a moment.'; return; }
    inp.value = '';
    if (S.cur) { var c = matchSpoken(S.cur, t); if (c) { return answer(S.cur, c, t); } }
    S.text += '. ' + t; say('me', t); infer(); say('bot', 'Noted, I added that.');
    if (S.phase === 'asking' && !S.cur) nextQ(); else if (S.phase === 'asking' && !pending().filter(function (q) { return q === S.cur; }).length) { /* keep waiting on the current question */ }
  }
  form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });
  hint.textContent = 'One or two words is enough. Press the microphone to dictate.'; var eng = el('a', null, ' I write code: skip ahead'); eng.href = '/engineers'; hint.appendChild(eng);
})();
`;

// ENGINEER-LANE-1: the status pins now live in site/pins.json, tied to docs/issues and checked by scripts/build_site_roadmap.py (SITE-PINS-1).
export default { CSS, JS, askBar };
