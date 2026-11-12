// INTERVIEW-1 (owner, 2026-11-12): the front door is an interview, not a form. A person says or types a few words; the system asks
// short either/or and yes/no questions (spoken or tapped) and builds a solution space from the answers. No blank "what do you want?"
// box. Pill-shaped ask bar everywhere (same pattern as a search box), microphone first, typing optional.
// Consumers: site/worker.js (renders ASK_BAR + CSS + JS into / and /start; PINS into /engineers); tests in site/site.test.mjs.
export const CSS = [
  ".us-iv [hidden]{display:none!important}",
  ".us-ask{display:flex;align-items:center;gap:6px;background:var(--sf);border:1.5px solid var(--line);border-radius:999px;padding:6px 6px 6px 22px;box-shadow:0 2px 12px rgba(0,0,0,.08);max-width:640px;margin:18px 0 8px;transition:box-shadow .15s,border-color .15s}",
  ".us-ask:focus-within{border-color:var(--ac);box-shadow:0 4px 20px rgba(201,61,0,.18)}",
  ".us-ask input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:inherit;font-size:18px;min-height:48px;outline:0}",
  ".us-ask input::placeholder{color:var(--ink2)}",
  ".us-rb{width:48px;height:48px;border-radius:50%;border:0;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;background:transparent;color:var(--ink);flex:none}",
  ".us-rb:hover{background:var(--sf2)}.us-rb svg{width:22px;height:22px;fill:currentColor}",
  ".us-rb.go{background:var(--ac);color:var(--on)}.us-rb.go:hover{filter:brightness(1.08)}",
  ".us-rb.live{background:var(--ac);color:var(--on);animation:usp 1.2s infinite}",
  "@keyframes usp{0%{box-shadow:0 0 0 0 rgba(201,61,0,.5)}100%{box-shadow:0 0 0 16px rgba(201,61,0,0)}}@media(prefers-reduced-motion:reduce){.us-rb.live{animation:none}}",
  ".us-chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}",
  ".us-chip{border:1.5px solid var(--line);background:var(--sf);color:var(--ink);border-radius:999px;padding:10px 18px;min-height:44px;font:600 16px system-ui;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center}",
  ".us-chip:hover{border-color:var(--ac)}.us-chip.pick{background:var(--soft);border-color:var(--ac)}.us-chip.quiet{border-style:dashed;color:var(--ink2)}",
  ".us-q{font-family:Fraunces,Georgia,serif;font-size:26px;line-height:1.25;margin:18px 0 6px}",
  ".us-opts{display:grid;gap:10px;margin:12px 0}@media(min-width:640px){.us-opts.two{grid-template-columns:1fr 1fr}}",
  ".us-opt{text-align:left;border:1.5px solid var(--line);background:var(--sf);color:var(--ink);border-radius:20px;padding:16px 20px;min-height:64px;font:inherit;font-size:17px;cursor:pointer}",
  ".us-opt b{display:block;font-size:13px;color:var(--ink2);letter-spacing:.06em;text-transform:uppercase}.us-opt:hover{border-color:var(--ac)}",
  ".us-space{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0}.us-note{color:var(--ink2);font-size:14px;margin:6px 0}",
  ".us-bar{height:6px;border-radius:99px;background:var(--sf2);overflow:hidden;max-width:640px}.us-bar i{display:block;height:100%;background:var(--ac);transition:width .3s}",
  ".us-lane{border-top:1px solid var(--line);margin-top:28px;padding-top:6px}"
].join("\n");

const MIC = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z\"/></svg>";
const GO = "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M4 12l16-8-6 16-3-7-7-1z\"/></svg>";

// The component. Progressive enhancement: with no JavaScript it is a plain pill form that posts the words to /api/idea.
export function askBar(lead) {
  return "<section class=\"us-iv\" id=\"us-iv\" aria-live=\"polite\"><form method=\"post\" action=\"/api/idea\" class=\"us-ask\" id=\"us-ask\" role=\"search\">"
    + "<input id=\"us-in\" name=\"idea\" type=\"text\" maxlength=\"1500\" autocomplete=\"off\" enterkeyhint=\"go\" required aria-label=\"Tell me what is on your mind\" placeholder=\"" + (lead || "Say or type a few words…") + "\">"
    + "<button type=\"button\" class=\"us-rb\" id=\"us-mic\" aria-label=\"Speak\" title=\"Speak\" hidden>" + MIC + "</button>"
    + "<button type=\"submit\" class=\"us-rb go\" aria-label=\"Go\" title=\"Go\">" + GO + "</button></form>"
    + "<div class=\"us-chips\" id=\"us-start\"><button type=\"button\" class=\"us-chip\" data-s=\"I want to make something new\">Make something new</button>"
    + "<button type=\"button\" class=\"us-chip\" data-s=\"Something I already have is broken or slow\">Fix something</button>"
    + "<button type=\"button\" class=\"us-chip\" data-s=\"I want to improve and grow what I already have\">Improve what I have</button>"
    + "<a class=\"us-chip quiet\" href=\"/engineers\">I write code: skip ahead</a></div>"
    + "<p class=\"us-note\" id=\"us-hint\">Even one or two words is enough. I will ask a few quick either/or questions; answer by tapping or by voice.</p></section>"
    + "<script>" + JS + "</script>";
}

