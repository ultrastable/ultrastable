"""CLI. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation new-system --manifest instances/<slug>/instance.json --out ../<slug> [--apply]
  python3 -m foundation validate --manifest FILE
  python3 -m foundation ladder            # credential ladder against the host it runs on
  python3 -m foundation standards [--check|--apply]   agentic standards register, surfaces, conformance lint
  python3 -m foundation filing --manifest FILE
  python3 -m foundation launch [--commit --push | --probe | --export-d1 F | --install SURFACE | --failover [--decide]]   start the loops on this repo (server-side hosts only)
  python3 -m foundation liveness [--json|--check|--file-items|--static|--probe ID]   are the autonomous loops actually running (evidence, not files)
  python3 -m foundation serverside [--check|--scan]                       server-side only: no host, scheduler, agent or route on a person's computer
  python3 -m foundation selfhost [--verify|--gaps|--no-node] [--db PATH]   Ultrastable boots its own organization from this repo
  python3 -m foundation glossary [--check|--apply|--show [ID]]            the owner's keywords, with tests, code and lineage
  python3 -m foundation loops [--verify|--list]                           the loop registry and its closing verifier
  python3 -m foundation kernel [--check|--lint FILE...|--metrics FILE...] the doctrine kernel as code
  python3 -m foundation directive [--check|--lint FILE...|--ledger|--probe|--bootstrap] the guiding directive as code
  python3 -m foundation docs_audit [--check|--report|--orphans|--humans]  every document must have a consumer (code, check, instruction import, generator)
  python3 -m foundation trust [--show|--event SURFACE ACTION EVENT|--tick] the trust ledger and ladder
  python3 -m foundation executor [--apply] [--issue N]                    pick the top issue, change, check, open a PR (--pick, --record: the key-free session route)
  python3 -m foundation upstream contract|adopt|sync|check|drift|leaks   core/instance link: pin, flow down, send up, drift, bring your own repo
  python3 -m foundation sessions [--scan|--apply|--meta|--check]       SESSION-CLOSE-1: no zombie branches or PRs; the loop tunes itself
  python3 -m foundation orphans [--check|--metrics|--baseline|--issue-body|--sync-issue OWNER/REPO]   ORPHANS-1: no orphan artifact, no human-wait
  python3 -m foundation components [--check|--report|--file-gaps|--evidence|--probe KIND:ID]   the system as a computed graph: gaps, stories, objections
  python3 -m foundation lifecycle [--open|--beat|--close|--reap|--check|--improve|--score|--report|--hooks]   no zombie sessions; loops that score and mutate themselves
  python3 -m foundation triggers [--check|--sync|--plan]   time (cron heartbeat) and event (webhook) triggers, drift-checked
  python3 -m foundation team [--gate|--check|--apply|--recommend --manifest F]   the phased virtual team (doctrine/team.json)
  python3 -m foundation pins [--check|--apply|--report]                  PINS-1: every status pin and roadmap item on the site is computed from code, proofs and issues
  python3 -m foundation failure_audit [--run|--check]                    FAILURE-AUDIT-1: live detectors for every failure mode; failures file their own issues
  python3 -m foundation writeback record|check|outputs                    knowledge write-back into the repository
"""
import argparse, datetime as dt, json, os, sys

from . import boundary, closedloop, standards, doctrine, directive, filing, glossary, kernel, ladder, loops, manifest as mf, scaffold, selfhost, trust, writeback


