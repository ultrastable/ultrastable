#!/usr/bin/env python3
"""LLM diff review for the lane (issue #89). Reads a unified diff on stdin, asks a model for findings as JSON,
prints a markdown review. Exit 0 = no High findings (or skipped: no key), 2 = High finding (lane holds the PR).
Fails open when no key is set or the model errors, so the lane never stalls on this step; the skip reason is printed."""
import json, os, sys, urllib.request

MAX_DIFF = 60000
PROMPT = ("Review this pull request diff for correctness bugs, security problems and leaked secrets. "
          'Reply with ONLY JSON: {"findings":[{"severity":"High|Medium|Low","file":"","issue":""}]}. '
          "High means it should block merge. Empty list if clean.\n\n")


def call_anthropic(prompt, key, model=None):
    model = model or os.environ.get("LLM_REVIEW_MODEL", "claude-sonnet-5-5")
    req = urllib.request.Request("https://api.anthropic.com/v1/messages", method="POST",
        data=json.dumps({"model": model, "max_tokens": 1500, "messages": [{"role": "user", "content": prompt}]}).encode(),
        headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())["content"][0]["text"]


def parse(text):
    s, e = text.find("{"), text.rfind("}")
    return json.loads(text[s:e + 1])["findings"]


def review(diff, call=None, key=None):
    """Returns (exit_code, markdown)."""
    key = key if key is not None else os.environ.get("ANTHROPIC_API_KEY")
    if call is None and not key:
        return 0, "llm-review: skipped (no ANTHROPIC_API_KEY)"
    if not diff.strip():
        return 0, "llm-review: empty diff"
    try:
        findings = parse((call or (lambda p: call_anthropic(p, key)))(PROMPT + diff[:MAX_DIFF]))
    except Exception as e:  # fail open, say why
        return 0, f"llm-review: skipped (model error: {str(e)[:200]})"
    high = [f for f in findings if str(f.get("severity", "")).lower() == "high"]
    lines = [f"llm-review: {len(findings)} finding(s), {len(high)} High"] + \
            [f"- **{f.get('severity')}** `{f.get('file','')}`: {f.get('issue','')}" for f in findings]
    return (2 if high else 0), "\n".join(lines)


if __name__ == "__main__":
    code, md = review(sys.stdin.read())
    print(md)
    sys.exit(code)
