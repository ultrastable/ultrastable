// TRANSPARENCY-1: /live and /api/live. Read-only for everyone; GET only, no write path, no secrets.
// Data: D1 table `transparency_parts` (numbered parts of one generation), written by `python3 -m foundation transparency --sql` on every loop pass.
// Changing anything stays behind the owner's e-mailed code (dashboard worker, /owner).
const JSON_H = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };

import { recency, recencyHeaders } from "../seed/worker/src/recency.js"; // RECENCY-1: live pages state the time of their latest reading
export async function load(env) {
  if (!env || !env.DB) return null;
  try {
    // newest generation whose part 0 exists (part 0 is written last), parts joined in order
    const h = await env.DB.prepare("SELECT generated, total FROM transparency_parts WHERE part=0 ORDER BY generated DESC LIMIT 1").first();
    if (!h) return null;
    const rows = await env.DB.prepare("SELECT body FROM transparency_parts WHERE generated=? ORDER BY part").bind(h.generated).all();
    const list = rows.results || [];
    if (list.length !== h.total) return null;
    return { generated: h.generated, body: list.map(r => r.body).join("") };
  } catch (e) { return null; }
}


// LIVE-FRESH-1: the daily snapshot is only the base. Merged changes come live from the tick Worker (refreshed every pass) and are merged in by PR number;
// `freshness` states the age of each source against its cadence so a stale page says so and the probe (/api/freshness) can fail.
export const CADENCE_S = { snapshot: 26 * 3600, changes: 30 * 60, pages: 26 * 3600 };
const ageS = (iso, now) => { const t = Date.parse(String(iso || "").replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso || "")) ? "" : "Z")); return isNaN(t) ? null : Math.max(0, Math.round((now - t) / 1000)); };
// Q-CRIT-PUBLIC-STAGE: the stage the tick Worker reads for itself (ignition) and its heartbeat (pulse), fetched through the TICK service binding at
// request time and stamped with the time of the reading. A reading older than two tick intervals is stale: a stopped tick cannot show its last stage.
export const TICK_INTERVAL_S = 600;
export async function ignitionReading(env, now = Date.now()) {
  if (!env || !env.TICK) return { ok: false, code: "no_binding", message: "The stage reading is not available on this deployment." };
  let j = null;
  try { const r = await env.TICK.fetch(new Request("https://tick.internal/live")); if (r.ok) j = await r.json(); } catch (e) { console.error("ignition", e && e.message); }
  if (!j) return { ok: false, code: "tick_unreachable", message: "The tick Worker did not answer." };
  const ig = j.ignition || null, at = ig && ig.at || null, age = ageS(at, now);
  const body = { read_at: new Date(now).toISOString(), reading_at: at, age_s: age, max_age_s: 2 * TICK_INTERVAL_S, stage: ig ? ig.stage : null, since: ig ? ig.since : null,
    bootstrapped: ig ? Boolean(ig.bootstrapped) : null, blocking: ig && ig.blocking || null, k_eff: j.k_eff ?? null, k_self: j.k_self ?? null, self_regime: j.self_regime ?? null,
    open_ignition_gaps: j.open_ignition_gaps ?? null, self_sustaining: Boolean(j.self_sustaining), pulse_at: j.pulse && j.pulse.at || null, log: ig && ig.log || [] };
  if (age == null || age > body.max_age_s) return { ...body, ok: false, code: "stale_reading", message: "The newest tick is older than two intervals, so no stage is shown." , stage: null };
  return { ...body, ok: true };
}
export async function ignitionResponse(env, now = Date.now()) {
  const b = await ignitionReading(env, now);
  return new Response(JSON.stringify(b), { status: b.ok ? 200 : 503, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" } });
}

async function liveChanges(env) {
  try { if (env && env.TICK) { const r = await env.TICK.fetch(new Request("https://tick.internal/api/live/changes")); if (r.ok) return await r.json(); } } catch (e) { console.error("live changes", e && e.message); }
  return null;
}
// RECENCY-1: a page that reads the snapshot shows the snapshot's time, not the time the page was built.
export function readingRecency(generated, now = Date.now()) {
  return recency({ updatedAt: generated, maxAgeS: CADENCE_S.snapshot, schedule: "Republished by the transparency loop at least every 26 hours", source: "transparency snapshot", now });
}
export async function overlay(d, env, generated, now = Date.now(), bundleAt = null) {
  const live = await liveChanges(env);
  const f = { snapshot: { at: generated, age_s: ageS(generated, now), cadence_s: CADENCE_S.snapshot }, changes: { at: live && live.refreshed_at || null, age_s: live ? ageS(live.refreshed_at, now) : null, cadence_s: CADENCE_S.changes } };
  if (live && live.changes && live.changes.length) {
    const th = d.throughput = d.throughput || {}, by = new Map();
    for (const g of th.changelog || []) for (const c of g.changes) by.set(c.n, { ...c, date: g.date });
    for (const c of live.changes) { const old = by.get(c.n) || {}; by.set(c.n, { ...old, n: c.n, title: c.title, by: c.by, url: c.url, date: c.merged_at.slice(0, 10), plus: old.plus, minus: old.minus }); }
    const days = {};
    for (const c of by.values()) (days[c.date] = days[c.date] || []).push(c);
    th.changelog = Object.keys(days).sort().reverse().slice(0, 14).map(date => ({ date, changes: days[date].sort((a, b) => b.n - a.n) }));
  }
  // PAGES-FRESH-1: every page served from a bundled generated file (roadmap, claims, self, ultrastability, spinoffs, dashboard preview, feed) is only as new as the
  // deploy that carried it. The bundle states the commit time it was built at; a merged change newer than that by more than an hour has not reached those pages.
  // SUBSTANCE-1: only a merge that altered behaviour obliges a redeploy; trivial and record-keeping merges no longer redeploy the Workers, and regenerated
  // data reaches the bundle at most once per doctrine/substance.json deploy.max_age_hours (20 h), so the bundle may lag by up to a day (cadence 26 h).
  const counted = live && live.changes ? live.changes.filter(c => c.substance !== "trivial" && c.substance !== "record") : [];
  const newest = counted.length ? Math.max(...counted.map(c => Date.parse(c.merged_at)).filter(t => !isNaN(t))) : null;
  const bt = Date.parse(bundleAt || "");
  f.pages = { at: bundleAt || null, behind_s: newest != null && !isNaN(bt) ? Math.max(0, Math.round((newest - bt) / 1000)) : null, cadence_s: CADENCE_S.pages };
  for (const k of ["snapshot", "changes"]) f[k].stale = f[k].age_s == null || f[k].age_s > f[k].cadence_s;
  f.pages.stale = isNaN(bt) || (f.pages.behind_s != null && f.pages.behind_s > f.pages.cadence_s);
  d.ignition = await ignitionReading(env, now);
  d.freshness = { ...f, ok: !f.snapshot.stale && !f.changes.stale && !f.pages.stale, checked_at: new Date(now).toISOString() };
  return d;
}

const JS = `
const $=s=>document.querySelector(s);
function el(t,c,x){const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e}
function link(t,h){const a=el('a',null,t);a.href=h;a.rel='noopener';return a}
function sec(t,sub){const s=el('section','card');s.appendChild(el('h2',null,t));if(sub)s.appendChild(el('p','meta',sub));$('#live').appendChild(s);return s}
function table(parent,head,rows){const w=el('div','us-wrap'),t=el('table','us-table'),h=el('tr');head.forEach(x=>h.appendChild(el('th',null,x)));t.appendChild(h);rows.forEach(r=>{const tr=el('tr');r.forEach(c=>{const td=el('td');if(c&&c.href)td.appendChild(link(c.t,c.href));else td.textContent=c==null?'':String(c);tr.appendChild(td)});t.appendChild(tr)});w.appendChild(t);parent.appendChild(w)}
fetch('/api/live').then(r=>r.json()).then(d=>{
 if(d.error){$('#live').textContent=d.error;return}
 const s=d.scoreboard,c=d.claims||{};
 const fr=d.freshness||{};$('#asof').textContent='Snapshot '+d.generated+' from commit '+d.commit+'. Merged changes refreshed '+((fr.changes||{}).at||'never')+'. '+d.access+'.'+(fr.ok===false?' STALE: '+['snapshot','changes'].filter(k=>(fr[k]||{}).stale).join(', ')+' older than its cadence; the freshness probe in the transparency workflow fails and files the repair.':'');
 const sb=sec('Scoreboard','Every number is computed from the repository and the live checks, not typed in.');
 table(sb,['Measure','Value'],[['Loops and managers in the registry',s.managers_and_loops],['...of which have a recorded run',s.loops_with_evidence+' (the rest are a gap and are listed below)'],['Components live',JSON.stringify(s.components)],['Wired connections',s.edges_wired+' of '+s.edges_total],['User stories passing',s.stories_passing+' of '+s.stories_total],['Open gaps',s.open_gaps],['Open pull requests',s.open_prs]]);
 const ig=d.ignition||{},is=sec('Stage','The stage the system reads for itself, from bootstrap to self-sustaining, fetched from the tick Worker when this page loads. A reading older than two tick intervals is not shown.');
 table(is,['Measure','Value'],ig.ok?[['Stage',ig.stage],['Since',ig.since],['Reading taken',ig.reading_at+' ('+ig.age_s+' s ago)'],['Blocked at',ig.blocking?(ig.blocking.stage||'')+': '+(ig.blocking.why||''):'nothing'],['k_eff',ig.k_eff],['k_self',ig.k_self==null?'not measured':ig.k_self],['Regime',ig.self_regime==null?'not measured':ig.self_regime],['Open ignition gaps',ig.open_ignition_gaps]]:[['Stage','not shown: '+(ig.message||'no reading')],['Last reading',ig.reading_at||'none']]);
 const th=d.throughput||{},mg0=th.merged||{},oo=mg0.by_origin||{};
 const tp=sec('How much code ships','Merged pull requests, by who opened them. Unattended means the server-side executor picked the work from the backlog without a session driving it.');
 table(tp,['Origin','Merged PRs','Lines added','Lines removed'],Object.keys(oo).map(k=>[k,oo[k].prs,oo[k].lines_added,oo[k].lines_removed]));
 table(tp,['Measure','Value'],[['Merged PRs in total',mg0.total],['Median hours from open to merge',mg0.median_hours_open_to_merge],['Merged per day',JSON.stringify(mg0.per_day)],['Site deploys by outcome (last 50)',JSON.stringify((th.deploys||{}).by_conclusion)],['Backlog items by status',JSON.stringify((th.queue||{}).by_status)],['Backlog items the executor may take now',(th.queue||{}).takeable_now],['Model calls and estimated cost (USD)',JSON.stringify(th.model_cost)],['Executor runs by outcome',JSON.stringify((th.executor||{}).by_conclusion)],['PRs the executor opened unattended, by state',JSON.stringify((th.executor||{}).attempts)]]);
 const cg=sec('Changelog','Every merged change by day, with size. Repository contents and the backlog text stay private.');
 (th.changelog||[]).forEach(g=>{cg.appendChild(el('h3',null,g.date+' ('+g.changes.length+' changes)'));table(cg,['PR','Title','By','Size'],g.changes.map(x=>[x.url?{t:'#'+x.n,href:x.url}:x.n,x.title,x.by,x.plus==null?'':'+'+x.plus+' -'+x.minus]))});
 const gw=d.growth||{},gm=gw.mix||{};
 if(d.unknowns&&!d.unknowns.error){const u=d.unknowns,uk=sec('What we do not know','Improving only what is known shrinks the solution space, so the system also questions itself: every loop is asked inverted questions (pre-mortem, assumption audit, red team, Universal Ignorance Audit). A gap found becomes a new objective candidate.');
  table(uk,['Measure','Value'],[['Loops and needs questioned',u.units_questioned+' of '+u.units+' ('+Math.round(u.coverage*100)+'%)'],['Questions asked / answered / open',u.asked+' / '+u.answered+' / '+u.open],['Surprise rate (answers that found a gap)',Math.round(u.surprise_rate*100)+'%'],['New objective candidates',u.objective_candidates],['Answered with "we cannot know"',u.cannot_know]]);
  if((u.recent||[]).length)table(uk,['Date','Question','Step','Verdict'],u.recent.map(r=>[r.at,r.key,r.kind,r.verdict||'']))}
 const gs=sec('Growth','The product manager keeps shipped work from becoming only repairs: growth share of recent merges against its target, and the measured reach of the product. A breach opens a growth item.');
 table(gs,['Measure','Value'],[['Growth share of the last '+gm.total+' merges',gm.growth_share==null?'':Math.round(gm.growth_share*100)+'% (target '+Math.round((gw.target_growth_share||0)*100)+'%)'],['Merges: growth / fix / maintenance',gm.growth+' / '+gm.fix+' / '+gm.maintenance],['Growth items the executor may take now',gw.growth_items_takeable]]);
 table(gs,['Metric','7-day value','Target','Breach'],(gw.metrics||[]).map(m=>[m.what,m.value==null?'not measured':m.value,m.target,m.breach==null?'':m.breach?'yes':'no']));
 const sg=sec('Pipeline stages','Freshness of every stage against its own SLA: heartbeat, author, pull request, merge, deploy, publish. Stale stages are caught up, then changed, then filed as p0 repairs.');
 table(sg,['Stage','Status','Age (s)','SLA (s)','Missed SLAs','What it is'],(d.stages||[]).map(x=>[x.id,x.status+(x.lag_s!=null?' (lag '+x.lag_s+' s)':''),x.age_s,x.sla_s,x.missed,x.what]));
 const st2=d.settlement||{};
 const se=sec('Settlement by name','Every change the executor opens ends under the name of its work item: merged, closed, parked, failed or expired. Unsettled changes past the window are closed as expired and the item returns to the queue.');
 table(se,['Name','State','PR','Age (h)'],(st2.names||[]).map(x=>[x.name,x.state,x.pr==null?'':x.pr,x.age_h==null?'':x.age_h]));
 const pmr=d.product_manager||{};
 const pg=sec('Product manager','Targets follow a straight line from baseline to target; experiments are kept or replaced after a week; knobs are bounded, logged and reverted if the metric is no better; growth and repair items are filed by the loop.');
 table(pg,['Metric','Baseline','Expected today','Value','Target','Behind'],(pmr.targets||[]).map(t=>[t.id,t.baseline,t.expected_today,t.value==null?'not measured':t.value,t.target,t.behind==null?'':t.behind?'yes':'no']));
 table(pg,['Experiment (item)','Metric','Baseline','Predicted %','Verdict'],(pmr.experiments||[]).map(e=>[e.item,e.metric,e.baseline,e.predicted_pct,e.verdict||'running']));
 table(pg,['Knob','Value'],Object.entries(((pmr.knobs||{}).values)||{}));
 table(pg,['Knob change','Old','New','Why','Reviewed'],(pmr.knob_log||[]).map(k=>[k.knob+' ('+k.at.slice(0,10)+')',k.old,k.new,k.why,k.reviewed||'pending']));
 table(pg,['Filed by the loop'],[].concat(((pmr.filed||{}).growth||[]).map(x=>['growth: '+x]),((pmr.filed||{}).repair||[]).map(x=>['repair: '+x])).concat([['(none this pass)']].slice(0,((pmr.filed||{}).growth||[]).length+((pmr.filed||{}).repair||[]).length?0:1)));
 const wkr=pmr.weekly||{};if(wkr.metrics){const ws=sec('Growth this week ('+wkr.week+')','Written once a week by the product manager loop: each growth metric against the week before, and the next three experiments with the prediction each must meet to be kept.');
 table(ws,['Metric','This week','Last week','Change','Target'],wkr.metrics.map(m=>[m.id,m.value==null?'not measured':m.value,m.previous==null?'':m.previous,m.delta_pct==null?'':m.delta_pct+'%',m.target]));
 table(ws,['Reviewed experiment','Metric','Verdict'],(wkr.verdicts||[]).map(v=>[v.item,v.metric,v.verdict]));
 table(ws,['Next experiment','Prediction','Closing probe'],(wkr.next_experiments||[]).map(n=>[n.item,n.prediction,n.closing_probe]));}
 const ck=sec('Clocks','Every loop is a clock. Status is measured from its recorded beats, never declared: ticking, late, stopped, or idle when there is no work. A stopped or inaccurate clock is a defect.');
 table(ck,['Clock','Status','Last beat (s ago)','Beats in 24 h (expected)','Median jitter (s)','What it does'],(d.clocks||[]).map(c=>[c.id,c.status+(c.why?' ('+c.why+')':''),c.last_beat_age_s,c.beats_24h==null?'':c.beats_24h+' ('+c.expected_24h+')',c.median_jitter_s,c.what]));
 const tp2=d.topology||{},pt=tp2.parts||{};
 const sy=sec('System parts','The whole system as one declaration: workers, stores, queues, indexes and workflows. Planned parts are being built; drift is any difference between the declaration and the live account.');
 table(sy,['Part','Live','Planned'],Object.keys(pt).map(k=>[k,pt[k].live,pt[k].planned]));
 table(sy,['Worker','State','Public','Role'],(tp2.workers||[]).map(w=>[w.id,w.state,w.public?'yes':'no',w.role]));
 table(sy,['Pending bindings (declared, target not built yet)'],(tp2.pending_bindings||[]).map(x=>[x]));
 table(sy,['Drift against the live account'],(tp2.drift||[]).length?(tp2.drift||[]).map(x=>[x]):[['none']]);
 const ch=sec('Change feed','What the agents changed, newest first. Each row links the change to the work item that caused it.');
 table(ch,['When','Change','Work item','Source'],d.changes.commits.slice(0,25).map(x=>[x.at.slice(0,16).replace('T',' '),x.subject,x.item||'',{t:x.sha,href:x.url}]));
 const pr=sec('Pull requests in flight and recently merged');
 table(pr,['#','State','Title','Branch'],d.changes.pull_requests.slice(0,25).map(x=>[{t:'#'+x.number,href:x.url},x.state+(x.labels.length?' ('+x.labels.join(', ')+')':''),x.title,x.branch]));
 const mg=sec('Managers and loops','Who runs what, on what trigger, and when it last ran. A blank last run is an open gap, not a hidden one.');
 table(mg,['Loop','Kind','Trigger','Last run','What it does'],d.managers.map(m=>[m.loop,m.kind,m.trigger,m.last_run?(m.last_run.at+(m.last_run.ok?' ok':' FAILED')):'none recorded',m.summary]));
 const cl=sec('What the site claims, checked against the code','Each component is evaluated by a probe; each user story is run.');
 table(cl,['Component','Status'],(c.components||[]).map(x=>[x.id,x.status]));
 table(cl,['User','Story','Passes'],(c.stories||[]).map(x=>[x.user,x.id,x.pass?'yes':'NO']));
 table(cl,['Objection','Verdict'],(c.objections||[]).map(x=>[x.id,x.verdict]));
 const gp=sec('Gap register','What Ultrastable still does through outside tools, with the plan to close each.');
 table(gp,['Id','Tool','What','Status'],d.gaps.map(g=>[g.id,g.tool,g.what,g.status||'open']));
 const im=sec('Loop self-improvements');
 table(im,['When','Loop','Improvement'],(d.loop_improvements||[]).map(x=>[x.at,x.loop,x.improvement]));
 sec('The feedback loop').appendChild(el('p',null,d.feedback_loop));
}).catch(()=>{$('#live').textContent='The snapshot could not be loaded.'});`;

// CHANGELOG-FEED-1: /changelog.xml (RSS 2.0) and /changelog.json, built from the same snapshot and live overlay as /live: merged changes by
// day with size and origin. Titles, numbers and links only; no repository contents.
const xesc = t => String(t == null ? "" : t).replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[c]));
export function changelogFeed(d, origin) {
  const days = ((d.throughput || {}).changelog || []).map(g => ({ date: g.date, merged: g.changes.length, lines_added: g.changes.reduce((a, c) => a + (c.plus || 0), 0), lines_removed: g.changes.reduce((a, c) => a + (c.minus || 0), 0),
    by_origin: g.changes.reduce((a, c) => { const k = c.by || "unknown"; a[k] = (a[k] || 0) + 1; return a; }, {}),
    changes: g.changes.map(c => ({ number: c.n, title: c.title, origin: c.by || null, url: c.url || null, lines_added: c.plus == null ? null : c.plus, lines_removed: c.minus == null ? null : c.minus })) }));
  const json = { title: "Ultrastable changelog", home: origin + "/live", feed: origin + "/changelog.xml", freshness: d.freshness || null, days };
  const items = days.flatMap(g => g.changes.map(c => "<item><title>" + xesc(c.title) + "</title><link>" + xesc(c.url || origin + "/live") + "</link><guid isPermaLink=\"false\">ultrastable-change-" + xesc(c.number) + "</guid><pubDate>" + new Date(g.date + "T12:00:00Z").toUTCString() + "</pubDate><category>" + xesc(c.origin || "unknown") + "</category><description>" + xesc("Merged change " + c.number + (c.lines_added == null ? "" : ": " + c.lines_added + " lines added, " + c.lines_removed + " removed") + ". Origin: " + (c.origin || "unknown") + ".") + "</description></item>"));
  const xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><rss version=\"2.0\"><channel><title>Ultrastable changelog</title><link>" + origin + "/live</link><description>Merged code changes to Ultrastable, by day, size and origin.</description>" + (days[0] ? "<lastBuildDate>" + new Date(days[0].date + "T12:00:00Z").toUTCString() + "</lastBuildDate>" : "") + items.slice(0, 100).join("") + "</channel></rss>";
  return { json, xml };
}

