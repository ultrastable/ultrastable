#!/usr/bin/env python3
"""Intro outreach (OUTREACH-INTRO-1): the system introduces the work to organizations that could use it, instead of waiting for a posting.

Where scripts/outreach.py answers programmes that publish an application, this lane approaches research institutes, AI labs, funders and
third-sector organizations that publish only a contact route, and proposes a conversation (or a role that does not exist yet).

Pipeline per prospect `intro:<id>`: resolve (read the organization's own pages for a published role mailbox) -> verify (the address is
still on its source page) -> packet (disclosed as automated, segment angle, opt-out, postal address) -> guard -> queue -> send through the
sender adapter -> replies -> follow-ups -> status. Same gate.json, suppression.json and caps as outreach.py; intro sends count toward the
shared daily and weekly caps.

Usage:
  outreach_intro.py run [--today YYYY-MM-DD]       all stages; writes outreach/intro-state.json and intro-status.json
  outreach_intro.py add ID NAME URL --segment S    add a prospect (homepage URL on the organization's own domain)
  outreach_intro.py reply <intro:ID> --kind K      ack|question|meeting|accepted|rejected|opt-out|bounce
Never: harvest personal addresses (role mailboxes on the organization's own domain only), buy or import lists, send while kill=true,
dry-run, or without a registered sender and a postal address, contact a suppressed domain, or reword text past the guard.
"""
import argparse, datetime, json, os, pathlib, re, sys, urllib.parse, urllib.request, urllib.robotparser

import outreach as base

ROOT = pathlib.Path(os.environ.get("OUTREACH_ROOT") or pathlib.Path(__file__).resolve().parent.parent)
OUT = ROOT / "outreach"
STATES = ["unresolved", "no-public-route", "form-only", "verified", "packet-ready", "guard-failed", "queued", "sent", "replied", "accepted", "rejected", "suppressed", "stale", "closed"]
REPLY_KINDS = {"ack", "question", "meeting", "accepted", "rejected", "opt-out", "bounce"}
CONTACT_PATHS = ["/contact", "/contact-us", "/about/contact", "/get-in-touch", "/partnerships", "/collaborate", "/about"]
ROLE_OK = re.compile(r"^(partnerships?|partners|collaborat\w*|research|enquir\w*|inquir\w*|contact|hello|info|office|team|general)$", re.I)
ROLE_RANK = [r"partner", r"collab", r"research", r"enquir|inquir", r"hello|contact", r"info|office|team|general"]
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
UA = "ultrastable-outreach (automated; opt-out by replying stop)"


def jload(p, default=None):
    return base.jload(p, default)


def jdump(p, o):
    base.jdump(p, o)


def http_fetch(url):
    """(status, text). A network failure raises; the caller records it."""
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read(400_000).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""


def domain(url_or_email):
    s = url_or_email.split("@")[-1] if "@" in url_or_email and "://" not in url_or_email else urllib.parse.urlparse(url_or_email).netloc
    return re.sub(r"^www\.", "", s.lower())


def role_mailboxes(text, site_domain):
    """Role mailboxes published on the organization's own domain. Personal addresses are never returned."""
    found = []
    for m in EMAIL_RE.findall(text):
        local, _, dom = m.lower().partition("@")
        if (dom == site_domain or dom.endswith("." + site_domain)) and ROLE_OK.match(local) and m.lower() not in found:
            found.append(m.lower())
    found.sort(key=lambda e: next((i for i, r in enumerate(ROLE_RANK) if re.search(r, e.split("@")[0])), 99))
    return found