// Client script. Questions are data; an utterance can pre-answer some (keywords), the rest are asked as A/B or yes/no.
// Result: a sentence plus a structured profile (the solution space) posted to /api/idea; the build consumes both.
const JS = "(function(){var Q=[" + [
  "{id:'kind',q:'Is it something people open and use, or something that quietly runs by itself?',o:[['A','People use it','an app or website people use'],['B','Runs by itself','an automation that runs by itself']],k:{A:/\\b(app|site|website|page|portal|store|shop|game|tool)\\b/,B:/\\b(automat|bot|schedul|remind|alert|monitor|sync|pipeline)\\w*/}}",
  "{id:'who',q:'Is it just for you, or for other people too?',o:[['A','Just me','for personal use'],['B','Other people','for other people, such as customers or a community']],k:{A:/\\b(my own|for me|personal|myself)\\b/,B:/\\b(customers?|clients?|members?|neighbou?rs?|community|users?|everyone|people|team)\\b/}}",
  "{id:'money',q:'Should it earn money?',yn:1,o:[['Y','Yes','it should earn money'],['N','No','it does not need to earn money']],k:{Y:/\\b(sell|earn|money|revenue|pay|charge|subscription|business|profit)\\b/}}",
  "{id:'start',q:'Do you already have something started?',yn:1,o:[['Y','Yes','there is existing work to build on'],['N','No','starting from nothing']],k:{Y:/\\b(already|existing|have a|my current|broken|slow|improve)\\b/}}",
  "{id:'depth',q:'Quick and simple first, or thorough and polished?',o:[['A','Quick first','a quick, simple first version'],['B','Thorough','a thorough, polished version']],k:{A:/\\b(quick|simple|fast|prototype|rough)\\b/,B:/\\b(polish|thorough|complete|professional|full)\\b/}}"
].join(",") + "];"
  + "var $=function(i){return document.getElementById(i)},iv=$('us-iv'),form=$('us-ask'),inp=$('us-in'),mic=$('us-mic'),hint=$('us-hint'),chips=$('us-start');"
  + "var SR=window.SpeechRecognition||window.webkitSpeechRecognition,voice=false,rec=null,S={text:'',ans:{},ord:[],i:0};"
  + "var YES=/^(yes|yeah|yep|yup|sure|ok|okay|correct|right|true|definitely|please|of course)\\b/,NO=/^(no|nope|nah|not|never|don'?t)\\b/;"
  + "function speak(t,done){if(!voice||!window.speechSynthesis){done&&done();return}try{speechSynthesis.cancel();var u=new SpeechSynthesisUtterance(t);u.onend=function(){done&&done()};u.onerror=function(){done&&done()};speechSynthesis.speak(u)}catch(e){done&&done()}}"
  + "function listen(onText,onFail){if(!SR){onFail&&onFail('unsupported');return}try{if(rec)rec.abort()}catch(e){}rec=new SR();rec.lang=navigator.language||'en-US';rec.interimResults=true;rec.maxAlternatives=1;var fin='';"
  + "mic.classList.add('live');mic.setAttribute('aria-label','Listening. Press to stop');"
  + "rec.onresult=function(e){var t='';for(var k=0;k<e.results.length;k++){t+=e.results[k][0].transcript;if(e.results[k].isFinal)fin=t}if(inp&&inp.offsetParent)inp.value=t;S.interim=t};"
  + "rec.onerror=function(e){mic.classList.remove('live');var m=e.error==='not-allowed'||e.error==='service-not-allowed'?'denied':e.error;onFail&&onFail(m)};"
  + "rec.onend=function(){mic.classList.remove('live');mic.setAttribute('aria-label','Speak');var t=(fin||S.interim||'').trim();S.interim='';if(t)onText(t)};"
  + "try{rec.start()}catch(e){onFail&&onFail('busy')}}"
  + "function failMsg(m){hint.textContent=m==='denied'?'The microphone is blocked for this site. You can tap the answers or type instead, or allow the microphone in your browser and press the mic again.':m==='no-speech'?'I did not hear anything. Press the mic and try again, or tap an answer.':m==='unsupported'?'Voice is not available in this browser. Tap or type instead.':'Voice stopped. Tap an answer, or press the mic to try again.'}"
  + "if(SR){mic.hidden=false;mic.onclick=function(){if(mic.classList.contains('live')){try{rec.stop()}catch(e){}return}voice=true;listen(begin,failMsg)}}"
  + "function infer(){var t=S.text.toLowerCase();Q.forEach(function(q){if(S.ans[q.id])return;var hit=null,n=0;Object.keys(q.k).forEach(function(c){if(q.k[c].test(t)){hit=c;n++}});if(n===1&&hit)S.ans[q.id]={c:hit,auto:1}})}"
  + "function pending(){return Q.filter(function(q){return !S.ans[q.id]})}"
  + "function begin(t){t=String(t||'').trim();if(!t){inp.focus();return}S.text=(S.text?S.text+'. ':'')+t;inp.value='';chips.hidden=true;infer();S.ord=pending();S.total=S.ord.length;next()}"
  + "form.onsubmit=function(e){e.preventDefault();begin(inp.value)};"
  + "chips.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('button[data-s]');if(b)begin(b.getAttribute('data-s'))});"
  + "function label(q,c){var o=q.o.filter(function(x){return x[0]===c})[0];return o?o[2]:''}"
  + "function matchSpoken(q,t){t=t.toLowerCase().trim();if(q.yn){if(YES.test(t))return 'Y';if(NO.test(t))return 'N'}"
  + "if(/\\b(a|first|option a|the first one)\\b/.test(t)&&!q.yn)return 'A';if(/\\b(b|second|option b|the second one)\\b/.test(t)&&!q.yn)return 'B';"
  + "for(var k=0;k<q.o.length;k++){var w=q.o[k][1].toLowerCase().split(' ');if(t.indexOf(q.o[k][1].toLowerCase())>=0||(w.length>1&&t.indexOf(w[w.length-1])>=0))return q.o[k][0]}"
  + "if(/not sure|don'?t know|skip|either|maybe/.test(t))return '?';return null}"
  + "function answer(q,c){S.ans[q.id]={c:c};S.i++;next()}"
  + "function el(tag,cls,txt){var n=document.createElement(tag);if(cls)n.className=cls;if(txt!=null)n.textContent=txt;return n}"
  + "function space(box){var s=el('div','us-space');Object.keys(S.ans).forEach(function(id){var q=Q.filter(function(x){return x.id===id})[0],c=S.ans[id].c;if(c==='?'||!q)return;var b=el('button','us-chip pick',label(q,c));b.type='button';b.title='Change this answer';b.onclick=function(){delete S.ans[id];S.ord=pending();S.i=0;next()};s.appendChild(b)});box.appendChild(s)}"
  + "function view(){var v=$('us-view');if(!v){v=el('div');v.id='us-view';iv.appendChild(v)}v.textContent='';return v}"
  + "function next(){var left=pending();var v=view();form.hidden=true;hint.hidden=true;"
  + "var q=left[0];if(!q){return done(v)}"
  + "var asked=S.total-left.length,bar=el('div','us-bar');var fill=el('i');fill.style.width=Math.round(100*asked/Math.max(S.total,1))+'%';bar.appendChild(fill);v.appendChild(bar);"
  + "v.appendChild(el('p','us-note','\\u201C'+S.text.slice(0,140)+'\\u201D'));space(v);v.appendChild(el('h2','us-q',q.q));"
  + "var g=el('div','us-opts'+(q.o.length===2?' two':''));q.o.forEach(function(o){var b=el('button','us-opt');b.type='button';var tag=el('b',null,q.yn?'':'Option '+o[0]);if(!q.yn)b.appendChild(tag);b.appendChild(document.createTextNode(o[1]));b.onclick=function(){answer(q,o[0])};g.appendChild(b)});v.appendChild(g);"
  + "var row=el('div','us-chips');var ns=el('button','us-chip quiet','Not sure');ns.type='button';ns.onclick=function(){answer(q,'?')};row.appendChild(ns);"
  + "var sk=el('button','us-chip quiet','That is enough, build it');sk.type='button';sk.onclick=function(){done(view())};row.appendChild(sk);"
  + "if(SR){var vm=el('button','us-chip','\\uD83C\\uDF99 Say it');vm.type='button';vm.onclick=function(){voice=true;listen(function(t){var c=matchSpoken(q,t);if(c)answer(q,c);else{hint.hidden=false;hint.textContent='I heard \\u201C'+t+'\\u201D. Say the answer again, or tap one.'; v.appendChild(el('p','us-note','I heard \\u201C'+t+'\\u201D. Say yes, no, A or B, or tap one.'))}},function(m){failMsg(m);hint.hidden=false;v.appendChild(el('p','us-note',hint.textContent))});};row.appendChild(vm)}"
  + "v.appendChild(row);speak(q.q,function(){if(voice&&SR&&!S.stop){listen(function(t){var c=matchSpoken(q,t);if(c)answer(q,c)},function(){})}})}"
  + "function compose(){var parts=[S.text];Q.forEach(function(q){var a=S.ans[q.id];if(a&&a.c!=='?')parts.push(label(q,a.c))});return parts.join('. ')}"
  + "function done(v){S.stop=true;try{speechSynthesis.cancel()}catch(e){}v.textContent='';v.appendChild(el('h2','us-q','Here is what I heard'));space(v);"
  + "v.appendChild(el('p',null,compose()));var f=el('form');f.method='post';f.action='/api/idea';var a=el('input');a.type='hidden';a.name='idea';a.value=compose().slice(0,1900);var p=el('input');p.type='hidden';p.name='profile';"
  + "var prof={};Object.keys(S.ans).forEach(function(k){prof[k]=S.ans[k].c});p.value=JSON.stringify({said:S.text.slice(0,500),space:prof,voice:voice});f.appendChild(a);f.appendChild(p);"
  + "var row=el('div','us-chips');var go=el('button','us-chip pick','Build it');go.type='submit';var again=el('button','us-chip quiet','Start over');again.type='button';again.onclick=function(){location.reload()};row.appendChild(go);row.appendChild(again);f.appendChild(row);v.appendChild(f);speak('Here is what I heard. '+compose())}"
  + "})();";

