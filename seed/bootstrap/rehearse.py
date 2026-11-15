"""Bootstrap rehearsal driver: replay empty-repo -> unattended merged change.

Run on an executor tick or by driver order. Reads foundation/topology.py,
provisions fresh resources, executes each rehearsal stage, records every
failure and fix into ops/bootstrap-rehearsal/latest.json.

Platform steps are isolated in PLATFORM handlers so the same stage sequence
ports to another platform (PORT-EXEC-1).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from foundation import topology

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "ops" / "bootstrap-rehearsal" / "latest.json"

STAGES = [
    "1-topology",
    "2-roles-hired",
    "3-queue-seeded",
    "4-tick-deployed",
    "5-executor-deployed",
    "6-unattended-change",
    "7-ci-merge",
    "8-live-page",
    "9-record",
]


def _empty_record() -> dict:
    return {
        "item": "Q-SYS-BOOT-REHEARSAL",
        "run": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "topology": "foundation/topology.py",
        "idea": "A transparency-first worker collective that publishes its own live status and improves itself via queued executor ticks.",
        "stages": [],
        "merged_pr": None,
        "all_stages_passed": False,
        "porting_note": "Platform steps isolated in stage 2-5 handlers; topology and stage order are platform-neutral (PORT-EXEC-1).",
    }


def _run_stage(record: dict, name: str, handler, platform) -> None:
    entry = {"stage": name, "action": handler.__doc__ or "", "status": "pending",
             "failure": None, "fix": None}
    try:
        result = handler(platform, topology)
        entry["status"] = "passed"
        if result:
            entry.update(result)
    except Exception as exc:  # record, fix where possible, and surface
        entry["status"] = "failed"
        entry["failure"] = str(exc)
        fix = platform.remediation(name, exc)
        if fix:
            entry["fix"] = fix
            entry["status"] = "passed"
    record["stages"].append(entry)
    OUT.write_text(json.dumps(record, indent=2) + "\n")  # persist after every stage


def rehearse(platform) -> dict:
    """Execute the full rehearsal on a fresh repository and fresh resources."""
    OUT.parent.mkdir(parents=True, exist_ok=True)
    record = _empty_record()
    handlers = {
        "1-topology": platform.scaffold_from_topology,
        "2-roles-hired": platform.hire_roles,
        "3-queue-seeded": platform.seed_queue,
        "4-tick-deployed": platform.deploy_tick,
        "5-executor-deployed": platform.deploy_executor,
        "6-unattended-change": platform.execute_unattended_change,
        "7-ci-merge": platform.ci_and_merge,
        "8-live-page": platform.verify_live_page,
        "9-record": lambda p, t: {"action": "Record of stage failures and fixes is this file."},
    }
    for name in STAGES:
        _run_stage(record, name, handlers[name], platform)
    merges = [s for s in record["stages"] if s["stage"] == "7-ci-merge"]
    record["merged_pr"] = merges[0].get("merged_pr") if merges else None
    record["all_stages_passed"] = all(s["status"] == "passed" for s in record["stages"])
    OUT.write_text(json.dumps(record, indent=2) + "\n")
    if not record["all_stages_passed"]:
        raise RuntimeError("bootstrap rehearsal has failed stages; see latest.json")
    return record


if __name__ == "__main__":
    import sys

    from seed.bootstrap import platform_github_cloudflare as default_platform

    rehearse(default_platform.Platform(sys.argv[1:] or []))
