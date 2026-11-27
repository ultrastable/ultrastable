# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
"""TOKEN-LOG-1: where an agent session's tokens go, by kind of tool, so every efficiency change is measured against a baseline.

  python3 -m foundation tokenlog --session FILE.jsonl [--append LOG]   summarise one Claude Code transcript
  python3 -m foundation tokenlog --session FILE.jsonl --store DB        also write the per-kind rows to the regulator ledger (token_log)
  python3 -m foundation tokenlog --hook                                 Claude Code Stop hook: reads {transcript_path, session_id} on stdin
                                                                         and appends the summary to .cache/token-log.jsonl (never committed)
  python3 -m foundation tokenlog --compare BASE.json NEW.json           tokens per session, before and after a change

A summary holds the real usage totals the API reported (input, cache read, cache write, output) and, per tool kind (read, execute,
edit, other), the number of calls and the size of their results in tokens. Result size is an estimate (characters / 4), because the
transcript carries usage per model turn, not per tool result; the real totals are never estimated. Read share is the report's
76.1% figure measured on our own sessions: read-kind result tokens over all tool-result tokens.
Ultrastable is the foundation for any autonomous system.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

KIND = {"Read": "read", "Grep": "read", "Glob": "read", "Bash": "execute", "Edit": "edit", "Write": "edit", "NotebookEdit": "edit"}
READ_HINT = ("get_file_contents", "read", "list_", "search", "get_")


def kind(name: str) -> str:
    if name in KIND:
        return KIND[name]
    return "read" if name.startswith("mcp__") and any(h in name.split("__")[-1] for h in READ_HINT) else "other"


def _text(c) -> str:
    if isinstance(c, str):
        return c
    return " ".join(x.get("text", "") for x in c if isinstance(x, dict)) if isinstance(c, list) else ""


def summarise(lines) -> dict:
    use = {"input": 0, "cache_read": 0, "cache_write": 0, "output": 0}
    by = {k: {"calls": 0, "result_tokens_est": 0} for k in ("read", "execute", "edit", "other")}
    names, seen = {}, set()
    for line in lines:
        try:
            d = json.loads(line)
        except ValueError:
            continue
        m = d.get("message") or {}
        if d.get("type") == "assistant":
            rid = d.get("requestId") or d.get("uuid")
            u = m.get("usage") or {}
            if rid not in seen:  # one API response can span several transcript lines
                seen.add(rid)
                use["input"] += u.get("input_tokens", 0); use["cache_read"] += u.get("cache_read_input_tokens", 0)
                use["cache_write"] += u.get("cache_creation_input_tokens", 0); use["output"] += u.get("output_tokens", 0)
            for c in m.get("content", []) if isinstance(m.get("content"), list) else []:
                if c.get("type") == "tool_use":
                    names[c["id"]] = kind(c["name"]); by[names[c["id"]]]["calls"] += 1
        elif d.get("type") == "user" and isinstance(m.get("content"), list):
            for c in m["content"]:
                if c.get("type") == "tool_result" and c.get("tool_use_id") in names:
                    by[names[c["tool_use_id"]]]["result_tokens_est"] += len(_text(c.get("content"))) // 4
    total = sum(v["result_tokens_est"] for v in by.values())
    return {"usage": use, "by_kind": by, "read_share": round(by["read"]["result_tokens_est"] / total, 3) if total else None,
            "cache_read_share": round(use["cache_read"] / max(1, use["cache_read"] + use["cache_write"] + use["input"]), 3)}


def compare(base: dict, new: dict) -> dict:
    def tot(s): return s["usage"]["input"] + s["usage"]["cache_write"] + s["usage"]["output"] + s["usage"]["cache_read"] * 0.1
    b, n = tot(base), tot(new)
    return {"base_weighted_tokens": round(b), "new_weighted_tokens": round(n), "change": round((n - b) / b, 3) if b else None,
            "note": "cache reads weighted 0.1; compare sessions on the same task, never different tasks"}


def to_store(summary: dict, db: str):
    from .regulator import Store
    st = Store(db)
    for k, v in summary["by_kind"].items():
        if v["calls"]:
            st.log_tokens(summary["session"], ".", k, v["result_tokens_est"], 0)
    return st.token_share_by_kind()


def hook(stdin, root=Path(__file__).resolve().parents[1]) -> int:
    """Stop hook: summarise the finished session. A hook that fails must not stop the session, so errors are returned, not raised."""
    try:
        d = json.loads(stdin.read() or "{}")
        p = Path(d["transcript_path"])
        s = summarise(p.read_text(errors="replace").splitlines()); s["session"] = d.get("session_id") or p.stem
        out = root / ".cache/token-log.jsonl"
        out.parent.mkdir(exist_ok=True)
        with open(out, "a") as f:
            f.write(json.dumps(s, sort_keys=True) + "\n")
        return 0
    except (KeyError, OSError, ValueError) as e:
        print(f"tokenlog hook: {e}", file=sys.stderr); return 0


def main(argv) -> int:
    if "--hook" in argv:
        return hook(sys.stdin)
    if "--session" in argv:
        p = Path(argv[argv.index("--session") + 1])
        s = summarise(p.read_text(errors="replace").splitlines()); s["session"] = p.stem
        print(json.dumps(s, indent=1))
        if "--store" in argv:
            to_store(s, argv[argv.index("--store") + 1])
        if "--append" in argv:
            with open(argv[argv.index("--append") + 1], "a") as f:
                f.write(json.dumps(s, sort_keys=True) + "\n")
        return 0
    if "--compare" in argv:
        i = argv.index("--compare")
        print(json.dumps(compare(*[json.loads(Path(a).read_text()) for a in argv[i + 1:i + 3]]), indent=1)); return 0
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
