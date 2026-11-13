"""Outreach egress for agent directories and registries.

Server-side only: runs as a plain function with injected fetch. Every send is
staged and gated: nothing leaves while the outreach gate is dry-run, and every
packet is validated for completeness before it could ever be sent.
"""

import json
import os

GATE_ENV = "OUTREACH_GATE"
DRY_RUN = "dry-run"


def load_directories(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def validate_packet(entry, endpoint):
    missing = [r for r in entry.get("requires", []) if not endpoint.get(r)]
    if missing:
        raise ValueError("incomplete packet for %s: missing %s" % (entry.get("id"), ", ".join(missing)))
    if not entry.get("submission_route") or not entry.get("status"):
        raise ValueError("incomplete packet for %s" % entry.get("id"))
    return True


def gate_is_live(gate_value=None):
    value = gate_value if gate_value is not None else os.environ.get(GATE_ENV, DRY_RUN)
    return value == "live"


def build_submissions(directories):
    endpoint = directories["endpoint"]
    submissions = []
    for entry in directories.get("directories", []):
        validate_packet(entry, endpoint)
        submissions.append({
            "directory": entry["id"],
            "route": entry["submission_route"],
            "packet": {k: endpoint[k] for k in entry.get("requires", [])},
        })
    return submissions


def publish(directories, fetch=None, gate_value=None):
    """Attempt automated acquisition of each listing surface.

    Returns a ledger of attempts. When the gate is not live, every attempt is
    staged as a dry run: fetch is never called and no packet is sent.
    """
    submissions = build_submissions(directories)
    live = gate_is_live(gate_value)
    ledger = []
    for sub in submissions:
        if live and fetch is not None:
            result = fetch(sub["route"], sub["packet"])
            ledger.append({"directory": sub["directory"], "sent": True, "result": result})
        else:
            ledger.append({"directory": sub["directory"], "sent": False, "staged": True})
    return {"gate": "live" if live else DRY_RUN, "attempts": ledger}


def main(directories_path="outreach/agent-directories.json", fetch=None, gate_value=None):
    return publish(load_directories(directories_path), fetch=fetch, gate_value=gate_value)


if __name__ == "__main__":
    print(json.dumps(main(), indent=2))
