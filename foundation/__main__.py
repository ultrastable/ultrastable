"""CLI. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation new-system --manifest instances/<slug>/instance.json --out ../<slug> [--apply]
  python3 -m foundation validate --manifest FILE
  python3 -m foundation ladder            # credential ladder against this machine
  python3 -m foundation filing --manifest FILE
  python3 -m foundation launch [--commit --push | --probe | --export-d1 F | --install SURFACE]   start the loops on this repo
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
    r = sub.add_parser("autorun"); r.add_argument("--ticks", type=int, default=10); r.add_argument("--out", default=".selfhost/autorun"); r.add_argument("--public", action="store_true"); r.add_argument("--no-node", action="store_true")
    c = sub.add_parser("cockpit"); c.add_argument("--out", default=".selfhost/cockpit"); c.add_argument("--ticks", type=int, default=10); c.add_argument("--no-node", action="store_true")
    l = sub.add_parser("launch"); l.add_argument("--commit", action="store_true"); l.add_argument("--push", action="store_true"); l.add_argument("--probe", action="store_true"); l.add_argument("--export-d1"); l.add_argument("--install"); l.add_argument("--skip-outreach", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "launch":
        from . import launch
        if a.probe:
            print(json.dumps(launch.probe_surfaces(), indent=2)); return 0
        if a.install:
            print(launch.install_artifact(a.install), end=""); return 0
        if a.export_d1:
            open(a.export_d1, "w", encoding="utf-8").write(launch.export_d1()); print("wrote", a.export_d1); return 0
        rec = launch.run_once(skip_outreach=a.skip_outreach)
        paths = launch.write_back(rec)
        print("\n".join(rec["report"])); print("evidence:", paths)
        if a.commit or a.push:
            res = launch.commit(paths, push=a.push); print("write-back:", json.dumps(res))
            if not res["ok"]:
                return 1
        return 0 if all(r["ok"] for r in rec["loops"]) else 1
    if a.cmd == "autorun":
        from . import autorun
        res = autorun.run(ticks=a.ticks, node=not a.no_node)
        if res["status"] != "ok":
            print(json.dumps(res, indent=2)); return 1
        for t in res["log"]["ticks"]:
            print("\n".join(t["report"]), "\n")
        print("wrote", [str(a.out + "/" + n) for n in autorun.write(res, a.out, a.public)]); return 0
    if a.cmd == "cockpit":
        from . import cockpit
        print("wrote", cockpit.write(a.out, ticks=a.ticks, node=not a.no_node)); return 0
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
