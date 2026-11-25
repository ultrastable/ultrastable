#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""CLONE-PATH-1: the person's side of starting a system from the template, with no terminal, key or file to edit.

A person who copied the template has one thing to give: the idea, in plain words. They type it into the form the repository itself offers
(.github/ISSUE_TEMPLATE/start.yml). The seed's own workflow (.github/workflows/bootstrap.yml) runs this module on the server:

  python3 bootstrap/intake.py --root . --from-env    write IDEA.md from the form (ISSUE_BODY, ISSUE_TITLE, ISSUE_USER, ISSUE_ASSOCIATION)
  python3 bootstrap/intake.py --root . --tell        say in plain words, on the person's own "Your system" thread, what happened and what the
                                                     system is doing about it (reads org/owner-status.json, written by bootstrap.py)
  python3 bootstrap/intake.py --root . --needs-run   exit 0 when the boot should run again (not live yet), 1 when the system is live

The person gave an idea, not a system test, so the four answers every system starts with are filled in from what the kernel itself does for it
(the same defaults the hosted front door uses: deploy/launch-apps.mjs `manifestOf`); the system's product manager replaces the measure once the
first readings exist. Stdlib only. Consumers: seed/tests/test_happy_path.py, .github/workflows/bootstrap.yml, bootstrap.py (`is_template`).
"""
from __future__ import annotations
import argparse, json, os, re, subprocess, sys
from pathlib import Path

TEMPLATE_MARKS = ("org_name: Example Co", "owner: Founder Name")  # the example the template ships with is never somebody's idea
OWNERS = {"OWNER", "MEMBER", "COLLABORATOR"}  # only the people who run the repository may give it its idea
THREAD = "Your system"
DEFAULT_USD = 5
STOP = set("a an the of in on for to and or that what which every by its as is are with it this each from into i we my want would like need".split())
# Words that mean the person is being handed a developer's job. No text a person reads may carry one (seed/tests/test_happy_path.py).
DEVELOPER_WORDS = ("terminal", "command line", "api key", "api token", " token", "secret", "wrangler", "git clone", "npx", "python3", "env var",
                   "environment variable", "config file", "workflow", "d1 ", "mint ", "paste", "install ")


def is_template(text: str) -> bool:
    return all(m in text for m in TEMPLATE_MARKS)


def developer_words(text: str) -> list[str]:
    low = " " + str(text or "").lower()
    return [w.strip() for w in DEVELOPER_WORDS if w in low]


def name_of(idea: str) -> str:
    words = [w for w in re.sub(r"[^A-Za-z0-9 ]+", " ", idea).split() if w.lower() not in STOP][:4]
    return (" ".join(words).strip().capitalize() or "New system")[:60]


def slug_of(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "system"


def parse_form(body: str) -> dict:
    """An issue form arrives as '### Question' headings, each followed by its answer. Free text with no headings is the idea itself."""
    parts = re.split(r"^###\s+(.+?)\s*$", str(body or ""), flags=re.M)
    if len(parts) < 3:
        return {"idea": str(body or "").strip()}
    out = {}
    for q, a in zip(parts[1::2], parts[2::2]):
        a = a.strip()
        if a in ("_No response_", ""):
            continue
        ql = q.lower()
        key = "budget" if ("cost" in ql or "month" in ql or "budget" in ql) else "name" if "call" in ql or "name" in ql else "idea"
        out.setdefault(key, a)
    return out


def idea_file(idea: str, name: str = "", owner: str = "", usd: float = DEFAULT_USD, hosted_by: str = "") -> str:
    idea = re.sub(r"\s+", " ", str(idea)).strip()[:1500]
    name = (name or name_of(idea)).strip()[:60]
    usd = f"{usd:g}"
    front = ["---", f"org_name: {name}", f"slug: {slug_of(name)}", f"owner: {owner or 'the person who asked for it'}"]
    if hosted_by:
        front.append(f"hosted_by: {hosted_by}")
    front += ["owner_contact: set-in-secret-store", "owner_contact_backup: set-in-secret-store", "workers_dev: true", "---", ""]
    return "\n".join(front + [
        "# Idea", "", idea, "",
        "# System test", "",
        "- Loop: its own clock measures the system, files what is wrong or missing and ships the fix, with no person in the middle",
        "- Measure: open work items past their deadline, target 0",
        "- Upkeep: new evidence, sources and requests from its owner keep arriving",
        f"- Run cost: {usd} USD a month for the back end", "",
        "# Who it is for", "", "- The person who asked for it and the people it serves", "",
        "# First outcomes", "",
        "- Do what the idea says and keep doing it",
        "- Check its own health every cycle and file its own repairs",
        f"- Stay inside {usd} USD a month", "",
        "# Constraints", "", f"- Budget per month: {usd} USD", ""])


def take(root: Path, body: str, user: str = "", association: str = "OWNER") -> dict:
    """Write IDEA.md from what the person typed. Returns {ok, say}: `say` is for the person, in plain words."""
    if association.upper() not in OWNERS:
        return {"ok": False, "say": "Only the people who run this project can give it its idea. Nothing was changed."}
    form = parse_form(body)
    idea = form.get("idea", "")
    if len(idea.split()) < 4:
        return {"ok": False, "say": "That is too short for the managers to start from. Say in a sentence or two what it should do and keep doing."}
    m = re.search(r"\d+(?:\.\d+)?", form.get("budget", ""))
    usd = float(m.group()) if m and float(m.group()) > 0 else DEFAULT_USD
    (root / "IDEA.md").write_text(idea_file(idea, form.get("name", ""), user, usd), encoding="utf-8")
    return {"ok": True, "say": "Got it. Your system is being set up from your words; nothing else is needed from you."}


def form_link(repo: str = "") -> str:
    repo = repo or os.environ.get("GITHUB_REPOSITORY", "")
    return f"https://github.com/{repo}/issues/new?template=start.yml" if repo else "https://ultrastable.io/start"


def status(root: Path) -> dict:
    p = root / "org" / "owner-status.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


def message(st: dict) -> str:
    parts = [st.get("say", "Your system is being set up."), st.get("doing", "")]
    if st.get("link"):
        parts.append(f"[{st.get('link_words', 'Open')}]({st['link']})")
    if st.get("live_url"):
        parts.append(f"It runs here: {st['live_url']}")
    parts.append("There is no code for you to write and no password to keep.")
    return "\n\n".join(x for x in parts if x)


def tell(root: Path, run=subprocess.run) -> dict:
    """One thread, kept current: the person reads what happened in one place. A refusal is recorded in the status file and never stops the boot."""
    st, repo = status(root), os.environ.get("GITHUB_REPOSITORY", "")
    if not st or not repo:
        return {"told": False, "why": "no status or no repository"}
    body = message(st)

    def gh(*args):
        r = run(["gh", *args], capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout or "").strip()[-200:])
        return r.stdout
    try:
        rows = json.loads(gh("issue", "list", "--repo", repo, "--state", "open", "--search", f'"{THREAD}" in:title', "--json", "number,title,body") or "[]")
        mine = next((x for x in rows if x["title"].startswith(THREAD)), None)
        if mine is None:
            gh("issue", "create", "--repo", repo, "--title", f"{THREAD}: {st.get('headline', 'status')}", "--body", body)
        elif mine.get("body") != body:  # idempotent: the same state twice says nothing new
            gh("issue", "edit", str(mine["number"]), "--repo", repo, "--title", f"{THREAD}: {st.get('headline', 'status')}", "--body", body)
        out = {"told": True}
    except Exception as e:  # recorded, not swallowed: the status file and the job log carry it, and the next run tells again
        out = {"told": False, "why": f"{type(e).__name__}: {e}"[:240]}
        print(f"::warning::could not update the owner's thread: {out['why']}")
    st["told"] = out
    (root / "org" / "owner-status.json").write_text(json.dumps(st, indent=1) + "\n", encoding="utf-8")
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--root", type=Path, default=Path("."))
    ap.add_argument("--from-env", action="store_true"); ap.add_argument("--tell", action="store_true"); ap.add_argument("--needs-run", action="store_true")
    a = ap.parse_args(argv)
    if a.from_env:
        r = take(a.root, os.environ.get("ISSUE_BODY", ""), os.environ.get("ISSUE_USER", ""), os.environ.get("ISSUE_ASSOCIATION", ""))
        print(r["say"]); return 0  # a refused or too-short idea is answered in words by the boot that follows, never by a red job
    if a.tell:
        print(json.dumps(tell(a.root))); return 0
    if a.needs_run:
        return 1 if status(a.root).get("state") == "live" else 0
    ap.print_help(); return 0


if __name__ == "__main__":
    sys.exit(main())
