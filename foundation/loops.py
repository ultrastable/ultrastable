"""Loop closure as code. Autonomy is self-referential loops plus the privilege to close them, so every loop the system runs is a row in
`instances/ultrastable/loop-registry.json` with a trigger, an owner, an SLA, a Definition of Done, at least two independent paths, a closing probe
and a write-back target in this repository. `verify` fails when any of that is missing or dead, when a workflow belongs to no loop, when
a role or process area has no loop, or when a loop's work or knowledge lives only outside the repository.

  python3 -m foundation loops --verify | --list
Enforces the owner directives that touch loops: FLEET-AUTONOMY-1 (closes_by system or a gate card), SLA-AND-PATHS-1 (SLA, Definition of
Done, two independent paths), FALLBACK-CLASSES-1 (fallback class), CREDENTIAL-ONE-SOURCE-1 (one source, live probe), PROACTIVE-PROGRAMS-1
(originate_to, orient, predict, lane).
"""
from __future__ import annotations
import json, re
from pathlib import Path
from . import selfhost

REPO = Path(__file__).resolve().parent.parent
PATH = "instances/ultrastable/loop-registry.json"
KINDS = {"tick", "manager", "staff", "review", "plussing", "probe", "funding", "outreach", "memory", "doctrine", "release", "reporting", "governance", "budget", "trust"}
CLASSES = {"free", "paid", "local", "external", "degraded"}
OUTSIDE = re.compile(r"https?://|/mnt/|\bchat\b|\bslack\b|\bnotion\b|\blinear\b|\bjira\b|tool memory|platform memory|\.selfhost", re.I)
SLA = re.compile(r"^\d+\s?(m|h|d|w|tick|ticks)\b")


def load(root=REPO) -> dict:
    return json.loads((Path(root) / PATH).read_text(encoding="utf-8"))


def _inside(rel: str) -> bool:
    return bool(rel) and not rel.startswith(("/", "~")) and ".." not in Path(rel).parts


def verify(root=REPO) -> list[str]:
    root, bad = Path(root), []
    reg = load(root)
    loops = reg["loops"]
    roles = {r["id"] for r in json.loads((root / "seed/ultrastable.json").read_text(encoding="utf-8"))["roles"]}
    areas = set(json.loads((root / "instances/ultrastable/selfhost.json").read_text(encoding="utf-8"))["required_areas"])
    creds = {}
    for c in reg.get("credentials", []):
        if c["binding"] in creds:
            bad.append(f"credential {c['binding']}: more than one source (one source per binding)")
        creds[c["binding"]] = c
        if not c.get("source") or not c.get("probe"):
            bad.append(f"credential {c['binding']}: needs one source and a live probe")
        elif not (root / c["source"]).exists():
            bad.append(f"credential {c['binding']}: source {c['source']} missing")
    ids = [l.get("id") for l in loops]
    for i in {x for x in ids if ids.count(x) > 1}:
        bad.append(f"loop id {i} is defined twice")
    claimed_wf, claimed_roles, claimed_areas = set(), set(), set()
    for l in loops:
        lid = l.get("id", "?")
        need = ("id", "kind", "summary", "trigger", "owner", "closes_by", "sla", "done", "paths", "closing_probe", "writeback", "system_path")
        for f in need:
            if not l.get(f):
                bad.append(f"{lid}: lacks {f}" + (" (a loop with no closing probe is an open loop)" if f == "closing_probe" else "") + (" (nowhere to write its knowledge back)" if f == "writeback" else ""))
        if l.get("kind") not in KINDS:
            bad.append(f"{lid}: kind {l.get('kind')!r} is not one of {sorted(KINDS)}")
        if l.get("owner") and l["owner"] != "system" and l["owner"] not in roles:
            bad.append(f"{lid}: owner {l['owner']} is not a role in seed/ultrastable.json")
        cb = l.get("closes_by", "")
        if cb != "system":
            if not cb.startswith("gate:") or not (root / cb[5:]).is_file():
                bad.append(f"{lid}: closes_by must be 'system' or 'gate:<owner card file>' that exists; got {cb!r}")
        if l.get("sla") and not SLA.match(l["sla"]):
            bad.append(f"{lid}: sla {l['sla']!r} is not a time bound like '10m', '1d', '1 tick'")
        paths = l.get("paths") or []
        if len({p.get("id") for p in paths}) < 2 or any(not p.get("how") or p.get("class") not in CLASSES for p in paths):
            bad.append(f"{lid}: needs at least two independent paths (distinct ids, each with how and a class in {sorted(CLASSES)})")
        else:
            classes = {p["class"] for p in paths}
            if classes & {"paid", "external"} and not classes & {"free", "local", "degraded"}:
                bad.append(f"{lid}: a paid or external path needs a free, local or degraded fallback class")
        if l.get("closing_probe"):
            try:
                if not selfhost.probe(root, l["closing_probe"]):
                    bad.append(f"{lid}: closing probe fails ({l['closing_probe']})")
            except ValueError as e:
                bad.append(f"{lid}: {e}")
        for rel in l.get("writeback", []):
            if not _inside(rel) or OUTSIDE.search(rel):
                bad.append(f"{lid}: write-back target {rel!r} is outside the repository")
            elif not (root / rel).exists():
                bad.append(f"{lid}: write-back target {rel} does not exist")
        for rel in l.get("system_path", []):
            if not _inside(rel) or not (root / rel).exists():
                bad.append(f"{lid}: system path {rel} does not exist in the repository")
        for text in (l.get("trigger", ""), l.get("summary", "")):
            if re.search(r"https?://|/mnt/|\bchat thread\b", text):
                bad.append(f"{lid}: work or knowledge described as living outside the repository ({text[:60]})")
        for wf in l.get("workflows", []):
            claimed_wf.add(wf)
            if not (root / ".github/workflows" / wf).is_file():
                bad.append(f"{lid}: workflow {wf} does not exist")
        for b in l.get("credentials", []):
            if b not in creds:
                bad.append(f"{lid}: credential binding {b} has no registered one source")
        if l.get("owner") in roles:
            claimed_roles.add(l["owner"]) if l["kind"] in ("manager", "staff", "review") else None
        if l.get("area"):
            claimed_areas.add(l["area"])
        pr = l.get("program")
        if pr:
            for f in ("orient", "originate_to", "predict_log", "lane"):
                if not pr.get(f):
                    bad.append(f"{lid}: program loop lacks {f} (orient, originate_to, predict_log, lane)")
            for rel in list(pr.get("orient", [])) + [pr.get("originate_to"), pr.get("predict_log")]:
                if rel and not (root / rel).exists():
                    bad.append(f"{lid}: program path {rel} does not exist")
    lp = root / "instances/ultrastable/loops.json"
    if lp.exists():
        claimed = {l.get("launch") for l in loops}
        for ll in json.loads(lp.read_text(encoding="utf-8")).get("loops", []):
            if ll["id"] not in claimed:
                bad.append(f"launch loop {ll['id']} (instances/ultrastable/loops.json) belongs to no registry loop (set its 'launch' field)")
    for wf in sorted((root / ".github/workflows").glob("*.yml")):
        if wf.name not in claimed_wf:
            bad.append(f"workflow {wf.name} belongs to no loop in {PATH}")
    for r in sorted(roles - claimed_roles):
        bad.append(f"role {r} has no manager, staff or review loop")
    for a in sorted(areas - claimed_areas):
        bad.append(f"process area '{a}' has no loop")
    return bad
