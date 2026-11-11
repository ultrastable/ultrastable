"""CLI. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation new-system --manifest instances/<slug>/instance.json --out ../<slug> [--apply]
  python3 -m foundation validate --manifest FILE
  python3 -m foundation ladder            # credential ladder against this machine
  python3 -m foundation filing --manifest FILE
  python3 -m foundation selfhost [--verify|--gaps|--no-node] [--db PATH]   Ultrastable boots its own organization from this repo
"""
import argparse, datetime as dt, json, sys

from . import doctrine, filing, ladder, manifest as mf, scaffold, selfhost


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="foundation", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new-system"); n.add_argument("--manifest", required=True); n.add_argument("--out", required=True); n.add_argument("--apply", action="store_true"); n.add_argument("--date")
    v = sub.add_parser("validate"); v.add_argument("--manifest", required=True)
    sub.add_parser("ladder")
    d = sub.add_parser("doctrine"); g = d.add_mutually_exclusive_group(required=True); g.add_argument("--apply", action="store_true"); g.add_argument("--check", action="store_true")
    h = sub.add_parser("selfhost"); h.add_argument("--verify", action="store_true"); h.add_argument("--gaps", action="store_true"); h.add_argument("--no-node", action="store_true"); h.add_argument("--db")
    f = sub.add_parser("filing"); f.add_argument("--manifest", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "ladder":
        print(json.dumps(ladder.acquire_all(), indent=2)); return 0
    if a.cmd == "selfhost":
        if a.gaps:
            print(json.dumps(selfhost.gaps_report(), indent=2)); return 0
        if a.verify:
            bad = selfhost.verify()
            print("\n".join(bad) or "selfhost ok"); return 1 if bad else 0
        rep = selfhost.boot(db_path=a.db, node=not a.no_node)
        print(json.dumps(rep, indent=2))
        if rep["status"] == "ok":
            print(rep["tick"]["report"])
        return 0 if rep["status"] == "ok" else 1
    if a.cmd == "doctrine":
        if a.apply:
            print("injected into:", doctrine.apply() or "nothing (already consistent)")
        bad = doctrine.check()
        print("\n".join(bad) or "doctrine ok")
        return 1 if bad else 0
    raw = mf.load(a.manifest)
    if a.cmd == "validate":
        p = mf.validate(raw)
        print("\n".join(p) or "manifest ok"); return 1 if p else 0
    if a.cmd == "filing":
        print(json.dumps(filing.plan(mf.resolve(raw)), indent=2)); return 0
    rep = scaffold.generate(raw, a.out, a.date or dt.date.today().isoformat(), apply=a.apply)
    print(json.dumps(rep, indent=2))
    return 0 if rep["status"] == "ok" else 2


if __name__ == "__main__":
    sys.exit(main())
