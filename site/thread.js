// THREAD-1 (owner, 2026-11-12): the front door is a conversation thread, not a form. Everyone already knows a text thread, so a person who
// has never coded starts the way they would message a friend. One rounded composer (mic first, grows as they talk), ideas that rotate and
// adapt to what they type, the interview asked inline as chat bubbles with tap answers, and the build shown as a live run in the thread
// (each step, its state, its time and the real call behind it), so people watch the system work the way the fleet command line shows it.
// Ideas: GET /api/suggest (a fresh daily set plus a curated pool; while typing, a small model suggests what to add; offline it falls back to
// keyword matches in POOL). Recall: past ideas are kept in this browser only and offered back on the next visit.
// Consumers: site/worker.js (renders thread() into / and /start, serves /api/suggest, JSON build steps); tests in site/site.test.mjs.

// Curated idea pool: t = the idea in a person's own words, k = words that make it related to what someone is typing.
export const POOL = [
  ["A booking page for my barbershop", "book booking appointment salon barber hair schedule"],
  ["A sign-up list for our street's bin rota", "bin rota neighbour street community list"],
  ["A menu with online ordering for my café", "cafe coffee restaurant food menu order"],
  ["A page that sells my handmade candles", "sell shop store handmade craft candle etsy"],
  ["A tracker for my kid's reading", "kid child reading school book track"],
  ["A website for my band with gig dates", "band music gig concert tour song"],
  ["A wedding page with RSVPs", "wedding rsvp event party invite guest"],
  ["A sign-up sheet for volunteer shifts", "volunteer shift charity sign-up rota"],
  ["A portfolio for my photography", "photo photography portfolio gallery art"],
  ["A reminder when my plants need water", "plant garden water reminder"],
  ["A price list and quote form for my cleaning business", "cleaning business quote price service"],
  ["A lost-and-found board for our school", "school lost found board community"],
  ["A habit tracker that cheers me on", "habit track goal streak fitness"],
  ["A page where clients book dog walks", "dog walk pet clients book"],
  ["A recipe box for our family recipes", "recipe family cook food kitchen"],
  ["A simple invoice maker for freelancers", "invoice freelance bill payment client"],
  ["A study planner for exams", "study exam school plan student revision"],
  ["A tip calculator to split the bill", "tip bill split calculator money"],
  ["A page for my tutoring with times and prices", "tutor tutoring lessons teach price"],
  ["A team page for our football club", "football soccer club team sport fixtures"],
  ["A guestbook for our holiday rental", "holiday rental airbnb guest house"],
  ["A countdown to our big launch", "launch countdown event date"],
  ["A quiz to recommend the right product", "quiz recommend product shop customer"],
  ["A newsletter sign-up for my blog", "newsletter blog email subscribe writing"],
  ["A map of the best local walks", "map walk local hike trail"],
  ["A tool to plan meals for the week", "meal plan food week shopping list"],
  ["A page for my yoga classes", "yoga class fitness timetable studio"],
  ["A one-page CV that looks great", "cv resume job career profile"],
  ["A fundraiser page with a progress bar", "fundraiser charity donate goal"],
  ["A chore chart for the kids", "chore kids family home chart"],
  ["A feedback form for my workshop", "feedback form workshop survey event"],
  ["A launch page for my app idea", "app idea startup launch waitlist"],
  ["A flashcard game for learning Spanish", "learn language spanish flashcard game"],
  ["A page that shows my opening hours", "opening hours shop business local"],
  ["A book club page with this month's pick", "book club reading group month"],
  ["A packing list for camping trips", "camping trip packing list travel"]
];

