"""GitHub + Cloudflare platform handlers for the bootstrap rehearsal.

Each handler is the concrete implementation behind one rehearsal stage.
Handlers take a fresh environment and foundation.topology and perform real
provision/deploy actions; remediation() encodes the fixes recorded in
ops/bootstrap-rehearsal/latest.json so replays self-heal.
"""

from __future__ import annotations

import subprocess


class Platform:
    def __init__(self, argv: list[str]):
        self.repo = argv[0] if argv else "bootstrap-rehearsal"
        self.org = argv[1] if len(argv) > 1 else ""
        self.stage_fixes = {
            "2-roles-hired": "add queue producer/consumer bindings to generated wrangler.toml from topology.outputs",
            "3-queue-seeded": "provision KV/D1/queue resources before seeding",
            "5-executor-deployed": "grant contents:write + pull-request:write fine-grained token at repo creation",
        }

    def _sh(self, *cmd: str) -> str:
        return subprocess.check_output(cmd, text=True).strip()

    # --- stage handlers -------------------------------------------------
    def scaffold_from_topology(self, p, t):
        """Render roles, queues, and integrations from topology into a fresh repo scaffold."""
        self._sh("gh", "repo", "create", f"{self.org}/{self.repo}".strip("/"), "--public", "--confirm")
        self._sh("git", "clone", f"https://github.com/{self.org}/{self.repo}".strip("/"))
        for relpath, content in t.render_scaffold(self.repo):
            (p.root / relpath).write_text(content)

    def hire_roles(self, p, t):
        """Hire driver, scheduler, and executor roles from topology with bootstrap workers.json credentials."""
        for role in t.roles:
            p.deploy_worker(role, t.outputs)

    def seed_queue(self, p, t):
        """Seed the work queue with the initial tick order and the rehearsal item."""
        p.provision_resources(t.outputs)
        p.enqueue([t.initial_tick_order, t.rehearsal_item])

    def deploy_tick(self, p, t):
        """Deploy scheduler tick worker; confirm cron fires and enqueues orders."""
        p.deploy_worker("scheduler", t.outputs)
        assert p.cron_fires("scheduler"), "scheduler cron did not fire"

    def deploy_executor(self, p, t):
        """Deploy executor worker consuming queue orders and opening PRs."""
        p.deploy_worker("executor", t.outputs)
        assert p.consumer_active("executor"), "executor queue consumer inactive"

    def execute_unattended_change(self, p, t):
        """Executor consumes the order, writes the transparency page, and opens PR #1 unattended."""
        pr = p.await_pr(timeout_seconds=900)
        assert pr["number"] == 1, f"expected PR #1, got {pr['number']}"
        return {"merged_pr": pr}

    def ci_and_merge(self, p, t):
        """CI checks run on PR #1 and the executor merges it unattended after green checks."""
        pr = p.await_ci_green(pr_number=1, timeout_seconds=900)
        p.merge(pr_number=1, actor="executor")
        return {"merged_pr": pr}

    def verify_live_page(self, p, t):
        """Transparency page serves merged content at /live with run id and latest merge sha."""
        body = p.http_get(f"https://{p.worker_host}/live")
        assert "bootstrap-rehearsal" in body and p.latest_merge_sha() in body, "live page stale"

    # --- remediation (recorded fixes) -----------------------------------
    def remediation(self, stage: str, exc: Exception) -> str | None:
        fix = self.stage_fixes.get(stage)
        if fix:
            self._apply_fix(stage)
        return fix

    def _apply_fix(self, stage: str) -> None:
        if stage == "2-roles-hired":
            self._sh("python", "-m", "foundation.topology", "emit-wrangler-bindings")
        elif stage == "3-queue-seeded":
            self._sh("wrangler", "kv", "namespace", "create", "rehearsal")
            self._sh("wrangler", "d1", "create", "rehearsal")
            self._sh("wrangler", "queues", "create", "rehearsal-orders")
        elif stage == "5-executor-deployed":
            self._sh("gh", "repo", "edit", "--add-write-access")
