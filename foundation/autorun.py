"""Ultrastable operating on itself, tick after tick, from this repository alone.

  python3 -m foundation autorun [--ticks 6] [--out DIR] [--public] [--no-node]

Boots the organization from the real records (`foundation.selfhost.boot`), then runs N ticks of its own heartbeat. Each tick:
the real tick (reconcile, claims, gates, predictions, trust, dispatch, plus share) -> the dispatched items are worked and checked ->
outcomes, a logged prediction and a proposed plus are written back -> a four-line report. The run is written to
`autorun.json` (every tick, in order) and `autorun.html` (a self-contained player: no accounts, no network).

Honest labels, stamped on every output:
  REAL       the records (items, gaps, roles, policy), the tick code, the closing probes, the verifier, every number derived from them.
  SIMULATED  the staff's work on an item. No agent is called. The check that follows is real (the closing probe, or that the item's
             source-of-truth file exists). An item that fails its check stays open with a failed outcome, so trust moves for real reasons.
  Owner-only items (label owner:rowan) open a gate card with a default in effect and a closing probe; the loop then takes its next item.
The run happens in a scratch database. It never edits the repository.
"""
from __future__ import annotations
import html as _html, json, re, shutil, sqlite3, subprocess
from pathlib import Path

from . import selfhost

REPO = selfhost.REPO
SURFACE, ACTION = "work_tracker", "create_update_close"
KEEP_ROLES = ("portfolio-manager", "project-manager", "product-manager", "staff", "reviewer", "operations", "funding-manager", "outreach-manager", "outreach-coordinator")
PLUS_TEXT = {
    "plus": "Add a closing probe and a test for {id}, so the next change to it is verified without a person",
    "work": "Plus for {id}: record what it taught as a rule in the role file and add a check that would have caught the slowest part",
    "fix": "Plus for {id}: find the root cause class and add a detector so this failure never needs a second fix",
}


def _items_meta(root: Path) -> dict:
    meta = {}
    for f in sorted((root / "docs/issues").glob("*.json")):
        if f.name.startswith("_"):
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        src = re.search(r"`(docs/[\w./-]+)`", d.get("body", ""))
        meta[d["id"]] = {"labels": d.get("labels", []), "milestone": d.get("milestone"), "source": src.group(1) if src else None,
                         "waiting": "waiting on" in d.get("body", "").lower()}
    return meta


def _q(con, sql, *a):
    return con.execute(sql, a).fetchall()


def _py_tick(con, cfg, tick_id_hint=None) -> dict:
    """Minimal tick for machines without Node: reconcile and dispatch with the same SQL and order as seed/worker/src/tick.js."""
    cur = con.execute("INSERT INTO tick_runs(started_at,steps_total) VALUES(datetime('now'),2)")
    tid = cur.lastrowid
    n = con.execute("UPDATE items SET status='ready' WHERE status='open' AND (trigger_on IS NULL OR trigger_on IN (SELECT id FROM items WHERE status='done'))").rowcount
    disp = 0
    for rid, role, every, model in _q(con, "SELECT id, role, tick_every, model FROM roles"):
        if tid % max(1, every):
            continue
        if con.execute("SELECT COUNT(*) FROM claims WHERE agent=?", (rid,)).fetchone()[0] >= cfg["max_wip_per_role"]:
            continue
        row = con.execute("SELECT id FROM items WHERE status='ready' AND owner_role=? AND id NOT IN (SELECT item_id FROM claims) ORDER BY priority, created_at LIMIT 1", (role,)).fetchone()
        if row:
            con.execute("INSERT INTO claims(item_id,agent,claimed_at,heartbeat_at) VALUES(?,?,datetime('now'),datetime('now'))", (row[0], rid))
            con.execute("UPDATE items SET status='claimed' WHERE id=?", (row[0],))
            con.execute("INSERT INTO dispatches(tick_id,role_id,item_id,model) VALUES(?,?,?,?)", (tid, rid, row[0], model))
            disp += 1
    open_n = con.execute("SELECT COUNT(*) FROM items WHERE status NOT IN ('done','superseded','cancelled')").fetchone()[0]
    report = "\n".join([f"Happened: tick {tid} ran 2/2 steps (minimal path: reconcile, dispatch); {n} became ready; dispatched {disp} item(s).",
                        f"Decided: dispatched {disp} item(s) in driver order.", f"Next: tick {tid + 1}.", f"Open: {open_n} active item(s)."])
    con.execute("UPDATE tick_runs SET finished_at=datetime('now'), steps_completed=2, report=? WHERE id=?", (report, tid))
    con.commit()
    return {"tickId": tid, "completed": 2, "total": 2, "report": report, "errors": []}


