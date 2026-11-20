"""BLINDSPOT-1: the system knows what the owner cannot know to ask for. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation blindspots --check                     register is well formed; every id unique; identity-bound needs carry an allowed gate
  python3 -m foundation blindspots --scan [--apply] [--live]   run each probe; failed system needs become Q-BLIND-* items; stale sweeps become Q-BLIND-SWEEP-*
  python3 -m foundation blindspots --answer DOMAIN --text T [--evidence E ...]   record a sweep answer (with evidence); resets that domain's clock
  python3 -m foundation blindspots --autoanswer [--apply]      answer every due sweep from what the repository itself can measure (needs, changed paths, data files)
  python3 -m foundation blindspots --tick [--apply]             the whole loop in one pass (the product manager pass runs this daily)
  python3 -m foundation blindspots --domains [--apply]         read each domain's expiry (RDAP, then the registrar API) and file a money gate inside renewal_gate_days
  python3 -m foundation blindspots --closed ID | --swept DOMAIN | --renewed DOMAIN   done checks: exit 0 when the need's probe passes, the sweep is not due, the domain is outside the gate
  python3 -m foundation blindspots --learn ID --domain D --why W --probe P [--gate G]   add a newly discovered blind spot (incidents, replies, findings)

Unknowns are explicit: a probe that cannot run here (dns, http without --live) is `unmeasured`, never `ok`. The register only grows.
"""
from __future__ import annotations
import argparse, datetime as dt, json, os, re, subprocess, sys, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
DOC = "doctrine/blindspots.json"


def load(root=REPO) -> dict:
    d = json.loads((Path(root) / DOC).read_text(encoding="utf-8"))
    lp = Path(root) / d["learned_file"]
    if lp.is_file():
        d["needs"] = d["needs"] + json.loads(lp.read_text(encoding="utf-8")).get("learned", [])
    return d


