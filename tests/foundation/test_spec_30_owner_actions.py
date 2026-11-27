# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""US-SPEC-30 (owner actions and credentials: one link, no pasted secrets): the requirements that live in the foundation's commands and data, proved through
their public functions: foundation/needsyou.py, pointclick.py, ladder.py, ownersteps.py (with handlers.py), pathfinder.py, credwatch.py and userbackend.py.
Every test names the requirement it proves in the method name and in the first docstring line (US-00-R12). Nothing here touches the network, an account or
the real repository tree: each root is a scratch directory removed when its test ends, clocks and environments are injected, and a fake stands in for every
port (fetch, http, the command runner)."""
import datetime as dt, json, shutil, sys, unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from _repo import scratch  # noqa: E402  (removes each scratch directory when its test ends; also puts the repository root on sys.path)

REPO = HERE.parents[1]
from foundation import credwatch, handlers, ladder, manifest as mf, needsyou, ownersteps, pathfinder, pointclick, userbackend  # noqa: E402

TODAY = dt.date(2026, 11, 26)


def root_with(*files):
    d = scratch()
    for rel in files:
        (d / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(REPO / rel, d / rel)
    return d


class OwnerActRegister(unittest.TestCase):
    """4.1: the register of what only the owner can do."""

    def card(self, **kw):
        c = {"id": "x", "title": "T", "why": "Because.", "default": "Nothing breaks.", "button": "Do it", "url": "https://ultrastable.io/connect/x",
             "connect": "https://ultrastable.io/connect/x", "connect_kind": "connect-flow"}
        c.update(kw)
        return c

    def links(self, items, baseline=("keep",)):
        d = root_with("doctrine/point-and-click.json")
        pol = json.loads((d / "doctrine/point-and-click.json").read_text())
        pol["connect_link"]["deep_link_baseline"] = list(baseline)
        (d / "foundation/data").mkdir(parents=True)
        (d / "foundation/data/needs-you.json").write_text(json.dumps({"items": items}))
        return pointclick.connect_links(d, pol)

    def test_us_30_r02_every_owner_card_carries_one_https_link_to_a_connect_flow(self):
        """US-30-R02: an owner card needs one https connect link; a flow must live under ultrastable.io/connect, a provider deep link only while on the shrink-only baseline."""
        self.assertEqual(self.links([self.card()]), [])
        self.assertEqual(self.links([self.card(id="keep", connect="https://github.com/settings/apps", connect_kind="provider-deep-link")]), [])
        bad = self.links([self.card(id="a", connect=None), self.card(id="b", connect="http://ultrastable.io/connect/x"), self.card(id="c", connect="https://example.com/connect/x"),
                          self.card(id="d", connect="https://github.com/settings/apps", connect_kind="provider-deep-link"), self.card(id="e", connect_kind="menu")])
        self.assertEqual(len(bad), 5)
        self.assertIn("a: no connect link", bad[0]); self.assertIn("b: no connect link", bad[1])
        self.assertIn("must be an ultrastable.io/connect page", bad[2]); self.assertIn("must use a /connect flow, not a provider deep link", bad[3]); self.assertIn("connect_kind must be", bad[4])
        self.assertEqual(self.links([]), [], "no owner card is the goal, and it passes")

    def test_us_30_r02_the_page_is_generated_from_the_register_and_a_stale_page_or_a_non_https_link_fails(self):
        """US-30-R02: NEEDS-YOU.md is generated from the register, and a stale page, a missing link or a non-https link fails the check."""
        d = scratch(); data, out = d / "needs-you.json", d / "NEEDS-YOU.md"
        data.write_text(json.dumps({"items": [self.card(id="solo", title="Connect Solo", why="Only you can sign in.", default="The rest keeps running.", button="Sign in")], "done_for_you": ["Everything else."]}))
        with mock.patch.object(needsyou, "DATA", data), mock.patch.object(needsyou, "OUT", out):
            self.assertTrue(any("stale" in b for b in needsyou.check()), "no page yet")
            out.write_text(needsyou.render(), encoding="utf-8")
            self.assertEqual(needsyou.check(), [])
            page = out.read_text()
            self.assertIn("## Connect Solo", page); self.assertIn("If you do nothing: The rest keeps running.", page); self.assertIn("**[Sign in](https://ultrastable.io/connect/x)**", page); self.assertIn("- Everything else.", page)
            data.write_text(json.dumps({"items": [self.card(id="solo", url="http://insecure.example/x"), self.card(id="nolink", url="")], "done_for_you": []}))
            out.write_text(needsyou.render(), encoding="utf-8")
            bad = needsyou.check()
            self.assertEqual(sorted(b.split(":")[0] for b in bad), ["nolink", "solo"]); self.assertTrue(all("needs one https link" in b for b in bad))

    def test_us_30_r03_a_gate_closes_on_its_own_evidence_and_an_unreadable_page_is_not_evidence(self):
        """US-30-R03: an owner gate is removed when its resolved_when evidence is in (a running Actions job, a bound name, a live https page saying so); no evidence, no removal."""
        d = scratch(); (d / "doctrine").mkdir()
        (d / "doctrine/point-and-click.json").write_text(json.dumps({"connect_link": {"deep_link_baseline": ["gh", "keep"]}}))
        data = d / "n.json"
        items = [{"id": "run", "title": "Run", "resolved_when": "actions-running"}, {"id": "env", "title": "Env", "resolved_when": "env:A|B"},
                 {"id": "gh", "title": "Connect GitHub", "resolved_when": ["env:LANE_PAT", "http:https://x.test/connect/github ~ GitHub is connected"]},
                 {"id": "bsky", "title": "Bluesky", "resolved_when": ["http:https://x.test/b ~ Bluesky is connected"]}, {"id": "plain", "title": "Plain", "resolved_when": ["http:http://x.test/a ~ ok"]}, {"id": "keep", "title": "No evidence"}]
        data.write_text(json.dumps({"items": items, "done_for_you": []}))
        pages = {"https://x.test/connect/github": "<h1>GitHub is connected</h1>", "https://x.test/b": "<h1>Connect Bluesky</h1>", "http://x.test/a": "ok"}  # the plain-http page DOES say ok: only the https rule keeps its item
        fetch = lambda url, text: text in pages.get(url, "")
        self.assertEqual(needsyou.settle(d, {}, data, fetch), ["gh"])
        self.assertEqual(needsyou.settle(d, {"GITHUB_ACTIONS": "false", "C": "x"}, data, fetch), [], "only the string true counts for a running job")
        self.assertEqual(needsyou.settle(d, {"GITHUB_ACTIONS": "true", "B": "v"}, data, fetch), ["run", "env"])
        left = json.loads(data.read_text())
        self.assertEqual([i["id"] for i in left["items"]], ["bsky", "plain", "keep"], "an unread page, a plain-http page (even one that answers with the text) and an item with no evidence stay")
        self.assertTrue(left["done_for_you"][0].startswith("Connect GitHub: settled 20") and "on its own evidence" in left["done_for_you"][0])
        self.assertEqual(json.loads((d / "doctrine/point-and-click.json").read_text())["connect_link"]["deep_link_baseline"], ["keep"], "the deep-link baseline shrinks with the item")

    def test_us_30_r03_the_real_register_names_live_evidence_for_every_flow_and_is_settled_by_the_watchdog(self):
        """US-30-R03: every connect-flow card of the real register names live evidence, and the watchdog runs the settle command."""
        for i in json.loads((REPO / "foundation/data/needs-you.json").read_text())["items"]:
            if i.get("connect_kind") == "connect-flow":
                w = i.get("resolved_when"); w = w if isinstance(w, list) else [w or ""]
                self.assertTrue(any(str(x).startswith("http:https://") for x in w), i["id"])
        self.assertIn("foundation needsyou --settle", (REPO / ".github/workflows/watchdog.yml").read_text())


def ctx(env=None, tools=None, runs=None, exists=()):
    tools, runs = tools or {}, runs or {}
    return ownersteps.StepCtx(env=env or {}, which=lambda t: tools.get(t), run=lambda argv: runs.get(argv[0], (1, "")), exists=lambda p: p in exists)


class Ladder(unittest.TestCase):
    """4.2: the credential acquisition ladder."""

    def test_us_30_r14_routes_are_tried_in_order_and_every_denial_is_recorded(self):
        """US-30-R14: the ladder tries each route in order, records every outcome, stops at the first success, and reads only whether a binding or sign-in exists."""
        r = ladder.acquire("org_admin", ctx(env={"ORG_ADMIN_TOKEN": "s3cret-value"}))
        self.assertEqual((r["status"], r["via"], [a["route"] for a in r["attempts"]], r["card"]), ("acquired", "env-token", ["env-token"], None))
        self.assertNotIn("s3cret-value", json.dumps(r), "a value is never read into the result")
        r = ladder.acquire("org_admin", ctx(env={"GITHUB_ACTIONS": "true"}, tools={"gh": "/bin/gh"}, runs={"gh": (0, "Token scopes: repo, admin:org")}))
        self.assertEqual((r["via"], [a["ok"] for a in r["attempts"]]), ("gh-login-admin-org", [False, True]))
        r = ladder.acquire("org_admin", ctx(env={"GH_APP_ID": "1", "GH_APP_INSTALLATION_ID": "2", "GH_APP_KEY_BINDING": "k"}))
        self.assertEqual(r["via"], "github-app"); self.assertEqual([a["ok"] for a in r["attempts"]], [False, False, True])
        self.assertEqual(ladder.acquire("cloudflare", ctx(env={"CLOUDFLARE_API_TOKEN": "t"}))["status"], "carded", "env_all needs every named binding")
        self.assertEqual(ladder.acquire("cloudflare", ctx(tools={"wrangler": "/w"}, runs={"wrangler": (0, "ok")}))["via"], "wrangler-login")

    def test_us_30_r14_a_sign_in_on_a_host_that_is_not_server_side_is_not_a_route_and_scope_absent_is_a_denial(self):
        """US-30-R14: a CLI sign-in counts only on a server-side host and only with the scope named; both failures are recorded denials."""
        tools, runs = {"gh": "/bin/gh"}, {"gh": (0, "Token scopes: repo, admin:org")}
        self.assertNotEqual(ladder.acquire("org_admin", ctx(tools=tools, runs=runs)).get("via"), "gh-login-admin-org")
        self.assertIn("not server-side", json.dumps(ladder.acquire("org_admin", ctx(tools=tools, runs=runs))["attempts"]))
        self.assertEqual(ladder.acquire("org_admin", ctx(env={"CLAUDE_CODE_REMOTE": "true"}, tools=tools, runs={"gh": (0, "Token scopes: repo")}))["status"], "carded")
        self.assertEqual(ladder.acquire("org_admin", ctx(env={"GITHUB_ACTIONS": "true"}, tools={}))["attempts"][1]["detail"], "gh not installed")
        self.assertEqual(ladder.acquire("org_admin", ctx(env={"GITHUB_ACTIONS": "true"}, tools=tools, runs={"gh": (4, "not logged in")}))["attempts"][1]["detail"], "gh not logged in (exit 4)")
        for env, want in (({"CLAUDE_CODE_REMOTE": "1"}, True), ({"GITHUB_ACTIONS": "true"}, True), ({"GITHUB_ACTIONS": "false"}, False), ({"CLAUDE_CODE_REMOTE": "0"}, False), ({}, False)):
            self.assertEqual(ladder.server_side(env), want, env)

    def test_us_30_r14_only_when_every_route_failed_does_one_card_open_with_a_default_and_a_closing_probe(self):
        """US-30-R14: at most one owner card per credential, only when every route failed, with an identity-bound line, why, default, probe and the routes exhausted."""
        r = ladder.acquire("model_api", ctx())
        self.assertEqual(r["status"], "carded"); c = r["card"]
        self.assertTrue(c["line"].startswith("IDENTITY-BOUND: ")); self.assertTrue(c["why"] and c["default_in_effect"] and c["closing_probe"])
        self.assertEqual(c["routes_exhausted"], ["env-key", "workers-ai-binding"]); self.assertEqual(len(r["attempts"]), 2)
        every = ladder.acquire_all(ctx(env={"ANTHROPIC_API_KEY": "x"}))
        self.assertEqual(len(every["results"]), 5); self.assertEqual(sorted(c["id"] for c in every["cards"]), ["CF-TOKEN", "ORG-TOKEN", "OUT-SENDER", "SOC-ACCOUNTS"], "an acquired credential opens no card")
        for spec in ladder.load_routes()["credentials"].values():
            self.assertTrue(spec["card"]["default"] and spec["card"]["probe"] and spec["routes"])


class OwnerSteps(unittest.TestCase):
    """4.2: the owner-step engine."""
    BASE = {"name": "Tool Library", "slug": "tool-library", "kind": "community", "goals": ["A booking prototype"], "owner": {"name": "Ada", "jurisdiction": "DE"}}

    def run_all(self, c, **over):
        m = mf.resolve({**self.BASE, "funding": {"routes": [{"id": "grants"}]}, "ip": {"has_invention": True}, **over})
        c.facts = mf.facts_for(m)
        d = scratch()
        return ownersteps.evaluate_all(m, c, d)

    def test_us_30_r15_a_found_credential_means_no_card_and_a_missing_one_means_one_identity_bound_card_with_its_default(self):
        """US-30-R15: a step ends done, automated, prepared or degraded; an identity-bound step opens one card with a default and a probe, merged by id across steps."""
        found = self.run_all(ctx(env={"ORG_ADMIN_TOKEN": "x", "CLOUDFLARE_API_TOKEN": "x", "CLOUDFLARE_ACCOUNT_ID": "x"}))
        by = {r["id"]: r for r in found["results"]}
        self.assertEqual((by["OS-3"]["status"], by["OS-4"]["status"]), ("automated", "automated")); self.assertNotIn("ORG-TOKEN", [c["id"] for c in found["cards"]])
        nothing = self.run_all(ctx())
        ids = [c["id"] for c in nothing["cards"]]; self.assertEqual(len(ids), len(set(ids)), "one card per id")
        for c in nothing["cards"]:
            self.assertTrue(c["line"].startswith("IDENTITY-BOUND") and c["default_in_effect"] and c["closing_probe"], c["id"])
        self.assertTrue({"ORG-TOKEN", "CF-TOKEN", "FILE-PRIORITY", "ENTITY", "FUND-SUBMIT"} <= set(ids))
        s = nothing["summary"]; self.assertEqual(sum(s.values()), len(nothing["results"]))
        self.assertEqual(ownersteps.evaluate_all(mf.resolve({**self.BASE, "domain": "x.org"}), ctx(), scratch())["summary"]["degraded"], 1, "the alias step")

    def test_us_30_r15_a_step_that_is_not_identity_bound_never_becomes_a_card_and_a_satisfied_step_is_left_alone(self):
        """US-30-R15: a non-identity-bound step whose routes all failed is degraded with a backlog line, never a card; a satisfied_when fact ends it as done."""
        res = self.run_all(ctx()); os9 = [r for r in res["results"] if r["id"] == "OS-9"][0]
        self.assertEqual((os9["status"], os9["card"]), ("degraded", None)); self.assertIn("every autonomous route failed", os9["backlog"])
        self.assertEqual([r for r in res["results"] if r["id"] == "OS-2"][0]["status"], "prepared", "an unsatisfied identity-bound step is prepared")
        m = mf.resolve(self.BASE); c = ctx(); c.facts = {"has_entity": True}
        os2 = [s for s in json.loads(ownersteps.DATA.read_text())["steps"] if s["id"] == "OS-2"][0]
        r = ownersteps.evaluate(os2, m, c, scratch())
        self.assertEqual(r["status"], "done"); self.assertEqual(r["attempts"][0]["route"], "detect")

    def test_us_30_r15_a_refusal_is_recorded_and_never_retried_through_another_path_and_a_handler_error_is_not_swallowed(self):
        """US-30-R15: a 401 or 403 from a route is one recorded refusal with no retry through another path, and a failing handler is recorded as a failure, never swallowed."""
        env = {"CLOUDFLARE_ZONE_ID": "z", "CLOUDFLARE_ACCOUNT_ID": "a", "OWNER_CONTACT": "dest"}
        step = [s for s in json.loads(ownersteps.DATA.read_text())["steps"] if s["id"] == "OS-9"][0]
        m = mf.resolve({**self.BASE, "domain": "example.org"}); calls = []
        ok = ctx(env=env); ok.http = lambda meth, url, body: (calls.append((meth, url)) or (200, {}))
        self.assertEqual(ownersteps.evaluate(step, m, ok, scratch(), apply=True)["status"], "automated"); self.assertEqual(len(calls), 2)
        self.assertEqual(ownersteps.evaluate(step, m, ok, scratch(), apply=False)["attempts"][0]["detail"][:8], "dry run:")
        calls.clear(); denied = ctx(env=env); denied.http = lambda meth, url, body: (calls.append(url) or (403, {}))
        r = ownersteps.evaluate(step, m, denied, scratch(), apply=True)
        self.assertEqual((r["status"], len(calls)), ("degraded", 1)); self.assertIn("refused (403)", r["attempts"][0]["detail"]); self.assertIn("not re-routed", r["attempts"][0]["detail"])
        old = handlers.REGISTRY["funding_packets"]; handlers.REGISTRY["funding_packets"] = lambda *a: 1 / 0
        try:
            os7 = [r for r in self.run_all(ctx())["results"] if r["id"] == "OS-7"][0]
        finally:
            handlers.REGISTRY["funding_packets"] = old
        self.assertIn("ZeroDivisionError", os7["failures"][0]["error"]); self.assertEqual(os7["status"], "prepared")


class Pathfinder(unittest.TestCase):
    """4.2: find another path before asking."""

    def repo(self, cfg_extra=None, gates=None, items=None, grand=()):
        d = scratch()
        for f in ("doctrine", "foundation/data", "ops/paths"):
            (d / f).mkdir(parents=True, exist_ok=True)
        cfg = json.loads((REPO / pathfinder.CFG).read_text()); cfg["grandfathered_gates"] = list(grand); cfg.update(cfg_extra or {})
        (d / pathfinder.CFG).write_text(json.dumps(cfg)); (d / "doctrine/open-loops.json").write_text(json.dumps({"gates": gates or []}))
        (d / "foundation/data/needs-you.json").write_text(json.dumps({"items": items or []}))
        return d, cfg

    def test_us_30_r16_an_owner_ask_needs_an_attempt_in_every_surface_class(self):
        """US-30-R16: an owner ask passes only with a recorded attempt, or a class-tagged result or reason, in each of the five surface classes."""
        d, cfg = self.repo(items=[{"id": "x"}])
        self.assertEqual(list(cfg["surface_classes"]), ["existing-credentials", "prior-working-config", "sibling-workers", "alternate-channel", "construct"])
        self.assertIn("needs-you x: owner ask without exhaustion proof, no attempt in existing-credentials, prior-working-config, sibling-workers, alternate-channel, construct", pathfinder.check(d))
        for c in list(cfg["surface_classes"])[:-1]:
            pathfinder.record(d, "x", c, "r", False, "tried")
        self.assertIn("no attempt in construct", pathfinder.check(d)[0])
        pathfinder.record(d, "x", "construct", "r", False, "tried"); self.assertEqual(pathfinder.check(d), [])
        pathfinder.record(d, "other", "construct", "r", True, "x"); self.assertEqual(pathfinder.check(d), [], "another ask's attempts prove nothing for this one")
        s = [{"class": c, "s": "s", "result": "r"} for c in list(cfg["surface_classes"])[:-1]] + [{"class": "construct", "s": "s", "na": "no such surface"}]
        d2, _ = self.repo(gates=[{"id": "g", "surfaces": s}]); self.assertEqual(pathfinder.check(d2), [], "a class-tagged surface with a result or a reason counts")
        d3, _ = self.repo(gates=[{"id": "g", "surfaces": [{"class": "construct", "s": "s"}]}]); self.assertTrue(any("gate g: owner ask without exhaustion proof" in b for b in pathfinder.check(d3)))
        d4, _ = self.repo(gates=[{"id": "g", "closed": True, "surfaces": []}]); self.assertEqual(pathfinder.check(d4), [], "a closed gate asks nothing")

    def test_us_30_r16_the_grandfathered_list_only_shrinks(self):
        """US-30-R16: a grandfathered gate that is now exhausted, or no longer exists, fails the check, so the list only shrinks."""
        d, cfg = self.repo(gates=[{"id": "old", "surfaces": []}], grand=["old", "gone"])
        self.assertEqual(pathfinder.check(d), ["grandfathered gate gone no longer exists, remove it"])
        for c in cfg["surface_classes"]:
            pathfinder.record(d, "old", c, "r", False, "t")
        self.assertEqual(sorted(pathfinder.check(d)), ["gate old: now exhausted, remove it from grandfathered_gates (shrink-only)", "grandfathered gate gone no longer exists, remove it"])
        self.assertEqual(pathfinder.check(REPO), [], "the real repository's asks are all proven")

    def test_us_30_r17_resolve_walks_every_class_records_each_attempt_and_counts_only_a_working_credential(self):
        """US-30-R17: resolve tries every class's routes in order, appends every attempt, and is resolved only by a working env, env_all or http route."""
        d, _ = self.repo({"asks": {"post": {"existing-credentials": ["env:A|B"], "prior-working-config": ["git:foo"], "sibling-workers": ["file:there"], "alternate-channel": ["env_all:C&D"]}}})
        (d / "there").write_text("x")
        r = pathfinder.resolve("post", d, env={"B": "v", "C": "1"}, git=lambda root, p: ["abc1234 a commit"], now=dt.datetime(2026, 11, 26, tzinfo=dt.timezone.utc))
        self.assertEqual((r["resolved"], r["via"]), (True, {"class": "existing-credentials", "route": "env:A|B"}))
        rows = pathfinder.attempts(d); self.assertEqual(len(rows), 4); self.assertEqual([x["ok"] for x in rows], [True, True, True, False])
        self.assertEqual(rows[0]["at"], "2026-11-26T00:00:00+00:00"); self.assertEqual(r["classes_missing"], ["construct"])
        self.assertIn("missing: D", rows[3]["detail"]); self.assertNotIn('"v"', json.dumps(rows), "bindings are named, never read")
        only_leads = pathfinder.resolve("post", d, env={}, git=lambda root, p: ["abc1234 a commit"])
        self.assertEqual((only_leads["resolved"], only_leads["via"]), (False, None), "a git history or a sibling file is a lead, not a credential")
        self.assertEqual(pathfinder.try_route("nonsense:x", d), (False, "unknown route kind nonsense"))
        self.assertEqual(pathfinder.try_route("git:nothing", d, git=lambda root, p: []), (False, "no history"))
        self.assertEqual(pathfinder.resolve("unlisted", d, env={})["classes_missing"], list(json.loads((REPO / pathfinder.CFG).read_text())["surface_classes"]))

    def test_us_30_r18_a_regressed_integration_lists_the_commits_since_it_last_worked_and_asks_are_derived_from_code(self):
        """US-30-R18: a failing integration lists suspect commits since last_good and records the attempt; asks and integrations are derived from the credential routes and social channels."""
        d, _ = self.repo({"integrations": [{"id": "bsky", "files": ["w/bsky.js", "w/auth.js"], "probe": "env:SESSION", "last_good": "abc"}]})
        seen = []
        git = lambda root, f, since=None: (seen.append((f, since)) or ["1a2b3c client type change"])
        out = pathfinder.regress(d, run={}, git=git)
        self.assertEqual(out[0]["suspects"], ["1a2b3c client type change", "1a2b3c client type change"]); self.assertEqual(seen, [("w/bsky.js", "abc"), ("w/auth.js", "abc")])
        row = pathfinder.attempts(d)[0]; self.assertEqual((row["class"], row["ok"], row["detail"]), ("prior-working-config", True, "2 suspect commits since abc"))
        self.assertEqual(pathfinder.regress(d, run={"SESSION": "1"}, git=git), [], "a working integration lists nothing")
        for rel in ("foundation/data/credential-routes.json",):
            (d / rel).write_text((REPO / rel).read_text())
        (d / "social").mkdir(); (d / "social/accounts.json").write_text(json.dumps({"channels": {"bluesky": {"secrets": ["BSKY_ID", "BSKY_PW"]}}}))
        cfg = pathfinder._cfg(d)
        for key, card in (("org_admin", "ORG-TOKEN"), ("cloudflare", "CF-TOKEN"), ("social_accounts", "SOC-ACCOUNTS")):
            self.assertIn(key, cfg["asks"]); self.assertIn(card, cfg["asks"])
        self.assertEqual(cfg["asks"]["org_admin"]["existing-credentials"], ["env:ORG_ADMIN_TOKEN|GH_ORG_TOKEN", "env_all:GH_APP_ID&GH_APP_INSTALLATION_ID&GH_APP_KEY_BINDING"])
        bsky = [i for i in cfg["integrations"] if i["id"] == "bluesky"][0]
        self.assertEqual((bsky["probe"], bsky["last_good"]), ("env_all:BSKY_ID&BSKY_PW", None)); self.assertTrue(bsky["files"] and all(isinstance(f, str) for f in bsky["files"]), "the files to diff come from the declared sibling workers")
        self.assertEqual(cfg["asks"]["owner-social"], cfg["asks"]["social_accounts"], "a gate waiting on a credential shares that credential's attempts")


