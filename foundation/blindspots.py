"""BLINDSPOT-1: the system knows what the owner cannot know to ask for. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation blindspots --check                     register is well formed; every id unique; identity-bound needs carry an allowed gate
  python3 -m foundation blindspots --scan [--apply] [--live]   run each probe; failed system needs become Q-BLIND-* items; stale sweeps become Q-BLIND-SWEEP-*
  python3 -m foundation blindspots --answer DOMAIN --text T    record a sweep answer (with evidence); resets that domain's clock
  python3 -m foundation blindspots --learn ID --domain D --why W --probe P [--gate G]   add a newly discovered blind spot (incidents, replies, findings)

Unknowns are explicit: a probe that cannot run here (dns, http without --live) is `unmeasured`, never `ok`. The register only grows.
"""
from __future__ import annotations
import argparse, datetime as dt, json, re, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOC = "doctrine/blindspots.json"


def load(root=REPO) -> dict:
    d = json.loads((Path(root) / DOC).read_text(encoding="utf-8"))
    lp = Path(root) / d["learned_file"]
    if lp.is_file():
        d["needs"] = d["needs"] + json.loads(lp.read_text(encoding="utf-8")).get("learned", [])
    return d


def probe(root, spec, live=False):
    """True, False, or None (unmeasured here)."""
    kind, _, arg = spec.partition(":")
    root = Path(root)
    if kind == "file":
        return (root / arg).exists()
    if kind in ("grep", "nogrep"):
        path, _, rx = arg.partition("::")
        p = root / path
        hit = p.is_file() and re.search(rx, p.read_text(encoding="utf-8", errors="replace")) is not None
        return hit if kind == "grep" else not hit
    if kind == "dns":
        if not live:
            return None
        name, rest = arg.split(":", 1)
        rtype, rx = rest.split("::", 1)
        try:
            req = urllib.request.Request(f"https://cloudflare-dns.com/dns-query?name={name}&type={rtype}", headers={"accept": "application/dns-json"})
            with urllib.request.urlopen(req, timeout=15) as r:
                ans = json.load(r).get("Answer", [])
            return any(re.search(rx, a.get("data", "")) for a in ans)
        except OSError:
            return None
    raise ValueError(f"unknown probe kind {kind!r}")


def last_answer(root, domain, d):
    p = Path(root) / d["answers_file"]
    best = None
    if p.is_file():
        for l in p.read_text(encoding="utf-8").splitlines():
            if l.strip():
                r = json.loads(l)
                if r["domain"] == domain:
                    best = r["at"]
    return best


def scan(root=REPO, live=False, today=None):
    d, today = load(root), today or dt.date.today()
    rows = []
    for n in d["needs"]:
        v = probe(root, n["probe"], live)
        rows.append({**{k: n[k] for k in ("id", "domain", "class", "action", "why")}, "gate": n.get("gate"), "state": "ok" if v else ("unmeasured" if v is None else "gap")})
    sweeps = []
    for s in d["sweeps"]:
        la = last_answer(root, s["domain"], d)
        age = (today - dt.date.fromisoformat(la)).days if la else None
        sweeps.append({**s, "last_answer": la, "age_days": age, "due": age is None or age >= s["cadence_days"]})
    return {"needs": rows, "sweeps": sweeps}


def items(res) -> list[dict]:
    out = []
    for r in res["needs"]:
        if r["state"] == "gap" and r["class"] == "system":
            out.append({"id": f"Q-BLIND-{r['id']}", "title": f"Q-BLIND-{r['id']}: close the {r['domain']} blind spot {r['id']}",
                        "body": f"**Owner:** product-manager\n**Trigger:** every blindspots scan\n**Done check:** grep:ops/blindspots/closed.jsonl::\"id\": \"{r['id']}\"\n**Prediction:** blindspots_open <= {len([x for x in res['needs'] if x['state']=='gap'])-1} within 168 h\n**Status:** open\n\nWhy the owner would not know to ask: {r['why']}\nAction: {r['action']}. The probe in doctrine/blindspots.json passes when it is done.",
                        "labels": ["role:product-manager", "blindspot"], "milestone": "Next", "workstream": "Growth"})
    for s in res["sweeps"]:
        if s["due"]:
            out.append({"id": f"Q-BLIND-SWEEP-{s['domain']}", "title": f"Q-BLIND-SWEEP-{s['domain']}: answer the {s['domain']} sweep",
                        "body": f"**Owner:** product-manager\n**Trigger:** sweep older than {s['cadence_days']} days\n**Done check:** grep:ops/blindspots/answers.jsonl::\"domain\": \"{s['domain']}\" ; recorded with `python3 -m foundation blindspots --answer {s['domain']} --text <answer with evidence>`\n**Status:** open\n\nQuestion: {s['question']}\nResearch it with sources, record the answer, and for each new gap run `blindspots --learn`.",
                        "labels": ["role:product-manager", "blindspot"], "milestone": "Next", "workstream": "Growth"})
    return out


