# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""OUTREACH-1 (OL-20261115-11): the outreach lane learns which segment to approach next from the replies it gets. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation outreach --rank       segments in the order the next intro run queues them (UCB1 over recorded replies), as JSON
  python3 -m foundation outreach --selftest   the learner's invariants and the live data's invariants; exit 1 with the reasons when one fails
  python3 -m foundation outreach --check      same as --selftest (the name the checks use)

Learner: each segment in outreach/intro-profile.json is an arm. A pull is a prospect of that segment that was contacted (event `sent`); its reward is the
best reply recorded for it (REWARD). The score is UCB1: mean reward + sqrt(2 ln N / n), so a segment nobody has contacted yet is tried first and a segment
that keeps getting no answer falls behind without ever being dropped. Nothing is stored: the order is computed from outreach/intro-state.json on every run,
so a recorded reply changes the next queue with no second write.

Consumer: scripts/outreach_intro.py `queue()` orders packet-ready prospects by this rank before it applies max_new_per_run. Flow: `outreach-send` in
doctrine/flows.json (outflow outreach.sent to the world, returning signal outreach.replies; its feedback line names this learner).
The gate (outreach/gate.json: kill switch, dry-run default, caps, suppression) is not this module's to change; it only orders what the gate allows.
"""
from __future__ import annotations
import json, math, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
STATE, PROFILE, GATE, SUPPRESSION, PROSPECTS = "outreach/intro-state.json", "outreach/intro-profile.json", "outreach/gate.json", "outreach/suppression.json", "outreach/prospects.json"
# What a reply is worth to the learner. A meeting or an acceptance is the outcome the lane exists for; a question or an acknowledgement shows the message
# reached someone it was relevant to; a rejection, an opt-out or a bounce is a pull that returned nothing (and the gate, not the learner, stops further contact).
REWARD = {"accepted": 1.0, "meeting": 1.0, "question": 0.6, "ack": 0.3, "rejected": 0.0, "opt-out": 0.0, "bounce": 0.0}
SENT = ("sent",)


def _load(root, rel, default):
    p = Path(root) / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def stats(targets: dict, segments) -> dict:
    """Per segment: pulls (prospects contacted) and reward (sum of each contacted prospect's best reply). A reply to a prospect with no send (a dry run) counts for nothing."""
    out = {s: {"pulls": 0, "reward": 0.0, "replies": 0} for s in segments}
    for t in targets.values():
        seg = t.get("segment")
        events = [e.get("event", "") for e in t.get("events", [])]
        if seg not in out or not any(e in SENT for e in events):
            continue
        out[seg]["pulls"] += 1
        got = [REWARD[e[6:]] for e in events if e.startswith("reply:") and e[6:] in REWARD]
        if got:
            out[seg]["reward"] += max(got); out[seg]["replies"] += 1
    return out


def rank(targets: dict, segments) -> list[dict]:
    """Segments, best first. An untried segment scores infinity (explored first, in name order); ties keep name order so the result is deterministic."""
    st = stats(targets, segments)
    total = sum(v["pulls"] for v in st.values())
    rows = []
    for seg in sorted(st):
        n, r = st[seg]["pulls"], st[seg]["reward"]
        mean = r / n if n else None
        score = math.inf if not n else mean + math.sqrt(2 * math.log(total) / n)
        rows.append({"segment": seg, "pulls": n, "replies": st[seg]["replies"], "mean_reward": None if mean is None else round(mean, 4), "ucb1": None if score == math.inf else round(score, 4), "_score": score})
    rows.sort(key=lambda x: (-x["_score"], x["segment"]))
    for i, x in enumerate(rows):
        x["rank"] = i; del x["_score"]
    return rows


def order(root=REPO, targets: dict | None = None, segments=None) -> dict:
    """{segment: rank} for the queue. Read from the live files unless the caller (the intro run, which holds unsaved state) passes its own."""
    root = Path(root)
    if segments is None:
        segments = list(_load(root, PROFILE, {"segments": {}})["segments"])
    if targets is None:
        targets = _load(root, STATE, {"targets": {}})["targets"]
    return {x["segment"]: x["rank"] for x in rank(targets, segments)}


def selftest(root=REPO) -> list[str]:
    bad = []
    def T(seg, *events):
        return {"segment": seg, "events": [{"event": e} for e in events]}
    segs = ["a", "b", "c"]
    # 1. nothing sent yet: every segment is untried, so the order is by name and no score is invented
    r = rank({}, segs)
    if [x["segment"] for x in r] != segs or any(x["ucb1"] is not None for x in r):
        bad.append("learner: with no sends the order must be the segment names and no score")
    # 2. an untried segment is explored before any tried one, whatever the tried ones earned
    r = rank({"1": T("a", "sent", "reply:meeting"), "2": T("b", "sent")}, segs)
    if r[0]["segment"] != "c":
        bad.append("learner: an untried segment must be queued first")
    # 3. replies reward a segment: equal pulls, the one that got a meeting ranks above the one that got nothing
    world = {"1": T("a", "sent"), "2": T("a", "sent"), "3": T("b", "sent", "reply:meeting"), "4": T("b", "sent"), "5": T("c", "sent", "reply:ack"), "6": T("c", "sent")}
    r = [x["segment"] for x in rank(world, segs)]
    if r != ["b", "c", "a"]:
        bad.append(f"learner: a rewarded segment must rank above an unrewarded one with the same pulls (got {r})")
    # 4. exploration: a segment contacted once with no reply is still ahead of one contacted many times with a low mean
    many = {str(i): T("a", "sent", *(["reply:ack"] if i == 0 else [])) for i in range(40)}
    many["x"] = T("b", "sent")
    if rank(many, ["a", "b"])[0]["segment"] != "b":
        bad.append("learner: the exploration term must keep a rarely tried segment ahead of a heavily tried weak one")
    # 5. a reply with no send (dry run) and an unknown reply kind earn nothing; the best reply of a prospect counts once
    s = stats({"1": T("a", "dry-run-send", "reply:meeting"), "2": T("a", "sent", "reply:ack", "reply:meeting", "reply:bogus")}, ["a"])
    if s["a"] != {"pulls": 1, "reward": 1.0, "replies": 1}:
        bad.append(f"learner: only contacted prospects count, once, at their best reply (got {s['a']})")
    # live data: the learner can only order what exists, and the gate fields it must never override are present
    prof = _load(root, PROFILE, None); state = _load(root, STATE, {"targets": {}}); gate = _load(root, GATE, None); reg = _load(root, PROSPECTS, {"items": []})
    if not prof or not prof.get("segments"):
        bad.append(f"{PROFILE}: no segments")
    else:
        for i in reg.get("items", []):
            if i.get("segment") not in prof["segments"]:
                bad.append(f"{PROSPECTS}: {i.get('id')} has segment {i.get('segment')!r}, which the profile does not define")
        for k, t in state["targets"].items():
            if t.get("segment") not in prof["segments"]:
                bad.append(f"{STATE}: {k} has segment {t.get('segment')!r}, which the profile does not define")
        if sorted(order(root)) != sorted(prof["segments"]):
            bad.append("order(): must rank every profile segment exactly once")
    if not gate or not isinstance(gate.get("kill"), bool) or gate.get("mode") not in ("dry-run", "live") or "limits" not in gate:
        bad.append(f"{GATE}: needs kill (true or false), mode (dry-run or live) and limits; the learner never runs without the gate")
    supp = {e.get("id") for e in _load(root, SUPPRESSION, {"entries": []}).get("entries", [])}
    for k, t in state["targets"].items():
        if k in supp and t.get("state") in ("queued", "packet-ready", "sent"):
            bad.append(f"{STATE}: {k} is suppressed but still {t['state']}")
    return bad


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if argv[:1] == ["--rank"]:
        root = REPO
        print(json.dumps(rank(_load(root, STATE, {"targets": {}})["targets"], list(_load(root, PROFILE, {"segments": {}})["segments"])), indent=1))
        return 0
    bad = selftest()
    print("\n".join(bad) or "outreach ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
