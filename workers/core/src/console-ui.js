// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// The whole console UI: one static page, no dependencies, no third-party requests.
// All dynamic text is inserted with textContent, never innerHTML (titles are written by agents).
// NOTE: no backticks and no dollar-brace sequences inside the script below, because this file is a template literal.
export const CONSOLE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ultrastable</title>
<style>
:root{--bg:#f7f7f5;--fg:#1c1c1a;--mut:#66665f;--card:#fff;--line:#e2e2dc;--ok:#1f7a4d;--warn:#b45309;--btn:#1c1c1a}
@media(prefers-color-scheme:dark){:root{--bg:#161614;--fg:#eeeee9;--mut:#9a9a92;--card:#1f1f1c;--line:#34342f;--ok:#4cc38a;--warn:#f0a04b;--btn:#eeeee9}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.45 system-ui,sans-serif}
main{max-width:34rem;margin:0 auto;padding:1rem 1rem 6rem}
h1{font-size:1.25rem;margin:.2rem 0 .1rem}h2{font-size:1rem;margin:1.4rem 0 .5rem;color:var(--mut);font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.head{padding:1rem;border-radius:12px;background:var(--card);border:1px solid var(--line)}.head p{margin:.2rem 0 0;color:var(--mut);font-size:.9rem}
.dot{display:inline-block;width:.7rem;height:.7rem;border-radius:50%;margin-right:.45rem;background:var(--ok)}.dot.bad{background:var(--warn)}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:.9rem;margin:.6rem 0}.card p{margin:.25rem 0}.mut{color:var(--mut);font-size:.9rem}
.nums{display:flex;gap:.6rem}.nums div{flex:1;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:.7rem;text-align:center}.nums b{display:block;font-size:1.6rem}
button{font:inherit;border:1px solid var(--btn);background:var(--btn);color:var(--bg);border-radius:10px;padding:.6rem .9rem;margin:.35rem .35rem 0 0;min-height:2.75rem;cursor:pointer}
button.alt{background:transparent;color:var(--fg);border-color:var(--line)}
nav{position:fixed;bottom:0;left:0;right:0;display:flex;background:var(--card);border-top:1px solid var(--line)}nav button{flex:1;margin:0;border:0;border-radius:0;background:transparent;color:var(--mut);min-height:3.4rem}nav button[aria-selected=true]{color:var(--fg);font-weight:700;box-shadow:inset 0 -3px var(--fg)}
.ask{display:flex;gap:.4rem;margin-top:.6rem}.ask input{flex:1;font:inherit;padding:.65rem;border-radius:10px;border:1px solid var(--line);background:var(--card);color:var(--fg)}
.chips button{font-size:.9rem;padding:.4rem .7rem;min-height:2.2rem}
.changed{font-weight:600;color:var(--warn)}
.say{margin:.6rem 0;padding:.7rem;border-left:3px solid var(--ok);background:var(--card)}
[hidden]{display:none}
</style></head><body><main>
<div class="head"><h1><span class="dot" id="dot"></span><span id="headline">Loading</span></h1><p id="sub"></p></div>
<div id="say" class="say" hidden></div>
<section id="s-start" hidden></section><section id="s-now"></section><section id="s-needs" hidden></section><section id="s-prog" hidden></section><section id="s-connect" hidden></section><section id="s-help" hidden></section>
<h2>Ask for something</h2>
<div class="chips" id="chips"></div>
<form class="ask" id="askform"><input id="asktext" maxlength="4000" placeholder="Say what you want, in your own words" aria-label="Say what you want"><button>Send</button></form>
</main>
<nav role="tablist"><button role="tab" data-t="now" aria-selected="true">Now</button><button role="tab" data-t="needs" aria-selected="false">Needs you</button><button role="tab" data-t="prog" aria-selected="false">Progress</button><button role="tab" data-t="connect" aria-selected="false">Connect</button><button role="tab" data-t="help" aria-selected="false">Help</button></nav>
<script>
var D=null,TAB='now',WT=null,WTSEEN=false;
try{WTSEEN=localStorage.getItem('us_wt_seen')==='1'}catch(e){}
var LAB={open:'Open',done:'Done',stuck:'Stuck',predictions_right:'Called right',waiting_on_you:'Waiting on you'};
function el(t,c,x){var e=document.createElement(t);if(c)e.className=c;if(x!==undefined)e.textContent=x;return e}
function say(m){var s=document.getElementById('say');s.textContent=m;s.hidden=!m}
function post(u,b,ask){if(ask!==false&&!window.confirm('Please confirm.'))return Promise.resolve({ok:false,j:{error:'Cancelled.'}});b.confirm=true;return fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}},function(){return {ok:r.ok,j:{}}})})}
function more(sec,n){if(n>0)sec.appendChild(el('p','mut',T('t.more','And {n} more.').replace('{n}',String(n))))}
function list(sec,title,items,fmt,n){sec.appendChild(el('h2','',title));if(!items.length){sec.appendChild(el('p','mut',T('t.nothing','Nothing here.')));return}items.forEach(function(i){var c=el('div','card');fmt(c,i);sec.appendChild(c)});more(sec,n)}
function okLink(l){return typeof l==='string'&&(l.indexOf('https://')===0||(l.charAt(0)==='/'&&l.charAt(1)!=='/'))}
function answerAsk(n,ch,ask){return post('/api/console/walkthrough/answer',{need_id:n,choice:ch},ask).then(function(r){if(r.j.explain)say(r.j.explain);else if(!r.ok)say(r.j.error||'Something went wrong.');else say('Thank you. Noted.');load()})}
function askButtons(c,i){
 (i.buttons||[]).forEach(function(b){var x=el('button',(b==='Not sure'||b==='Tell me more')?'alt':'',b);x.onclick=function(){answerAsk(i.need_id,b,b!=='Tell me more')};c.appendChild(x)});
 if(i.free_text){var f=el('form');var inp=el('input');inp.setAttribute('aria-label','Your answer');inp.maxLength=200;inp.style.cssText='width:100%;padding:.6rem;margin:.4rem 0;font:inherit';var sb=el('button','','Send');f.appendChild(inp);f.appendChild(sb);f.onsubmit=function(e){e.preventDefault();var v=inp.value.trim();if(v)answerAsk(i.need_id,v,true)};c.appendChild(f)}}