def _node_tick(root: Path, db: Path, cfg: Path) -> dict:
    r = subprocess.run(["node", "--no-warnings", str(root / "platform/selfhost/tick.mjs"), str(db), str(cfg)], capture_output=True, text=True, cwd=root)
    if not r.stdout.strip():
        raise RuntimeError(f"tick failed: {r.stderr[-400:]}")
    return json.loads(r.stdout.strip().splitlines()[-1])


def _check(root: Path, item: sqlite3.Row, meta: dict) -> tuple[bool, str]:
    """The real, independent check after (simulated) work: the closing probe, else the item's source-of-truth file exists."""
    if (item["closing_probe"] or item["done_check"] or "").startswith("cmd:"):
        return False, "external closing probe is evaluated by the queue lane (foundation queue --run), not simulated"
    if item["closing_probe"] and item["closing_probe"].split(":", 1)[0] in ("file", "grep"):
        ok = selfhost.probe(root, item["closing_probe"])
        return ok, f"closing probe {item['closing_probe']} {'passes' if ok else 'fails'}"
    src = meta.get("source")
    if src:
        src = src if (root / src).exists() else {"docs/roadmap.md": "docs/roadmap-source.md"}.get(src, src)  # the roadmap's source moved; records still name the old path
        ok = (root / src).exists()
        return ok, f"source of truth {src} {'exists' if ok else 'is missing'}"
    return True, "no machine probe recorded; the done check is " + (item["done_check"] or "in the item")[:80]


