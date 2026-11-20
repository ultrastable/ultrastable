"""Preflight: health-check every surface before any stage relies on it (BG-9). Recorded, never fatal.
Ultrastable is the foundation for any autonomous system; a system that cannot see its own surfaces cannot boot."""
from __future__ import annotations
import shutil

from . import ladder


def run(ctx: ladder.Ctx | None = None, path: str = ".", min_free_gb: float = 2.0) -> dict:
    ctx = ctx or ladder.Ctx()
    free = shutil.disk_usage(path).free / 1e9
    tools = {t: bool(ctx.which(t)) for t in ("git", "python3", "node", "gh", "wrangler")}
    creds = {r["credential"]: r["status"] for r in ladder.acquire_all(ctx)["results"]}
    problems = []
    if free < min_free_gb:
        problems.append(f"disk {free:.1f} GB free is below {min_free_gb} GB")
    for t in ("git", "python3"):
        if not tools[t]:
            problems.append(f"{t} missing")
    return {"disk_free_gb": round(free, 1), "tools": tools, "credentials": creds, "problems": problems,
            "status": "ok" if not problems else "degraded"}