function needCard(s,i){
 var c=el('div','card');c.appendChild(el('p','',i.what));if(i.changed)c.appendChild(el('p','changed',i.changed));if(i.why)c.appendChild(el('p','mut',i.why));if(i.cue)c.appendChild(el('p','mut',i.cue));
 c.appendChild(el('p','mut',T('t.donothing','If you do nothing: ')+i.default_in_effect));
 if(i.kind==='manual'){var b1=el('button','',T('b.did','I did it'));b1.onclick=function(){act(i.id,'done')};var b2=el('button','alt',T('b.default','Use the default'));b2.onclick=function(){act(i.id,'default')};c.appendChild(b1);c.appendChild(b2)}
 if(i.kind==='secret'){var b4=el('button','',T('b.connect','Add it in Connect'));b4.onclick=function(){show('connect')};c.appendChild(b4)}
 if(i.kind==='ask'&&i.need_id&&i.buttons)askButtons(c,i);
 if(okLink(i.link)){var bl=el('button','',T('b.do','Do it'));bl.onclick=function(){location.href=i.link};c.appendChild(bl)}
 if(i.kind==='manual'||i.kind==='secret'||(i.kind==='ask'&&String(i.id).indexOf('ask:')!==0)){var b3=el('button','alt',T('b.explain','What does this mean?'));b3.onclick=function(){act(i.id,'explain')};c.appendChild(b3)}
 s.appendChild(c)}