class Credwatch(unittest.TestCase):
    """4.6: expiry is measured before it lapses."""

    def setUp(self):
        self.d = scratch(); (self.d / "doctrine").mkdir()
        cfg = json.loads((REPO / "doctrine/credwatch.json").read_text())
        cfg["credentials"] = [c for c in cfg["credentials"] if c["kind"] in ("cloudflare-token", "github-token")]
        for c in cfg["credentials"]:
            c.pop("optional", None)
        (self.d / "doctrine/credwatch.json").write_text(json.dumps(cfg)); self.cfg = cfg
        self.env = {"CLOUDFLARE_API_TOKEN": "s3cret-value", "LANE_PAT": "another-value"}

    @staticmethod
    def http(cf_expires="2026-12-01T00:00:00Z", cf_status="active", code=200, gh_code=200):
        def f(url, tok):
            if "cloudflare" in url:
                return code, {}, json.dumps({"result": {"status": cf_status, "expires_on": cf_expires}})
            return gh_code, {"GitHub-Authentication-Token-Expiration": "2027-06-01 00:00:00 UTC"}, ""
        return f

    def rows(self, **k):
        return {r["name"]: r for r in credwatch.assess(credwatch.cfg(self.d), TODAY, k.pop("env", self.env), self.http(**k))}

    def test_us_30_r57_a_credential_is_ok_invalid_unbound_or_unmeasured_and_a_near_expiry_is_a_state_of_its_own(self):
        """US-30-R57: each credential reads ok, invalid, unbound or unmeasured, never ok without a reading, and ok becomes expiring or expired inside the warning window."""
        r = self.rows(cf_expires=None); self.assertEqual((r["CLOUDFLARE_API_TOKEN"]["state"], r["LANE_PAT"]["state"], r["LANE_PAT"]["days_left"]), ("ok", "ok", 187))
        self.assertEqual(self.rows(cf_status="disabled")["CLOUDFLARE_API_TOKEN"]["state"], "invalid")
        self.assertEqual(self.rows(code=503)["CLOUDFLARE_API_TOKEN"]["state"], "unmeasured"); self.assertEqual(self.rows(gh_code=503)["LANE_PAT"]["state"], "unmeasured")
        self.assertEqual(self.rows(gh_code=401)["LANE_PAT"]["state"], "invalid")
        self.assertEqual(self.rows(env={})["LANE_PAT"]["state"], "unbound", "a name that is not bound is never ok")
        self.assertEqual(self.rows(cf_expires="2026-12-20T00:00:00Z")["CLOUDFLARE_API_TOKEN"]["state"], "expiring"); self.assertEqual(self.rows(cf_expires="2026-11-01T00:00:00Z")["CLOUDFLARE_API_TOKEN"]["state"], "expired")
        self.assertEqual(self.rows(cf_expires="2027-01-10T00:00:00Z")["CLOUDFLARE_API_TOKEN"]["state"], "expiring", "day 45 is inside the 45-day warning window")
        self.assertEqual(self.rows(cf_expires="2027-01-11T00:00:00Z")["CLOUDFLARE_API_TOKEN"]["state"], "ok", "day 46 is outside it")
        crashing = lambda url, tok: (_ for _ in ()).throw(OSError("down"))
        self.assertEqual(credwatch.probe({"name": "X", "kind": "github-token"}, {"X": "v"}, crashing), {"state": "unmeasured", "expires": None, "error": "OSError"}, "a probe that fails is a result, not a crash")
        self.assertEqual(credwatch.probe({"name": "CF_DEPLOY_TOKEN", "kind": "cloudflare-worker-token"}, {})["state"], "unmeasured", "no OIDC token in the environment is never ok")
        late = {r["name"]: r["state"] for r in credwatch.assess(credwatch.cfg(self.d), dt.date(2027, 10, 1), {}, self.http())}
        self.assertEqual(late["domain-ultrastable.io"], "expiring"); self.assertEqual(credwatch.assess(credwatch.cfg(self.d), dt.date(2027, 11, 11), {}, self.http())[-1]["state"], "expired")

    def test_us_30_r58_a_bad_required_credential_files_one_item_writes_no_value_and_a_second_run_writes_nothing(self):
        """US-30-R58: a required credential that is invalid or inside its window files one Q-CRED item, the ledger holds states only, an optional one never files, and the closing probe reads the recorded state."""
        r = credwatch.run(self.d, apply=True, today=TODAY, env=self.env, http=self.http(cf_expires="2026-12-01T00:00:00Z"))
        self.assertEqual((r["bad"], r["changed"]), (["CLOUDFLARE_API_TOKEN"], True))
        it = json.loads((self.d / "docs/issues/Q-CRED-CLOUDFLARE_API_TOKEN.json").read_text())
        self.assertIn("cmd:python3 -m foundation credwatch --probe CLOUDFLARE_API_TOKEN", it["body"]); self.assertIn("**Status:** open", it["body"])
        for p in self.d.rglob("*.json"):
            self.assertNotIn("s3cret-value", p.read_text()); self.assertNotIn("another-value", p.read_text())
        self.assertEqual(sorted(json.loads((self.d / "ops/credwatch.json").read_text())["rows"][0]), ["expires", "name", "state"])
        self.assertFalse(credwatch.run(self.d, apply=True, today=TODAY, env=self.env, http=self.http(cf_expires="2026-12-01T00:00:00Z"))["changed"])
        self.assertEqual(credwatch.probe_recorded("CLOUDFLARE_API_TOKEN", self.d), 1); self.assertEqual(credwatch.probe_recorded("LANE_PAT", self.d), 0); self.assertEqual(credwatch.probe_recorded("NEVER", self.d), 1)
        self.assertFalse(credwatch.run(self.d, apply=False, today=TODAY, env=self.env, http=self.http(code=401))["changed"], "a dry run writes nothing")
        c = json.loads((self.d / "doctrine/credwatch.json").read_text()); c["credentials"][0]["optional"] = True; (self.d / "doctrine/credwatch.json").write_text(json.dumps(c))
        self.assertEqual(credwatch.run(self.d, apply=True, today=TODAY, env=self.env, http=self.http(code=401))["bad"], [], "an optional credential is recorded but never files")

    def test_us_30_r58_the_ledger_fails_on_a_required_credential_not_ok_a_never_recorded_one_and_an_expiry_in_the_window(self):
        """US-30-R58: the ledger reading fails a required credential that is not ok, one never recorded, and any expiry inside the warning window; an optional bad one passes."""
        def root(rows):
            d = scratch(); (d / "doctrine").mkdir(); (d / "ops").mkdir()
            (d / "doctrine/credwatch.json").write_text(json.dumps({"warn_days": 45, "registrations": [], "credentials": [{"name": "A", "kind": "github-token", "used_by": "x"}, {"name": "B", "kind": "github-token", "used_by": "y", "optional": True}]}))
            (d / "ops/credwatch.json").write_text(json.dumps({"rows": rows})); return d
        self.assertEqual(credwatch.ledger(root([{"name": "A", "state": "ok"}, {"name": "B", "state": "invalid"}]), TODAY), [])
        self.assertEqual(credwatch.ledger(root([{"name": "B", "state": "ok"}]), TODAY), ["A: never recorded by credwatch --run (unmeasured)"])
        self.assertEqual(credwatch.ledger(root([{"name": "A", "state": "unbound"}, {"name": "B", "state": "ok"}]), TODAY), ["A: unbound"])
        self.assertTrue(any("20 days left" in m for m in credwatch.ledger(root([{"name": "A", "state": "ok"}, {"name": "dom", "state": "ok", "expires": "2026-12-16"}]), TODAY)))
        self.assertEqual(credwatch.check(REPO), [])
        bad = scratch(); (bad / "doctrine").mkdir(); (bad / "doctrine/credwatch.json").write_text(json.dumps({"warn_days": 45, "credentials": [{"name": "Z", "kind": "mystery", "used_by": "x"}], "registrations": [{"name": "d", "expires": "soon"}]}))
        self.assertEqual(len(credwatch.check(bad)), 2)
        self.assertIn("foundation credwatch --run --apply", (REPO / ".github/workflows/watchdog.yml").read_text())