def _day(v):
    try:
        return dt.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def probe(root, spec, live=False, today=None):
    """True, False, or None (unmeasured here). fresh:<json path>::<date field>::<max age days>[::<field that must be true>] is a clock: a stale record is a gap."""
    kind, _, arg = spec.partition(":")
    root = Path(root)
    if kind == "fresh":
        path, field, days, *must = arg.split("::")
        p = root / path
        if not p.is_file():
            return False
        try:
            j = json.loads(p.read_text(encoding="utf-8"))
        except ValueError:
            return False
        at = _day(j.get(field))
        return bool(at and ((today or dt.date.today()) - at).days <= int(days) and all(j.get(m) is True for m in must))
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
        v = probe(root, n["probe"], live, today)
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
                        "body": f"**Owner:** product-manager\n**Trigger:** every blindspots scan\n**Done check:** cmd:python3 -m foundation blindspots --closed {r['id']}\n**Prediction:** blindspots_open <= {len([x for x in res['needs'] if x['state']=='gap'])-1} within 168 h\n**Status:** open\n\nWhy the owner would not know to ask: {r['why']}\nAction: {r['action']}. The probe in doctrine/blindspots.json passes when it is done.",
                        "labels": ["role:product-manager", "blindspot"], "milestone": "Next", "workstream": "Growth"})
    for s in res["sweeps"]:
        if s["due"]:
            out.append({"id": f"Q-BLIND-SWEEP-{s['domain']}", "title": f"Q-BLIND-SWEEP-{s['domain']}: answer the {s['domain']} sweep",
                        "body": f"**Owner:** product-manager\n**Trigger:** sweep older than {s['cadence_days']} days\n**Done check:** cmd:python3 -m foundation blindspots --swept {s['domain']}\n**Status:** open\n\nQuestion: {s['question']}\nResearch it with sources, record the answer with `python3 -m foundation blindspots --answer {s['domain']} --text <answer> --evidence <source>`, and for each new gap run `blindspots --learn`. The product manager pass records a computed answer (`--autoanswer`) when nobody else has.",
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


def answer(root, domain, text, evidence=None, basis="session"):
    d = load(root)
    if domain not in {s["domain"] for s in d["sweeps"]}:
        raise SystemExit(f"unknown domain {domain}")
    if len(text) < 40:
        raise SystemExit("an answer states findings and evidence (at least 40 characters)")
    with open(Path(root) / d["answers_file"], "a", encoding="utf-8") as f:
        f.write(json.dumps({"at": dt.date.today().isoformat(), "domain": domain, "text": text, "evidence": list(evidence or []), "basis": basis}) + "\n")


def _changed(root, since, paths) -> list[str] | None:
    """Files under `paths` changed since a date, from git; None when git cannot say (shallow or absent history is unmeasured, never 'nothing changed')."""
    try:
        r = subprocess.run(["git", "-C", str(root), "log", f"--since={since}", "--name-only", "--format=", "--", *paths], capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return sorted({l for l in r.stdout.splitlines() if l.strip()}) if r.returncode == 0 else None


def evidence(root, sweep, res, d) -> dict:
    """What the repository itself can measure for one sweep: the state of that domain's needs, the files changed since the last answer, and the data files the sweep reads."""
    root, dom = Path(root), sweep["domain"]
    needs = [r for r in res["needs"] if r["domain"] == dom]
    since = sweep.get("last_answer") or (dt.date.today() - dt.timedelta(days=sweep["cadence_days"])).isoformat()
    ch = _changed(root, since, sweep.get("paths") or ["."])
    data = {}
    for rel in sweep.get("data", []):
        p = root / rel
        if p.is_file():
            try:
                j = json.loads(p.read_text(encoding="utf-8"))
                data[rel] = {k: j[k] for k in list(j)[:12] if not isinstance(j[k], (list, dict)) and not k.startswith("_")}
            except ValueError:
                data[rel] = "unreadable"
        else:
            data[rel] = "missing"
    return {"needs": {r["id"]: r["state"] for r in needs}, "since": since, "changed": ch, "data": data}


def autoanswer(root=REPO, apply=False, live=False, today=None) -> list[dict]:
    """BLINDSPOT-1 on a clock: every due sweep gets a computed answer, so the question is asked and recorded even when no session researches it.
    A computed answer never claims more than it measured: unmeasured needs and unreadable history are stated as such, and each gap is named."""
    d, res, out = load(root), scan(root, live, today), []
    for s in res["sweeps"]:
        if not s["due"]:
            continue
        ev = evidence(root, s, res, d)
        gaps = [k for k, v in ev["needs"].items() if v == "gap"]
        unm = [k for k, v in ev["needs"].items() if v == "unmeasured"]
        ch = ev["changed"]
        text = (f"Computed sweep. Needs in this domain: {len(ev['needs'])} registered, gaps: {', '.join(gaps) or 'none'}, unmeasured: {', '.join(unm) or 'none'}. "
                + (f"History since {ev['since']} could not be read, so what changed is unmeasured. " if ch is None else f"{len(ch)} file(s) changed since {ev['since']} under the paths this sweep watches"
                   + (": " + ", ".join(ch[:8]) + (f" and {len(ch) - 8} more" if len(ch) > 8 else "") if ch else "") + ". ")
                + "".join(f"{k}: {json.dumps(v)[:240]}. " for k, v in ev["data"].items()))
        row = {"domain": s["domain"], "text": text.strip(), "evidence": [f"file:{k}" for k in ev["data"]] + ["cmd:python3 -m foundation blindspots --scan"], "gaps": gaps}
        out.append(row)
        if apply:
            answer(root, s["domain"], row["text"], row["evidence"], basis="computed")
    return out


def tick(root=REPO, apply=False, live=True, env=None, today=None) -> dict:
    """One pass of the whole loop, run by the product manager pass every day: refresh the clocks that are stale (domain expiry, backup drill), scan, keep the
    closed ledger, file items, and give a computed answer to any sweep nobody answered within grace_days. Each stage records its own failure and the rest still run."""
    root, d, today, out = Path(root), load(root), today or dt.date.today(), {}
    if live:
        p = root / d["domain_expiry_file"]
        try:
            at = _day(json.loads(p.read_text(encoding="utf-8")).get("at")) if p.is_file() else None
        except ValueError:
            at = None
        if at is None or (today - at).days >= d["refresh_days"]:
            try:
                r = domains(root, apply, today, env)
                out["domains"] = {"ok": r["ok"], "soonest": r["soonest"], "filed": r["filed"]}
            except Exception as e:  # recorded; the stale record turns the probe into a gap by itself
                out["domains"] = {"error": f"{type(e).__name__}: {e}"[:160]}
        from . import backup
        try:
            r = backup.run(root, apply, env=env, today=today)
            out["backup"] = {k: r[k] for k in ("skipped", "ok", "restore_ok", "stored_ok", "errors") if k in r}
        except Exception as e:
            out["backup"] = {"error": f"{type(e).__name__}: {e}"[:160]}
    res = scan(root, live, today)
    its = items(res)
    late = [s["domain"] for s in res["sweeps"] if s["due"] and (s["age_days"] is None or s["age_days"] >= s["cadence_days"] + d["grace_days"])]
    out["answered"] = [r["domain"] for r in autoanswer(root, False, live, today) if r["domain"] in late]
    if apply:
        out["ledger"] = closed_ledger(root, res, today)
        for r in autoanswer(root, False, live, today):
            if r["domain"] in late:
                answer(root, r["domain"], r["text"], r["evidence"], basis="computed")
        for it in its:
            if it["id"].startswith("Q-BLIND-SWEEP-") and it["id"][len("Q-BLIND-SWEEP-"):] in late:
                continue
            f = root / "docs/issues" / f"{it['id']}.json"
            if not (f.is_file() and "**Status:** open" in f.read_text(encoding="utf-8")):  # an open item is left as it is, so a quiet day changes no file
                f.write_text(json.dumps(it, indent=2) + "\n", encoding="utf-8")
    out["filed"] = [it["id"] for it in its if not (it["id"].startswith("Q-BLIND-SWEEP-") and it["id"][len("Q-BLIND-SWEEP-"):] in late)]
    out["gaps"] = [r["id"] for r in res["needs"] if r["state"] == "gap"]
    out["unmeasured"] = [r["id"] for r in res["needs"] if r["state"] == "unmeasured"]
    return out


def closed_ledger(root, res, today=None) -> list[str]:
    """ops/blindspots/closed.jsonl holds one row per system need whose probe passes now. A need that relapses loses its row (key `reopened`), so a done check
    that reads the ledger cannot pass on an old closure."""
    root, d = Path(root), load(root)
    p = root / d.get("closed_file", "ops/blindspots/closed.jsonl")
    rows = [json.loads(l) for l in p.read_text(encoding="utf-8").splitlines() if l.strip()] if p.is_file() else []
    have = {r["id"] for r in rows if "id" in r}
    day, moved = (today or dt.date.today()).isoformat(), []
    probes = {n["id"]: n["probe"] for n in d["needs"]}
    for r in res["needs"]:
        if r["class"] != "system":
            continue
        if r["state"] == "ok" and r["id"] not in have:
            rows.append({"id": r["id"], "at": day, "probe": probes[r["id"]]}); moved.append(r["id"])
        elif r["state"] == "gap" and r["id"] in have:
            rows = [({"reopened": x["id"], "at": day, "closed_at": x["at"]} if x.get("id") == r["id"] else x) for x in rows]; moved.append("-" + r["id"])
    if moved:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("".join(json.dumps(x) + "\n" for x in rows), encoding="utf-8")
    return moved


def _rdap(name, fetch=None):
    """Expiry from RDAP (no credential). Returns (iso date or None, source)."""
    fetch = fetch or (lambda u, h: json.load(urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=20)))
    try:
        j = fetch(f"https://rdap.org/domain/{name}", {"accept": "application/rdap+json", "user-agent": "ultrastable-blindspots"})
        for e in j.get("events", []):
            if e.get("eventAction") == "expiration":
                return e["eventDate"][:10], "rdap"
    except (OSError, ValueError, KeyError):
        pass
    return None, "rdap"


def _registrar(name, env, fetch=None):
    """Second route: the Cloudflare Registrar API, for every account the token can read. Returns (iso date or None, auto_renew or None)."""
    tok = env.get("CLOUDFLARE_API_TOKEN")
    if not tok:
        return None, None
    fetch = fetch or (lambda u, h: json.load(urllib.request.urlopen(urllib.request.Request(u, headers=h), timeout=20)))
    h = {"authorization": "Bearer " + tok}
    try:
        accts = [a["id"] for a in fetch("https://api.cloudflare.com/client/v4/accounts?per_page=50", h).get("result", [])]
    except (OSError, ValueError, KeyError):
        accts = [env["CLOUDFLARE_ACCOUNT_ID"]] if env.get("CLOUDFLARE_ACCOUNT_ID") else []
    for a in accts:
        try:
            r = fetch(f"https://api.cloudflare.com/client/v4/accounts/{a}/registrar/domains/{name}", h).get("result") or {}
            if r.get("expires_at"):
                return r["expires_at"][:10], r.get("auto_renew")
        except (OSError, ValueError, KeyError):
            continue
    return None, None


def domains(root=REPO, apply=False, today=None, env=None, fetch=None) -> dict:
    """The domain-renewal clock. Each domain's expiry is read on two routes; a reading that fails keeps the last measured date and says so (never a guess).
    Inside renewal_gate_days a domain without auto-renew becomes a money gate item (identity-bound, so the executor leaves it) with a done check that passes once the expiry moves out."""
    root, d, today, env = Path(root), load(root), today or dt.date.today(), os.environ if env is None else env
    p = root / d["domain_expiry_file"]
    prev = {x["name"]: x for x in (json.loads(p.read_text(encoding="utf-8")).get("domains", []) if p.is_file() else [])}
    rows, filed = [], []
    for name in d["domains"]:
        exp, src = _rdap(name, fetch)
        rexp, auto = _registrar(name, env, fetch)
        if not exp and rexp:
            exp, src = rexp, "cloudflare-registrar-api"
        old = prev.get(name, {})
        row = {"name": name, "expires": exp or old.get("expires"), "source": src if exp else old.get("source"), "measured": today.isoformat() if exp else old.get("measured"),
               "auto_renew": auto if auto is not None else old.get("auto_renew")}
        e = _day(row["expires"])
        row["days_left"] = (e - today).days if e else None
        row["gate"] = bool(e is None or (row["days_left"] <= d["renewal_gate_days"] and row["auto_renew"] is not True))
        rows.append(row)
        if row["gate"] and e is not None:
            iid = f"Q-BLIND-RENEW-{name.replace('.', '-')}"
            filed.append(iid)
            if apply:
                (root / "docs/issues" / f"{iid}.json").write_text(json.dumps({"id": iid, "title": f"{iid}: renew {name} before {row['expires']}",
                    "body": f"**Owner:** ROWAN (identity-bound: money)\n**Trigger:** {name} expires in {row['days_left']} days and auto-renew is not on\n**Done check:** cmd:python3 -m foundation blindspots --renewed {name}\n**Status:** open\n\nDefault in effect: the site keeps serving until {row['expires']}; after that the domain, its mail and every listing that names it stop. Renewing is a payment, so it is the owner's act: https://dash.cloudflare.com/?to=/:account/domains/manage/{name}",
                    "labels": ["gate:money", "blindspot"], "milestone": "Now", "workstream": "Continuity"}, indent=2) + "\n", encoding="utf-8")
    measured = [r["measured"] for r in rows if r["measured"]]
    out = {"_doc": "GENERATED by python3 -m foundation blindspots --domains --apply (BLINDSPOT-1 need domain-renewal). at is the oldest reading, so one unread domain makes the whole record stale.",
           "at": min(measured) if len(measured) == len(rows) else None, "ok": all(r["expires"] for r in rows), "soonest": min((r["expires"] for r in rows if r["expires"]), default=None),
           "auto_renew_off": [r["name"] for r in rows if r["auto_renew"] is False], "domains": rows, "filed": filed}
    if apply:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    return out


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
    for f in ("--check", "--scan", "--apply", "--live", "--autoanswer", "--domains", "--tick"):
        ap.add_argument(f, action="store_true")
    ap.add_argument("--answer"); ap.add_argument("--text", default=""); ap.add_argument("--evidence", action="append", default=[])
    ap.add_argument("--closed"); ap.add_argument("--swept"); ap.add_argument("--renewed")
    ap.add_argument("--learn"); ap.add_argument("--domain"); ap.add_argument("--why"); ap.add_argument("--probe"); ap.add_argument("--gate")
    ap.add_argument("--root", default=str(REPO))
    a = ap.parse_args(argv)
    root = Path(a.root)
    if a.answer:
        answer(root, a.answer, a.text, a.evidence); return 0
    if a.closed:
        st = {r["id"]: r["state"] for r in scan(root, a.live)["needs"]}.get(a.closed)
        print(f"{a.closed}: {st}"); return 0 if st == "ok" else 1
    if a.swept:
        due = {s["domain"]: s["due"] for s in scan(root)["sweeps"]}.get(a.swept, True)
        print(f"{a.swept}: {'due' if due else 'answered'}"); return 1 if due else 0
    if a.renewed:
        d = load(root); p = root / d["domain_expiry_file"]
        row = next((x for x in (json.loads(p.read_text(encoding="utf-8"))["domains"] if p.is_file() else []) if x["name"] == a.renewed), None)
        print(f"{a.renewed}: {row and row.get('days_left')} days left"); return 0 if row and not row["gate"] else 1
    if a.tick:
        print(json.dumps(tick(root, a.apply), indent=1)); return 0
    if a.autoanswer:
        for r in autoanswer(root, a.apply, a.live):
            print(f"{r['domain']}: {r['text'][:160]}")
        return 0
    if a.domains:
        out = domains(root, a.apply)
        for r in out["domains"]:
            print(f"{r['name']:<20} expires={r['expires']} days_left={r['days_left']} auto_renew={r['auto_renew']} source={r['source']}")
        return 0 if out["ok"] else 1
    if a.learn:
        learn(root, a.learn, a.domain, a.why, a.probe, a.gate); return 0
    if a.scan:
        res = scan(root, a.live)
        for r in res["needs"]:
            print(f"{r['state']:<10} {r['class']:<14} {r['domain']:<13} {r['id']}")
        for s in res["sweeps"]:
            print(f"{'DUE' if s['due'] else 'ok':<10} sweep          {s['domain']:<13} last={s['last_answer']}")
        if a.apply:
            closed_ledger(root, res)
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