export const CSS = [
  ".th{max-width:760px;margin:0 auto}.th [hidden]{display:none!important}",
  ".th-hello{text-align:center;padding:36px 0 6px}.th-hello h1{font-size:40px;line-height:1.1;margin:0 auto 10px;max-width:18ch}.th-hello p{color:var(--ink2);font-size:18px;margin:0 auto;max-width:44ch}",
  "@media(max-width:640px){.th-hello h1{font-size:30px}.th-hello{padding-top:18px}}",
  // Composer: a rounded bar that grows with what is said, mic and send inside it.
  ".th-dock{padding:14px 0 6px}body.th-on .th-dock{position:sticky;bottom:0;z-index:4;padding:18px 0 14px;background:linear-gradient(to bottom,transparent,var(--bg) 26%)}",
  ".th-cmp{position:relative;display:flex;align-items:flex-end;gap:6px;background:var(--sf);border:1.5px solid var(--line);border-radius:28px;padding:6px 6px 6px 22px;box-shadow:0 4px 24px rgba(0,0,0,.08);transition:border-color .15s,box-shadow .15s}",
  ".th-cmp:focus-within{border-color:var(--ac);box-shadow:0 6px 28px rgba(201,61,0,.18)}",
  ".th-cmp textarea{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:inherit;font-size:18px;line-height:1.45;padding:12px 0;min-height:48px;max-height:200px;resize:none;outline:0;overflow-y:auto}",
  ".th-ph{position:absolute;left:22px;right:120px;top:18px;color:var(--ink2);font-size:18px;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity .35s}.th-ph.out{opacity:0}",
  ".th-rb{width:48px;height:48px;border-radius:50%;border:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:var(--ink);flex:none}",
  ".th-rb:hover{background:var(--sf2)}.th-rb svg{width:22px;height:22px;fill:currentColor}.th-rb.go{background:var(--ac);color:var(--on)}.th-rb.go:disabled{opacity:.35;cursor:default}",
  ".th-rb.live{background:var(--ac);color:var(--on);animation:thp 1.2s infinite}@keyframes thp{0%{box-shadow:0 0 0 0 rgba(201,61,0,.5)}100%{box-shadow:0 0 0 16px rgba(201,61,0,0)}}",
  ".th-hint{color:var(--ink2);font-size:13px;text-align:center;margin:8px 0 0;min-height:18px}",
  // Suggestions: a row of rounded chips that rotate when idle and follow what is typed.
  ".th-sug{margin:14px 0 4px;min-height:96px}.th-lbl{font-size:13px;color:var(--ink2);margin:0 4px 8px;display:flex;align-items:center;gap:8px}",
  ".th-chips{display:flex;flex-wrap:wrap;gap:8px;transition:opacity .3s}.th-chips.out{opacity:0}",
  ".th-chip{border:1.5px solid var(--line);background:var(--sf);color:var(--ink);border-radius:999px;padding:9px 16px;min-height:42px;font:500 15px/1.3 inherit;font-family:inherit;cursor:pointer;text-align:left;text-decoration:none;display:inline-flex;align-items:center;gap:6px}",
  "@media(max-width:640px){#th-chips .th-chip:nth-child(n+5){display:none}}.th-chip:hover{border-color:var(--ac)}.th-chip.pick{background:var(--soft);border-color:var(--ac)}.th-chip.quiet{border-style:dashed;color:var(--ink2)}.th-chip.go{background:var(--ac);border-color:var(--ac);color:var(--on);font-weight:700}",
  ".th-more{border:0;background:none;color:var(--ac);font:600 13px inherit;font-family:inherit;cursor:pointer;padding:4px}",
  // Thread.
  ".th-log{display:flex;flex-direction:column;gap:14px;padding:8px 0 4px}",
  ".th-row{display:flex;gap:10px;align-items:flex-start;scroll-margin-bottom:130px;animation:thin .25s ease-out}@keyframes thin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}",
  ".th-row.me{justify-content:flex-end}.th-av{width:30px;height:30px;flex:none;border-radius:50%;background:var(--sf);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;margin-top:2px}.th-av img{width:18px;height:18px}",
  ".th-b{max-width:min(560px,86%);padding:12px 16px;border-radius:20px;font-size:17px;line-height:1.5;overflow-wrap:anywhere}",
  ".th-row.me .th-b{background:var(--ac);color:var(--on);border-bottom-right-radius:6px}.th-row.ai .th-b{background:var(--sf);border:1px solid var(--line);border-top-left-radius:6px}",
  ".th-b p{margin:0 0 6px}.th-b p:last-child{margin:0}.th-b .th-chips{margin-top:10px}.th-small{font-size:14px;color:var(--ink2)}",
  ".th-dots{display:inline-flex;gap:4px;padding:4px 0}.th-dots i{width:7px;height:7px;border-radius:50%;background:var(--ink2);animation:thd 1s infinite}.th-dots i:nth-child(2){animation-delay:.15s}.th-dots i:nth-child(3){animation-delay:.3s}@keyframes thd{0%,60%,100%{opacity:.25}30%{opacity:1}}",
  // Run card: the build as it executes, like a command and its output.
  ".th-run{width:min(600px,100%);background:var(--sf);border:1px solid var(--line);border-radius:18px;overflow:hidden}",
  ".th-run h4{margin:0;padding:12px 16px;font-size:14px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink2);border-bottom:1px solid var(--line);display:flex;justify-content:space-between}",
  ".th-step{display:grid;grid-template-columns:22px 1fr auto;gap:10px;padding:10px 16px;align-items:start;border-bottom:1px solid var(--line)}.th-step:last-child{border-bottom:0}",
  ".th-ic{width:18px;height:18px;border-radius:50%;border:2px solid var(--line);margin-top:3px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800}",
  ".th-step.run .th-ic{border-color:var(--ac);border-top-color:transparent;animation:ths .8s linear infinite}@keyframes ths{to{transform:rotate(360deg)}}",
  ".th-step.ok .th-ic{background:var(--good);border-color:var(--good);color:#fff}.th-step.bad .th-ic{background:var(--bad);border-color:var(--bad);color:#fff}.th-step.wait{opacity:.55}",
  ".th-st{font-weight:600}.th-sd{font-size:14px;color:var(--ink2);margin-top:2px}.th-t{font:13px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink2);margin-top:3px}",
  ".th-cmd{font:12.5px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--ink2);background:var(--sf2);border-radius:8px;padding:6px 8px;margin-top:6px;white-space:pre-wrap;overflow-wrap:anywhere}",
  ".th-run details{border-top:1px solid var(--line)}.th-run summary{padding:8px 16px;font-size:13px;color:var(--ink2);cursor:pointer}",
  ".th-ul{margin:6px 0 0;padding-left:18px;font-size:14px}.th-ul li{margin:2px 0}",
  ".th-frame{width:min(600px,100%);height:380px;border:1px solid var(--line);border-radius:18px;background:#fff;display:block}",
  "@media(prefers-reduced-motion:reduce){.th-row,.th-rb.live,.th-step.run .th-ic,.th-dots i{animation:none}.th-ph,.th-chips{transition:none}}",
  // While a thread is open the page is the thread: marketing sections step aside.
  "body.th-on main>*:not(.th){display:none}body.th-on .th-hello,body.th-on .th-sug.idle{display:none}"
].join("\n");

