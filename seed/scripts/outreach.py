#!/usr/bin/env python3
"""Outreach engine: discover funding targets, write tailored packets, guard them, queue, send or open one owner card,
track replies and follow-ups, and write status into the repo.

Usage:
  outreach.py run [--today YYYY-MM-DD]          all stages in order; writes outreach/state.json, STATUS.md, status.json
  outreach.py status [--today YYYY-MM-DD]       re-render status only (no contact stages)
  outreach.py reply <key> --kind K [--note T]   record a reply: ack|question|accepted|rejected|opt-out|bounce
Targets are keyed "<profile>:<registry id>". Only registry programs (each with a published application or contact URL, and not marked outreach:false because the programme does not fit yet)
are ever targets. Nothing is contacted when gate.json kill=true or mode=dry-run. Every failure is recorded in the
target's events and the log; nothing is swallowed. Generic: another organization adopts it by editing outreach/*.json.
"""
import argparse, datetime, json, os, pathlib, re, sys, urllib.request

ROOT = pathlib.Path(os.environ.get("OUTREACH_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
OUT = ROOT / "outreach"
REG = ROOT / "funding" / "registry.json"  # a seeded org keeps its registry at funding/registry.json
if not REG.exists():  # an instance repo keeps it under instances/<slug>/funding/ (TEMPLATE-CODE-ONLY-1)
    REG = next(iter(sorted(ROOT.glob("instances/*/funding/registry.json"))), REG)
STATES = ["discovered", "packet-ready", "guard-failed", "queued", "awaiting-owner", "sent", "replied", "accepted", "rejected", "suppressed", "expired", "closed"]
REPLY_KINDS = {"ack", "question", "accepted", "rejected", "opt-out", "bounce"}


def jload(p, default=None):
    p = pathlib.Path(p)
    return json.loads(p.read_text()) if p.exists() else default


def jdump(p, o):
    pathlib.Path(p).write_text(json.dumps(o, indent=1, ensure_ascii=False) + "\n")


def parse_day(s):
    return datetime.date.fromisoformat(s)



class Engine:
    def __init__(self, today):
        self.today = today
        self.gate = jload(OUT / "gate.json")
        self.profiles = jload(OUT / "profiles.json")["profiles"]
        self.supp = jload(OUT / "suppression.json", {"entries": []})
        self.reg = {i["id"]: i for i in jload(REG)["items"]}
        self.state = jload(OUT / "state.json", {"targets": {}})
        self.log = []
        self.deliver = deliver  # replaceable in tests

    # ------------------------------------------------------------ helpers
    def event(self, key, kind, detail=""):
        e = {"at": self.today.isoformat(), "key": key, "event": kind, "detail": detail}
        self.log.append(e)
        t = self.state["targets"].get(key)
        if t is not None:
            t.setdefault("events", []).append({k: e[k] for k in ("at", "event", "detail")})
        return e

    def suppressed(self, key, item):
        ids = {e.get("id") for e in self.supp["entries"]}
        dom = re.sub(r"^https?://([^/]+)/?.*$", r"\1", item["url"]).lower()
        return key in ids or item["id"] in ids or dom in {str(e.get("domain", "")).lower() for e in self.supp["entries"]}

    def sends_since(self, days):
        cut = self.today - datetime.timedelta(days=days)
        n = 0
        for t in self.state["targets"].values():
            for e in t.get("events", []):
                if e["event"] in ("sent", "followup-sent") and parse_day(e["at"]) > cut:
                    n += 1
        return n

    # ------------------------------------------------------------ stages
    def discover(self):
        new = 0
        for pname, prof in self.profiles.items():
            if pname in self.gate.get("paused_profiles", []):
                continue
            for item in self.reg.values():
                if (item["track"] not in prof["tracks"] and item["id"] not in prof.get("extra_ids", [])) or not item.get("url") or item.get("outreach") is False:
                    continue
                key = f"{pname}:{item['id']}"
                if key in self.state["targets"]:
                    continue
                self.state["targets"][key] = {"profile": pname, "registry_id": item["id"], "program": item["name"], "state": "discovered",
                                              "route": item.get("route", {"kind": "form"}).get("kind", "form"), "first_seen": self.today.isoformat(), "events": []}
                self.event(key, "discovered", item["url"])
                new += 1
        return new

    def refresh_status(self):
        """Expire, suppress and reflect source verification for every open target."""
        for key, t in self.state["targets"].items():
            item = self.reg.get(t["registry_id"])
            if item is None:
                if t["state"] not in ("closed",):
                    t["state"] = "closed"; self.event(key, "closed", "registry entry removed")
                continue
            t["source_status"] = item["status"]
            if t["state"] in ("sent", "replied", "accepted", "rejected", "closed", "suppressed", "expired"):
                if self.suppressed(key, item) and t["state"] not in ("suppressed", "closed"):
                    t["state"] = "suppressed"; self.event(key, "suppressed", "opt-out or do-not-contact entry")
                continue
            if self.suppressed(key, item):
                t["state"] = "suppressed"; self.event(key, "suppressed", "opt-out or do-not-contact entry"); continue
            if item.get("deadline") and parse_day(item["deadline"]) < self.today:
                t["state"] = "expired"; self.event(key, "expired", f"deadline {item['deadline']} passed"); continue

    def packet_text(self, key, t):
        prof, item = self.profiles[t["profile"]], self.reg[t["registry_id"]]
        deadline = item.get("deadline") or "none stated"
        return "\n".join([
            f"# {prof['name']} to {item['name']}", "",
            f"Target: {key}  |  Route: {t['route']}  |  Source status: {item['status']} (last verified {item['last_verified']})",
            f"Programme page: {item['url']}", f"Programme amount (as published): {item['amount']}", f"Deadline: {deadline}", "",
            "## What we do", prof["summary"], "",
            "## Positioning", prof["tagline"], "",
            "## Where we are", prof["stage"], "",
            "## Request", prof["ask"], "",
            "## Reply route", prof["contact_route"], "",
            "---", "Opt-out: reply \"stop\" and we will not contact this programme again.", ""])

    def guard_text(self, text, profile):
        """Checks only our own words (summary, stage, ask), never the programme's published fields."""
        prof = self.profiles[profile]
        ours = " ".join(prof[k] for k in ("tagline", "summary", "stage", "ask", "contact_route"))
        findings = [f"blocked pattern /{p}/ matched '{m.group(0)}'" for p in prof["blocked_patterns"] for m in [re.search(p, ours, re.I)] if m]
        for pat in (r"\$\s?\d", r"\d\s?%", r"\u20ac\s?\d"):
            if re.search(pat, ours):
                findings.append(f"numeric claim pattern {pat} in our own text")
        if re.search(r"https?://", ours):
            findings.append("links are not allowed in our own text")
        return findings

    def packets_and_guard(self):
        for key, t in self.state["targets"].items():
            if t["state"] not in ("discovered", "packet-ready", "guard-failed"):
                continue
            text = self.packet_text(key, t)
            d = OUT / "packets" / t["profile"]
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{t['registry_id']}.md").write_text(text)
            f = self.guard_text(text, t["profile"])
            if f:
                t["state"], t["guard"] = "guard-failed", f
                self.event(key, "guard-failed", "; ".join(f))
            else:
                if t["state"] != "packet-ready":
                    self.event(key, "packet-ready", f"outreach/packets/{t['profile']}/{t['registry_id']}.md")
                t["state"], t["guard"] = "packet-ready", []

    def queue(self):
        """Move packet-ready targets with a trustworthy source to queued, within caps. Deadline order first."""
        g = self.gate
        if g["kill"]:
            return 0
        cand = [(k, t) for k, t in self.state["targets"].items()
                if t["state"] == "packet-ready" and t.get("source_status") in ("verified", "secondary")]
        cand.sort(key=lambda kt: (self.reg[kt[1]["registry_id"]].get("deadline") or "9999", kt[0]))
        n = 0
        for k, t in cand[: g["limits"]["max_new_per_run"]]:
            t["state"] = "queued"; self.event(k, "queued", "guard clean, source " + t["source_status"]); n += 1
        for k, t in self.state["targets"].items():
            if t["state"] == "packet-ready" and t.get("source_status") not in ("verified", "secondary"):
                t["blocked_by"] = "source-unverified"
        return n

    def send(self):
        g, lim = self.gate, self.gate["limits"]
        if g["kill"]:
            return {"sent": 0, "dry": 0, "awaiting": 0}
        res = {"sent": 0, "dry": 0, "awaiting": 0}
        live = g["mode"] == "live" and g["sender"]["registered"] and os.environ.get("OUTREACH_SEND_URL") and os.environ.get("OUTREACH_SEND_TOKEN")
        for key, t in self.state["targets"].items():
            if t["state"] != "queued" or t["profile"] in g.get("paused_profiles", []) or t["registry_id"] in g.get("paused_programs", []):
                continue
            item = self.reg[t["registry_id"]]
            email = (item.get("route") or {}).get("email")
            if t["route"] == "email" and email:
                if g["mode"] != "live":
                    t["dry_run_at"] = self.today.isoformat(); self.event(key, "dry-run-send", f"would email the published address for {item['id']}"); res["dry"] += 1; continue
                if not live:
                    t["state"] = "awaiting-owner"; t["needs"] = "sender-identity"; self.event(key, "awaiting-owner", "no registered sender identity or adapter secrets"); res["awaiting"] += 1; continue
                if self.sends_since(1) >= lim["max_sends_per_day"] or self.sends_since(7) >= lim["max_sends_per_week"]:
                    self.event(key, "rate-limited", "daily or weekly cap reached; stays queued"); continue
                try:
                    self.deliver(email, f"{self.profiles[t['profile']]['name']}: question about {item['name']}", (OUT / "packets" / t["profile"] / f"{t['registry_id']}.md").read_text())
                    t["state"], t["last_contact"] = "sent", self.today.isoformat(); self.event(key, "sent", "delivered through sender adapter"); res["sent"] += 1
                except Exception as e:  # recorded, never swallowed
                    self.event(key, "send-failed", f"{type(e).__name__}: {e}")
            else:
                # form routes: submitting a form as the owner is identity-bound; consolidated into one card per profile
                t["state"], t["needs"] = "awaiting-owner", "form-submission"
                self.event(key, "awaiting-owner", "form route: included in the profile's owner card"); res["awaiting"] += 1
        return res

    def followups(self):
        due = 0
        lim = self.gate["limits"]
        for key, t in self.state["targets"].items():
            if t["state"] != "sent" or t.get("replied"):
                continue
            done = t.get("followups", 0)
            if done >= lim["max_followups"]:
                if (self.today - parse_day(t["last_contact"])).days >= lim["followup_days"][-1] + 14:
                    t["state"] = "closed"; self.event(key, "closed", "no reply after the last follow-up")
                continue
            if (self.today - parse_day(t["last_contact"])).days >= lim["followup_days"][min(done, len(lim["followup_days"]) - 1)]:
                if self.gate["kill"] or self.gate["mode"] != "live":
                    self.event(key, "followup-due", "dry-run or kill: not sent"); due += 1; continue
                email = (self.reg[t["registry_id"]].get("route") or {}).get("email")
                try:
                    self.deliver(email, "Following up", "Brief follow-up to our earlier message. Reply \"stop\" and we will not contact you again.")
                    t["followups"], t["last_contact"] = done + 1, self.today.isoformat(); self.event(key, "followup-sent", f"follow-up {done + 1}")
                except Exception as e:
                    self.event(key, "send-failed", f"{type(e).__name__}: {e}")
        return due

    def record_reply(self, key, kind, note=""):
        t = self.state["targets"].get(key)
        if t is None:
            raise SystemExit(f"unknown target {key}")
        if kind not in REPLY_KINDS:
            raise SystemExit(f"kind must be one of {sorted(REPLY_KINDS)}")
        t["replied"] = True
        self.event(key, "reply:" + kind, note)
        if kind == "opt-out":
            self.supp["entries"].append({"id": key, "reason": "opt-out reply", "at": self.today.isoformat()})
            t["state"] = "suppressed"
        elif kind == "accepted":
            t["state"] = "accepted"
        elif kind == "rejected":
            t["state"] = "rejected"
        elif kind == "bounce":
            self.supp["entries"].append({"id": key, "reason": "address bounced", "at": self.today.isoformat()})
            t["state"] = "suppressed"
        else:
            t["state"] = "replied"

    # ------------------------------------------------------------ cards and status
    def cards(self):
        """Open owner items as data only (no files): a count per profile. The one human-facing list is NEEDS-YOU.md."""
        awaiting = {}
        for k, t in self.state["targets"].items():
            if t["state"] == "awaiting-owner":
                awaiting.setdefault(t["profile"], []).append(k)
        items = [{"id": f"OUT-SEND-{p}", "count": len(v), "file": "NEEDS-YOU.md"} for p, v in sorted(awaiting.items())]
        if not self.gate["sender"]["registered"]:
            items.append({"id": "OUT-SENDER", "count": 1, "file": "NEEDS-YOU.md"})
        return items

    def trust(self):
        """Reliability per (profile, action) = (successes + 0.5*2) / (outcomes + 2), the seed policy formula."""
        out = {}
        for pname in self.profiles:
            for action, good, bad in (("draft", ("packet-ready",), ("guard-failed",)), ("contact", ("sent", "followup-sent", "reply:ack", "reply:accepted", "reply:question"), ("send-failed", "reply:bounce", "reply:opt-out"))):
                ok = n_bad = 0
                for t in self.state["targets"].values():
                    if t["profile"] == pname:
                        for e in t.get("events", []):
                            ok += e["event"] in good; n_bad += e["event"] in bad
                out[f"{pname}/{action}"] = {"outcomes": ok + n_bad, "verified_successes": ok, "reliability": round((ok + 1.0) / (ok + n_bad + 2), 3)}
        return out

    def metrics(self):
        c = {s: 0 for s in STATES}
        for t in self.state["targets"].values():
            c[t["state"]] += 1
        m = {"targets": len(self.state["targets"]), **{f"state_{k}": v for k, v in c.items()},
             "outreach_sent_total": sum(1 for t in self.state["targets"].values() for e in t.get("events", []) if e["event"] == "sent"),
             "outreach_replies_total": sum(1 for t in self.state["targets"].values() if t.get("replied")),
             "blocked_source_unverified": sum(1 for t in self.state["targets"].values() if t.get("blocked_by") == "source-unverified" and t["state"] == "packet-ready")}
        return m

    def predictions(self, m):
        p = jload(OUT / "predictions.json", {"items": []})
        have = {x["id"] for x in p["items"]}
        add = []
        if "P-QUEUE" not in have:
            add.append({"id": "P-QUEUE", "metric": "state_queued", "op": ">=", "target": 1, "due": (self.today + datetime.timedelta(days=14)).isoformat(), "logged": self.today.isoformat(),
                        "text": "state_queued >= 1 within 336 h (a verified source reaches the queue once the weekly verification promotes a registry row)"})
        if m["outreach_sent_total"] and "P-REPLY" not in have:
            add.append({"id": "P-REPLY", "metric": "outreach_replies_total", "op": ">=", "target": 1, "due": (self.today + datetime.timedelta(days=45)).isoformat(), "logged": self.today.isoformat(),
                        "text": "outreach_replies_total >= 1 within 1080 h of the first send"})
        p["items"] += add
        ops = {">=": lambda a, b: a >= b, "<=": lambda a, b: a <= b, "==": lambda a, b: a == b}
        for x in p["items"]:
            if "scored" not in x and parse_day(x["due"]) <= self.today:
                x["scored"] = {"at": self.today.isoformat(), "value": m.get(x["metric"]), "hit": bool(ops[x["op"]](m.get(x["metric"], 0), x["target"]))}
        jdump(OUT / "predictions.json", p)
        return p["items"]

    def write_status(self, cards):
        m = self.metrics()
        preds = self.predictions(m)
        status = {"generated": self.today.isoformat(), "mode": self.gate["mode"], "kill": self.gate["kill"], "sender_registered": self.gate["sender"]["registered"],
                  "metrics": m, "trust": self.trust(), "owner_cards": cards, "predictions": preds,
                  "targets": [{"key": k, "program": t["program"], "state": t["state"], "route": t["route"], "source": t.get("source_status"), "blocked_by": t.get("blocked_by"),
                               "last_event": (t.get("events") or [{}])[-1].get("event")} for k, t in sorted(self.state["targets"].items())]}
        jdump(OUT / "status.json", status)
        md = ["# Outreach status", "", f"Generated {status['generated']}. Mode **{status['mode']}**, kill switch **{'ON' if status['kill'] else 'off'}**, sender identity {'registered' if status['sender_registered'] else 'not registered'}.", "",
              "| State | Count |", "|---|---|"] + [f"| {s} | {m['state_' + s]} |" for s in STATES if m["state_" + s]] + ["",
              f"Sent: {m['outreach_sent_total']}. Replies: {m['outreach_replies_total']}. Packet-ready but waiting on source verification: {m['blocked_source_unverified']}.", "",
              "## What needs a person", "", "One page lists it: [NEEDS-YOU.md](../NEEDS-YOU.md).", ""] + [f"- {c['id']}: {c['count']}" for c in cards] + ["", "## Trust (per profile)", ""] + \
             [f"- {p}: reliability {v['reliability']} from {v['outcomes']} outcomes" for p, v in status["trust"].items()] + ["", "## Targets", "", "| Key | Programme | State | Route | Source | Blocked by |", "|---|---|---|---|---|---|"] + \
             [f"| {t['key']} | {t['program'][:50]} | {t['state']} | {t['route']} | {t['source']} | {t['blocked_by'] or ''} |" for t in status["targets"]] + [""]
        (OUT / "STATUS.md").write_text("\n".join(md))
        return status

    def save(self):
        jdump(OUT / "state.json", self.state)
        jdump(OUT / "suppression.json", self.supp)
        if self.log:
            with open(OUT / "log.jsonl", "a") as f:
                for e in self.log:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")


def deliver(to, subject, body):
    """Delivery adapter: POST to the owner's sender endpoint (a mailer on their domain). Needs both secrets by binding name."""
    req = urllib.request.Request(os.environ["OUTREACH_SEND_URL"], data=json.dumps({"to": to, "subject": subject, "text": body}).encode(),
                                 headers={"content-type": "application/json", "authorization": "Bearer " + os.environ["OUTREACH_SEND_TOKEN"]})
    with urllib.request.urlopen(req, timeout=20) as r:
        if r.status >= 300:
            raise RuntimeError(f"sender endpoint answered HTTP {r.status}")


def run(today, contact=True):
    e = Engine(today)
    new = e.discover()
    e.refresh_status()
    if contact:
        e.packets_and_guard()
        queued = e.queue()
        res = e.send()
        due = e.followups()
    else:
        queued, res, due = 0, {}, 0
    cards = e.cards()
    e.write_status(cards)
    e.save()
    directories = None
    if (OUT / "agent-directories.json").exists():  # AGENT-DIRECTORIES-1: packets for agent registries ride the same run and the same gate
        import agent_directories
        directories = agent_directories.build(ROOT)
    return {"agent_directories": directories, "new": new, "queued": queued, "send": res, "followups_due": due, "cards": [c["id"] for c in cards], "mode": e.gate["mode"], "kill": e.gate["kill"]}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run", "status", "reply"])
    ap.add_argument("key", nargs="?")
    ap.add_argument("--kind")
    ap.add_argument("--note", default="")
    ap.add_argument("--today")
    a = ap.parse_args(argv)
    today = parse_day(a.today) if a.today else datetime.date.today()
    if a.cmd == "reply":
        e = Engine(today)
        e.record_reply(a.key, a.kind, a.note)
        e.write_status(e.cards()); e.save()
        print(json.dumps({"recorded": a.key, "kind": a.kind}))
        return 0
    print(json.dumps(run(today, contact=a.cmd == "run"), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