def main(argv=None) -> int:
    import sys as _s
    _av = _s.argv[1:] if argv is None else list(argv)
    if _av[:1] == ["pins"]:
        from . import pins
        return pins.main(_av[1:])
    if _av[:1] == ["failure_audit"]:
        from . import failure_audit
        return failure_audit.main(_av[1:])
    if _av[:1] == ["queue"]:
        from . import queue
        return queue.main(_av[1:])
    if _av[:1] == ["fleet"]:
        from . import fleet
        return fleet.main(_av[1:])
    if _av[:1] == ["transparency"]:
        from . import transparency
        return transparency.main(_av[1:])
    if _av[:1] == ["components"]:
        from . import components
        return components.main(_av[1:])
    if _av[:1] == ["lifecycle"]:
        from . import lifecycle
        return lifecycle.main(_av[1:])
    if _av[:1] == ["triggers"]:
        from . import triggers
        return triggers.main(_av[1:])
    if _av[:1] == ["team"]:
        from . import team
        return team.main(_av[1:])
    if _av[:1] == ["scout"]:
        from . import scout
        return scout.main(_av[1:])
    if _av[:1] == ["market"]:
        from . import market
        return market.main(_av[1:])
    if _av[:1] == ["boundary"]:
        return boundary.main(_av[1:])
    if _av[:1] == ["closedloop"]:
        return closedloop.main(_av[1:])
    if _av[:1] == ["liveness"]:
        from . import liveness
        return liveness.main(_av[1:])
    if _av[:1] == ["serverside"]:
        from . import serverside
        return serverside.main(_av[1:])
    args0 = sys.argv[1:] if argv is None else list(argv)
    if args0[:1] == ["sessions"]:
        from . import sessions
        return sessions.main(args0[1:])
    if args0[:1] == ["orphans"]:
        from . import orphans
        return orphans.main(args0[1:])
    if args0[:1] == ["upstream"]:
        from . import upstream
        return upstream.main(args0[1:])
    ap = argparse.ArgumentParser(prog="foundation", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new-system"); n.add_argument("--manifest", required=True); n.add_argument("--out", required=True); n.add_argument("--apply", action="store_true"); n.add_argument("--date")
    v = sub.add_parser("validate"); v.add_argument("--manifest", required=True)
    sub.add_parser("ladder")
    d = sub.add_parser("doctrine"); g = d.add_mutually_exclusive_group(required=True); g.add_argument("--apply", action="store_true"); g.add_argument("--check", action="store_true")
    h = sub.add_parser("selfhost"); h.add_argument("--verify", action="store_true"); h.add_argument("--gaps", action="store_true"); h.add_argument("--no-node", action="store_true"); h.add_argument("--db")
    gl = sub.add_parser("glossary"); gl.add_argument("--check", action="store_true"); gl.add_argument("--apply", action="store_true"); gl.add_argument("--show", nargs="?", const="")
    lp = sub.add_parser("loops"); lp.add_argument("--verify", action="store_true"); lp.add_argument("--list", action="store_true")
    kn = sub.add_parser("kernel"); kn.add_argument("--check", action="store_true"); kn.add_argument("--lint", nargs="+"); kn.add_argument("--metrics", nargs="+")
    cl = sub.add_parser("closedloop"); cl.add_argument("rest", nargs="*")
    dv = sub.add_parser("directive"); dv.add_argument("--check", action="store_true"); dv.add_argument("--lint", nargs="+"); dv.add_argument("--ledger", action="store_true"); dv.add_argument("--probe", action="store_true"); dv.add_argument("--bootstrap", action="store_true")
    tr = sub.add_parser("trust"); tr.add_argument("--show", action="store_true"); tr.add_argument("--event", nargs=3, metavar=("SURFACE", "ACTION", "EVENT")); tr.add_argument("--tick", action="store_true")
    da = sub.add_parser("docs_audit"); da.add_argument("--check", action="store_true"); da.add_argument("--report", action="store_true"); da.add_argument("--orphans", action="store_true"); da.add_argument("--humans", action="store_true")
    ny = sub.add_parser("needsyou"); ny.add_argument("--check", action="store_true")
    ex = sub.add_parser("executor"); ex.add_argument("--apply", action="store_true"); ex.add_argument("--issue", type=int); ex.add_argument("--repo"); ex.add_argument("--pick", action="store_true"); ex.add_argument("--record", action="store_true"); ex.add_argument("--result"); ex.add_argument("--pr"); ex.add_argument("--detail"); ex.add_argument("--host")
    sub.add_parser("upstream", add_help=False)
    wb = sub.add_parser("writeback"); ws = wb.add_subparsers(dest="wcmd", required=True)
    rc = ws.add_parser("record"); rc.add_argument("--kind", required=True); rc.add_argument("--title", required=True); rc.add_argument("--body", required=True)
    for opt in ("session", "owner", "trigger", "probe", "term", "source"):
        rc.add_argument("--" + opt, default="")
    ck = ws.add_parser("check"); ck.add_argument("--base", default="origin/main"); ck.add_argument("--head", default="HEAD")
    ou = ws.add_parser("outputs"); ou.add_argument("dirs", nargs="+"); ou.add_argument("--ignore", action="append", default=[])
    st = sub.add_parser("standards"); sg = st.add_mutually_exclusive_group(required=True); sg.add_argument("--apply", action="store_true"); sg.add_argument("--check", action="store_true")
    f = sub.add_parser("filing"); f.add_argument("--manifest", required=True)
    r = sub.add_parser("autorun"); r.add_argument("--ticks", type=int, default=10); r.add_argument("--out", default=".selfhost/autorun"); r.add_argument("--public", action="store_true"); r.add_argument("--no-node", action="store_true")
    c = sub.add_parser("cockpit"); c.add_argument("--out", default=".selfhost/cockpit"); c.add_argument("--ticks", type=int, default=10); c.add_argument("--no-node", action="store_true")
    l = sub.add_parser("launch"); l.add_argument("--commit", action="store_true"); l.add_argument("--push", action="store_true"); l.add_argument("--probe", action="store_true"); l.add_argument("--export-d1"); l.add_argument("--install"); l.add_argument("--skip-outreach", action="store_true"); l.add_argument("--failover", action="store_true"); l.add_argument("--decide", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "docs_audit":
        from . import docs_audit
        return docs_audit.main([x for x in ("--check", "--report", "--orphans", "--humans") if getattr(a, x[2:])])
    if a.cmd == "needsyou":
        from . import needsyou
        return needsyou.main(["--check"] if a.check else [])
    if a.cmd == "executor":
        from . import executor
        return executor.main(sys.argv[2:] if argv is None else argv[1:])
    if a.cmd == "launch":
        from . import launch
        if a.probe:
            print(json.dumps(launch.probe_surfaces(), indent=2)); return 0
        if a.install:
            print(launch.install_artifact(a.install), end=""); return 0
        if a.export_d1:
            open(a.export_d1, "w", encoding="utf-8").write(launch.export_d1()); print("wrote", a.export_d1); return 0
        if a.failover:
            from . import failover
            host = os.environ.get("ULTRASTABLE_HOST", "unspecified")
            d = failover.decide(launch.REPO, host)
            print("failover:", json.dumps(d))
            if a.decide:  # the gate alone: say whether this host takes over, as a step output where one exists, and run nothing
                if os.environ.get("GITHUB_OUTPUT"):
                    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
                        f.write(f"run={'true' if d['run'] else 'false'}\n")
                return 0
            if not d["run"]:
                return 0
            os.environ["ULTRASTABLE_HOST"] = "failover:" + host
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
    if a.cmd == "glossary":
        if a.apply:
            print("regenerated:", glossary.apply() or "nothing (already current)")
        if a.show is not None:
            print(glossary.show(term_id=a.show or None)); return 0
        bad = glossary.check()
        print("\n".join(bad) or "glossary ok"); return 1 if bad else 0
    if a.cmd == "loops":
        if a.list:
            for l in loops.load()["loops"]:
                print(f"{l['id']:24} {l['kind']:10} owner={l['owner']:20} closes_by={l['closes_by']}")
        bad = loops.verify()
        print("\n".join(bad) or "loops ok"); return 1 if bad else 0
    if a.cmd == "kernel":
        if a.lint or a.metrics:
            found, n = [], 0
            for fn in a.lint or a.metrics:
                fs = kernel.lint(open(fn, encoding="utf-8").read()); n += 1
                found += [dict(x, file=fn) for x in fs]
            if a.metrics:
                print(json.dumps(kernel.metrics(found, n), indent=1)); return 0
            print("\n".join(f"{x['file']}:{x['line']}: {x['recognition']}: {x['text']}" for x in found) or "no recognitions fired"); return 1 if found else 0
        bad = kernel.check()
        print("\n".join(bad) or "kernel ok"); return 1 if bad else 0
    if a.cmd == "closedloop":
        return closedloop.main(a.rest)
    if a.cmd == "directive":
        if a.lint:
            found = [dict(x, file=fn) for fn in a.lint for x in directive.lint(open(fn, encoding="utf-8").read())]
            print("\n".join(f"{x['file']}:{x['line']}: {x['recognition']}: {x['text']}" for x in found) or "no owner-handback shapes"); return 1 if found else 0
        if a.ledger:
            led = directive.issue_ledger(); print(json.dumps(led, indent=1)); return 0 if led["balanced"] else 1
        if a.probe:
            rows = directive.probe_all(); print(f"{sum(r['ok'] for r in rows)}/{len(rows)} probes ok, evidence appended to doctrine/probe-log.jsonl"); return 0 if all(r["ok"] for r in rows) else 1
        if a.bootstrap:
            out = directive.bootstrap(); print("\n".join(out)); return 1 if any(x.startswith("MISSING") or " problems" in x for x in out) else 0
        bad = directive.check()
        print("\n".join(bad) or "directive ok"); return 1 if bad else 0
    if a.cmd == "trust":
        k, led = kernel.load(), trust.load()
        if a.event:
            print(json.dumps(trust.apply(led, *a.event, k))); trust.save(led)
        if a.tick:
            print("decayed:", trust.tick(led, k)); trust.save(led)
        print(json.dumps({"tick": led["tick"], "rows": led["rows"], "compounding_rate": trust.compounding_rate(led)}, indent=1)); return 0
    if a.cmd == "writeback":
        try:
            if a.wcmd == "record":
                print("recorded:", writeback.record(".", a.kind, a.title, a.body, session=a.session, owner=a.owner, trigger=a.trigger, probe=a.probe, term=a.term, source=a.source or "doctrine/glossary.json")); return 0
            bad = writeback.check(".", a.base, a.head) if a.wcmd == "check" else writeback.outputs(".", a.dirs, a.ignore)
        except ValueError as e:
            print("refused:", e); return 1
        print("\n".join(bad) or "writeback ok"); return 1 if bad else 0
    if a.cmd == "standards":
        if a.apply:
            print("docs/standards table updated" if standards.apply() else "docs/standards table already current")
        bad = standards.check()
        print("\n".join(bad) or "standards ok"); return 1 if bad else 0
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
