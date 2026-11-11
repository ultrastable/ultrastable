"""The owner cockpit: Ultrastable's own dashboard, built from Ultrastable's own repository records. Three screens: Now, Next, Needs you.

  python3 -m foundation cockpit [--out DIR]     writes DIR/index.html and DIR/state.json (default .selfhost/cockpit), then open index.html in any browser.

Self-referential: it boots the organization from the repo, lets it run its own ticks (foundation.autorun), and shows what the loop did, what it will do
next, and the few things only the owner can do, each with its default in effect and a closing probe. Modeled on the QNFO fleet dashboard but generic.
Needs Python 3 and a copy of the repo; works with no accounts and no network. The static output deploys unchanged as Cloudflare Workers static assets
(dashboard/cockpit/wrangler.toml); put it behind Cloudflare Access because it shows internal records.
"""
from __future__ import annotations
import json, re, sqlite3, subprocess
from pathlib import Path

from . import autorun, selfhost

REPO = selfhost.REPO
GH = "https://github.com/ultrastable/ultrastable"


def _j(root, rel, default=None):
    p = Path(root) / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else default


def loops(root) -> list[dict]:
    out, budget = [], _j(root, "actions-budget.json", {})
    for f in sorted((Path(root) / ".github/workflows").glob("*.yml")):
        t = f.read_text(encoding="utf-8")
        name = (re.search(r"^name:\s*(.+)$", t, re.M) or [0, f.stem])[1].strip()
        cron = re.search(r"cron:\s*['\"]([^'\"]+)['\"]", t)
        out.append({"id": f.stem, "name": name, "schedule": cron[1] if cron else None, "dispatch": "workflow_dispatch" in t, "push": bool(re.search(r"^\s+push:", t, re.M)),
                    "essential": f.stem in budget.get("essential", []), "path": f".github/workflows/{f.name}"})
    return out


def merges(root, n=10) -> list[dict]:
    r = subprocess.run(["git", "-C", str(root), "log", f"-{n}", "--format=%h%x09%ad%x09%s", "--date=format:%Y-%m-%d"], capture_output=True, text=True)
    rows = [l.split("\t") for l in r.stdout.strip().splitlines() if l]
    return [{"sha": s, "when": w, "subject": sub, "pr": (re.search(r"\(#(\d+)\)", sub) or [0, None])[1]} for s, w, sub in rows]


