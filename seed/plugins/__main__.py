"""python3 -m plugins <command>   (run from the seed root)
  list                          plugins, roles, what each may reach
  check                         the core-vs-plugin boundary lint
  self [--write|--check]        the self-description loop
  communicate [--answers FILE]  guided 'what do you want to communicate' flow; writes comms/brief.json
  tick [--config FILE]          run the four role loops once (dry-run unless the config says live)
"""
import argparse, json, os, sys
from pathlib import Path
from . import scopecheck
from .api import SCOPE, Runtime
from .communicate import plugin as comm
from .selfdescribe import plugin as selfd
from . import loops

ROOT = Path(__file__).resolve().parent.parent


def main(argv=None):
    ap = argparse.ArgumentParser(prog="plugins"); sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list"); sub.add_parser("check")
    s = sub.add_parser("self"); g = s.add_mutually_exclusive_group(required=True); g.add_argument("--write", action="store_true"); g.add_argument("--check", action="store_true")
    c = sub.add_parser("communicate"); c.add_argument("--answers")
    t = sub.add_parser("tick"); t.add_argument("--config")
    a = ap.parse_args(argv)
    if a.cmd == "list":
        for n, sp in SCOPE["plugins"].items(): print(f"{n:13} role={sp['role']:15} may: {', '.join(sp['classes'])}")
        return 0
    if a.cmd == "check": return scopecheck.main()
    if a.cmd == "self":
        if a.write: selfd.write(ROOT); print("wrote self/SELF.md and self/self.json"); return 0
        bad = selfd.check(ROOT); print("\n".join(bad) or "self-description current"); return 1 if bad else 0
    if a.cmd == "communicate":
        answers = json.loads(Path(a.answers).read_text()) if a.answers else comm.ask()
        r = comm.write(ROOT, answers)
        print("Still needed: " + ", ".join(r["gaps"]) if r["gaps"] else "Saved comms/brief.json. Plugins to enable by reviewed PR: " + (", ".join(r["brief"]["plugins_to_enable"]) or "none (draft only)"))
        return 1 if r["gaps"] else 0
    if a.cmd == "tick":
        cfg = json.loads(Path(a.config or ROOT / "plugins/plugins.config.template.json").read_text())
        rt = Runtime(cfg, state_dir=ROOT / "plugin-state", env=os.environ)
        print(loops.run_tick(rt, ROOT)["report"]); return 0


if __name__ == "__main__":
    sys.exit(main())
