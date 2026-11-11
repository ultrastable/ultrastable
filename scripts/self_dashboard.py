#!/usr/bin/env python3
"""Ultrastable's own dashboard, generated from the repository: the system showing itself operating on itself.

Usage: python3 scripts/self_dashboard.py [--out demos/self]
Writes snapshot.json and index.html (one self-contained page, no network, no secrets). Every number is computed from a file or from
`git log` in this repository, so it is exactly as true as the repo; a source that cannot be read is listed under `problems`, never
filled in. The QNFO fleet dashboard is the model for the owner-side view (dashboard/); this one shows the same loops running on
Ultrastable's own work, which is the self-referential demo. Private until the owner publishes.
"""
import argparse, collections, datetime, html, json, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def jl(rel, problems, default=None):
    try:
        return json.loads((ROOT / rel).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        problems.append(f"{rel}: {type(e).__name__}")
        return default


def git(*a):
    r = subprocess.run(["git", "-C", str(ROOT), *a], capture_output=True, text=True)
    return r.stdout if r.returncode == 0 else ""


def collect():
    problems = []
    pos = jl("doctrine/positioning.json", problems, {})
    from foundation import doctrine, selfhost
    sh_bad, dc_bad = selfhost.verify(ROOT), doctrine.check(ROOT)
    gaps = (jl("instances/ultrastable/gaps.json", problems, {}) or {}).get("gaps", [])
    procs = (jl("instances/ultrastable/selfhost.json", problems, {}) or {}).get("processes", [])
    out = jl("outreach/status.json", problems, {}) or {}
    cap = (jl("seed/ultrastable.json", problems, {}) or {}).get("capacity", {})
    steps = (jl("foundation/data/owner-steps.json", problems, {}) or {}).get("steps", [])
    log = [l.split("\t") for l in git("log", "-300", "--format=%h\t%ad\t%s", "--date=format:%Y-%m-%d %H:%M").splitlines() if l]
    per_day = collections.Counter(d[1][:10] for d in log)
    merged = sum(1 for d in log if re.search(r"\(#\d+\)$", d[2]))
    plus = sum(1 for d in log if re.search(r"\bplus(es|sing)?\b", d[2], re.I))
    trust = out.get("trust", {})
    return {
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "commit": git("rev-parse", "--short", "HEAD").strip(),
        "tagline": pos.get("tagline", ""),
        "selfhost": {"problems": sh_bad, "processes": len(procs), "names": [p["id"] for p in procs]},
        "doctrine": {"problems": dc_bad},
        "gaps": {"total": len(gaps), "closed": sum(g["status"] == "closed" for g in gaps), "open": [{"id": g["id"], "tool": g["tool"], "probe": g["closing_probe"]} for g in gaps if g["status"] != "closed"]},
        "ticks": {"commits_logged": len(log), "per_day": dict(sorted(per_day.items())[-7:]), "merged_prs": merged, "recent": [{"sha": d[0], "when": d[1], "subject": d[2]} for d in log[:10]]},
        "plussing": {"reserved_share": cap.get("plus_share"), "commits_mentioning_plus": plus},
        "trust": {k: {"outcomes": v["outcomes"], "reliability": v["reliability"]} for k, v in trust.items()},
        "gate": {"owner_steps_open": len(steps), "outreach_mode": out.get("mode"), "kill_switch": out.get("kill"), "sent_total": (out.get("metrics") or {}).get("outreach_sent_total")},
        "problems": problems,
    }


E = html.escape


def render(d):
    def tile(k, v, sub=""):
        return f'<div class="t"><b>{E(str(v))}</b><span>{E(k)}</span><i>{E(sub)}</i></div>'
    ok = not d["selfhost"]["problems"] and not d["doctrine"]["problems"]
    tiles = "".join([
        tile("self-hosting check", "pass" if not d["selfhost"]["problems"] else f"{len(d['selfhost']['problems'])} problem(s)", "python3 -m foundation selfhost --verify"),
        tile("doctrine and brand check", "pass" if not d["doctrine"]["problems"] else f"{len(d['doctrine']['problems'])} problem(s)", "python3 -m foundation doctrine --check"),
        tile("processes run on itself", d["selfhost"]["processes"], ", ".join(d["selfhost"]["names"][:6]) + " ..."),
        tile("gaps closed", f"{d['gaps']['closed']} of {d['gaps']['total']}", "outside tools it still uses, each with a closing probe"),
        tile("ticks in this checkout (commits)", d["ticks"]["commits_logged"], f"{d['ticks']['merged_prs']} merged PRs"),
        tile("plussing reserved", f"{round((d['plussing']['reserved_share'] or 0) * 100)}%", "of capacity, protected"),
        tile("owner steps open", d["gate"]["owner_steps_open"], "interrupt gate: irreversible and identity-bound only"),
        tile("outreach", d["gate"]["outreach_mode"] or "n/a", f"sent {d['gate']['sent_total']}; kill switch {'on' if d['gate']['kill_switch'] else 'off'}"),
    ])
    rows = lambda a, f: "".join("<tr>" + "".join(f"<td>{E(str(c))}</td>" for c in f(x)) + "</tr>" for x in a)
    days = d["ticks"]["per_day"]; mx = max(days.values() or [1])
    bars = "".join(f'<div class="bar"><u style="height:{max(4, 100 * v // mx)}px"></u><span>{E(k[5:])}</span><em>{v}</em></div>' for k, v in days.items())
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Ultrastable on itself</title><style>
:root{{--bg:#F6F1E7;--fg:#14120F;--card:#fff;--line:#ddd5c5;--mute:#5B574F;--sig:#FF5B1F}}
@media(prefers-color-scheme:dark){{:root{{--bg:#0B1A15;--fg:#F6F1E7;--card:#12342A;--line:#1f4a3c;--mute:#C9D4CC}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:16px/1.5 'IBM Plex Sans',system-ui,sans-serif}}
main{{max-width:1000px;margin:0 auto;padding:24px 16px}}h1,h2{{font-family:Fraunces,Georgia,serif;letter-spacing:-.5px}}h1{{font-size:40px;margin:8px 0}}
.mark{{display:inline-block;width:0;height:0;border-left:16px solid transparent;border-right:16px solid transparent;border-bottom:30px solid var(--sig);vertical-align:middle;margin-right:8px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:12px}}.t{{background:var(--card);border:1px solid var(--line);border-radius:6px;padding:12px}}
.t b{{display:block;font:700 26px Fraunces,Georgia,serif}}.t span{{display:block;font-weight:600}}.t i{{display:block;color:var(--mute);font-size:13px;font-style:normal;overflow-wrap:anywhere}}
table{{border-collapse:collapse;width:100%;background:var(--card)}}td{{border-bottom:1px solid var(--line);padding:6px 8px;vertical-align:top;overflow-wrap:anywhere}}
.bars{{display:flex;gap:10px;align-items:flex-end;height:150px}}.bar{{text-align:center;font-size:12px}}.bar u{{display:block;width:34px;background:var(--sig)}}.bar em{{display:block;font-style:normal}}
.ok{{color:var(--sig);font-weight:700}}p.m{{color:var(--mute)}}</style></head><body><main>
<h1><span class="mark"></span>Ultrastable on itself</h1><p><b>{E(d['tagline'])}</b></p>
<p class="m">The same loops it gives everyone else, running on Ultrastable's own work. Generated {E(d['generated'])} from commit {E(d['commit'])}; every number is computed from files in this repository (<code>python3 scripts/self_dashboard.py</code>). <span class="{'ok' if ok else ''}">{'All checks pass.' if ok else 'A check is failing: see the lists below.'}</span></p>
<div class="grid">{tiles}</div>
<h2>Ticks per day</h2><div class="bars">{bars}</div>
<h2>Recent ticks</h2><table>{rows(d['ticks']['recent'], lambda c: [c['sha'], c['when'], c['subject']])}</table>
<h2>Open gaps (what it still does with outside tools)</h2><table>{rows(d['gaps']['open'], lambda g: [g['id'], g['tool'], g['probe']])}</table>
<h2>Trust ledger (outreach drafting)</h2><table>{rows(d['trust'].items(), lambda kv: [kv[0], f"{kv[1]['outcomes']} verified outcomes", f"reliability {kv[1]['reliability']}"])}</table>
{('<h2>Problems</h2><ul>' + ''.join(f'<li>{E(p)}</li>' for p in d['selfhost']['problems'] + d['doctrine']['problems'] + d['problems']) + '</ul>') if not ok or d['problems'] else ''}
</main></body></html>"""


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default="demos/self"); a = ap.parse_args()
    d = collect(); out = ROOT / a.out; out.mkdir(parents=True, exist_ok=True)
    (out / "snapshot.json").write_text(json.dumps(d, indent=1) + "\n", encoding="utf-8")
    (out / "index.html").write_text(render(d), encoding="utf-8")
    print(f"wrote {a.out}/index.html and snapshot.json: selfhost {'pass' if not d['selfhost']['problems'] else 'FAIL'}, doctrine {'pass' if not d['doctrine']['problems'] else 'FAIL'}")


if __name__ == "__main__":
    main()