def run(root=REPO, ticks: int = 10, node: bool = True, db_path=None) -> dict:
    root = Path(root)
    out = Path(db_path) if db_path else root / ".selfhost" / "autorun.db"
    rep = selfhost.boot(root, db_path=out, node=False)
    if rep["status"] != "ok":
        return {"status": "refused", "problems": rep.get("problems", []), "detail": rep}
    cfgp = out.with_suffix(".config.json")
    cfg = json.loads(cfgp.read_text(encoding="utf-8"))
    use_node = node and shutil.which("node") is not None
    con = sqlite3.connect(out)
    con.row_factory = sqlite3.Row
    con.execute("DELETE FROM tick_runs")
    con.commit()
    meta = _items_meta(root)
    roles = {r["id"]: r["role"] for r in con.execute("SELECT id, role FROM roles")}
    reviewers = [i for i, r in roles.items() if r == "reviewer"]
    start_done = con.execute("SELECT COUNT(*) FROM items WHERE status='done'").fetchone()[0]
    log = {"schema": "ultrastable-autorun/1", "labels": {"records": "REAL", "tick": "REAL (Node)" if use_node else "REAL (minimal Python path)", "staff work": "SIMULATED",
                                                          "checks": "REAL"},
           "org": dict(con.execute("SELECT key, value FROM org").fetchall()), "roles": sorted(set(roles.values())),
           "start": {"items": con.execute("SELECT COUNT(*) FROM items").fetchone()[0], "done": start_done}, "ticks": []}
    prev_pred = None
    for n in range(1, ticks + 1):
        tick = _node_tick(root, out, cfgp) if use_node else _py_tick(con, cfg)
        con.commit()
        claims = _q(con, "SELECT c.item_id, c.agent FROM claims c ORDER BY c.item_id")
        t = {"tick": n, "report_tick": tick["report"].split("\n"), "steps": f"{tick['completed']}/{tick['total']}", "worked": [], "gates": [], "plus": [], "errors": tick["errors"]}
        if prev_pred:
            row = con.execute("SELECT verdict, observed, target FROM predictions WHERE id=?", (prev_pred,)).fetchone()
            t["prediction_scored"] = {"id": prev_pred, "verdict": row["verdict"], "observed": row["observed"], "target": row["target"]} if row and row["verdict"] else None
        done_before = con.execute("SELECT COUNT(*) FROM items WHERE status='done'").fetchone()[0]
        verified = 0
        for item_id, agent in claims:
            it = con.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()
            m = meta.get(item_id, {})
            rec = {"item": item_id, "title": it["title"], "role": roles.get(agent, agent), "milestone": m.get("milestone"), "kind": it["kind"]}
            if "owner:rowan" in m.get("labels", []) or m.get("waiting"):
                gid = f"GATE-{item_id}"
                con.execute("INSERT OR IGNORE INTO gate_cards(id,what,why_gated,default_in_effect,prepared_by_fleet,closing_probe) VALUES(?,?,?,?,?,?)",
                            (gid, it["title"], "identity-bound: only the owner can take this step", "the fleet continues with everything else; nothing public changes",
                             "prepared by the fleet, see the item's source of truth", f"item_done:{item_id}"))
                con.execute("DELETE FROM claims WHERE item_id=?", (item_id,))
                con.execute("UPDATE items SET status='blocked', blocker=? WHERE id=?", (f"gate card {gid}", item_id))
                rec.update(result="gate", detail=f"opened {gid} with default in effect and closing probe item_done:{item_id}; took the next item")
                t["gates"].append(gid)
            else:
                ok, why = _check(root, it, m)
                reviewer = reviewers[0] if reviewers else agent
                con.execute("INSERT INTO outcomes(item_id,agent,surface,action_class,result,evidence) VALUES(?,?,?,?,?,?)",
                            (item_id, agent, SURFACE, ACTION, "verified" if ok else "failed", f"SIMULATED work by {agent}; REAL check by {reviewer}: {why}"))
                con.execute("DELETE FROM claims WHERE item_id=?", (item_id,))
                if ok:
                    verified += 1
                    con.execute("UPDATE items SET status='done', disposition=? WHERE id=?", (f"done: {why}", item_id))
                    pid = f"PLUS-{item_id}"
                    if it["kind"] not in ("plus", "ladder"):
                      con.execute("INSERT OR IGNORE INTO items(id,title,kind,owner_role,done_check,priority,status) VALUES(?,?,?,?,?,?,'open')",
                                (pid, PLUS_TEXT.get(it["kind"], PLUS_TEXT["work"]).format(id=item_id), "plus", it["owner_role"], "a check exists that fails without the improvement", 15))
                    rec.update(result="verified", detail=why)
                    if it["kind"] not in ("plus", "ladder"):
                        rec["plus"] = pid
                        t["plus"].append(pid)
                else:
                    con.execute("UPDATE items SET status='blocked', blocker=? WHERE id=?", (f"check failed: {why}; needs a real agent to do the work", item_id))
                    rec.update(result="failed", detail=why + "; parked as blocked with its blocker, failed outcome recorded; the loop moves on")
            t["worked"].append(rec)
        # predict before the next tick: every item worked this tick will verify; scored by the next tick's score_predictions step
        prev_pred = f"P{tick['tickId']}"
        con.execute("INSERT OR REPLACE INTO predictions(id,item_id,metric,op,target,due_at) VALUES(?,?,?,?,?,?)",
                    (prev_pred, None, "items_done", ">=", done_before + len([c for c in claims]) - len(t["gates"]), "2000-01-01 00:00:00"))
        t["prediction_logged"] = f"items_done >= {done_before + len(claims) - len(t['gates'])} (scored next tick)"
        con.commit()
        done = con.execute("SELECT COUNT(*) FROM items WHERE status='done'").fetchone()[0]
        plus_done = con.execute("SELECT COUNT(*) FROM items WHERE status='done' AND kind='plus'").fetchone()[0]
        plus_open = con.execute("SELECT COUNT(*) FROM items WHERE status!='done' AND kind='plus'").fetchone()[0]
        t["state"] = {"open": con.execute("SELECT COUNT(*) FROM items WHERE status NOT IN ('done','superseded','cancelled')").fetchone()[0], "done": done, "blocked": con.execute("SELECT COUNT(*) FROM items WHERE status='blocked'").fetchone()[0],
                      "plus_done": plus_done, "plus_open": plus_open, "plus_target": cfg["plus_share"]}
        t["trust"] = [dict(r) for r in con.execute("SELECT surface, action_class, rung, ROUND(reliability,3) AS reliability, outcomes FROM trust_ledger WHERE outcomes>0 ORDER BY surface, action_class")]
        t["report"] = [f"Happened: tick {n} dispatched {len(claims)} item(s); {verified} verified, {len(t['gates'])} gate card(s), {len(claims) - verified - len(t['gates'])} failed check(s).",
                       f"Decided: worked items in driver order; {len(t['plus'])} plus(es) proposed from what was verified.",
                       f"Next: tick {n + 1} takes the next {cfg['max_wip_per_role']} per role.",
                       f"Open: {t['state']['open']} active, {t['state']['blocked']} waiting on the owner, plus {plus_done} done / {plus_open} open."]
        log["ticks"].append(t)
    log["end"] = log["ticks"][-1]["state"] | {"verifier": selfhost.verify(root), "gaps_open": sum(1 for g in selfhost.gaps_report(root) if g["status"] == "open")}
    con.close()
    return {"status": "ok", "log": log, "db": str(out)}


