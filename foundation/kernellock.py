# SPDX-License-Identifier: LicenseRef-Ultrastable
# KERNEL-LOCK-1 (ZHC-R8, R9): the kernel is written once, in seed/; each tenant pins the kernel it runs.
#   python3 -m foundation kernellock --check   every non-retired tenant has a row, one canary, pins are tree hashes of seed/ or null
#   python3 -m foundation kernellock --hash    the tree hash of seed/ at HEAD (what a pin names)
#   python3 -m foundation kernellock --status  per tenant: pinned to current, behind, or unpinned; the canary is listed first
import json, re, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = "doctrine/kernel-lock.json"
HASH = re.compile(r"^[0-9a-f]{40}$")


def load(root=ROOT):
    return json.loads((Path(root) / LOCK).read_text())


def kernel_hash(root=ROOT, ref="HEAD"):
    r = subprocess.run(["git", "rev-parse", f"{ref}:seed"], cwd=root, capture_output=True, text=True)
    if r.returncode != 0: raise RuntimeError("cannot read the seed/ tree: " + r.stderr.strip()[:120])
    return r.stdout.strip()


def live_tenants(root=ROOT):
    t = json.loads((Path(root) / "doctrine" / "tenant-repos.json").read_text())["tenants"]
    return sorted(k for k, v in t.items() if v.get("state") != "retired")


def check(root=ROOT):
    lock, errs = load(root), []
    rows = lock.get("tenants", {})
    for t in live_tenants(root):
        if t not in rows: errs.append(f"tenant {t} has no row in {LOCK}")
    for t, v in rows.items():
        if v.get("pin") is not None and not HASH.match(str(v["pin"])): errs.append(f"{t}: pin {v['pin']!r} is not a tree hash or null")
    if lock.get("canary") not in rows: errs.append("canary must name a tenant row")
    return errs


def status(root=ROOT, current=None):
    lock, cur = load(root), current or kernel_hash(root)
    out = []
    for t, v in sorted(lock["tenants"].items(), key=lambda kv: (kv[0] != lock.get("canary"), kv[0])):
        p = v.get("pin")
        out.append({"tenant": t, "canary": t == lock.get("canary"), "state": "unpinned" if p is None else "current" if p == cur else "behind"})
    return out


def main(argv=None):
    a = list(argv or [])
    if "--hash" in a: print(kernel_hash()); return 0
    if "--status" in a:
        for r in status(): print(f"{r['tenant']}: {r['state']}{' (canary)' if r['canary'] else ''}")
        return 0
    errs = check(); print("\n".join(errs) if errs else "kernellock ok"); return 1 if errs else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
