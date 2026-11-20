#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""AGENT-DIRECTORIES-1: one packet per agent directory, behind the outreach gate.

Reads outreach/agent-directories.json and outreach/gate.json. For every directory it builds the packet from the shared packet
fields the directory needs, checks that it is complete, writes outreach/packets/agent-directories/<id>.json and sets the
directory's status:
  packet-incomplete   a needed field is missing (named in `missing`); nothing else happens
  held-dry-run        packet complete; the gate is dry-run or kill is set, so nothing is published
  self-hosted         no submission exists: the discovery document on the site is the listing
  ready-workflow      gate live and the route is a workflow in this repository: the workflow publishes it
  awaiting-owner      gate live and the route is a form or a pull request to someone else's project: never submitted by an agent
Nothing in this script contacts a directory. Called from `scripts/outreach.py run`; also `python3 scripts/agent_directories.py [--check]`.
"""
import json, pathlib, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
ROUTES = {"workflow", "form", "pull-request", "self-hosted"}


def build(root=ROOT, write=True) -> dict:
    out = pathlib.Path(root) / "outreach"
    reg = json.loads((out / "agent-directories.json").read_text(encoding="utf-8"))
    gate = json.loads((out / "gate.json").read_text(encoding="utf-8"))
    live = gate.get("mode") == "live" and not gate.get("kill")
    shared, rows = reg["packet"], []
    for d in reg["directories"]:
        missing = [k for k in d["needs"] if not str(shared.get(k) or "").strip()]
        if d["route"] not in ROUTES:
            missing.append("route:" + str(d["route"]))
        packet = {"directory": d["id"], "submit_to": d["url"], "route": d["route"], **{k: shared[k] for k in d["needs"] if k in shared}}
        if missing:
            status = "packet-incomplete"
        elif d["route"] == "self-hosted":
            status = "self-hosted"
        elif not live:
            status = "held-dry-run"
        else:
            status = "ready-workflow" if d["route"] == "workflow" else "awaiting-owner"
        d["status"], d["missing"] = status, missing
        rows.append({"id": d["id"], "status": status, "missing": missing})
        if write and not missing:
            p = out / "packets" / "agent-directories" / (d["id"] + ".json")
            p.parent.mkdir(parents=True, exist_ok=True)
            text = json.dumps(packet, indent=1) + "\n"
            if not p.exists() or p.read_text(encoding="utf-8") != text:
                p.write_text(text, encoding="utf-8")
    if write:
        text = json.dumps(reg, indent=1) + "\n"
        if (out / "agent-directories.json").read_text(encoding="utf-8") != text:
            (out / "agent-directories.json").write_text(text, encoding="utf-8")
    return {"gate": "live" if live else ("kill" if gate.get("kill") else gate.get("mode")), "directories": rows, "published": 0}


def check(root=ROOT) -> list[str]:
    rep, bad = build(root, write=False), []
    for r in rep["directories"]:
        if r["missing"]:
            bad.append(f"{r['id']}: packet is missing {', '.join(r['missing'])}")
        if rep["gate"] != "live" and r["status"] in ("ready-workflow", "awaiting-owner"):
            bad.append(f"{r['id']}: status {r['status']} while the gate is {rep['gate']}")
    return bad


def main(argv) -> int:
    if "--check" in argv:
        bad = check()
        print("\n".join(bad) if bad else "agent directories ok")
        return 1 if bad else 0
    print(json.dumps(build(), indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