function T(k,d){var m=D&&D.screens&&D.screens.i18n&&D.screens.i18n.messages;return (m&&typeof m[k]==='string'&&m[k])||d}
function render(){
 var S=D.screens||D;
 if(document.documentElement&&D.screens&&D.screens.i18n){document.documentElement.dir=D.screens.i18n.dir||'ltr';document.documentElement.lang=D.screens.i18n.lang||'en'}
 document.querySelectorAll('nav button').forEach(function(b){var v=T('tab.'+b.dataset.t,'');if(v)b.textContent=v});
 document.getElementById('headline').textContent=S.headline||D.headline;document.getElementById('dot').className='dot'+(D.ok?'':' bad');
 document.getElementById('sub').textContent=D.last_check?('Last check: '+D.last_check):'';
 var n=document.getElementById('s-now');n.textContent='';
 var nm=(S.now&&S.now.numbers)||[{metric:'open',value:S.now.open},{metric:'done',value:S.now.done},{metric:'stuck',value:S.now.blocked}];
 var nums=el('div','nums');nm.forEach(function(p){var d=el('div');d.appendChild(el('b','',String(p.value)));d.appendChild(el('span','mut',LAB[p.metric]||p.metric));nums.appendChild(d)});n.appendChild(nums);
 list(n,T('h.working','Working on'),S.now.working_on,function(c,i){c.appendChild(el('p','',i.title));c.appendChild(el('p','mut',i.owner||''))},S.now.working_on_more);
 if(S.now.stuck.length)list(n,T('h.stuck','Stuck'),S.now.stuck,function(c,i){c.appendChild(el('p','',i.title));c.appendChild(el('p','mut',i.blocker||''))},S.now.stuck_more);
 var s=document.getElementById('s-needs');s.textContent='';
 s.appendChild(el('h2','',T('h.needs','Needs you')));if(!S.needs_you.cards.length)s.appendChild(el('p','mut',T('t.nothing','Nothing here.')));
 S.needs_you.cards.forEach(function(i){needCard(s,i)});
 if(S.needs_you.more)s.appendChild(el('p','mut','And '+S.needs_you.more+' more after these.'));
 var p=document.getElementById('s-prog');p.textContent='';
 list(p,T('h.finished','Finished lately'),S.progress.done_lately,function(c,i){c.appendChild(el('p','',i.title));c.appendChild(el('p','mut',i.updated_at))},S.progress.done_lately_more);
 p.appendChild(el('h2','',T('h.predicts','How well it predicts')));var pr=S.progress.predictions;var c1=el('div','card');c1.appendChild(el('p','',pr.scored?('It called '+pr.hit+' of '+pr.scored+' outcomes right.'):'Nothing scored yet.'));p.appendChild(c1);
 list(p,T('h.autonomy','Where it acts on its own'),S.progress.autonomy,function(c,i){c.appendChild(el('p','',i.what));c.appendChild(el('p','mut',T('t.level','Level: ')+i.level))},S.progress.autonomy_more);
 renderConnect();renderHelp();renderStart();
 var ch=document.getElementById('chips');ch.textContent='';(D.suggestions||[]).forEach(function(q){var b=el('button','alt',q);b.onclick=function(){chip(q)};ch.appendChild(b)});
 show(TAB)}
function submitIdea(t){post('/api/console/walkthrough/idea',{text:t}).then(function(r){say(r.ok?'Thank you. I have what I need to start.':(r.j.error||'Could not save that.'));load()})}
function renderStart(){
 var s=document.getElementById('s-start');s.textContent='';
 if(!WT||WT.error||(WT.kind==='done'&&WTSEEN)){s.hidden=true;return}
 s.hidden=false;s.appendChild(el('h2','','Getting started: step '+WT.step+' of '+WT.of));
 var c=el('div','card');
 if(WT.kind==='idea'){c.appendChild(el('p','',WT.question));c.appendChild(el('p','mut',WT.example));
  (WT.suggestions||[]).forEach(function(q){var b=el('button','alt',q);b.onclick=function(){submitIdea(q)};c.appendChild(b)});
  var f=el('form');var inp=el('input');inp.setAttribute('aria-label','What you want to exist');inp.maxLength=4000;inp.style.cssText='width:100%;padding:.6rem;margin:.4rem 0;font:inherit';var sb=el('button','','Send');f.appendChild(inp);f.appendChild(sb);f.onsubmit=function(e){e.preventDefault();var v=inp.value.trim();if(v)submitIdea(v)};c.appendChild(f)}
 if(WT.kind==='ask'){var k=WT.card;c.appendChild(el('p','',k.question));if(k.changed)c.appendChild(el('p','changed',k.changed));c.appendChild(el('p','mut',k.why));c.appendChild(el('p','mut',k.cue));
  if(k.default!=null)c.appendChild(el('p','mut','If you do nothing: we use "'+k.default+'". '+(k.default_consequence||'')));
  askButtons(c,{need_id:k.need_id,buttons:k.buttons,free_text:k.free_text});
  if(WT.remaining>1)c.appendChild(el('p','mut','And '+(WT.remaining-1)+' more questions after this one.'))}
 if(WT.kind==='readback'){c.appendChild(el('p','',WT.readback.defaults?(WT.readback.defaults+' of these were assumed for you. They come first.'):'Nothing here was assumed for you.'));
  var rb=el('button','alt','Read it');rb.onclick=function(){location.href='/console/readback'};var ok=el('button','','This is right');ok.onclick=function(){post('/api/console/readback',{confirm_readback:true}).then(function(r){say(r.j.message||r.j.error||'');load()})};c.appendChild(rb);c.appendChild(ok)}
 if(WT.kind==='done'){c.appendChild(el('p','','This is what works now.'));(WT.works.runs||[]).forEach(function(t){c.appendChild(el('p','',t))});(WT.works.not_yet||[]).forEach(function(t){c.appendChild(el('p','mut','Not yet: '+t))});
  if(WT.later)c.appendChild(el('p','mut',WT.later+' smaller questions are left for later; we use sensible defaults until then.'));
  var g=el('button','','Got it');g.onclick=function(){WTSEEN=true;try{localStorage.setItem('us_wt_seen','1')}catch(e){}renderStart()};c.appendChild(g)}
 if(WT.setup&&WT.setup.cards&&WT.setup.cards.length&&WT.kind!=='done')c.appendChild(el('p','mut','Only you can do: '+WT.setup.cards.map(function(x){return x.what}).join('; ')+(WT.setup.more?' and '+WT.setup.more+' more':'')+'. Work carries on meanwhile.'));
 s.appendChild(c)}
