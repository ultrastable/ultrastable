# gaplint

Finds open loops in any repository. Standard library only, Python 3.9+.

```
python3 -m gaplint .            # from products/gaplint, or with PYTHONPATH=products/gaplint
python3 -m gaplint . --json
pip install ./products/gaplint  # installs the `gaplint` command
```

Exit code 1 when there is any finding, so it works as a CI gate.

## Rules

| Id | Checks |
|---|---|
| GL001 | Each open `## BG-n` entry in the gap register names symptom, a fix in code, a default in effect and a closing probe. |
| GL002 | Each `OWNER-CARD*.md` names the default in effect and a closing probe. |
| GL003 | Agent files carry the standing rules, including **code is all that matters, never rely on user impact**. |
| GL004 | Hand-off reports do not assign a next step to a person (`needs you to`, `if you want`, `let me know if`). |
| GL005 | Public files contain none of the banned terms (off by default; configure `public_safe`). |
| GL006 | No secret-shaped strings. |
| GL007 | The memory file exists and has a `Last updated: YYYY-MM-DD` line. |
| GL008 | The positioning line (and, when the doctrine file has an `autonomy` block, the autonomy line) is in the files the doctrine names. Doctrine driven, off by default. |
| GL009 | Code is the only memory: the canonical memory file exists and agent files state the rule. Doctrine driven, off by default. |
| GL010 | SELF-CLOSED-LOOPS-1: agent files carry the rule and handoff files do not wait on a person (`pending owner decision`, `please review`, ...). Off by default; configure `self_closed`. |

## Configure

Put gaplint.json at the repository root. Keys merge over the defaults in `gaplint/config.py`, except `required`, which replaces the default whole. `agent_rules` may be one spec or a list of specs. `configs/workers.json` is the configuration of the workers repository itself: it names the rules and phrases the workers contract carries (`PYTHONPATH=products/gaplint python3 -m gaplint . --config products/gaplint/configs/workers.json`). A finding is cleared by fixing the file, never by editing the list.

## Status

BUILT: 19 tests (`python3 -m unittest discover -s tests`), including gaplint run on the checkout it ships in with `configs/workers.json` (exit 0). The platform repository runs its own copy in its `checks` workflow; this repository's CI does not yet run the linter on the checkout (a protected workflow change, requested), and `core/principles/enforcement.js` runs it for the directive D-NO-OPEN-LOOPS. NOT MEASURED: any use outside this repository. Impact is a hypothesis until another repository runs it.

## Why it exists

The agent operating agreement (`agents/AGENTS.md`) is only real if something fails when it is broken. gaplint is that check, and it ships as a tool so any repository can adopt the same loop discipline.