def build(root=REPO, ticks=10, node=True) -> dict:
    root = Path(root)
    res = autorun.run(root, ticks=ticks, node=node)
    if res["status"] != "ok":
        return {"status": "refused", "problems": res.get("problems", [])}
    log = res["log"]
    con = sqlite3.connect(res["db"])
    con.row_factory = sqlite3.Row
    inst = _j(root, "instances/ultrastable/instance.json", {})
    meta = autorun._items_meta(root)
    nxt = [dict(r) | {"milestone": meta.get(r["id"], {}).get("milestone"), "path": f"docs/issues/{r['id']}.json"}
           for r in con.execute("SELECT id,title,owner_role AS role,kind,priority,closing_probe FROM items WHERE status IN ('open','ready') ORDER BY priority, created_at, id LIMIT 12")]
    blocked = [dict(r) for r in con.execute("SELECT id,title,blocker FROM items WHERE status='blocked' ORDER BY id")]
    gates = [dict(r) for r in con.execute("SELECT id,what,why_gated,default_in_effect,closing_probe FROM gate_cards WHERE status='open' ORDER BY id")]
    managers = []
    for r in con.execute("SELECT role, MIN(tick_every) AS every FROM roles GROUP BY role ORDER BY role"):
        n_open = con.execute("SELECT COUNT(*) FROM items WHERE owner_role=? AND status IN ('open','ready','claimed')", (r["role"],)).fetchone()[0]
        n_done = con.execute("SELECT COUNT(*) FROM items WHERE owner_role=? AND status='done'", (r["role"],)).fetchone()[0]
        managers.append({"role": r["role"], "tick_every": r["every"], "open": n_open, "done": n_done})
    owner_steps = [{"id": s["id"], "title": s["title"], "why": s.get("reason", ""), "default": (s["card"]["default"] if isinstance(s.get("card"), dict) else "the fleet prepares everything and keeps going"),
                    "probe": (s["card"]["probe"] if isinstance(s.get("card"), dict) else "the filing plan's closing probe")}
                   for s in _j(root, "foundation/data/owner-steps.json", {"steps": []})["steps"] if s.get("identity_bound")]
    out = _j(root, "outreach/status.json", {})
    funnel = {k[6:]: v for k, v in out.get("metrics", {}).items() if k.startswith("state_") and v}
    state = {
        "status": "ok", "org": {"name": inst.get("name", "Ultrastable"), "positioning": inst.get("positioning", "")},
        "labels": log["labels"], "now": {"last_tick": log["ticks"][-1], "start": log["start"], "end": log["end"], "ticks": log["ticks"]},
        "next": nxt, "blocked": blocked, "managers": managers, "gaps": selfhost.gaps_report(root), "loops": loops(root),
        "needs_you": {"owner_steps": owner_steps, "gate_cards": gates, "outreach_cards": out.get("owner_cards", [])},
        "funding": {"mode": out.get("mode"), "sender_registered": out.get("sender_registered"), "targets": out.get("metrics", {}).get("targets"), "funnel": funnel,
                    "sent": out.get("metrics", {}).get("outreach_sent_total"), "replies": out.get("metrics", {}).get("outreach_replies_total")},
        "inbox": _j(root, "instances/ultrastable/inbox.json", {"routes": []})["routes"], "merges": merges(root), "links": {"repo": GH, "prs": GH + "/pulls", "issues": GH + "/issues"},
        "trust": log["ticks"][-1]["trust"],
    }
    con.close()
    return state


def render(s: dict) -> str:
    data = json.dumps(s, separators=(",", ":")).replace("</", "<\\/")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Ultrastable cockpit</title>