var HELP={ANTHROPIC_API_KEY:'This lets the system ask a language model to write and review work. You get the key from the account page of your model provider, under API keys. Paste it here once; it is kept private and never shown again.',OPENAI_API_KEY:'A key from your model provider account.'};
function renderHelp(){var s=document.getElementById('s-help');s.textContent='';s.appendChild(el('h2','','Help'));(D.help||[]).forEach(function(h){var c=el('div','card');c.appendChild(el('p','',h.title));h.text.split(String.fromCharCode(10,10)).forEach(function(t){c.appendChild(el('p','mut',t))});s.appendChild(c)})}
function renderConnect(){var s=document.getElementById('s-connect');s.textContent='';s.appendChild(el('h2','','Connect'));var L=D.connections||[];if(!L.length)s.appendChild(el('p','mut','Nothing to connect here.'));
 L.forEach(function(k){var c=el('div','card');c.appendChild(el('p','',k.label));if(k.href){c.appendChild(el('p','mut',k.present?'Connected.':'Not connected yet.'));c.appendChild(el('p','mut',k.help||''));var gb=el('button','',k.present?'Reconnect':k.label);gb.type='button';gb.onclick=function(){location.href=k.href};c.appendChild(gb);s.appendChild(c);return}c.appendChild(el('p','mut',k.present?('Connected'+(k.set_at?' ('+k.set_at+')':'')+'. Paste a new value to replace it.'):'Not connected yet.'));c.appendChild(el('p','mut',k.help||HELP[k.name]||''));
  var f=el('form');var inp=el('input');inp.type='password';inp.autocomplete='off';inp.setAttribute('aria-label',k.label);inp.style.cssText='width:100%;padding:.6rem;margin:.4rem 0;font:inherit';var b=el('button','','Save');f.appendChild(inp);f.appendChild(b);
  f.onsubmit=function(e){e.preventDefault();var v=inp.value.trim();if(!v)return;post('/api/console/secret',{name:k.name,value:v}).then(function(r){inp.value='';say(r.ok?'Saved. It is stored privately and will not be shown again.':(r.j.error||'Could not save.'));load()})};
  c.appendChild(f);if(k.source==='console'){var rm=el('button','alt','Disconnect');rm.type='button';rm.onclick=function(){post('/api/console/secret/remove',{name:k.name}).then(function(r){say(r.ok?'Disconnected.':(r.j.error||'Could not disconnect.'));load()})};c.appendChild(rm)}s.appendChild(c)})}
function show(t){TAB=t;['now','needs','prog','connect','help'].forEach(function(k){document.getElementById('s-'+k).hidden=(k!==t)});document.querySelectorAll('nav button').forEach(function(b){b.setAttribute('aria-selected',String(b.dataset.t===t))})}
function chip(q){post('/api/console/ask',{text:q},false).then(function(r){say(r.j.answer||r.j.message||r.j.error||'');if(r.j.screen)show(r.j.screen);window.scrollTo(0,0);load()})}
function act(id,choice){post('/api/console/card',{id:id,choice:choice},choice!=='explain').then(function(r){if(r.j.explain)say(r.j.explain);else if(!r.ok)say(r.j.error||'Something went wrong.');else say('Done.');load()})}
function load(){fetch('/api/console').then(function(r){if(r.status===401){location.href='/console';return null}return r.json()}).then(function(j){if(!j)return null;D=j;return fetch('/api/console/walkthrough').then(function(r){return r.ok?r.json():null}).catch(function(){return null}).then(function(w){WT=(w&&!w.error)?w:null;render()})})}
document.querySelectorAll('nav button').forEach(function(b){b.onclick=function(){show(b.dataset.t)}});
document.getElementById('askform').onsubmit=function(e){e.preventDefault();var i=document.getElementById('asktext');var t=i.value.trim();if(!t)return;post('/api/console/ask',{text:t}).then(function(r){say(r.j.answer||r.j.message||r.j.error||'');if(r.j.screen)show(r.j.screen);i.value='';load()})};
load();setInterval(load,60000);
</script></body></html>`;
