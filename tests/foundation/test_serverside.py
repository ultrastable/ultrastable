"""Server-side only (owner, 2026-11-12): the tree and the registries name no host, scheduler, agent or route on a person's computer.

The banned words are assembled from fragments here, so this file passes the scan it tests without needing an exclude entry."""
import json, unittest
from _repo import ROOT, copy_repo, edit
from foundation import doctrine, serverside

SCHED = "local" + " " + "scheduler"
WIN = "sch" + "tasks /Create /SC HOURLY"
CRON = "cron" + "tab -e"


class ServerSideOnly(unittest.TestCase):
    def test_repo_is_clean(self):
        self.assertEqual(serverside.check(ROOT), [])

    def test_rule_is_data_with_patterns_globs_and_reasoned_excludes(self):
        d = serverside.load(ROOT)
        self.assertIn("Ultrastable runs server-side only", d["rule"])
        self.assertTrue(d["banned"] and d["scan"])
        self.assertTrue(all(e["reason"].strip() for e in d["exclude"] + d["skip_dirs"]))
        self.assertLessEqual(len(d["exclude"]), 8, "the exclude list stays short")
        self.assertEqual(set(d["platforms"]), {"cloudflare", "github-actions", "claude-cloud"})

    def test_every_banned_phrase_from_the_directive_is_caught(self):
        d = serverside.load(ROOT)
        for phrase in (WIN, "Windows Task" + " Scheduler", CRON, "a system" + "d timer", "system" + "ctl enable", "a launch" + "d agent", "launch" + "ctl load",
                       "ops/scheduled" + "-tasks/x.md", "a desktop scheduled" + " task", SCHED, "a local" + " agent drains it", "a local" + " run", "run it on the" + " laptop",
                       "on the owner" + " machine", "the owner's" + " laptop", "C:" + "\\Users\\someone\\Dev", "http://local" + "host:8080", "local" + "-cron", "windows" + "-task"):
            self.assertTrue(serverside.lint(phrase, d), phrase)

    def test_ordinary_text_is_not_caught(self):
        d = serverside.load(ROOT)
        for phrase in ("local edits are never overwritten", "the cron worker ticks every 10 minutes", "a cloud-hosted routine runs hourly", "nothing needs a laptop",
                       "the task is scheduled daily", "cloud scheduled " + "tasks run on a schedule", "a machine-readable register", "mandatory local law"):
            self.assertEqual(serverside.lint(phrase, d), [], phrase)

    def test_a_line_that_states_the_rule_and_cites_it_is_the_only_excuse(self):
        d = serverside.load(ROOT)
        self.assertEqual(serverside.lint("Server-side only: no " + SCHED + " is a host.", d), [])
        self.assertTrue(serverside.lint("Never use a " + SCHED + ".", d))      # a bare 'never' excuses nothing

    def test_a_file_that_adds_a_scheduler_on_a_persons_computer_fails(self):
        r = copy_repo()
        (r / "deploy/loops/fallback.md").write_text("# Fallback\n\nIf everything else is down, add a line with `" + CRON + "` on any computer you have.\n")
        bad = serverside.check(r)
        self.assertTrue(any(b.startswith("deploy/loops/fallback.md:3:") and "unix-scheduler" in b for b in bad), bad)
        self.assertTrue(any(b.startswith("serverside: deploy/loops/fallback.md:3:") for b in doctrine.check(r)))     # the doctrine check carries it into CI

    def test_a_script_or_workflow_comment_is_scanned_too(self):
        r = copy_repo()
        p = r / ".github/workflows/loop.yml"
        p.write_text(p.read_text().replace("# free-alternative:", "# free-alternative: a " + SCHED + " or"))
        (r / "scripts/install.ps1").write_text(WIN + ' /TN "Loop"\n')
        bad = serverside.check(r)
        self.assertTrue(any(".github/workflows/loop.yml" in b and "host-on-a-computer" in b for b in bad), bad)
        self.assertTrue(any("scripts/install.ps1" in b and "windows-scheduler" in b for b in bad), bad)

    def test_a_host_with_an_adapter_on_a_persons_computer_fails(self):
        r = copy_repo()
        (r / "deploy/loops/local").mkdir()
        (r / "deploy/loops/local/run-loop.sh").write_text("#!/bin/sh\npython3 -m foundation launch --failover --commit --push\n")
        edit(r / "instances/ultrastable/loops.json", lambda d: d["hosts"].append(
            {"id": "spare-box", "cadence": "hourly", "state": "ready", "adapter": "deploy/loops/local/", "credential": "none", "takeover_after_hours": 2}))
        bad = serverside.check(r)
        self.assertTrue(any("host spare-box runs_on None" in b for b in bad), bad)
        self.assertTrue(any("host spare-box adapter 'deploy/loops/local/' names a host on a person's computer" in b for b in bad), bad)
        self.assertTrue(any(b.startswith("serverside: ") and "spare-box" in b for b in doctrine.check(r)))

    def test_a_host_cannot_claim_a_platform_with_another_platforms_adapter(self):
        r = copy_repo()
        (r / "deploy/loops/box.md").write_text("# box\n")
        edit(r / "instances/ultrastable/loops.json", lambda d: d["hosts"].append(
            {"id": "box", "cadence": "hourly", "state": "ready", "adapter": "deploy/loops/box.md", "credential": "x", "runs_on": "github-actions", "takeover_after_hours": 2}))
        self.assertTrue(any("host box has adapter 'deploy/loops/box.md', which is not a github-actions adapter" in b for b in serverside.check(r)))

    def test_a_route_or_loop_path_on_a_persons_computer_fails(self):
        r = copy_repo()
        edit(r / "deploy/routes.json", lambda d: d["targets"][1]["routes"].append({"id": "local-box", "credential": "none", "how": "a spare computer"}))
        edit(r / "instances/ultrastable/loop-registry.json", lambda d: d["loops"][0]["paths"][1].update({"class": "local"}))
        bad = serverside.check(r)
        self.assertTrue(any("deploy/routes.json" in b and "'local-box'" in b for b in bad), bad)
        self.assertTrue(any("loop-registry.json" in b and "class 'local'" in b for b in bad), bad)

    def test_the_rule_must_stay_in_the_agent_files(self):
        r = copy_repo()
        p = r / "seed/agents/AGENTS.md"
        p.write_text("\n".join(l for l in p.read_text().split("\n") if "Server-side only (owner, 2026-11-12)" not in l))
        self.assertTrue(any("seed/agents/AGENTS.md: lacks the server-side-only rule" in b for b in serverside.check(r)))

    def test_an_exclude_without_a_reason_or_without_a_file_fails(self):
        r = copy_repo()
        edit(r / "doctrine/server-side.json", lambda d: d["exclude"].extend([{"path": "docs/overview.md", "reason": " "}, {"path": "docs/no-such-file.md", "reason": "x"}]))
        bad = serverside.check(r)
        self.assertTrue(any("docs/overview.md is excluded without a reason" in b for b in bad), bad)
        self.assertTrue(any("docs/no-such-file.md matches no file" in b for b in bad), bad)

    def test_skipped_directories_are_not_read(self):
        r = copy_repo()
        (r / "ip").mkdir(exist_ok=True); (r / "ip/old-draft.md").write_text("install with " + CRON + "\n")
        self.assertEqual(serverside.scan(r), [])


if __name__ == "__main__":
    unittest.main()
