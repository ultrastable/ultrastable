// TRANSPARENCY-1: /live and /api/live. Read-only for everyone; GET only, no write path, no secrets.
// Data: D1 table `transparency` (one row), written by `python3 -m foundation transparency --sql` on every loop pass.
// Changing anything stays behind the owner's e-mailed code (dashboard worker, /owner).
const JSON_H = { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "access-control-allow-origin": "*", "x-content-type-options": "nosniff" };

async function load(env) {
  if (!env || !env.DB) return null;
  try {
    const r = await env.DB.prepare("SELECT generated, body FROM transparency WHERE id=1").first();
    return r ? { generated: r.generated, body: r.body } : null;
  } catch (e) { return null; }
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
 $('#asof').textContent='Snapshot '+d.generated+' from commit '+d.commit+'. '+d.access+'.';
 const sb=sec('Scoreboard','Every number is computed from the repository and the live checks, not typed in.');
 table(sb,['Measure','Value'],[['Loops and managers in the registry',s.managers_and_loops],['...of which have a recorded run',s.loops_with_evidence+' (the rest are a gap and are listed below)'],['Components live',JSON.stringify(s.components)],['Wired connections',s.edges_wired+' of '+s.edges_total],['User stories passing',s.stories_passing+' of '+s.stories_total],['Open gaps',s.open_gaps],['Open pull requests',s.open_prs]]);
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

export async function liveResponse(u, request, env, shell, HTML) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(JSON.stringify({ error: "read-only" }), { status: 405, headers: { ...JSON_H, allow: "GET, HEAD" } });
  if (u.pathname === "/api/live") {
    const r = await load(env);
    return new Response(r ? r.body : JSON.stringify({ error: "No snapshot published yet." }), { status: r ? 200 : 503, headers: JSON_H });
  }
  const body = "<div class=\"head\"><h1>Ultrastable running on Ultrastable</h1><p>Everything here is read-only and open to everyone. It is the same record the managers and agents work from.</p><p class=\"meta\" id=\"asof\">Loading...</p></div><div id=\"live\"></div><script>" + JS + "</script>";
  return new Response(shell({ path: "/live", title: "Live: Ultrastable running on Ultrastable", description: "Read-only view of the managers, loops, claim checks and code changes behind Ultrastable." }, body), { headers: HTML });
}