// ENGINEER-LANE-1: for people who write code. Status is honest: live, testing, or pinned (not built yet, with the trigger that will build it).
export const PINS = [
  ["Live", "Heartbeat loop", "A 10-minute tick reconciles state, claims the top ready item, dispatches it to a role, verifies and writes back (seed/worker tick).", "python3 -m foundation launch"],
  ["Live", "Virtual managers and staff", "Portfolio, project and product managers plus operations, reviewer and staff roles, each a plain file in agents/roles with limits in autonomy/policy.json.", "python3 -m foundation loops --verify"],
  ["Live", "Plussing", "A protected share of capacity (default 20%) goes to improvements so work does not collapse into bug fixes; every closed item proposes a plus.", "capacity.plus_share in ultrastable.json"],
  ["Live", "Earned-trust autonomy", "A trust ledger widens or narrows what each role may do from graded predictions, never by itself.", "trust rows in the org database"],
  ["Live", "Probes with automatic revert", "Each deploy declares probes; a probe that passed before and fails after reverts the push and files its own issue.", "site/probes.json"],
  ["Live", "Ultrastable runs on itself", "Its roadmap, issues, managers and specs run on the same code it gives everyone.", "python3 -m foundation selfhost"],
  ["Testing", "Other clouds", "Deploy briefs exist for Cloudflare, Google Cloud, AWS and Azure (/deploy.md); only Cloudflare is proven in production.", "/deploy/gcp.md"],
  ["Testing", "Voice interview front door", "Spoken and tapped either/or questions build a solution space. The question bank is static; adaptive follow-ups from a model are pinned.", "site/interview.js"],
  ["Pinned", "Executor opens its own merged pull request", "Built and tested with a fake model; blocked on a bound model credential. Each run records no-model-credential until a host has a key.", "trigger: ANTHROPIC_API_KEY bound; probe: a merged agent/* PR"],
  ["Pinned", "Fresh-account bootstrap", "The first real --apply of a brand-new organization on an empty Cloudflare account has not run yet.", "docs/bootstrapping/bootstrapping.md"],
  ["Pinned", "Packaged installer and second installation", "Today there is one installation. A second independent one is the first pilot milestone.", "trigger: first pilot repo"],
  ["Pinned", "Core separated from QNFO's database", "The core still shares a database with QNFO's research applications.", "trigger: pilot milestone 1"],
  ["Pinned", "Outside audit of prediction scoring", "The match rate is scored by the system itself; an independent audit is a pilot goal.", "trigger: pilot milestone 2"],
  ["Pinned", "Adaptive interview", "Pick the next question from the answers so far with a small model instead of a fixed bank; record which questions narrowed the solution space most.", "trigger: model credential + 20 recorded interviews"]
];

export default { CSS, JS, askBar, PINS };