const MIC = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z\"/></svg>";
const GO = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 4l7 7-1.4 1.4L13 7.8V20h-2V7.8l-4.6 4.6L5 11z\"/></svg>";
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Server-rendered shell. With no JavaScript it is still a working rounded form that posts the idea to /api/idea.
export function thread(o) {
  o = o || {};
  const first = POOL.slice().sort(() => Math.random() - 0.5).slice(0, 6);
  return "<section class=\"th\" id=\"th\"><div class=\"th-hello\"><h1>" + esc(o.title || "What do you want to make?") + "</h1><p>" + esc(o.lede || "Say it or type it, the way you would text a friend. I ask a few quick questions, build it, put it online and look after it.") + "</p></div>"
    + "<div class=\"th-log\" id=\"th-log\" role=\"log\" aria-live=\"polite\" aria-label=\"Conversation\"></div>"
    + "<div class=\"th-dock\"><form class=\"th-cmp\" id=\"th-form\" method=\"post\" action=\"/api/idea\">"
    + "<textarea id=\"th-in\" name=\"idea\" rows=\"1\" maxlength=\"1500\" required autocomplete=\"off\" enterkeyhint=\"send\" aria-label=\"Message Ultrastable\">" + esc(o.prefill || "") + "</textarea>"
    + "<span class=\"th-ph\" id=\"th-ph\" aria-hidden=\"true\">" + (o.prefill ? "" : "Describe your idea…") + "</span>"
    + "<button type=\"button\" class=\"th-rb\" id=\"th-mic\" aria-label=\"Speak\" title=\"Speak\" hidden>" + MIC + "</button>"
    + "<button type=\"submit\" class=\"th-rb go\" id=\"th-go\" aria-label=\"Send\" title=\"Send\">" + GO + "</button></form>"
    + "<p class=\"th-hint\" id=\"th-hint\">A few words is enough. <a href=\"/engineers\">I write code: skip ahead</a></p></div>"
    + "<div class=\"th-sug idle\" id=\"th-sug\"><div class=\"th-lbl\"><span id=\"th-sl\">Ideas to get you going</span><button type=\"button\" class=\"th-more\" id=\"th-more\">Show others</button></div>"
    + "<div class=\"th-chips\" id=\"th-chips\">" + first.map((p) => "<a class=\"th-chip\" href=\"/start?idea=" + encodeURIComponent(p[0]) + "\" data-s=\"" + esc(p[0]) + "\">" + esc(p[0]) + "</a>").join("") + "</div>"
    + "<div class=\"th-chips\" id=\"th-recall\" hidden></div></div></section>"
    // Bundlers that keep function names (wrangler/esbuild keepNames) inject __name(...) into serialized functions; the shim keeps it working.
    + "<script>var __name=window.__name||function(f){return f};(" + client.toString() + ")(" + JSON.stringify({ pool: POOL.map((p) => p[0]), keys: POOL.map((p) => p[1]), qs: QS, auto: !!o.prefill }).replace(/</g, "\\u003c") + ")</script>";
}

// The interview bank: either/or questions; words in what was said can answer one up front (shown, and tappable to change).
const QS = [
  { id: "kind", q: "Is it something people open and use, or something that quietly runs by itself?", o: [["A", "People use it", "an app or website people use"], ["B", "Runs by itself", "an automation that runs by itself"]], k: { A: "\\b(app|site|website|page|portal|store|shop|game|tool|menu|portfolio|form|list|board|tracker|calculator|quiz|planner)\\b", B: "\\b(automat|bot|schedul|remind|alert|monitor|sync|pipeline)\\w*" } },
  { id: "who", q: "Is it just for you, or for other people too?", o: [["A", "Just me", "for personal use"], ["B", "Other people", "for other people, such as customers or a community"]], k: { A: "\\b(my own|for me|personal|myself)\\b", B: "\\b(customers?|clients?|members?|neighbou?rs?|community|users?|everyone|people|team|guests?|club|class|business|street|school)\\b" } },
  { id: "money", q: "Should it earn money?", yn: 1, o: [["Y", "Yes", "it should earn money"], ["N", "No", "it does not need to earn money"]], k: { Y: "\\b(sell|sells|earn|money|revenue|pay|charge|subscription|business|profit|ordering|order|prices?|invoice|booking)\\b" } },
  { id: "depth", q: "Quick and simple first, or thorough and polished?", o: [["A", "Quick first", "a quick, simple first version"], ["B", "Polished", "a thorough, polished version"]], k: { A: "\\b(quick|simple|fast|prototype|rough)\\b", B: "\\b(polish|thorough|complete|professional|full)\\b" } }
];