class Intro:
    def __init__(self, today, fetch=http_fetch):
        self.today = today
        self.fetch = fetch
        self.gate = jload(OUT / "gate.json")
        self.cfg = {"enabled": True, "max_new_per_run": 5, "max_sends_per_week": 5, "reverify_days": 30, "held_regions": [], **self.gate.get("intro", {})}
        self.prof = jload(OUT / "intro-profile.json")
        self.reg = jload(OUT / "prospects.json", {"items": []})
        self.supp = jload(OUT / "suppression.json", {"entries": []})
        self.state = jload(OUT / "intro-state.json", {"targets": {}})
        self.main_state = jload(OUT / "state.json", {"targets": {}})
        self.log = []
        self.deliver = base.deliver
        self.robots = {}

    # ---------------------------------------------------------------- helpers
    def event(self, key, kind, detail=""):
        e = {"at": self.today.isoformat(), "key": key, "event": kind, "detail": detail}
        self.log.append(e)
        t = self.state["targets"].get(key)
        if t is not None:
            t.setdefault("events", []).append({k: e[k] for k in ("at", "event", "detail")})

    def suppressed(self, key, item):
        doms = {str(e.get("domain", "")).lower() for e in self.supp["entries"]}
        ids = {e.get("id") for e in self.supp["entries"]}
        mine = {domain(item["url"])} | ({domain(item["email"])} if item.get("email") else set())
        return key in ids or item["id"] in ids or bool(mine & doms)

    def sends_since(self, days):
        cut = self.today - datetime.timedelta(days=days)
        n = 0
        for st in (self.state, self.main_state):
            for t in st["targets"].values():
                n += sum(1 for e in t.get("events", []) if e["event"] in ("sent", "followup-sent") and base.parse_day(e["at"]) > cut)
        return n

    def allowed_by_robots(self, url):
        p = urllib.parse.urlparse(url)
        root = f"{p.scheme}://{p.netloc}"
        if root not in self.robots:
            rp = urllib.robotparser.RobotFileParser()
            try:
                status, text = self.fetch(root + "/robots.txt")
            except Exception as e:  # unreachable site: recorded by the caller on the page fetch
                self.robots[root] = None
                return True
            if status == 200:
                rp.parse(text.splitlines())
                self.robots[root] = rp
            elif status in (404, 410):
                self.robots[root] = None
            else:
                self.robots[root] = False
        r = self.robots[root]
        return True if r is None else (r is not False and r.can_fetch(UA, url))

    # ---------------------------------------------------------------- stages
    def discover(self):
        new = 0
        for item in self.reg["items"]:
            key = f"intro:{item['id']}"
            if key in self.state["targets"] or item.get("outreach") is False:
                continue
            self.state["targets"][key] = {"registry_id": item["id"], "name": item["name"], "segment": item["segment"], "state": "unresolved",
                                          "first_seen": self.today.isoformat(), "events": []}
            self.event(key, "discovered", item["url"]); new += 1
        return new

    def resolve(self):
        """Read the organization's own pages for a published role mailbox. Re-reads each verified row on the reverify cadence."""
        for item in self.reg["items"]:
            key = f"intro:{item['id']}"
            t = self.state["targets"].get(key)
            if not t or t["state"] in ("sent", "replied", "accepted", "rejected", "suppressed", "closed"):
                continue
            due = t["state"] in ("unresolved", "no-public-route", "form-only", "stale") or (
                item.get("last_verified") and (self.today - base.parse_day(item["last_verified"])).days >= self.cfg["reverify_days"])
            if not due:
                continue
            site = domain(item["url"])
            base_url = urllib.parse.urlparse(item["url"])
            root = f"{base_url.scheme}://{base_url.netloc}"
            hit, contact_page, errs = None, None, []
            for path in [""] + CONTACT_PATHS:
                url = root + path
                if not self.allowed_by_robots(url):
                    errs.append(f"{path or '/'}: robots.txt disallows"); continue
                try:
                    status, text = self.fetch(url)
                except Exception as e:
                    errs.append(f"{path or '/'}: {type(e).__name__}: {e}"); continue
                if status != 200:
                    continue
                if path and contact_page is None and re.search(r"contact|touch", path):
                    contact_page = url
                boxes = role_mailboxes(text, site)
                if boxes:
                    hit = (boxes[0], url); break
            if hit:
                item.update({"email": hit[0], "email_source": hit[1], "status": "verified", "last_verified": self.today.isoformat()})
                if t["state"] in ("unresolved", "no-public-route", "form-only", "stale"):
                    t["state"] = "verified"; self.event(key, "verified", f"{hit[0]} published at {hit[1]}")
            else:
                if item.get("email") and item.get("status") == "verified":  # was on a page before and is not now
                    item["status"] = "stale"; t["state"] = "stale"; self.event(key, "stale", "published address no longer found on the organization's own pages")
                elif contact_page:
                    item.update({"status": "form-only", "contact_url": contact_page}); t["state"] = "form-only"
                    self.event(key, "form-only", f"no published role mailbox; contact page {contact_page}. Forms are not submitted by the system")
                else:
                    item["status"] = "no-public-route"; t["state"] = "no-public-route"
                    self.event(key, "no-public-route", "; ".join(errs) or "no contact page or role mailbox found")

    def refresh_status(self):
        for key, t in self.state["targets"].items():
            item = next((i for i in self.reg["items"] if i["id"] == t["registry_id"]), None)
            if item is None:
                if t["state"] != "closed":
                    t["state"] = "closed"; self.event(key, "closed", "prospect removed from the registry")
                continue
            if self.suppressed(key, item) and t["state"] not in ("suppressed", "closed"):
                t["state"] = "suppressed"; self.event(key, "suppressed", "opt-out or do-not-contact entry")
            elif item.get("region") in self.cfg["held_regions"] and t["state"] in ("verified", "packet-ready", "queued"):
                t["state"] = "closed"; self.event(key, "closed", f"region {item['region']} is held in gate.json")

    def body(self, key, t, item):
        p, s = self.prof, self.prof["segments"][t["segment"]]
        sender = self.gate["sender"]
        lines = [f"Hello {item['name']} team,", "", p["disclosure"], "", p["who"], "", p["what"], "", s["angle"], "", p["offer"]]
        if sender.get("booking_url"):
            lines += ["", f"A time can be picked here: {sender['booking_url']}"]
        lines += ["", p["signoff"], "", f"If you would rather not hear from us, reply \"stop\" and this organization will not be contacted again."]
        if sender.get("postal_address"):
            lines += ["", sender["postal_address"]]
        return "\n".join(lines) + "\n"

    def guard(self):
        """Checks only our own words (the profile), never the prospect's published fields."""
        p = self.prof
        ours = " ".join([p["disclosure"], p["who"], p["what"], p["offer"], p["signoff"]] + [s["angle"] + " " + s["subject"] for s in p["segments"].values()])
        found = [f"blocked pattern /{b}/ matched '{m.group(0)}'" for b in p["blocked_patterns"] for m in [re.search(b, ours, re.I)] if m]
        for pat in (r"\$\s?\d", r"\d\s?%", r"€\s?\d", r"£\s?\d"):
            if re.search(pat, ours):
                found.append(f"numeric claim pattern {pat} in our own text")
        if re.search(r"https?://", ours):
            found.append("links are not allowed in our own text")
        bu = self.gate["sender"].get("booking_url")
        if bu and not re.match(r"^https://[^\s]+$", bu):
            found.append("sender.booking_url must be an https link")
        return found

    def packets(self):
        f = self.guard()
        for key, t in self.state["targets"].items():
            if t["state"] not in ("verified", "packet-ready", "guard-failed"):
                continue
            item = next(i for i in self.reg["items"] if i["id"] == t["registry_id"])
            if f:
                if t["state"] != "guard-failed":
                    self.event(key, "guard-failed", "; ".join(f))
                t["state"], t["guard"] = "guard-failed", f; continue
            d = OUT / "packets" / "intro"
            d.mkdir(parents=True, exist_ok=True)
            (d / f"{item['id']}.md").write_text(f"Subject: {self.prof['segments'][t['segment']]['subject']}\nTo: {item['email']} (published at {item['email_source']})\n\n" + self.body(key, t, item))
            if t["state"] != "packet-ready":
                self.event(key, "packet-ready", f"outreach/packets/intro/{item['id']}.md")
            t["state"], t["guard"] = "packet-ready", []

    def queue(self):
        if self.gate["kill"] or not self.cfg["enabled"]:
            return 0
        cand = sorted(k for k, t in self.state["targets"].items() if t["state"] == "packet-ready")
        n = 0
        for k in cand[: self.cfg["max_new_per_run"]]:
            self.state["targets"][k]["state"] = "queued"; self.event(k, "queued", "guard clean, role mailbox verified at source"); n += 1
        return n

    def send(self):
        g, lim = self.gate, self.gate["limits"]
        res = {"sent": 0, "dry": 0, "awaiting": 0, "capped": 0}
        if g["kill"] or not self.cfg["enabled"]:
            return res
        s = g["sender"]
        live = g["mode"] == "live" and s["registered"] and s.get("postal_address") and os.environ.get("OUTREACH_SEND_URL") and os.environ.get("OUTREACH_SEND_TOKEN")
        for key, t in self.state["targets"].items():
            if t["state"] != "queued":
                continue
            item = next(i for i in self.reg["items"] if i["id"] == t["registry_id"])
            if g["mode"] != "live":
                t["dry_run_at"] = self.today.isoformat(); self.event(key, "dry-run-send", f"would email {item['email']}"); res["dry"] += 1; continue
            if not live:
                self.event(key, "send-blocked", "needs registered sender, postal address and adapter secrets; stays queued"); res["awaiting"] += 1; continue
            if self.sends_since(1) >= lim["max_sends_per_day"] or self.sends_since(7) >= lim["max_sends_per_week"] or self.sends_since(7) - self.main_sends_week() >= self.cfg["max_sends_per_week"]:
                self.event(key, "rate-limited", "daily or weekly cap reached; stays queued"); res["capped"] += 1; continue
            text = (OUT / "packets" / "intro" / f"{item['id']}.md").read_text().split("\n\n", 1)[1]
            try:
                self.deliver(item["email"], self.prof["segments"][t["segment"]]["subject"], text)
                t["state"], t["last_contact"] = "sent", self.today.isoformat(); self.event(key, "sent", "delivered through sender adapter"); res["sent"] += 1
            except Exception as e:  # recorded, never swallowed
                self.event(key, "send-failed", f"{type(e).__name__}: {e}")
        return res

    def main_sends_week(self):
        cut = self.today - datetime.timedelta(days=7)
        return sum(1 for t in self.main_state["targets"].values() for e in t.get("events", []) if e["event"] in ("sent", "followup-sent") and base.parse_day(e["at"]) > cut)

    def followups(self):
        due, lim = 0, self.gate["limits"]
        for key, t in self.state["targets"].items():
            if t["state"] != "sent" or t.get("replied"):
                continue
            done = t.get("followups", 0)
            age = (self.today - base.parse_day(t["last_contact"])).days
            if done >= lim["max_followups"]:
                if age >= lim["followup_days"][-1] + 14:
                    t["state"] = "closed"; self.event(key, "closed", "no reply after the last follow-up")
                continue
            if age >= lim["followup_days"][min(done, len(lim["followup_days"]) - 1)]:
                if self.gate["kill"] or self.gate["mode"] != "live":
                    self.event(key, "followup-due", "dry-run or kill: not sent"); due += 1; continue
                item = next(i for i in self.reg["items"] if i["id"] == t["registry_id"])
                try:
                    self.deliver(item["email"], "Following up", self.prof["followup"] + "\n\n" + self.prof["signoff"] + "\n\nReply \"stop\" and this organization will not be contacted again.\n")
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
        item = next(i for i in self.reg["items"] if i["id"] == t["registry_id"])
        t["replied"] = True
        self.event(key, "reply:" + kind, note)
        if kind in ("opt-out", "bounce"):
            for e in ({"domain": domain(item["url"])} if kind == "opt-out" else {}, {"id": key}):
                if e:
                    self.supp["entries"].append({**e, "reason": f"{kind} reply", "at": self.today.isoformat()})
            item["outreach"] = False; t["state"] = "suppressed"
        elif kind == "rejected":
            item["outreach"] = False; t["state"] = "rejected"
        elif kind in ("accepted", "meeting"):
            t["state"] = "accepted"
        else:
            t["state"] = "replied"

    # ---------------------------------------------------------------- status
    def metrics(self):
        c = {s: 0 for s in STATES}
        for t in self.state["targets"].values():
            c[t["state"]] += 1
        ev = [e for t in self.state["targets"].values() for e in t.get("events", [])]
        return {"intro_prospects": len(self.state["targets"]), **{f"intro_state_{k}": v for k, v in c.items()},
                "intro_sent_total": sum(e["event"] == "sent" for e in ev),
                "intro_replies_total": sum(1 for t in self.state["targets"].values() if t.get("replied")),
                "intro_meetings_total": sum(e["event"] == "reply:meeting" for e in ev),
                "intro_awaiting_person_reply": sum(1 for t in self.state["targets"].values() if t["state"] in ("replied", "accepted"))}

    def write_status(self):
        m = self.metrics()
        s = self.gate["sender"]
        blockers = [n for n, ok in (("sender-identity", s["registered"]), ("postal-address", bool(s.get("postal_address"))), ("mode-live", self.gate["mode"] == "live"), ("kill-off", not self.gate["kill"])) if not ok]
        jdump(OUT / "intro-status.json", {"generated": self.today.isoformat(), "mode": self.gate["mode"], "kill": self.gate["kill"], "live_blockers": blockers, "metrics": m,
                                         "targets": [{"key": k, "name": t["name"], "segment": t["segment"], "state": t["state"], "last_event": (t.get("events") or [{}])[-1].get("event")} for k, t in sorted(self.state["targets"].items())]})
        return m

    def save(self):
        jdump(OUT / "intro-state.json", self.state)
        jdump(OUT / "prospects.json", self.reg)
        jdump(OUT / "suppression.json", self.supp)
        if self.log:
            with open(OUT / "log.jsonl", "a") as f:
                for e in self.log:
                    f.write(json.dumps(e, ensure_ascii=False) + "\n")