def check(root=REPO) -> list[str]:
    d, errs, seen = load(root), [], set()
    for n in d["needs"]:
        if n["id"] in seen:
            errs.append(f"duplicate need {n['id']}")
        seen.add(n["id"])
        for k in ("domain", "why", "probe", "class", "action"):
            if not n.get(k):
                errs.append(f"{n['id']}: missing {k}")
        if n.get("class") == "owner-identity" and n.get("gate") not in d["gates_allowed"]:
            errs.append(f"{n['id']}: owner-identity needs an allowed identity-bound gate")
        if n.get("class") not in ("system", "owner-identity"):
            errs.append(f"{n['id']}: class must be system or owner-identity")
        try:
            probe(root, n["probe"])
        except (ValueError, OSError) as e:
            errs.append(f"{n['id']}: probe error {e}")
    doms = {n["domain"] for n in d["needs"]}
    for s in d["sweeps"]:
        if s["cadence_days"] < 1:
            errs.append(f"sweep {s['domain']}: cadence")
    for dom in doms - {s["domain"] for s in d["sweeps"]}:
        errs.append(f"domain {dom} has needs but no sweep")
    return errs


def answer(root, domain, text):
    d = load(root)
    if domain not in {s["domain"] for s in d["sweeps"]}:
        raise SystemExit(f"unknown domain {domain}")
    if len(text) < 40:
        raise SystemExit("an answer states findings and evidence (at least 40 characters)")
    with open(Path(root) / d["answers_file"], "a", encoding="utf-8") as f:
        f.write(json.dumps({"at": dt.date.today().isoformat(), "domain": domain, "text": text}) + "\n")


def learn(root, nid, domain, why, pr, gate=None):
    d = load(root)
    if nid in {n["id"] for n in d["needs"]}:
        raise SystemExit(f"{nid} already registered")
    if domain not in {s["domain"] for s in d["sweeps"]}:
        raise SystemExit(f"unknown domain {domain}")
    new = {"id": nid, "domain": domain, "why": why, "probe": pr, "class": "owner-identity" if gate else "system", "action": "added by --learn; the executor fills the action", **({"gate": gate} if gate else {})}
    lp = Path(root) / d["learned_file"]
    cur = json.loads(lp.read_text(encoding="utf-8"))
    cur["learned"].append(new)
    lp.write_text(json.dumps(cur, indent=1) + "\n", encoding="utf-8")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="blindspots")
    for f in ("--check", "--scan", "--apply", "--live"):
        ap.add_argument(f, action="store_true")
    ap.add_argument("--answer"); ap.add_argument("--text", default="")
    ap.add_argument("--learn"); ap.add_argument("--domain"); ap.add_argument("--why"); ap.add_argument("--probe"); ap.add_argument("--gate")
    ap.add_argument("--root", default=str(REPO))
    a = ap.parse_args(argv)
    root = Path(a.root)
    if a.answer:
        answer(root, a.answer, a.text); return 0
    if a.learn:
        learn(root, a.learn, a.domain, a.why, a.probe, a.gate); return 0
    if a.scan:
        res = scan(root, a.live)
        for r in res["needs"]:
            print(f"{r['state']:<10} {r['class']:<14} {r['domain']:<13} {r['id']}")
        for s in res["sweeps"]:
            print(f"{'DUE' if s['due'] else 'ok':<10} sweep          {s['domain']:<13} last={s['last_answer']}")
        if a.apply:
            for it in items(res):
                (root / "docs/issues" / f"{it['id']}.json").write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
        return 0
    errs = check(root)
    for e in errs:
        print("blindspots:", e, file=sys.stderr)
    print("blindspots ok" if not errs else f"blindspots: {len(errs)} problem(s)")
    return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main())