// Browser code. Serialized with toString(), so it must not reference anything outside itself.
function client(C) {
  var $ = function (i) { return document.getElementById(i); };
  var log = $("th-log"), form = $("th-form"), inp = $("th-in"), ph = $("th-ph"), mic = $("th-mic"), go = $("th-go"), hint = $("th-hint");
  var sug = $("th-sug"), chips = $("th-chips"), sl = $("th-sl"), more = $("th-more"), recallBox = $("th-recall");
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition, voice = false, rec = null;
  var S = { phase: "idle", text: "", ans: {}, adds: [], picked: [], id: null, cur: null, total: 0, box: null };
  var QS = C.qs.map(function (q) { var k = {}; Object.keys(q.k).forEach(function (c) { k[c] = new RegExp(q.k[c], "i"); }); return { id: q.id, q: q.q, o: q.o, yn: q.yn, k: k }; });
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  function el(tag, cls, txt) { var n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; }
  function store(k, v) { try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch (e) { return null; } }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function bottom() { var r = log.lastElementChild; if (r && r.scrollIntoView) r.scrollIntoView({ block: "end", behavior: reduce ? "auto" : "smooth" }); }

  // ---------- composer ----------
  function grow() { inp.style.height = "auto"; inp.style.height = Math.min(inp.scrollHeight, 200) + "px"; ph.classList.toggle("out", !!inp.value); go.disabled = !inp.value.trim(); }
  inp.addEventListener("input", function () { grow(); typed(); });
  inp.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
  form.addEventListener("submit", function (e) { e.preventDefault(); send(); });
  grow();
  // Rotating placeholder: example ideas fade in and out while the box is empty.
  var phs = shuffle(C.pool), phi = 0;
  function nextPh() { if (inp.value || S.phase === "done" || S.phase === "building") return; ph.classList.add("out"); setTimeout(function () { if (inp.value) return; ph.textContent = (S.phase === "idle" ? "Try: " : "") + (S.phase === "idle" ? phs[phi++ % phs.length].toLowerCase() + "…" : "Type an answer, or add more detail…"); ph.classList.remove("out"); }, reduce ? 0 : 350); }
  if (!C.auto) { ph.textContent = "Describe your idea…"; setInterval(nextPh, 3800); }

  // ---------- voice ----------
  function speak(t, done) { if (!voice || !window.speechSynthesis) { if (done) done(); return; } try { speechSynthesis.cancel(); var u = new SpeechSynthesisUtterance(t); u.onend = function () { if (done) done(); }; u.onerror = u.onend; speechSynthesis.speak(u); } catch (e) { if (done) done(); } }
  function listen(onText) {
    if (!SR) return; try { if (rec) rec.abort(); } catch (e) {}
    rec = new SR(); rec.lang = navigator.language || "en-US"; rec.interimResults = true; var fin = "", last = "";
    mic.classList.add("live"); mic.setAttribute("aria-label", "Listening. Press to stop"); hint.textContent = "Listening…";
    rec.onresult = function (e) { var t = ""; for (var k = 0; k < e.results.length; k++) { t += e.results[k][0].transcript; if (e.results[k].isFinal) fin = t; } last = t; inp.value = t; grow(); };
    rec.onerror = function (e) { hint.textContent = e.error === "not-allowed" || e.error === "service-not-allowed" ? "The microphone is blocked for this site. Type instead, or allow it in your browser and press the mic again." : e.error === "no-speech" ? "I did not hear anything. Press the mic to try again." : "Voice stopped. Type, tap, or press the mic again."; };
    rec.onend = function () { mic.classList.remove("live"); mic.setAttribute("aria-label", "Speak"); var t = (fin || last || "").trim(); if (hint.textContent === "Listening…") hint.textContent = ""; if (t) onText(t); };
    try { rec.start(); } catch (e) { mic.classList.remove("live"); }
  }
  if (SR) { mic.hidden = false; mic.onclick = function () { if (mic.classList.contains("live")) { try { rec.stop(); } catch (e) {} return; } voice = true; listen(function () { send(); }); }; }

  // ---------- suggestions ----------
  function paint(label, items, how) {
    chips.classList.add("out");
    setTimeout(function () {
      sl.textContent = label; chips.textContent = "";
      items.forEach(function (t) { var b = el("button", "th-chip", (how === "add" ? "+ " : "") + t); b.type = "button"; b.onclick = function () { pickIdea(t, how); }; chips.appendChild(b); });
      chips.classList.remove("out");
    }, reduce ? 0 : 220);
  }
  function pickIdea(t, how) {
    if (S.picked.indexOf(t) < 0) S.picked.push(t);
    if (how === "add") { inp.value = inp.value.trim() ? inp.value.trim().replace(/[.\s]+$/, "") + ", " + t.charAt(0).toLowerCase() + t.slice(1) : t; grow(); inp.focus(); typed(); return; }
    inp.value = t; grow(); send();
  }
  var fresh = shuffle(C.pool), fi = 0, rotor = null, lastQ = "", qTimer = null;
  function idleSet() { var out = []; for (var i = 0; i < 6; i++) out.push(fresh[fi++ % fresh.length]); return out; }
  function rotate() { if (S.phase !== "idle" || inp.value.trim() || sug.matches(":hover") || sug.contains(document.activeElement)) return; paint("Ideas to get you going", idleSet()); }
  function startRotor() { if (!rotor && !reduce) rotor = setInterval(rotate, 8000); }
  more.onclick = function () { if (S.phase === "idle" && !inp.value.trim()) paint("Ideas to get you going", idleSet()); else typed(true); };
  // A fresh daily set from the server joins the pool (a model writes it once a day; offline the pool alone rotates).
  fetch("/api/suggest", { headers: { accept: "application/json" } }).then(function (r) { return r.json(); }).then(function (d) { if (d && d.ideas && d.ideas.length) { fresh = shuffle(d.ideas.concat(fresh)).filter(function (x, i, a) { return a.indexOf(x) === i; }); fi = 0; } }).catch(function () {});
  startRotor();
  // The first chips are server-rendered links (they work with no JavaScript); with JavaScript they start the thread in place.
  chips.addEventListener("click", function (e) { var a = e.target.closest && e.target.closest("a[data-s]"); if (a) { e.preventDefault(); pickIdea(a.getAttribute("data-s")); } });
  function local(q) { var w = q.toLowerCase().match(/[a-z]{3,}/g) || [], sc = []; C.pool.forEach(function (t, i) { var n = 0; w.forEach(function (x) { if (C.keys[i].indexOf(x.slice(0, 5)) >= 0) n++; }); if (n) sc.push([n, t]); }); return sc.sort(function (a, b) { return b[0] - a[0]; }).slice(0, 4).map(function (x) { return x[1]; }); }
  function typed(force) {
    var q = inp.value.trim(); clearTimeout(qTimer);
    if (S.phase !== "idle") return;
    if (q.length < 4) { if (S.phase === "idle" && lastQ) { lastQ = ""; paint("Ideas to get you going", idleSet()); } return; }
    qTimer = setTimeout(function () {
      if (q === lastQ && !force) return; lastQ = q;
      var mode = S.phase === "done" ? "change" : "grow", ctx = S.phase === "done" ? S.text + ". Change asked: " + q : q;
      var near = mode === "grow" ? local(q) : [];
      fetch("/api/suggest?mode=" + mode + "&q=" + encodeURIComponent(ctx.slice(0, 400)), { headers: { accept: "application/json" } }).then(function (r) { return r.json(); }).then(function (d) {
        if (inp.value.trim() !== q) return;
        var add = (d && d.ideas) || [];
        if (add.length) paint(mode === "change" ? "You could also ask for" : "Building on that, you could add", add.slice(0, 4), "add");
        else if (near.length) paint("Similar ideas", near);
      }).catch(function () { if (near.length) paint("Similar ideas", near); });
    }, force ? 0 : 450);
  }

  // ---------- recall: ideas from earlier visits, kept in this browser only ----------
  var past = store("us-threads") || [];
  if (past.length) {
    recallBox.hidden = false; recallBox.style.marginBottom = "14px"; sug.insertBefore(recallBox, sug.firstChild);
    recallBox.appendChild(el("div", "th-lbl", "Pick up where you left off"));
    past.slice(0, 3).forEach(function (p) { var a = el("a", "th-chip pick", p.title.length > 48 ? p.title.slice(0, 46) + "…" : p.title); a.href = "/s/" + p.id; recallBox.appendChild(a); });
  }
  function remember(id, title) { past = [{ id: id, title: title, at: Date.now() }].concat(past.filter(function (p) { return p.id !== id; })).slice(0, 8); store("us-threads", past); }

  // ---------- thread ----------
  function row(who, node) { var r = el("div", "th-row " + who); if (who === "ai") { var av = el("div", "th-av"); var im = el("img"); im.src = "/favicon.svg"; im.alt = ""; av.appendChild(im); r.appendChild(av); } r.appendChild(node); log.appendChild(r); bottom(); return r; }
  function me(t) { var b = el("div", "th-b"); b.textContent = t; return row("me", b); }
  function ai(t, small) { var b = el("div", "th-b"); if (t) b.appendChild(el("p", small ? "th-small" : null, t)); row("ai", b); return b; }
  function typing(then) { var b = el("div", "th-b"), d = el("span", "th-dots"); d.setAttribute("aria-label", "Thinking"); d.appendChild(el("i")); d.appendChild(el("i")); d.appendChild(el("i")); b.appendChild(d); var r = row("ai", b); setTimeout(function () { r.remove(); then(); }, reduce ? 0 : 550); }
  function chipRow(box, items) { var g = el("div", "th-chips"); items.forEach(function (it) { var b = el("button", "th-chip" + (it.cls ? " " + it.cls : ""), it.t); b.type = "button"; b.onclick = function () { if (it.once !== false) g.querySelectorAll("button").forEach(function (x) { x.disabled = true; }); it.fn(b); }; g.appendChild(b); }); box.appendChild(g); bottom(); return g; }
  function label(q, c) { var o = q.o.filter(function (x) { return x[0] === c; })[0]; return o ? o : null; }
  function infer() { var t = S.text; QS.forEach(function (q) { if (S.ans[q.id]) return; var hit = null, n = 0; Object.keys(q.k).forEach(function (c) { if (q.k[c].test(t)) { hit = c; n++; } }); if (n === 1) S.ans[q.id] = { c: hit, auto: 1 }; }); }
  function pending() { return QS.filter(function (q) { return !S.ans[q.id]; }); }
  function begin() { document.body.classList.add("th-on"); sug.classList.remove("idle"); sug.hidden = true; hint.textContent = ""; clearInterval(rotor); rotor = null; }

  function send() {
    var t = inp.value.trim(); if (!t) { inp.focus(); return; }
    inp.value = ""; grow(); lastQ = "";
    if (S.phase === "building") { hint.textContent = "One moment, I am still working on the last step."; inp.value = t; grow(); return; }
    if (S.phase === "idle") { begin(); S.text = t; me(t); infer(); var known = Object.keys(S.ans); S.total = pending().length; S.phase = "asking"; if (t.split(/s+/).length >= 25) { S.phase = "review"; typing(function () { ai("That is a clear description, so I will skip the questions."); review(); }); return; } typing(function () { var b = ai(known.length ? "Got it. From what you said I already know:" : "Love it. A few quick questions so I build the right thing."); if (known.length) { chipRow(b, known.map(function (id) { var q = QS.filter(function (x) { return x.id === id; })[0]; return { t: label(q, S.ans[id].c)[1] + "  ✎", cls: "pick", once: false, fn: function (btn) { delete S.ans[id]; btn.remove(); if (S.phase === "review" || S.phase === "asking") { S.phase = "asking"; ask(); } } }; })); b.appendChild(el("p", "th-small", "Tap one to change it.")); } ask(); }); return; }
    me(t);
    if (S.phase === "asking" && S.cur) { var c = matchSaid(S.cur, t); if (c) return answer(S.cur, c, true); S.text += ". " + t; infer(); typing(function () { ai("Added that to the idea."); ask(); }); return; }
    if (S.phase === "review") { S.text += ". " + t; infer(); typing(function () { ai("Added. Here is the updated plan."); review(); }); return; }
    if (S.phase === "done") { change(t); return; }
  }
  function matchSaid(q, t) {
    t = t.toLowerCase().trim();
    if (q.yn) { if (/^(yes|yeah|yep|yup|sure|ok|okay|correct|right|definitely|please|of course)\b/.test(t)) return "Y"; if (/^(no|nope|nah|not really|never|don'?t)\b/.test(t)) return "N"; }
    if (/^(not sure|don'?t know|skip|either|maybe|whatever)\b/.test(t)) return "?";
    for (var k = 0; k < q.o.length; k++) if (t === q.o[k][1].toLowerCase() || t.indexOf(q.o[k][1].toLowerCase()) >= 0) return q.o[k][0];
    if (!q.yn && /^(a|first|the first( one)?)$/.test(t)) return "A"; if (!q.yn && /^(b|second|the second( one)?)$/.test(t)) return "B";
    return null;
  }
  function ask() {
    var q = pending()[0]; S.cur = q || null;
    if (!q) { review(); return; }
    var n = S.total - pending().length + 1, b = ai(q.q); S.box = b;
    if (S.total > 1) b.insertBefore(el("p", "th-small", "Question " + Math.min(n, S.total) + " of " + S.total), b.firstChild);
    chipRow(b, q.o.map(function (o) { return { t: o[1], fn: function () { answer(q, o[0]); } }; }).concat([{ t: "Not sure", cls: "quiet", fn: function () { answer(q, "?"); } }, { t: "That's enough, plan it", cls: "quiet", fn: function () { S.skip = true; review(); } }]));
    speak(q.q, function () { if (voice && SR && S.cur === q) listen(function (t) { inp.value = t; grow(); send(); }); });
  }
  function answer(q, c, said) { S.ans[q.id] = { c: c }; if (!said) { var o = label(q, c); me(o ? o[1] : "Not sure"); } if (S.box) S.box.querySelectorAll("button").forEach(function (x) { x.disabled = true; }); typing(ask); }
  function brief() { var parts = [S.text]; QS.forEach(function (q) { var a = S.ans[q.id]; if (a && a.c !== "?") { var o = label(q, a.c); if (o) parts.push(o[2]); } }); if (S.adds.length) parts.push("include " + S.adds.join(", ")); return parts.map(function (x) { x = String(x).trim().replace(/[.s]+$/, ""); return x.charAt(0).toUpperCase() + x.slice(1); }).join(". ") + "."; }
  // Prompted recall: before building, offer what people with similar ideas usually add; every tap changes the plan.
  function review() {
    S.phase = "review"; S.cur = null;
    var b = ai("Here is the plan:"), p = el("p", null, brief()); p.style.fontWeight = "600"; b.appendChild(p);
    b.appendChild(el("p", "th-small", "People with ideas like this often add one of these. Tap any you want, or type anything else."));
    var g = chipRow(b, []), loading = el("span", "th-dots"); loading.appendChild(el("i")); loading.appendChild(el("i")); loading.appendChild(el("i")); g.appendChild(loading);
    fetch("/api/suggest?mode=add&q=" + encodeURIComponent(brief().slice(0, 400)), { headers: { accept: "application/json" } }).then(function (r) { return r.json(); }).catch(function () { return null; }).then(function (d) {
      loading.remove();
      var items = (d && d.ideas && d.ideas.length ? d.ideas : ["A contact button", "A section with photos", "A way to sign up", "Opening hours or dates"]).slice(0, 4);
      items.forEach(function (t) { var x = el("button", "th-chip", "+ " + t); x.type = "button"; x.onclick = function () { var i = S.adds.indexOf(t); if (i < 0) { S.adds.push(t); x.classList.add("pick"); x.textContent = "✓ " + t; } else { S.adds.splice(i, 1); x.classList.remove("pick"); x.textContent = "+ " + t; } p.textContent = brief(); }; g.appendChild(x); });
      bottom();
    });
    chipRow(b, [{ t: "Build it", cls: "go", fn: function () { build(); } }, { t: "Start over", cls: "quiet", fn: function () { location.href = location.pathname; } }]);
    speak("Here is the plan. " + brief() + ". Say build it, or tap build it, when you are ready.", function () { if (voice && SR && S.phase === "review") listen(function (t) { if (/\bbuild\b|\bgo\b|\byes\b|ready/i.test(t)) build(); else { inp.value = t; grow(); send(); } }); });
  }

  // ---------- the run: each step of the build shown as it executes ----------
  function runCard(title) {
    var card = el("div", "th-run"), h = el("h4"); h.appendChild(el("span", null, title)); var clock = el("span", null, "0s"); h.appendChild(clock); card.appendChild(h);
    var t0 = Date.now(), tick = setInterval(function () { clock.textContent = Math.round((Date.now() - t0) / 1000) + "s"; }, 1000);
    var cmds = el("details"); cmds.appendChild(el("summary", null, "Show what ran (for the curious)")); var pre = el("div", "th-cmd"); pre.style.margin = "0 16px 12px"; cmds.appendChild(pre);
    var steps = el("div"); card.appendChild(steps); card.appendChild(cmds); row("ai", card);
    return {
      step: function (name, sub) {
        var s = el("div", "th-step wait"), ic = el("span", "th-ic"), body = el("div"), tm = el("span", "th-t", "");
        body.appendChild(el("div", "th-st", name)); var sd = el("div", "th-sd", sub || ""); body.appendChild(sd); s.appendChild(ic); s.appendChild(body); s.appendChild(tm); steps.appendChild(s); bottom();
        var st0 = 0, tt = null;
        return {
          run: function (x) { s.className = "th-step run"; st0 = Date.now(); if (x) sd.textContent = x; tt = setInterval(function () { tm.textContent = Math.round((Date.now() - st0) / 1000) + "s"; }, 1000); },
          ok: function (x) { clearInterval(tt); s.className = "th-step ok"; ic.textContent = "✓"; if (x != null) sd.textContent = x; if (st0) tm.textContent = ((Date.now() - st0) / 1000).toFixed(1) + "s"; },
          bad: function (x) { clearInterval(tt); s.className = "th-step bad"; ic.textContent = "!"; if (x != null) sd.textContent = x; },
          body: body, sub: sd
        };
      },
      cmd: function (line) { pre.textContent += (pre.textContent ? "\n" : "") + line; },
      end: function () { clearInterval(tick); }
    };
  }
  function call(R, method, url, body) {
    var t0 = Date.now(), opt = { method: method, headers: { accept: "application/json" } };
    if (body) { var f = new FormData(); Object.keys(body).forEach(function (k) { f.set(k, body[k]); }); opt.body = f; }
    return fetch(url, opt).then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { R.cmd("$ " + method + " " + url + "  →  " + r.status + "  " + (Date.now() - t0) + "ms" + (d && d.state ? "  state=" + d.state : "") + (d && d.error ? "  " + d.error : "")); d._status = r.status; return d; }); });
  }
  var NOTES = ["Asking the builder model for one complete page", "Writing the words and the layout", "Making it fit phones as well as computers", "Wiring up the buttons and forms", "Nearly there: a page this size usually takes 20 to 40 seconds"];
  function waitBuild(R, s) {
    var ni = 0, nt = setInterval(function () { s.sub.textContent = NOTES[++ni % NOTES.length]; }, 6000), tries = 0;
    return new Promise(function (done) {
      (function poll() {
        call(R, "POST", "/api/s/" + S.id + "/build").then(function (d) {
          if (d.state === "ready" || d.state === "failed" || ++tries > 30) { clearInterval(nt); done(d.state === "ready" ? "ready" : "failed"); }
          else setTimeout(poll, 3000);
        }).catch(function () { if (++tries > 30) { clearInterval(nt); done("failed"); } else setTimeout(poll, 3000); });
      })();
    });
  }
  function checkStep(R, s) {
    s.run("A different model reads your page and compares it with the plan");
    var tries = 0;
    (function poll() {
      call(R, "GET", "/api/s/" + S.id).then(function (d) {
        if (!d.audit) { if (++tries > 20) s.bad("The check did not finish. Open “What I checked” later."); else setTimeout(poll, 3000); return; }
        var a = d.audit, fixed = a.fixed || [];
        s.ok((a.met || []).length + " things done, " + (a.gaps || []).length + " not right yet" + (fixed.length ? ", " + fixed.length + " fixed automatically" : ""));
        var ul = el("ul", "th-ul"); (a.met || []).slice(0, 4).forEach(function (m) { ul.appendChild(el("li", null, "✓ " + m)); }); (a.gaps || []).slice(0, 3).forEach(function (g) { ul.appendChild(el("li", null, (fixed.indexOf(g.what) >= 0 ? "✓ fixed: " : "! ") + g.what)); }); s.body.appendChild(ul);
        if (fixed.length) refresh();
      }).catch(function () { if (++tries > 20) s.bad("The check did not finish."); else setTimeout(poll, 3000); });
    })();
  }
  var frame = null;
  function refresh() { if (frame) frame.src = "/s/" + S.id + "?v=" + Date.now(); }
  // The page is isolated by the CSP sandbox header /s/<id> always sends (opaque origin, no access to ultrastable.io); a second sandbox
  // attribute on the frame left it blank in some browsers, so the header is the single isolation layer and site.test.mjs asserts it.
  function finish(R, title) {
    R.end(); S.phase = "done";
    var b = ai(title); frame = el("iframe", "th-frame"); frame.title = "Preview of your site"; frame.src = "/s/" + S.id + "?v=" + Date.now(); row("ai", frame);
    var nb = ai(null); chipRow(nb, [{ t: "Open my site ↗", cls: "go", once: false, fn: function () { window.open("/s/" + S.id, "_blank", "noopener"); } }, { t: "What I checked", cls: "quiet", once: false, fn: function () { window.open("/s/" + S.id + "/review", "_blank", "noopener"); } }]);
    nb.appendChild(el("p", "th-small", "Want anything different? Just say it below, like “make it green” or “add a contact form”."));
    ph.textContent = "Ask for a change…"; changeIdeas(nb);
    speak(title + " Say what you would like to change, any time.");
  }
  var CHANGES = ["Add a contact form", "Make it more colourful", "Add a photo gallery", "Make the text bigger"];
  function changeIdeas(box) {
    var g = chipRow(box, []), fill = function (xs) { xs.slice(0, 4).forEach(function (t) { var x = el("button", "th-chip", t); x.type = "button"; x.onclick = function () { inp.value = t; grow(); send(); }; g.appendChild(x); }); };
    fetch("/api/suggest?mode=change&q=" + encodeURIComponent(brief().slice(0, 400)), { headers: { accept: "application/json" } }).then(function (r) { return r.json(); }).then(function (d) { fill(d && d.ideas && d.ideas.length ? d.ideas : CHANGES); }).catch(function () { fill(CHANGES); });
  }
  function build() {
    if (S.phase === "building") return; S.phase = "building"; S.cur = null; var idea = brief();
    var R = runCard("Building"), s1 = R.step("Saving your idea"), s2 = R.step("Writing your page"), s3 = R.step("Putting it online"), s4 = R.step("Independent check");
    s1.run();
    var prof = {}; Object.keys(S.ans).forEach(function (k) { prof[k] = S.ans[k].c; });
    call(R, "POST", "/api/idea", { idea: idea.slice(0, 1900), profile: JSON.stringify({ said: S.text.slice(0, 500), space: prof, adds: S.adds.concat(S.picked), voice: voice, ui: "thread" }) }).then(function (d) {
      if (!d.id) { s1.bad(d.error || "That did not save. Try again in a minute."); R.end(); S.phase = "review"; return; }
      S.id = d.id; remember(d.id, S.text.slice(0, 80)); s1.ok("Saved as project " + d.id); s2.run(NOTES[0]);
      return waitBuild(R, s2).then(function (st) {
        if (st !== "ready") { s2.bad("The builder did not finish this time."); R.end(); S.phase = "review"; var b = ai("Sorry, that build failed. Nothing is lost."); chipRow(b, [{ t: "Try again", cls: "go", fn: build }]); return; }
        s2.ok("Done"); s3.run(); s3.ok("Live at ultrastable.io/s/" + S.id); checkStep(R, s4); finish(R, "It is live. Here it is:");
      });
    }).catch(function () { s1.bad("No connection. Check your internet and try again."); R.end(); S.phase = "review"; });
  }
  function change(t) {
    S.phase = "building";
    var R = runCard("Changing"), s1 = R.step("Reading your request", "“" + t + "”"), s2 = R.step("Rewriting the page"), s3 = R.step("Putting the new version online");
    s1.run();
    call(R, "POST", "/api/change", { id: S.id, change: t }).then(function (d) {
      if (!d.id) { s1.bad(d.error || "That did not go through."); R.end(); S.phase = "done"; return; }
      s1.ok(); s2.run(NOTES[1]);
      return waitBuild(R, s2).then(function (st) {
        R.end(); S.phase = "done";
        if (st !== "ready") { s2.bad("That change did not work this time. Your site is unchanged."); return; }
        s2.ok("Done"); s3.ok("Updated"); refresh(); ai("Done. The preview above is updated. Anything else?"); speak("Done. Anything else?");
      });
    }).catch(function () { s1.bad("No connection."); R.end(); S.phase = "done"; });
  }
  // A suggestion link (/start?idea=...) or a prefilled idea starts the thread straight away.
  if (C.auto && inp.value.trim()) send();
}

export default { CSS, POOL, thread };