def run(today, fetch=http_fetch, contact=True):
    e = Intro(today, fetch)
    new = e.discover()
    e.resolve()
    e.refresh_status()
    queued, res, due = 0, {}, 0
    if contact:
        e.packets(); queued = e.queue(); res = e.send(); due = e.followups()
    m = e.write_status()
    e.save()
    return {"new": new, "queued": queued, "send": res, "followups_due": due, "mode": e.gate["mode"], "kill": e.gate["kill"], "metrics": m}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["run", "status", "add", "reply"])
    ap.add_argument("a", nargs="?")
    ap.add_argument("b", nargs="?")
    ap.add_argument("c", nargs="?")
    ap.add_argument("--segment")
    ap.add_argument("--kind")
    ap.add_argument("--note", default="")
    ap.add_argument("--today")
    a = ap.parse_args(argv)
    today = base.parse_day(a.today) if a.today else datetime.date.today()
    if a.cmd == "add":
        reg = jload(OUT / "prospects.json", {"items": []})
        prof = jload(OUT / "intro-profile.json")
        if a.segment not in prof["segments"]:
            raise SystemExit(f"segment must be one of {sorted(prof['segments'])}")
        if any(i["id"] == a.a for i in reg["items"]):
            raise SystemExit(f"{a.a} already exists")
        reg["items"].append({"id": a.a, "segment": a.segment, "name": a.b, "url": a.c, "status": "unresolved"})
        jdump(OUT / "prospects.json", reg)
        print(json.dumps({"added": a.a}))
        return 0
    if a.cmd == "reply":
        e = Intro(today)
        e.record_reply(a.a, a.kind, a.note)
        e.write_status(); e.save()
        print(json.dumps({"recorded": a.a, "kind": a.kind}))
        return 0
    print(json.dumps(run(today, contact=a.cmd == "run"), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