class PointAndClick(unittest.TestCase):
    """4.7: no surface asks a person to handle a credential."""
    ASKS = ["Create a personal access token first.", "Then paste the token here.", "Run wrangler secret put CLOUDFLARE_API_TOKEN.", "Use gh secret set FOO.", "export CLOUDFLARE_API_TOKEN=abc",
            "Set the GitHub secret named X.", "Mint your own token.", "You must install node.js.", "Run with --apply once.", "Store them as secrets in the repository."]

    def tree(self, text, baseline=()):
        d = root_with("doctrine/point-and-click.json")
        pol = json.loads((d / "doctrine/point-and-click.json").read_text()); pol["baseline"] = list(baseline)
        (d / "doctrine/point-and-click.json").write_text(json.dumps(pol))
        (d / "docs").mkdir(); (d / "docs/BOOTSTRAP-X.md").write_text(text)
        return d

    def test_us_30_r59_every_pattern_catches_its_instruction_and_a_click_instruction_passes(self):
        """US-30-R59: an instruction to create, paste, save or set a token, secret or setting, or to run a command, fails by file and line; a click does not."""
        for line in self.ASKS:
            errs = pointclick.check(self.tree(line + "\n"))
            self.assertEqual(len(errs), 1, line); self.assertIn("docs/BOOTSTRAP-X.md:1: tells a person to handle a token, secret or setting (POINT-AND-CLICK-1)", errs[0])
        d = self.tree("Click Authorize.\nThe system keeps the connection renewed.\nPaste a link into the chat.\n")
        self.assertEqual(pointclick.check(d), [])
        self.assertEqual(pointclick.check(self.tree("ok\nStep: create a personal access token\n"))[0].split(":")[1], "2")

    def test_us_30_r59_a_baseline_entry_is_tolerated_and_only_the_exact_line_is(self):
        """US-30-R59: a file and line on the baseline is tolerated and any other offender fails, and the real repository has no offender at all."""
        text = "Paste the token here.\nok\nCreate a new token.\n"
        self.assertEqual(len(pointclick.check(self.tree(text))), 2)
        self.assertEqual([e.split(": ")[0] for e in pointclick.check(self.tree(text, baseline=["docs/BOOTSTRAP-X.md:1"]))], ["docs/BOOTSTRAP-X.md:3"])
        self.assertEqual(pointclick.check(REPO), []); self.assertEqual(json.loads((REPO / "doctrine/point-and-click.json").read_text())["baseline"], [], "the baseline has shrunk to nothing")
        self.assertIn("seed/worker/src/**/*.js", json.loads((REPO / "doctrine/point-and-click.json").read_text())["scan_globs"])


    @unittest.expectedFailure
    def test_planned_the_ladder_card_texts_pass_the_no_token_prompt_patterns(self):
        """Closing probe of the PLANNED part of US-SPEC-30 (no requirement id): no card of foundation/data/credential-routes.json tells a person to create, mint or set a token. Today
        ORG-TOKEN and CF-TOKEN match the patterns of doctrine/point-and-click.json, and MODEL-KEY and SOC-ACCOUNTS read as the same kind of instruction; the file is not in scan_globs."""
        import re
        pol = json.loads((REPO / "doctrine/point-and-click.json").read_text()); pats = [re.compile(p, re.I) for p in pol["patterns"]]
        for name, c in json.loads((REPO / "foundation/data/credential-routes.json").read_text())["credentials"].items():
            card = c["card"]
            self.assertFalse(any(p.search(card["what"]) for p in pats), card["id"] + ": " + card["what"])
        self.assertIn("foundation/data/credential-routes.json", pol["scan_globs"])