const hesc = v => String(v == null ? "" : v).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
export function serverView(d, generated) {
  const days = ((d && d.throughput && d.throughput.changelog) || []).slice(0, 3), n = days.reduce((a, g) => a + g.changes.length, 0);
  const asof = "Snapshot taken " + hesc(generated || "at an unknown time") + ". " + n + " merged changes in the last " + days.length + " days shown below.";
  const first = days.length ? "<section class=\"card\"><h2>Latest merged changes</h2>" + days.map(g => "<h3>" + hesc(g.date) + " (" + g.changes.length + ")</h3><ul>"
    + g.changes.slice(0, 15).map(c => "<li>" + (c.url ? "<a href=\"" + hesc(c.url) + "\">#" + hesc(c.n) + "</a> " : "#" + hesc(c.n) + " ") + hesc(c.title) + "</li>").join("") + "</ul>").join("") + "</section>" : "";
  return { asof, first };
}

export async function liveResponse(u, request, env, shell, HTML, bundleAt = null) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(JSON.stringify({ error: "read-only" }), { status: 405, headers: { ...JSON_H, allow: "GET, HEAD" } });
  if (u.pathname === "/api/freshness") {
    const r = await load(env);
    const d = r ? await overlay({}, env, r.generated, Date.now(), bundleAt) : { freshness: { ok: false, snapshot: { stale: true, at: null }, changes: { stale: true } } };
    return new Response(JSON.stringify(d.freshness), { status: d.freshness.ok ? 200 : 503, headers: { ...JSON_H, "cache-control": "no-store" } });
  }
  if (u.pathname === "/changelog.xml" || u.pathname === "/changelog.json") {
    const r = await load(env);
    if (!r) return new Response(JSON.stringify({ error: "No snapshot published yet." }), { status: 503, headers: JSON_H });
    const f = changelogFeed(await overlay(JSON.parse(r.body), env, r.generated, Date.now(), bundleAt), u.origin);
    return u.pathname.endsWith(".xml") ? new Response(f.xml, { headers: { ...JSON_H, "content-type": "application/rss+xml; charset=utf-8" } }) : new Response(JSON.stringify(f.json), { headers: JSON_H });
  }
  if (u.pathname === "/api/live") {
    const r = await load(env);
    if (!r) return new Response(JSON.stringify({ error: "No snapshot published yet." }), { status: 503, headers: JSON_H });
    { const rc = readingRecency(r.generated); return new Response(JSON.stringify({ recency: rc, ...(await overlay(JSON.parse(r.body), env, r.generated, Date.now(), bundleAt)) }), { headers: { ...JSON_H, ...recencyHeaders(rc) } }); }
  }
  // REDTEAM-1: the page used to say only "Loading..." until its script ran, so crawlers, AI readers and no-JS visitors saw no figures.
  // The server now renders the snapshot time and the latest merged changes; the script replaces them with the full view.
  let asof = "The live record could not be read just now.", first = "", rc = readingRecency(null);
  try {
    const r = await load(env);
    if (r) { rc = readingRecency(r.generated); const d = await overlay(JSON.parse(r.body), env, r.generated, Date.now(), bundleAt); ({ asof, first } = serverView(d, r.generated)); }
  } catch (e) { console.error("live ssr", e && e.message); }
  const body = "<div class=\"head\"><h1>Ultrastable running on Ultrastable</h1><p>Everything here is read-only and open to everyone. It is the same record the managers and agents work from.</p><p class=\"meta\" id=\"asof\">" + asof + "</p><p class=\"meta\">Subscribe to merged changes: <a href=\"/changelog.xml\">RSS</a> or <a href=\"/changelog.json\">JSON</a>.</p></div><div id=\"live\">" + first + "</div><script>" + JS + "</script>";
  return new Response(shell({ path: "/live", title: "Live: Ultrastable running on Ultrastable", description: "Read-only view of the managers, loops, claim checks and code changes behind Ultrastable.", recency: rc }, body), { headers: { ...HTML, ...recencyHeaders(rc) } });
}