<style>:root{{--bg:#F6F1E7;--fg:#14120F;--card:#fff;--line:#ddd5c5;--sig:#FF5B1F;--mut:#5B574F;--ok:#12342A;--bad:#a4281a}}
@media(prefers-color-scheme:dark){{:root{{--bg:#0B1A15;--fg:#F6F1E7;--card:#12342A;--line:#1f4a3c;--mut:#C9D4CC;--ok:#9be3bd;--bad:#ff9b8a}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}}main{{max-width:860px;margin:0 auto;padding:12px 16px 60px}}h1{{font:700 26px Georgia,serif;margin:8px 0 2px}}
nav{{display:flex;gap:8px;margin:12px 0;position:sticky;top:0;background:var(--bg);padding:8px 0}}nav a{{flex:1;text-align:center;padding:12px 6px;border:1px solid var(--line);border-radius:10px;color:var(--fg);text-decoration:none;font-weight:600}}nav a.on{{background:var(--sig);color:#14120F;border-color:var(--sig)}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:12px 0}}.row{{padding:8px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}}.row:first-of-type{{border-top:0}}
.mut{{color:var(--mut)}}.ok{{color:var(--ok)}}.bad{{color:var(--bad)}}a{{color:inherit}}.btn{{display:inline-block;background:var(--sig);color:#14120F;border-radius:8px;padding:8px 14px;margin:6px 8px 0 0;font-weight:600;text-decoration:none;border:0;font-size:15px;cursor:pointer}}.btn.alt{{background:transparent;color:var(--fg);border:1px solid var(--line)}}
.k{{display:flex;flex-wrap:wrap;gap:10px}}.k div{{flex:1 1 120px;border:1px solid var(--line);border-radius:10px;padding:8px 10px}}.k b{{display:block;font-size:24px}}code{{font:13px ui-monospace,monospace}}.screen{{display:none}}.screen.on{{display:block}}</style></head><body><main>
<h1>Ultrastable cockpit</h1><div class="mut" id="sub"></div>
<nav><a href="#now" data-s="now">Now</a><a href="#next" data-s="next">Next</a><a href="#you" data-s="you">Needs you</a></nav>
<section id="p-now" class="screen"></section><section id="p-next" class="screen"></section><section id="p-you" class="screen"></section>
<p class="mut" id="foot"></p></main>
<script>const S={data};const $=i=>document.getElementById(i);const e=x=>String(x??'').replace(/[&<>"]/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}}[c]));
const L=S.links,blob=p=>L.repo+'/blob/main/'+p;const lt=(l,u)=>`<a class="btn alt" href="${{e(u)}}" target="_blank" rel="noopener">${{e(l)}}</a>`;
const cp=t=>`<button class="btn alt" onclick="navigator.clipboard&&navigator.clipboard.writeText(${{e(JSON.stringify(t))}});this.textContent='Copied'">Copy: ${{e(t.length>34?t.slice(0,34)+'...':t)}}</button>`;
const tick=S.now.last_tick,st=tick.state;
$('sub').textContent=S.org.name+': '+S.org.positioning;
$('p-now').innerHTML=`<div class="card"><b>Where it stands</b><div class="k"><div><b>${{st.open}}</b>active items</div><div><b>${{st.done}}</b>done this run</div><div><b>${{st.blocked}}</b>parked or waiting</div><div><b>${{S.gaps.filter(g=>g.status==='open').length}}</b>open gaps</div></div></div>
<div class="card"><b>Last tick, in four lines</b><div class="mut">${{tick.report.map(e).join('<br>')}}</div><a class="btn" href="selfhost-run.html">Watch it run, tick by tick</a>${{cp('python3 -m foundation autorun')}}</div>
<div class="card"><b>Managers and staff</b>${{S.managers.map(m=>`<div class="row"><b>${{e(m.role)}}</b> <span class="mut">every ${{m.tick_every}} tick(s)</span><br>${{m.open}} open, ${{m.done}} done</div>`).join('')}}</div>
<div class="card"><b>Plussing budget</b><div>${{st.plus_done}} improvement items done of ${{st.done}} finished (${{Math.round(100*st.plus_done/Math.max(1,st.done))}}%), target ${{Math.round(100*st.plus_target)}}%; ${{st.plus_open}} queued.</div></div>
<div class="card"><b>Trust ledger</b>${{S.trust.map(t=>`<div class="row">${{e(t.surface)}}/${{e(t.action_class)}}: <b>${{e(t.rung)}}</b>, reliability ${{t.reliability}} over ${{t.outcomes}} outcomes</div>`).join('')||'<div class="mut">no outcomes yet</div>'}}</div>
<div class="card"><b>Loops that run on their own</b>${{S.loops.map(l=>`<div class="row"><a href="${{e(blob(l.path))}}">${{e(l.name)}}</a> <span class="mut">${{l.schedule?'cron '+e(l.schedule):l.push?'on push':'on demand'}}${{l.essential?', essential':''}}</span></div>`).join('')}}</div>
<div class="card"><b>Gap register</b> <span class="mut">what still runs on tools outside Ultrastable</span>${{S.gaps.map(g=>`<div class="row"><b>${{e(g.id)}}</b> ${{e(g.tool)}}: <span class="${{g.status==='closed'?'ok':'bad'}}">${{e(g.status)}}</span><br><span class="mut">${{e(g.what)}}</span></div>`).join('')}}</div>
<div class="card"><b>Recent merged changes</b>${{S.merges.map(m=>`<div class="row">${{e(m.when)}} ${{m.pr?`<a href="${{e(L.repo+'/pull/'+m.pr)}}">#${{m.pr}}</a>`:e(m.sha)}} ${{e(m.subject)}}</div>`).join('')}}${{lt('All pull requests',L.prs)}}</div>`;
$('p-next').innerHTML=`<div class="card"><b>Next in line</b> <span class="mut">driver order, the fleet takes these without being asked</span>${{S.next.map(n=>`<div class="row"><b>${{e(n.id)}}</b> ${{e(n.title)}}<br><span class="mut">${{e(n.role)}}, ${{e(n.milestone||n.kind)}}</span> <a href="${{e(blob(n.path))}}">record</a></div>`).join('')}}</div>
<div class="card"><b>Parked with a blocker</b> <span class="mut">each has an owner and a closing probe in its record</span>${{S.blocked.map(b=>`<div class="row"><b>${{e(b.id)}}</b> ${{e(b.title)}}<br><span class="mut">${{e(b.blocker)}}</span></div>`).join('')||'<div class="mut">none</div>'}}</div>
<div class="card"><b>Funding and outreach</b><div>${{e(S.funding.mode)}} mode; ${{S.funding.targets}} targets; sent ${{S.funding.sent}}, replies ${{S.funding.replies}}; sender registered: ${{S.funding.sender_registered}}.</div><div class="mut">${{Object.entries(S.funding.funnel).map(([k,v])=>e(k)+' '+v).join(' | ')}}</div>${{lt('Outreach status',blob('outreach/STATUS.md'))}}</div>`;
$('p-you').innerHTML=`<div class="card"><b>Only you can do these</b> <span class="mut">each one has a default that is already in effect; nothing waits on you</span>${{S.needs_you.owner_steps.map(o=>`<div class="row"><b>${{e(o.id)}} ${{e(o.title)}}</b><br><span class="mut">why only you: ${{e(o.why)}}</span><br>Default now: ${{e(o.default)}}<br><span class="mut">Done when: ${{e(o.probe)}}</span></div>`).join('')}}${{lt('The one-page list',blob('docs/ops/OWNER-STEPS.md'))}}</div>
<div class="card"><b>Cards the loop opened this run</b>${{S.needs_you.gate_cards.map(g=>`<div class="row"><b>${{e(g.id)}}</b> ${{e(g.what)}}<br>Default now: ${{e(g.default_in_effect)}}<br><span class="mut">Closing probe: ${{e(g.closing_probe)}}</span></div>`).join('')||'<div class="mut">none</div>'}}</div>
<div class="card"><b>Outreach cards</b>${{S.needs_you.outreach_cards.map(c=>`<div class="row">${{e(c.id)}} (${{c.count}}) ${{lt('Open',blob(c.file))}}</div>`).join('')}}</div>
<div class="card"><b>Where your mail goes</b>${{S.inbox.map(r=>`<div class="row"><b>${{e(r.address)}}</b> (${{e(r.kind)}})<br>Goes to: ${{e(r.forwards_to)}}<br><span class="mut">Then: ${{e(r.then)}}</span></div>`).join('')}}</div>`;
function go(){{const h=(location.hash||'#now').slice(1);['now','next','you'].forEach(i=>$('p-'+i).classList.toggle('on',i===h));document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('on',a.dataset.s===h))}}
addEventListener('hashchange',go);go();$('foot').textContent='Records: REAL. Staff work in the run: SIMULATED. Regenerate: python3 -m foundation cockpit';</script></body></html>"""


def write(out=".selfhost/cockpit", root=REPO, ticks=10, node=True) -> list[str]:
    s = build(root, ticks, node)
    if s["status"] != "ok":
        raise SystemExit("cockpit refused: " + "; ".join(s["problems"]))
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "state.json").write_text(json.dumps(s, indent=1) + "\n", encoding="utf-8")
    (out / "index.html").write_text(render(s), encoding="utf-8")
    log = json.loads(json.dumps({"schema": "ultrastable-autorun/1", "labels": s["labels"], "start": s["now"]["start"], "end": s["now"]["end"], "ticks": s["now"]["ticks"], "org": s["org"], "roles": []}))
    (out / "selfhost-run.html").write_text(autorun.render_html(log), encoding="utf-8")
    return ["index.html", "state.json", "selfhost-run.html"]
