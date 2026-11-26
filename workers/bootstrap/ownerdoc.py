# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
"""Owner README generated at bootstrap (issue #23, US-19-R17). Stdlib only.

The text comes from docs/help.md, the same source tools/build_help.mjs turns into the console Help tab, so the README and
the Help view cannot disagree. The README is plain language: no commands, no file names, no secrets.
"""
from __future__ import annotations

import re


def parse_help(md: str) -> list[dict]:
    """Sections of docs/help.md: a `## title` line, then paragraphs. Mirrors parseHelp in tools/build_help.mjs."""
    sections: list[dict] = []
    cur = None
    for line in md.replace("\r\n", "\n").split("\n"):
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            cur = {"title": m.group(1), "lines": []}
            sections.append(cur)
        elif cur is not None:
            cur["lines"].append(line)
    out = []
    for sec in sections:
        paras = [" ".join(p.split()) for p in re.split(r"\n{2,}", "\n".join(sec["lines"]).strip()) if p.strip()]
        if paras:
            out.append({"title": sec["title"], "text": "\n\n".join(paras)})
    return out


def card_say(card: dict) -> str:
    """What a person reads for one owner card: the plain-words `say` when the card has it (US-10-R15), else `what`."""
    return card.get("say") or card["what"]


def card_default(card: dict) -> str:
    """What happens if nothing is done, in words a person reads: `say_default` when the card has it (US-10-R15), else the machine default."""
    return card.get("say_default") or card["default_in_effect"]


def owner_readme(org_name: str, idea_prose: str, outcomes: list, cards: list, help_md: str,
                 budget_usd: float | None = None, roles: int | None = None, models: dict | None = None) -> str:
    """Five parts for the owner (US-19-R17): what is running, what it costs and what stops it, what they will be asked to decide,
    how to stop and delete it, plus the help sections. The four parts after the idea are written only when the caller states the
    budget, so a caller with no budget gets the older short form. Plain words: no variable names, keys or commands."""
    lines = [f"# {org_name}", "",
             "This is your organization. A team of software workers runs it for you, on a schedule, "
             "and reports back through a private console page.", ""]
    if idea_prose:
        lines += ["## The idea", "", idea_prose, ""]
    if outcomes:
        lines += ["## What it is working toward", ""] + [f"- {o}" for o in outcomes] + [""]
    full = budget_usd is not None
    if full:
        team = f"{roles} workers" if roles else "a team of workers"
        lines += ["## What is running", "",
                  f"{org_name} is {team} that wake up by themselves every 10 minutes, look at what needs doing, do it, check it "
                  "and write down what happened. They live in your own hosting account and report through a private console page "
                  "that only you can open.", ""]
        if budget_usd and budget_usd > 0:
            spend = (f"You said it may spend up to {budget_usd:g} USD a month on AI models and running costs. When that limit "
                     "is reached the workers switch to free models only and never spend more.")
        else:
            spend = "You set a monthly limit of zero, so the workers use free models only and spend nothing."
        lines += ["## What it costs and what stops it", "", spend,
                  " The hosting account's free plan stops at its daily limits instead of charging you; "
                  "a paid plan only ever starts if you sign in and choose one yourself. "
                  "Nothing runs up a bill you did not approve.", ""]
    lines += ["## What only you can do", ""]
    if full:
        lines += ["These are the things you will be asked to decide. Each one says what happens if you do nothing; "
                  "the workers keep going on everything else either way.", ""]
    if cards:
        lines += [f"- {card_say(c)}. If nothing is done: {card_default(c)}." for c in cards]
    else:
        lines.append("- Nothing right now.")
    lines.append("")
    if full:
        lines += ["## How to stop and delete it", "",
                  "To stop it for good, sign in to your hosting account, open Workers, choose this organization's worker and delete it, "
                  "then delete its database. That ends every scheduled check at once. The code repositories stay on your code host "
                  "until you delete them yourself. The system never deletes anything of yours.", ""]
    for sec in parse_help(help_md):
        lines += [f"## {sec['title']}", "", sec["text"], ""]
    return "\n".join(lines).rstrip() + "\n"