class UserBackend(unittest.TestCase):
    """4.7: the user does the idea; the system does the backend."""

    def tree(self):
        d = scratch(); (d / "doctrine").mkdir(); shutil.copy(REPO / "doctrine/user-backend.json", d / "doctrine/user-backend.json")
        (d / "seed/worker/src").mkdir(parents=True); (d / "site").mkdir(); (d / "seed/worker/src/errors.js").write_text("export const userError = () => 0;\n")
        return d

    def test_us_30_r61_raw_error_text_in_a_response_or_on_a_page_fails_unless_it_is_logged_or_marked(self):
        """US-30-R61: a response or page that carries a caught error's text fails by file and line; a console line, a plain userError answer and a marked owner-only reply pass."""
        d = self.tree(); cfg = userbackend.load(d)
        cases = {'catch (e) { return json({ error: String(e && e.message || e) }, 500); }': "response-carries-raw-error", "catch(e){el.textContent='Failed: '+e.message}": "page-shows-raw-error"}
        for src, pid in cases.items():
            (d / "site/a.js").write_text(src + "\n"); found = userbackend.leaks(d, cfg)
            self.assertEqual(len(found), 1, src); self.assertIn("site/a.js:1: " + pid, found[0])
        for ok in ['console.error("x", json({ error: String(e) }));', 'return json({ error: String(e) }); // USER-BACKEND-OK: owner-only panel', 'const r = userError(e, "x"); return json({ error: r.error }, r.status);']:
            (d / "site/a.js").write_text(ok + "\n"); self.assertEqual(userbackend.leaks(d, cfg), [], ok)
        (d / "site/a.test.js").write_text('json({ error: String(e) })\n'); self.assertEqual(userbackend.leaks(d, cfg), [], "a test file is not a surface")

    def test_us_30_r61_every_worker_reaches_the_one_shared_errors_module_and_a_fork_of_it_fails(self):
        """US-30-R61: each named Worker must reach the one shared errors module through its imports, and a second definition of userError or a sibling fails; tenants inherit the rule."""
        d = self.tree(); cfg = userbackend.load(d)
        cfg["shared_consumers"] = [{"id": "errors", "module": "seed/worker/src/errors.js", "must_reach_from": ["site/worker.js"], "fork_patterns": [r"\bfunction\s+userError\b"]}]
        (d / "site/worker.js").write_text("export default {};\n"); self.assertTrue(any("does not consume the shared errors module" in x for x in userbackend.shared_failures(d, cfg)))
        (d / "site/helper.js").write_text('import { userError } from "../seed/worker/src/errors.js";\n'); (d / "site/worker.js").write_text('import "./helper.js";\n')
        self.assertEqual(userbackend.shared_failures(d, cfg), [], "reached through another module counts")
        (d / "site/fork.js").write_text("function userError(e) { return String(e); }\n"); self.assertTrue(any("forks the shared errors module" in x for x in userbackend.shared_failures(d, cfg)))
        self.assertEqual(userbackend.shared_failures(REPO, userbackend.load(REPO)), [])
        (d / "agents").mkdir(); (d / "agents/AGENTS.md").write_text("no rule here\n"); (d / "seed/agents").mkdir(parents=True); (d / "seed/agents/AGENTS.md").write_text("USER-BACKEND-1 present\n")
        self.assertTrue(any("agents/AGENTS.md: lacks the USER-BACKEND-1 rule" in x for x in userbackend.inheritance_failures(d, cfg)))
        self.assertEqual(userbackend.check(REPO), [])


if __name__ == "__main__":
    unittest.main()
