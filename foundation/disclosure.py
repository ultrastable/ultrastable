# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DISCLOSE-1: no new specification text on the public branch.

`python3 -m foundation disclosure --check` fails when specs/ holds a US-SPEC file that is not in the
shrink-only baseline in doctrine/disclosure.json. Full specification text belongs in ultrastable/ops spec/.
"""
import argparse, glob, json, os, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def check(root=ROOT):
    cfg = json.loads((root / "doctrine" / "disclosure.json").read_text())
    have = {os.path.basename(p) for p in glob.glob(str(root / cfg["public_spec_dir"] / "US-SPEC-*.md"))}
    return sorted(have - set(cfg["baseline"]))


# Each specification tool run against an empty specification directory (the public CI case) must exit without a traceback and must say it measured
# nothing; a clean pass on no text is a false pass. A tool that wrote a file is a failure too: the conformance manifest was once overwritten by an empty one.
TOOLS = [
    (["python3", "workers/tools/spec_truth.py", "--code-dir", "workers"], "unmeasured"),
    (["python3", "workers/tools/req_ids.py", "--code-dir", "workers"], "unmeasured"),
    (["python3", "workers/tools/spec_backlog.py", "--summary"], "unmeasured"),
    (["node", "core/conformance/cli.js", "--write"], "unmeasured"),
]


def tooling(root=ROOT):
    """Problems found running every specification tool with no specification text; [] when each one reports unmeasured and none crashes or writes."""
    bad = []
    manifest = root / "workers" / "core" / "conformance" / "manifest.json"
    before = manifest.read_bytes() if manifest.is_file() else None
    with tempfile.TemporaryDirectory(prefix="us-empty-spec-") as empty:
        env = {k: v for k, v in os.environ.items() if k not in ("ULTRASTABLE_SPEC_DIR", "US_SPEC_DIR")}
        for cmd, word in TOOLS:
            full = cmd + ["--spec-dir", empty]
            cwd = root / "workers" if cmd[0] == "node" else root
            try:
                r = subprocess.run(full, cwd=cwd, env=env, capture_output=True, text=True, timeout=120)
            except (OSError, subprocess.TimeoutExpired) as e:
                bad.append(f"{' '.join(cmd[:2])}: could not run ({e})")
                continue
            out = r.stdout + r.stderr
            if "Traceback" in out or "at file:///" in out:
                bad.append(f"{' '.join(cmd[:2])}: crashed without specification text")
            elif word not in out:
                bad.append(f"{' '.join(cmd[:2])}: did not report {word} (a pass on no text is a false pass)")
    after = manifest.read_bytes() if manifest.is_file() else None
    if before != after:
        if before is not None:
            manifest.write_bytes(before)
        bad.append("workers/core/conformance/manifest.json was rewritten from an empty specification directory")
    return bad


def main(argv=None):
    ap = argparse.ArgumentParser(prog="disclosure")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--tooling", action="store_true", help="run every specification tool with no specification text and require it to say unmeasured")
    a = ap.parse_args(argv)
    if a.tooling:
        bad = tooling()
        for b in bad:
            print(f"DISCLOSE-1: {b}", file=sys.stderr)
        print("disclosure tooling ok: every specification tool reports unmeasured without the text" if not bad else f"disclosure tooling: {len(bad)} problem(s)")
        return 1 if bad else 0
    new = check()
    for f in new:
        print(f"DISCLOSE-1: specs/{f} is new specification text on a public branch; it belongs in ultrastable/ops spec/", file=sys.stderr)
    print("disclosure ok" if not new else f"disclosure: {len(new)} new spec file(s)")
    return 1 if new else 0


if __name__ == "__main__":
    sys.exit(main())