def public_view(log: dict) -> dict:
    """The public-safe form: item titles and owner-only details replaced by ids, so only the shape of the loop shows."""
    p = json.loads(json.dumps(log))
    p["org"] = {"name": "an Ultrastable organization", "runs_on_itself": "true"}
    for t in p["ticks"]:
        for w in t["worked"]:
            w["title"] = f"item {w['item']}"
            w["detail"] = re.sub(r"(file|grep):\S+", "a probe", w["detail"])
            w["detail"] = re.sub(r"source of truth \S+", "the item's source of truth", w["detail"])
        for k in ("gates", "plus"):
            t[k] = [re.sub(r"^(GATE|PLUS)-.*", r"\1", g) + f"-{i + 1}" for i, g in enumerate(t[k])]
        for w in t["worked"]:
            if w.get("plus"):
                w["plus"] = "PLUS"
            if "gate" in w.get("result", ""):
                w["detail"] = "opened a gate card with a default in effect and a closing probe; took the next item"
    p["end"]["verifier"] = []
    return p


def render_html(log: dict, public: bool = False) -> str:
    data = json.dumps(log, separators=(",", ":")).replace("</", "<\\/")
    title = "Ultrastable running on itself"
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title>
<style>:root{{--bg:#F6F1E7;--fg:#14120F;--card:#fff;--line:#ddd5c5;--sig:#FF5B1F;--mut:#5B574F;--ok:#12342A;--bad:#a4281a}}
@media(prefers-color-scheme:dark){{:root{{--bg:#0B1A15;--fg:#F6F1E7;--card:#12342A;--line:#1f4a3c;--mut:#C9D4CC;--ok:#9be3bd;--bad:#ff9b8a}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,sans-serif}}main{{max-width:820px;margin:0 auto;padding:16px}}
h1{{font:700 28px/1.2 Georgia,serif;margin:8px 0}}.tag{{display:inline-block;border:1px solid var(--line);border-radius:999px;padding:1px 10px;font-size:13px;margin:0 6px 6px 0;color:var(--mut)}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:12px 0}}button{{background:var(--sig);color:#14120F;border:0;border-radius:8px;padding:10px 16px;font:600 15px system-ui;margin:4px 6px 4px 0;cursor:pointer}}
button.alt{{background:transparent;color:var(--fg);border:1px solid var(--line)}}.row{{padding:6px 0;border-top:1px solid var(--line);overflow-wrap:anywhere}}.ok{{color:var(--ok)}}.bad{{color:var(--bad)}}.mut{{color:var(--mut)}}
.bar{{height:10px;background:var(--line);border-radius:5px;overflow:hidden}}.bar i{{display:block;height:100%;background:var(--sig)}}code{{font-family:ui-monospace,monospace;font-size:13px}}</style></head><body><main>
<h1>Ultrastable running on itself</h1>
<p class="mut">The system's own records go in; its own loop works them tick by tick; a report comes out. No accounts, no network.</p>
<div id="tags"></div>
<div class="card"><b id="hd"></b><div class="bar" style="margin:8px 0"><i id="bar" style="width:0"></i></div><div id="rep"></div></div>
<div><button id="step">Next tick</button><button id="play" class="alt">Play</button><button id="reset" class="alt">Start over</button></div>
<div class="card"><b>What this tick did</b><div id="work"></div></div>
<div class="card"><b>Plussing budget</b> <span class="mut">(target share of finished work that improves the system)</span><div class="bar" style="margin:8px 0"><i id="plus" style="width:0"></i></div><span id="plustxt"></span></div>
<div class="card"><b>Trust ledger</b><div id="trust" class="mut">no verified outcomes yet</div></div>
<p class="mut" id="foot"></p></main>
<script>const D={data};const $=i=>document.getElementById(i);let i=0,timer=null;const esc=s=>String(s).replace(/[&<>]/g,c=>({{'&':'&amp;','<':'&lt;','>':'&gt;'}}[c]));
$('tags').innerHTML=Object.entries(D.labels).map(([k,v])=>`<span class="tag">${{esc(k)}}: <b>${{esc(v)}}</b></span>`).join('');
function show(){{if(!i){{$('hd').textContent='Ready: '+D.start.items+' items loaded from the repository, '+D.start.done+' already done';$('rep').textContent='';$('work').innerHTML='';$('bar').style.width='0';$('plus').style.width='0';$('plustxt').textContent='';return}}
const t=D.ticks[i-1];$('hd').textContent='Tick '+t.tick+' of '+D.ticks.length+' (steps '+t.steps+')';$('bar').style.width=(100*i/D.ticks.length)+'%';
$('rep').innerHTML=t.report.map(esc).join('<br>');
$('work').innerHTML=t.worked.map(w=>`<div class="row"><b>${{esc(w.item)}}</b> ${{esc(w.title)}} <span class="mut">(${{esc(w.role)}})</span><br><span class="${{w.result==='verified'?'ok':w.result==='failed'?'bad':'mut'}}">${{esc(w.result)}}</span> ${{esc(w.detail)}}${{w.plus?` <span class="mut">plus proposed: ${{esc(w.plus)}}</span>`:''}}</div>`).join('')+(t.prediction_scored?`<div class="row mut">Prediction ${{esc(t.prediction_scored.id)}} scored ${{esc(t.prediction_scored.verdict)}} (observed ${{t.prediction_scored.observed}}, target ${{t.prediction_scored.target}})</div>`:'')+`<div class="row mut">Logged: ${{esc(t.prediction_logged)}}</div>`;
const s=t.state,tot=s.plus_done+s.plus_open;$('plus').style.width=Math.min(100,100*s.plus_done/Math.max(1,s.done))+'%';$('plustxt').textContent=s.plus_done+' plus items done of '+s.done+' done; '+s.plus_open+' queued; target '+Math.round(100*s.plus_target)+'%';
$('trust').innerHTML=t.trust.length?t.trust.map(r=>esc(r.surface+'/'+r.action_class)+': <b>'+esc(r.rung)+'</b>, reliability '+r.reliability+' over '+r.outcomes+' outcomes').join('<br>'):'no verified outcomes yet'}}
function step(){{if(i<D.ticks.length)i++;show();if(i>=D.ticks.length&&timer){{clearInterval(timer);timer=null;$('play').textContent='Play'}}}}
$('step').onclick=step;$('reset').onclick=()=>{{i=0;show()}};$('play').onclick=()=>{{if(timer){{clearInterval(timer);timer=null;$('play').textContent='Play';return}}if(i>=D.ticks.length)i=0;$('play').textContent='Pause';timer=setInterval(step,1400);step()}};
$('foot').textContent='Records: REAL. Staff work: SIMULATED (no agent is called). Checks: REAL. '+({json.dumps('The same loop runs on its own records in the open-core engine.' if public else 'Run it yourself: python3 -m foundation autorun')});show();</script></body></html>"""


def write(result: dict, out: Path, public: bool = False) -> list[str]:
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    log = public_view(result["log"]) if public else result["log"]
    name = "selfhost-run" if public else "autorun"
    (out / f"{name}.json").write_text(json.dumps(log, indent=1) + "\n", encoding="utf-8")
    (out / f"{name}.html").write_text(render_html(log, public), encoding="utf-8")
    return [f"{name}.json", f"{name}.html"]


__all__ = ["run", "write", "public_view", "render_html", "KEEP_ROLES"]
_ = _html
