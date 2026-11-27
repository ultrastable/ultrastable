"""CLI. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation new-system --manifest instances/<slug>/instance.json --out ../<slug> [--apply]
  python3 -m foundation validate --manifest FILE
  python3 -m foundation ladder            # credential ladder against the host it runs on
  python3 -m foundation standards [--check|--apply|--probe ID|--commits|--live|--audit|--adopted ID]   standards register with measured decisions (STANDARDS-FIRST-1), surfaces, conformance lint, commit-title lint
  python3 -m foundation configschema [--check|--gen]   CONFIG-SCHEMA-1: every JSON config has a JSON Schema 2020-12 contract in a Schema Store catalog
  python3 -m foundation stdgen [--check|--gen]         STANDARDS-1: catalog-info.yaml (Backstage) and sbom.cdx.json (CycloneDX) from the registers
  python3 -m foundation filing --manifest FILE
  python3 -m foundation launch [--commit --push | --probe | --export-d1 F | --install SURFACE | --failover [--decide]]   start the loops on this repo (server-side hosts only)
  python3 -m foundation liveness [--json|--check|--file-items|--static|--probe ID]   are the autonomous loops actually running (evidence, not files)
  python3 -m foundation resilience [--run [--apply]|--report|--check|--probe ID]   every clock keeps ticking; stalled ones are restarted (RESILIENCE-1)
  python3 -m foundation verify [--check|--report]                          VERIFY-1: model-check the core loops and tie the models to the code
  python3 -m foundation ultrastability [--tick [--apply]|--check|--data [--apply]]  Ashby's two loops over essential variables (ULTRASTABILITY-1)
  python3 -m foundation freeadapt [--report|--run [--apply]|--probe CLASS|--levels|--check]  FREELY-ADAPTIVE-1: both verdicts on every action, three survival levels (Pérez López 1974)
  python3 -m foundation ashbyarchive [--build DIR [--apply]|--report|--run [--apply]|--probe ID|--live|--check]  ASHBY-ARCHIVE-1: Ashby's journal index as a register, every entry disposed
  python3 -m foundation lessons [--check]  every lesson bound to enforcing code or an open item (LESSONS-1)
  python3 -m foundation specgate [--check]  work items an agent cannot misread: done check, prediction, out of scope, live proof (SPEC-GATE-1)
  python3 -m foundation criticality [--tick [--apply]|--check|--gate]     the mantra as a computed invariant (CRITICALITY-1)
  python3 -m foundation liveclaims [--check|--live]                         public copy describes only what is live: no promised features, every system host probed (LIVE-CLAIMS-1)
  python3 -m foundation claimcode [--check|--baseline|--list]                words match code: every number, cadence or guarantee on a public surface is bound to a probe (WORDS-MATCH-CODE-1)
  python3 -m foundation pointclick [--check|--baseline]                    no surface asks a person to handle a token, secret or setting (POINT-AND-CLICK-1)
  python3 -m foundation loopowner [--check|--sync]                        every loop has a server-side owner and path (SERVER-OWNS-LOOPS-1)
  python3 -m foundation research [--check|--run [--apply]|--probe S:F|--intake [--apply]|--report]  RESEARCH-1: own R&D loop and white papers at /research
  python3 -m foundation thought [--check|--preview|--run [--apply]]  THOUGHT-1: each white paper becomes posts (belief, measured record, the Ultrastable hook) for every channel
  python3 -m foundation unattended [--check|--horizon|--probe ID]           UNATTENDED-365: one year with zero external input; every remaining input is closed, a gate or an item
  python3 -m foundation modelwatch [--check|--status|--refresh [--apply]]  MODEL-WATCH-1: no retired hosted model id in source
  python3 -m foundation redmain [--run [--apply]|--check]                  REDMAIN-1: a red deploy gate on main is repaired by reverting the smallest change that broke it
  python3 -m foundation tenantrepos [--check|--missing|--prepare DIR --slug S|--behind]   TENANT-REPO-1: every tenant app lives in its own repository
  python3 -m foundation seedlife [--check|--status [SLUG]|--verify [--apply]|--run [--apply]|--probe SLUG]   SEED-LIFECYCLE-1: every seed is built, deployed, live and a year unattended
  python3 -m foundation openstd [--check|--baseline]   OPEN-STANDARDS-1: open standards, no home-grown formats
  python3 -m foundation compatdate [--check|--run [--apply]]   COMPAT-DATE-1: Worker compatibility dates advance by a loop
  python3 -m foundation runway [--run [--apply]|--probe C|--check]         RUNWAY-1: projected days of unattended running against the one-year target
  python3 -m foundation credwatch [--run [--apply]|--check]                TOKEN-EXPIRY-1: every credential the loops use is probed for expiry before it lapses
  python3 -m foundation openloops [--check]                                NO-OPEN-ITEMS-1: no "needs you"; every leftover is closed or a recorded gate
  python3 -m foundation failmine [--run [--apply]|--report|--probe HASH|--check]   FAILMINE-1: mine every failure record, classify root causes, register new modes, escalate recurrence
  python3 -m foundation intentyield [--run [--apply]|--probe|--check|--report]   INTENT-YIELD-1: owner directives kept per unit of attention; no counts, no person scored
  python3 -m foundation temporal [--run [--apply]|--settled ID|--probe|--check|--report]   TEMPORAL-1: series per area, loop and entry; hotspots, neglect and stopped loops feed the failure-mode machinery
  python3 -m foundation constitution [--check|--fresh|--render]   CONSTITUTION-1: the seed states what an ultrastable system is; every rule has a detector and a remediation in code
  python3 -m foundation systemspec [--check|--write|--gaps|--rule ID]   SYSTEM-SPEC-1: seed/SYSTEM.md, the definition every system carries, generated from code and probed
  python3 -m foundation bootaccept [--run|--probe|--url U --repo O/R|--check]   BOOT-ACCEPT-1: nothing to repo, back end, web UI, graph, discovery and health, read live
  python3 -m foundation bootproof [--check]   BOOTPROOF-1: the seed kernel is closed under bootstrap (instructions, placeholders, secrets, triggers)
  python3 -m foundation seedlaunch [--e2e [--keep]|--fleet|--check]   SEED-LAUNCH-1: every seed built, deployed, year-gated and probed live by the system
  python3 -m foundation repostd [--check|--plan|--live|--apply|--branches]   REPO-STANDARD-1: one repository standard for every repository of the org
  python3 -m foundation discover [--gen|--check|--live]                    DISCOVER-1: every system is listed, cross-linked and findable
  python3 -m foundation cleanroom [--run [--apply] [--ticks N]|--probe ID|--check]   CLEANROOM-1: a sandbox system boots from the seed alone, runs a day, tears down
  python3 -m foundation coherence [--check [--remote]|--report]   COHERENCE-1: no instruction surface or generated agent file contradicts the closed-loop axiom; every rule names code and reaches the seed
  python3 -m foundation fullstack [--check|--live|--probe ID|--list]        FULLSTACK-1: every system has a repository, a back end and a public front end
  python3 -m foundation reposhape [--check|--report|--probe state|--pr BASE...HEAD|--split BASE...HEAD [--apply]]   REPO-SHAPE-1: every path is classified, a session PR stays in budget, an oversize branch splits into a stack
  python3 -m foundation collisions [--check|--prs [--pr N]|--claim ID]   COLLISION-1: no two migrations share a number; a PR may not add what an older open PR adds
  python3 -m foundation datagraph [--check|--list|--live]                        DATAGRAPH-1: every system keeps a knowledge graph of all its data
  python3 -m foundation livelinks [--check [--readme PATH --id ID]|--write README --id ID|--block ID|--live]   LIVE-LINKS-1: every README says where its code runs
  python3 -m foundation fleetcontract [--check|--live [--apply|--record]|--probe ID|--list]   FLEET-CONTRACT-1: one contract per system; statements hold front to back and back to front
  python3 -m foundation tenantstd [--check [--tenant PATH]|--scaffold PATH --slug S|--measure PATH|--table PATH...|--live]   TENANT-STANDARD-1: one standard, one scaffold and one check for every tenant repository
  python3 -m foundation managers [--check|--report [--with-live]|--live]   MANAGERS-1: every manager role is a running loop that owns code; the seed carries every manager
  python3 -m foundation fleetmap [--check|--drift [--apply]|--probe REPO|--list]   FLEET-MAP-1: one map of every repository; a copy that differs from its source is never ok
  python3 -m foundation surfaces [--check|--render|--plan [github|wellknown|publiccode]] [--root DIR]   SYSTEM-MANIFEST-1: one manifest per system; every surface rendered from it
  python3 -m foundation rulerefs [--check|--list|--reverse|--seed|--exec|--live]             RULE-REFS-1: every path, command, test, workflow and endpoint a rule names resolves; code nothing names is listed
  python3 -m foundation tenantpromo [--check|--list]                      TENANT-PROMO-1: every tenant promotes itself (social queue, showcase, cross-links)
  python3 -m foundation admit [--check|--apply [--slug S]|--list]          ADMIT-1: one tenant-repos row admits a tenant; every other registry is derived
  python3 -m foundation progress [--check|--live]                          PROGRESS-1: every system shows substantive progress at every visit; the cadence monitor is wired
  python3 -m foundation cost [--check|--probe|--guard [--apply]]          D1 rows read and AI neurons against budgets (COST-GUARD-1)
  python3 -m foundation issueloop [--apply|--json]                       ISSUE-LOOP-1: every open issue's probe is run; a passing probe closes it
  python3 -m foundation prsafe --recover [--apply]                         PR-NEVER-LOSE-1: reopens a PR automation closed that main still lacks; --check fails while one is lost
  python3 -m foundation prbound [--check|--apply]                        PR-BOUND-1: closes a PR whose conflict has stood 30 min or whose failed check 60 min (branch kept); --check fails on any PR open past 2 h
  python3 -m foundation ladderwatch [--check|--hours N]                  LADDER-LIVE-1: the code-agent ladder returns answers; fails when executor items are shelved because every rung failed
  python3 -m foundation agewatch [--check]                                 SLA-8H-1: oldest open issue and PR per org repository; fails past 8 hours
  python3 -m foundation ghmirror [--plan|--apply [--max N]|--check]       GH-MIRROR-1: the docs/issues queue mirrored one way onto GitHub Issues, labels, milestones and the board
  python3 -m foundation claims [--check|--fix|--apply|--file|--live]     CLAIMS-1: every claim on a surface is probed against code, both directions; /claims
  python3 -m foundation goalscheck [--check]                              GOALS-1: every goal has a measured variable, a deadline and a knob
  python3 -m foundation singleaccount [--check|--scan]                    SINGLE-ACCOUNT-1: nothing references the retired quniverse Cloudflare account
  python3 -m foundation template [--check|--list]                         the template carries code and agent instructions only (TEMPLATE-CODE-ONLY-1)
  python3 -m foundation serverside [--check|--scan]                       server-side only: no host, scheduler, agent or route on a person's computer
  python3 -m foundation selfhost [--verify|--gaps|--no-node] [--db PATH]   Ultrastable boots its own organization from this repo
  python3 -m foundation glossary [--check|--apply|--show [ID]]            the owner's keywords, with tests, code and lineage
  python3 -m foundation loops [--verify|--list]                           the loop registry and its closing verifier
  python3 -m foundation kernel [--check|--lint FILE...|--metrics FILE...] the doctrine kernel as code
  python3 -m foundation kernel9 [--check [--json]]  KERNEL-9-1: kernel 9.2.0 clauses each bound to an existing enforcer and metric, byte budgets, vetoed irreversible step classes
  python3 -m foundation userbackend [--check|--scan]                      USER-BACKEND-1: no raw backend error reaches a user; one shared module per fix, every Worker consumes it
  python3 -m foundation standingorder [--check|--lint FILE...|--file-items|--baseline]  CODE-ONLY-ORDER: decisions live in code the system consumes; no report hands a decision to the owner
  python3 -m foundation directive [--check|--lint FILE...|--ledger|--probe|--bootstrap] the guiding directive as code
  python3 -m foundation docs_audit [--check|--report|--orphans|--humans]  every document must have a consumer (code, check, instruction import, generator)
  python3 -m foundation trust [--show|--event SURFACE ACTION EVENT|--tick] the trust ledger and ladder
  python3 -m foundation substance [--range A..B|--gate|--deploy-gate|--report [--apply]|--check]   SUBSTANCE-1: only changes that alter executable behaviour count, open a PR or deploy
  python3 -m foundation executor [--apply] [--issue N]                    pick the top issue, change, check, open a PR (--pick, --record: the key-free session route)
  python3 -m foundation upstream contract|adopt|sync|check|drift|leaks   core/instance link: pin, flow down, send up, drift, bring your own repo
  python3 -m foundation branchsweep [--scan|--apply|--prune|--check]  BRANCH-SWEEP-1: no remote branch carries work main lacks
  python3 -m foundation sessions [--scan|--apply|--meta|--check]       SESSION-CLOSE-1: no zombie branches or PRs; the loop tunes itself
  python3 -m foundation strays [--check|--list [--json]]                  STRAYS-1: no code file where nothing runs it; no workflow outside .github/workflows
  python3 -m foundation cfposture [--check|--probe [--apply]|--rule ID]       CF-POSTURE-1: the Cloudflare account's settings, declared and measured live
  python3 -m foundation orphans [--check|--metrics|--baseline|--issue-body|--sync-issue OWNER/REPO]   ORPHANS-1: no orphan artifact, no human-wait
  python3 -m foundation components [--check|--report|--file-gaps|--evidence|--probe KIND:ID]   the system as a computed graph: gaps, stories, objections
  python3 -m foundation lifecycle [--open|--beat|--close|--reap|--check|--improve|--score|--report|--hooks]   no zombie sessions; loops that score and mutate themselves
  python3 -m foundation triggers [--check|--sync|--plan]   time (cron heartbeat) and event (webhook) triggers, drift-checked
  python3 -m foundation team [--gate|--check|--apply|--recommend --manifest F]   the phased virtual team (doctrine/team.json)
  python3 -m foundation publication [--check|--baseline|--history DIR]   PUBLICATION-GUARD-1: license, notice files, no case collisions, SPDX ratchet, no private data
  python3 -m foundation pins [--check|--apply|--report]                  PINS-1: every status pin and roadmap item on the site is computed from code, proofs and issues
  python3 -m foundation phasework [new|next|done|status|--check]  PHASED-WORK-1: audit, coverage, implement, verify, fix, integrate, final gate
  python3 -m foundation worklog [start|beat|finish|list|reap|backfill|--check]   WORK-RECORD-1: the canonical work store (GitHub issues labelled work)
  python3 -m foundation agentwork [--apply|--probe-kill|--check]            AGENT-WORK-1: caps and kill switch for the Actions code agent; files Q-UNK work
  python3 -m foundation decisions [--check|--settle|--backfill|--probe|--status|--page|--baseline] [--apply]  DECISIONS-1: every decision logs its metric, predicted effect and measured outcome; /decisions
  python3 -m foundation rules [--check|--run [--apply] [--due]|--probe NAME|--status|--panel]  RULES-1: every standing rule maps to a CI check and a runtime probe; violations file and fix themselves
  python3 -m foundation mergeaudit [--run [--apply]|--probe N|--check]  MERGE-AUDIT-1: a PR merged without a green `checks` run becomes a queue item
  python3 -m foundation ciwatch [--run [--apply]|--probe REPO WORKFLOW|--check]  CIWATCH-1: red X's on any watched repo are rerun or filed as queue items
  python3 -m foundation rootcause [--run|--check|--report]               ROOTCAUSE-1: every finding traced to its root cause; recurrence escalates to the root
  python3 -m foundation failure_audit [--run|--check]                    FAILURE-AUDIT-1: live detectors for every failure mode; failures file their own issues
  python3 -m foundation flows [--check|--map]                             FLOW-DIRECTIVE-1: every loop declares inflows, outflows and its feedback path
  python3 -m foundation driftguard [--check|--crons [--live]|--triggers [--apply]|--empty-commits|--accounts-live|--visibility-live|--built-live|--handoff-lint [FILE]]  DRIFT-GUARD-1: each root-cause class of 2026-11-25 has a check
  python3 -m foundation outreach [--rank|--selftest|--check]              OUTREACH-1: replies reward a segment; UCB1 orders the next intro queue
  python3 -m foundation metasignal [--check|--scan F|--ingest F [--apply]]  META-SIGNAL-1: sentiment, frustration, mic events and ideas feed the roadmap
  python3 -m foundation unknowns [--check|--run [--apply]|--answer KEY --verdict V --text T|--status]   UNKNOWNS-1: audit what the system does not know; inverted questions feed the objective space
  python3 -m foundation blindspots [--check|--scan [--apply] [--live]|--answer D --text T|--learn ID ...]   BLINDSPOT-1: the system knows what the owner cannot know to ask for
  python3 -m foundation ideas [--headroom|--brainstorm|--queue|--roadmap|--check] [--apply]   SPINOFF-IDEAS-1: propose, score and queue spinoffs and loop scope against free-plan headroom
  python3 -m foundation spinoff [--ideate|--launch [--apply]|--metrics SLUG|--collect [--apply]|--tick [--apply]|--check]   SPINOFF-1: the system generates, launches, measures and prunes its own apps
  python3 -m foundation promote [--check|--kits|--plan [--apply]|--outcome CH --kind K]   PROMOTE-1: strategy and promotion as a closed loop
  python3 -m foundation provenance [--check|--record JSON|--settle ID kept|reverted|none|--ingest-git [--apply]|--timeline|--changelog [--apply]|--lessons|--signal]  PROVENANCE-1: origin, effect and history of every input and change
  python3 -m foundation writeback record|check|outputs                    knowledge write-back into the repository
  python3 -m foundation sauce [--tick [--apply]|--check|--parity SLUG DIR]  QNFO-PORT-1: contracts, fold, throughput, metric loop, ignition gaps
  python3 -m foundation contracts [--tick [--apply]|--report]             CONTRACTS-1: close on the item's own probe, reopen on relapse, hold after a reopen
  python3 -m foundation metricloop [--tick [--apply]|--probe ID|--check]  METRIC-LOOP-1: breach -> remedy item -> efficacy -> replace a remedy that did not move
  python3 -m foundation throughput [--tick [--apply]|--report|--doer FAM] THROUGHPUT-1: net inflow per family; a family with no doer gets a build-the-doer item
  python3 -m foundation adopt --repo DIR [--apply|--check]                 ADOPT-1: wrap loops around an existing repository (scan, kernel, gaps as items)
  python3 -m foundation rescore [--run [--apply]|--check|--status]        RESCORE-1: a held-out grader re-scores settled predictions; disagreement files an item
  python3 -m foundation owndb [--check|--write]                           OWN-DB-1: core databases are the core's own; no tenant or originating-fleet database is bound
  python3 -m foundation tenantcontrols [--check|--write]                  TENANT-CONTROLS-1: the hosted tier stays closed until every multi-tenant control is proven
  python3 -m foundation metafold [--tick [--apply]]                       META-FOLD-1: tickets about another record close when that record resolves
"""
import argparse, datetime as dt, json, os, sys

from . import boundary, closedloop, standards, doctrine, directive, filing, glossary, kernel, ladder, loops, manifest as mf, scaffold, selfhost, trust, writeback


# Commands parsed by the argparse block at the end of main(); every other name resolves to a module (COLDSTART-1).
ARGPARSE_COMMANDS = frozenset({"new-system", "validate", "ladder", "doctrine", "selfhost", "glossary", "loops", "kernel", "closedloop", "directive",
                               "trust", "docs_audit", "needsyou", "executor", "upstream", "writeback", "standards", "filing", "autorun", "cockpit", "launch"})


def resolve(name: str):
    """The foundation module that answers `python3 -m foundation <name>`, or None. A module answers when foundation/<name>.py exists and defines main."""
    import importlib, re as _re
    from pathlib import Path as _P
    if not _re.fullmatch(r"[a-z][a-z0-9_]*", name or "") or not (_P(__file__).resolve().parent / f"{name}.py").exists():
        return None
    m = importlib.import_module("foundation." + name)
    return m if callable(getattr(m, "main", None)) else None


def main(argv=None) -> int:
    from . import cfaccount
    cfaccount.scrub()  # SINGLE-ACCOUNT-2: never act on a retired Cloudflare account
    import sys as _s
    _av = _s.argv[1:] if argv is None else list(argv)
    if _av[:1] == ["findable"]:
        from . import findable
        return findable.main(_av[1:])
    if _av[:1] == ["deprot"]:
        from . import deprot
        return deprot.main(_av[1:])
    if _av[:1] == ["failmine"]:
        from . import failmine
        return failmine.main(_av[1:])
    if _av[:1] == ["yearfail"]:
        from . import yearfail
        return yearfail.main(_av[1:])
    if _av[:1] == ["semrel"]:
        from . import semrel
        return semrel.main(_av[1:])
    if _av[:1] == ["openstd"]:
        from . import openstd
        return openstd.main(_av[1:])
    if _av[:1] == ["compatdate"]:
        from . import compatdate
        return compatdate.main(_av[1:])
    if _av[:1] == ["tenantrepos"]:
        from . import tenantrepos
        return tenantrepos.main(_av[1:])
    if _av[:1] == ["seedlife"]:
        from . import seedlife
        return seedlife.main(_av[1:])
    if _av[:1] == ["unattended"]:
        from . import unattended
        return unattended.main(_av[1:])
    if _av[:1] == ["modelwatch"]:
        from . import modelwatch
        return modelwatch.main(_av[1:])
    if _av[:1] == ["adopt"]:
        from . import adopt
        return adopt.main(_av[1:])
    if _av[:1] == ["rescore"]:
        from . import rescore
        return rescore.main(_av[1:])
    if _av[:1] == ["owndb"]:
        from . import owndb
        return owndb.main(_av[1:])
    if _av[:1] == ["tenantcontrols"]:
        from . import tenantcontrols
        return tenantcontrols.main(_av[1:])
    if _av[:1] == ["userbackend"]:
        from . import userbackend
        return userbackend.main(_av[1:])
    if _av[:1] == ["standingorder"]:
        from . import standingorder
        return standingorder.main(_av[1:])
    if _av[:1] == ["blindspots"]:
        from . import blindspots
        return blindspots.main(_av[1:])
    if _av[:1] == ["licences"]:
        from . import licences
        return licences.main(_av[1:])
    if _av[:1] == ["backup"]:
        from . import backup
        return backup.main(_av[1:])
    if _av[:1] == ["ideas"]:
        from . import ideas
        return ideas.main(_av[1:])
    if _av[:1] == ["spinoff"]:
        from . import spinoff
        return spinoff.main(_av[1:])
    if _av[:1] == ["promote"]:
        from . import promote
        return promote.main(_av[1:])
    if _av[:1] == ["thought"]:
        from . import thought
        return thought.main(_av[1:])
    if _av[:1] == ["research"]:
        from . import research
        return research.main(_av[1:])
    if _av[:1] == ["rnd"]:
        from . import rnd
        return rnd.main(_av[1:])
    if _av[:1] == ["scout"]:
        from . import scout
        return scout.main(_av[1:])
    if _av[:1] == ["metasignal"]:
        from . import metasignal
        return metasignal.main(_av[1:])
    if _av[:1] == ["outreach"]:
        from . import outreach
        return outreach.main(_av[1:])
    if _av[:1] == ["publication"]:
        from . import publication
        return publication.main(_av[1:])
    if _av[:1] == ["pins"]:
        from . import pins
        return pins.main(_av[1:])
    if _av[:1] == ["phasework"]:
        from . import phasework
        return phasework.main(_av[1:])
    if _av[:1] == ["worklog"]:
        from . import worklog
        return worklog.main(_av[1:])
    if _av[:1] == ["agentwork"]:
        from . import agentwork
        return agentwork.main(_av[1:])
    if _av[:1] == ["decisions"]:
        from . import decisions
        return decisions.main(_av[1:])
    if _av[:1] == ["rules"]:
        from . import rules
        return rules.main(_av[1:])
    if _av[:1] == ["mergeaudit"]:
        from . import mergeaudit
        return mergeaudit.main(_av[1:])
    if _av[:1] == ["ciwatch"]:
        from . import ciwatch
        return ciwatch.main(_av[1:])
    if _av[:1] == ["rootcause"]:
        from . import rootcause
        return rootcause.main(_av[1:])
    if _av[:1] == ["driftguard"]:  # DRIFT-GUARD-1
        from . import driftguard
        return driftguard.main(_av[1:])
    if _av[:1] == ["selftest"]:  # SELFTEST-1
        from . import selftest
        return selftest.main(_av[1:])
    if _av[:1] == ["staticcontent"]:  # STATIC-CONTENT-1 (detector static-content was unroutable: SILENT-FAIL-1 routes check)
        from . import staticcontent
        return staticcontent.main(_av[1:])
    if _av[:1] == ["slawatch"]:
        from . import slawatch
        return slawatch.main(_av[1:])
    if _av[:1] == ["silentfail"]:  # SILENT-FAIL-1
        from . import silentfail
        return silentfail.main(_av[1:])
    if _av[:1] == ["failure_audit"]:
        from . import failure_audit
        return failure_audit.main(_av[1:])
    if _av[:1] == ["prioritize"]:
        from . import prioritize
        return prioritize.main(_av[1:])
    if _av[:1] == ["queue"]:
        from . import queue
        return queue.main(_av[1:])
    if _av[:1] == ["fleet"]:
        from . import fleet
        return fleet.main(_av[1:])
    if _av[:1] == ["pm"]:
        from . import pm
        return pm.main(_av[1:])
    if _av[:1] == ["design"]:
        from . import design
        return design.main(_av[1:])
    if _av[:1] == ["provenance"]:
        from . import provenance
        return provenance.main(_av[1:])
    if _av[:1] == ["tenantsync"]:
        from . import tenantsync
        return tenantsync.main(_av[1:])
    if _av[:1] == ["improve"]:
        from . import improve
        return improve.main(_av[1:])
    if _av[:1] == ["reach"]:
        from . import reach
        return reach.main(_av[1:])
    if _av[:1] == ["proofown"]:
        from . import proofown
        return proofown.main(_av[1:])
    if _av[:1] == ["uiux"]:
        from . import uiux
        return uiux.main(_av[1:])
    if _av[:1] == ["insight"]:
        from . import insight
        return insight.main(_av[1:])
    if _av[:1] == ["growth"]:
        from . import growth
        return growth.main(_av[1:])
    if _av[:1] == ["flows"]:
        from . import flows
        return flows.main(_av[1:])
    if _av[:1] and _av[0] in ("sauce", "redteam", "contracts", "metricloop", "throughput", "metafold", "dispose", "balance", "yearsim", "saydo", "trajectory", "seedadmit"):
        import importlib
        return importlib.import_module("foundation." + _av[0]).main(_av[1:])
    if _av[:1] and _av[0] in ("configschema", "stdgen"):  # STANDARDS-1
        import importlib
        return importlib.import_module("foundation." + _av[0]).main(_av[1:])
    if _av[:1] == ["unknowns"]:
        from . import unknowns
        return unknowns.main(_av[1:])
    if _av[:1] == ["ignorance"]:
        from . import ignorance
        return ignorance.main(_av[1:])
    if _av[:1] == ["resilience"]:
        from . import resilience
        return resilience.main(_av[1:])
    if _av[:1] == ["selfmodel"]:
        from . import selfmodel
        return selfmodel.main(_av[1:])
    if _av[:1] == ["verify"]:
        from . import verify
        return verify.main(_av[1:])
    if _av[:1] == ["lessons"]:
        from . import lessons
        return lessons.main(_av[1:])
    if _av[:1] == ["specgate"]:
        from . import specgate
        return specgate.main(_av[1:])
    if _av[:1] == ["ultrastability"]:
        from . import ultrastability
        return ultrastability.main(_av[1:])
    if _av[:1] == ["criticality"]:
        from . import criticality
        return criticality.main(_av[1:])
    if _av[:1] == ["liveclaims"]:
        from . import liveclaims
        return liveclaims.main(_av[1:])
    if _av[:1] == ["claimcode"]:
        from . import claimcode
        return claimcode.main(_av[1:])
    if _av[:1] == ["pointclick"]:
        from . import pointclick
        return pointclick.main(_av[1:])
    if _av[:1] == ["needsyou"] and "--settle" in _av:
        from . import needsyou
        return needsyou.main(_av[1:])
    if _av[:1] == ["redmain"]:
        from . import redmain
        return redmain.main(_av[1:])
    if _av[:1] == ["runway"]:
        from . import runway
        return runway.main(_av[1:])
    if _av[:1] == ["credwatch"]:
        from . import credwatch
        return credwatch.main(_av[1:])
    if _av[:1] == ["pathfinder"]:
        from . import pathfinder
        return pathfinder.main(_av[1:])
    if _av[:1] == ["openloops"]:
        from . import openloops
        return openloops.main(_av[1:])
    if _av[:1] == ["constitution"]:
        from . import constitution
        return constitution.main(_av[1:])
    if _av[:1] == ["bootproof"]:
        from . import bootproof
        return bootproof.main(_av[1:])
    if _av[:1] == ["seedlaunch"]:
        from . import seedlaunch
        return seedlaunch.main(_av[1:])
    if _av[:1] == ["systemspec"]:
        from . import systemspec
        return systemspec.main(_av[1:])
    if _av[:1] == ["bootaccept"]:
        from . import bootaccept
        return bootaccept.main(_av[1:])
    if _av[:1] == ["intentyield"]:
        from . import intentyield
        return intentyield.main(_av[1:])
    if _av[:1] == ["temporal"]:
        from . import temporal
        return temporal.main(_av[1:])
    if _av[:1] == ["repostd"]:
        from . import repostd
        return repostd.main(_av[1:])
    if _av[:1] == ["discover"]:
        from . import discover
        return discover.main(_av[1:])
    if _av[:1] == ["cleanroom"]:
        from . import cleanroom
        return cleanroom.main(_av[1:])
    if _av[:1] == ["coherence"]:
        from . import coherence
        return coherence.main(_av[1:])
    if _av[:1] == ["fullstack"]:
        from . import fullstack
        return fullstack.main(_av[1:])
    if _av[:1] == ["contentdrift"]:
        from . import contentdrift
        return contentdrift.main(_av[1:])
    if _av[:1] == ["reposhape"]:
        from . import reposhape
        return reposhape.main(_av[1:])
    if _av[:1] == ["collisions"]:
        from . import collisions
        return collisions.main(_av[1:])
    if _av[:1] == ["livelinks"]:
        from . import livelinks
        return livelinks.main(_av[1:])
    if _av[:1] == ["fleetcontract"]:
        from . import fleetcontract
        return fleetcontract.main(_av[1:])
    if _av[:1] == ["tenantstd"]:
        from . import tenantstd
        return tenantstd.main(_av[1:])
    if _av[:1] == ["managers"]:
        from . import managers
        return managers.main(_av[1:])
    if _av[:1] == ["surfaces"]:
        from . import surfaces
        return surfaces.main(_av[1:])
    if _av[:1] == ["fleetmap"]:
        from . import fleetmap
        return fleetmap.main(_av[1:])
    if _av[:1] == ["rulerefs"]:
        from . import rulerefs
        return rulerefs.main(_av[1:])
    if _av[:1] == ["datagraph"]:
        from . import datagraph
        return datagraph.main(_av[1:])
    if _av[:1] == ["admit"]:
        from . import admit
        return admit.main(_av[1:])
    if _av[:1] == ["tenantpromo"]:
        from . import tenantpromo
        return tenantpromo.main(_av[1:])
    if _av[:1] == ["progress"]:
        from . import progress
        return progress.main(_av[1:])
    if _av[:1] == ["loopowner"]:
        from . import loopowner
        return loopowner.main(_av[1:])
    if _av[:1] == ["tenantstorage"]:
        from . import tenantstorage
        return tenantstorage.main(_av[1:])
    if _av[:1] == ["cost"]:
        from . import cost
        return cost.main(_av[1:])
    if _av[:1] == ["clock"]:
        from . import clock
        return clock.main(_av[1:])
    if _av[:1] == ["drainwatch"]:
        from . import drainwatch
        return drainwatch.main(_av[1:])
    if _av[:1] == ["checksrun"]:
        from . import checksrun
        return checksrun.main(_av[1:])
    if _av[:1] == ["platformaudit"]:
        from . import platformaudit
        return platformaudit.main(_av[1:])
    if _av[:1] == ["topology"]:
        from . import topology
        return topology.main(_av[1:])
    if _av[:1] == ["substance"]:
        from . import substance
        return substance.main(_av[1:])
    if _av[:1] == ["mechfix"]:
        from . import mechfix
        return mechfix.main(_av[1:])
    if _av[:1] == ["selfcode"]:
        from . import selfcode
        return selfcode.main(_av[1:])
    if _av[:1] == ["redmerge"]:  # RED-MERGE-1: foundation/redmerge.py
        from . import redmerge
        return redmerge.main(_av[1:])
    if _av[:1] == ["statesink"]:  # STATE-SINK-1: foundation/statesink.py
        from . import statesink
        return statesink.main(_av[1:])
    if _av[:1] == ["jobtrust"]:  # JOB-TRUST-1: foundation/jobtrust.py
        from . import jobtrust
        return jobtrust.main(_av[1:])
    if _av[:1] == ["deploydrift"]:  # DEPLOY-DRIFT-1: foundation/deploydrift.py
        from . import deploydrift
        return deploydrift.main(_av[1:])
    if _av[:1] == ["routehealth"]:  # ROUTE-CANARY-1: foundation/routehealth.py
        from . import routehealth
        return routehealth.main(_av[1:])
    if _av[:1] == ["conclusions"]:  # CONCLUSION-CACHE-1: foundation/conclusions.py
        from . import conclusions
        return conclusions.main(_av[1:])
    if _av[:1] == ["impact"]:  # IMPACT-TESTS-1: foundation/impact.py
        from . import impact
        return impact.main(_av[1:])
    if _av[:1] == ["sampleaudit"]:  # SAMPLE-AUDIT-1: foundation/sampleaudit.py
        from . import sampleaudit
        return sampleaudit.main(_av[1:])
    if _av[:1] == ["tokenlog"]:  # TOKEN-LOG-1: foundation/tokenlog.py
        from . import tokenlog
        return tokenlog.main(_av[1:])
    if _av[:1] == ["perceptcost"]:  # PERCEPT-COST-1: foundation/perceptcost.py
        from . import perceptcost
        return perceptcost.main(_av[1:])
    if _av[:1] == ["repomap"]:  # REPO-MAP-1: foundation/repomap.py
        from . import repomap
        return repomap.main(_av[1:])
    if _av[:1] == ["churn"]:  # CHURN-GUARD-1: foundation/churn.py
        from . import churn
        return churn.main(_av[1:])
    if _av[:1] == ["regulator"]:  # CODE-REGULATOR-1: foundation/regulator/
        from .regulator import cli as _regcli
        return _regcli.main(_av[1:])
    if _av[:1] == ["identities"]:  # IDENTITIES-1: foundation/identities.py
        from . import identities
        return identities.main(_av[1:])
    if _av[:1] == ["testguard"]:  # TESTS-PROTECTED-1: foundation/testguard.py
        from . import testguard
        return testguard.main(_av[1:])
    if _av[:1] == ["agent_ladder"]:
        from . import agent_ladder
        return agent_ladder.main(_av[1:])
    if _av[:1] == ["transparency"]:
        from . import transparency
        return transparency.main(_av[1:])
    if _av[:1] == ["components"]:
        from . import components
        return components.main(_av[1:])
    if _av[:1] == ["lifecycle"]:
        from . import lifecycle
        return lifecycle.main(_av[1:])
    if _av[:1] == ["triggers"]:
        from . import triggers
        return triggers.main(_av[1:])
    if _av[:1] == ["team"]:
        from . import team
        return team.main(_av[1:])
    if _av[:1] == ["market"]:
        from . import market
        return market.main(_av[1:])
    if _av[:1] == ["conflicts"]:
        from . import conflicts
        return conflicts.main(_av[1:])
    if _av[:1] == ["lanewatch"]:
        from . import lanewatch
        return lanewatch.main(_av[1:])
    if _av[:1] == ["system"]:
        from . import system
        return system.main(_av[1:])
    if _av[:1] == ["agents"]:
        from . import agents
        return agents.main(_av[1:])
    if _av[:1] == ["agentstd"]:
        from . import agentstd
        return agentstd.main(_av[1:])
    if _av[:1] == ["crosswalk"]:
        from . import crosswalk
        return crosswalk.main(_av[1:])
    if _av[:1] == ["boundary"]:
        return boundary.main(_av[1:])
    if _av[:1] == ["closedloop"]:
        return closedloop.main(_av[1:])
    if _av[:1] == ["selfimprove"]:
        from . import selfimprove
        return selfimprove.main(_av[1:])
    if _av[:1] == ["liveness"]:
        from . import liveness
        return liveness.main(_av[1:])
    if _av[:1] == ["prsafe"]:
        from . import prsafe
        return prsafe.main(_av[1:])
    if _av[:1] == ["prbound"]:
        from . import prbound
        return prbound.main(_av[1:])
    if _av[:1] == ["ladderwatch"]:
        from . import ladderwatch
        return ladderwatch.main(_av[1:])
    if _av[:1] == ["agewatch"]:
        from . import agewatch
        return agewatch.main(_av[1:])
    if _av[:1] == ["ghmirror"]:
        from . import ghmirror
        return ghmirror.main(_av[1:])
    if _av[:1] == ["issueloop"]:
        from . import issueloop
        return issueloop.main(_av[1:])
    if _av[:1] == ["claims"]:
        from . import claims
        return claims.main(_av[1:])
    if _av[:1] == ["goalscheck"]:
        from . import goalscheck
        return goalscheck.main(_av[1:])
    if _av[:1] == ["singleaccount"]:
        from . import singleaccount
        return singleaccount.main(_av[1:])
    if _av[:1] == ["template"]:
        from . import template
        return template.main(_av[1:])
    if _av[:1] == ["serverside"]:
        from . import serverside
        return serverside.main(_av[1:])
    args0 = sys.argv[1:] if argv is None else list(argv)
    if args0[:1] == ["branchsweep"]:
        from . import branchsweep
        return branchsweep.main(args0[1:])
    if args0[:1] == ["sessions"]:
        from . import sessions
        return sessions.main(args0[1:])
    if args0[:1] == ["strays"]:
        from . import strays
        return strays.main(args0[1:])
    if args0[:1] == ["cfposture"]:
        from . import cfposture
        return cfposture.main(args0[1:])
    if args0[:1] == ["orphans"]:
        from . import orphans
        return orphans.main(args0[1:])
    if args0[:1] == ["upstream"]:
        from . import upstream
        return upstream.main(args0[1:])
    mod = resolve(args0[0]) if args0 and args0[0] not in ARGPARSE_COMMANDS else None
    if mod is not None:  # COLDSTART-1: every foundation module with main() is a command from birth; no hand-kept dispatch list
        return mod.main(args0[1:])
    ap = argparse.ArgumentParser(prog="foundation", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new-system"); n.add_argument("--manifest", required=True); n.add_argument("--out", required=True); n.add_argument("--apply", action="store_true"); n.add_argument("--date")
    v = sub.add_parser("validate"); v.add_argument("--manifest", required=True)
    sub.add_parser("ladder")
    d = sub.add_parser("doctrine"); g = d.add_mutually_exclusive_group(required=True); g.add_argument("--apply", action="store_true"); g.add_argument("--check", action="store_true")
    h = sub.add_parser("selfhost"); h.add_argument("--verify", action="store_true"); h.add_argument("--gaps", action="store_true"); h.add_argument("--no-node", action="store_true"); h.add_argument("--db")
    gl = sub.add_parser("glossary"); gl.add_argument("--check", action="store_true"); gl.add_argument("--apply", action="store_true"); gl.add_argument("--show", nargs="?", const="")
    lp = sub.add_parser("loops"); lp.add_argument("--verify", action="store_true"); lp.add_argument("--list", action="store_true")
    kn = sub.add_parser("kernel"); kn.add_argument("--check", action="store_true"); kn.add_argument("--lint", nargs="+"); kn.add_argument("--metrics", nargs="+")
    cl = sub.add_parser("closedloop"); cl.add_argument("rest", nargs="*")
    dv = sub.add_parser("directive"); dv.add_argument("--check", action="store_true"); dv.add_argument("--lint", nargs="+"); dv.add_argument("--ledger", action="store_true"); dv.add_argument("--probe", action="store_true"); dv.add_argument("--bootstrap", action="store_true")
    tr = sub.add_parser("trust"); tr.add_argument("--show", action="store_true"); tr.add_argument("--event", nargs=3, metavar=("SURFACE", "ACTION", "EVENT")); tr.add_argument("--tick", action="store_true")
    da = sub.add_parser("docs_audit"); da.add_argument("--check", action="store_true"); da.add_argument("--report", action="store_true"); da.add_argument("--orphans", action="store_true"); da.add_argument("--humans", action="store_true")
    ny = sub.add_parser("needsyou"); ny.add_argument("--check", action="store_true")
    ex = sub.add_parser("executor"); ex.add_argument("--apply", action="store_true"); ex.add_argument("--fold", action="store_true"); ex.add_argument("--issue", type=int); ex.add_argument("--repo"); ex.add_argument("--pick", action="store_true"); ex.add_argument("--record", action="store_true"); ex.add_argument("--result"); ex.add_argument("--pr"); ex.add_argument("--detail"); ex.add_argument("--host")
    sub.add_parser("upstream", add_help=False)
    wb = sub.add_parser("writeback"); ws = wb.add_subparsers(dest="wcmd", required=True)
    rc = ws.add_parser("record"); rc.add_argument("--kind", required=True); rc.add_argument("--title", required=True); rc.add_argument("--body", required=True)
    for opt in ("session", "owner", "trigger", "probe", "term", "source"):
        rc.add_argument("--" + opt, default="")
    ck = ws.add_parser("check"); ck.add_argument("--base", default="origin/main"); ck.add_argument("--head", default="HEAD")
    ou = ws.add_parser("outputs"); ou.add_argument("dirs", nargs="+"); ou.add_argument("--ignore", action="append", default=[])
    st = sub.add_parser("standards"); sg = st.add_mutually_exclusive_group(required=True); sg.add_argument("--apply", action="store_true"); sg.add_argument("--check", action="store_true"); sg.add_argument("--probe", metavar="ID")
    sg.add_argument("--commits", action="store_true"); sg.add_argument("--live", action="store_true"); sg.add_argument("--audit", action="store_true"); sg.add_argument("--adopted", default=None, metavar="ID")
    f = sub.add_parser("filing"); f.add_argument("--manifest", required=True)
    r = sub.add_parser("autorun"); r.add_argument("--ticks", type=int, default=10); r.add_argument("--out", default=".selfhost/autorun"); r.add_argument("--public", action="store_true"); r.add_argument("--no-node", action="store_true")
    c = sub.add_parser("cockpit"); c.add_argument("--out", default=".selfhost/cockpit"); c.add_argument("--ticks", type=int, default=10); c.add_argument("--no-node", action="store_true")
    l = sub.add_parser("launch"); l.add_argument("--commit", action="store_true"); l.add_argument("--push", action="store_true"); l.add_argument("--probe", action="store_true"); l.add_argument("--export-d1"); l.add_argument("--install"); l.add_argument("--skip-outreach", action="store_true"); l.add_argument("--failover", action="store_true"); l.add_argument("--decide", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "docs_audit":
        from . import docs_audit
        return docs_audit.main([x for x in ("--check", "--report", "--orphans", "--humans") if getattr(a, x[2:])])
    if a.cmd == "needsyou":
        from . import needsyou
        return needsyou.main(["--check"] if a.check else [])
    if a.cmd == "executor":
        from . import executor
        return executor.main(sys.argv[2:] if argv is None else argv[1:])
    if a.cmd == "launch":
        from . import launch
        if a.probe:
            print(json.dumps(launch.probe_surfaces(), indent=2)); return 0
        if a.install:
            print(launch.install_artifact(a.install), end=""); return 0
        if a.export_d1:
            open(a.export_d1, "w", encoding="utf-8").write(launch.export_d1()); print("wrote", a.export_d1); return 0
        if a.failover:
            from . import failover
            host = os.environ.get("ULTRASTABLE_HOST", "unspecified")
            d = failover.decide(launch.REPO, host)
            print("failover:", json.dumps(d))
            if a.decide:  # the gate alone: say whether this host takes over, as a step output where one exists, and run nothing
                if os.environ.get("GITHUB_OUTPUT"):
                    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
                        f.write(f"run={'true' if d['run'] else 'false'}\n")
                return 0
            if not d["run"]:
                return 0
            os.environ["ULTRASTABLE_HOST"] = "failover:" + host
        rec = launch.run_once(skip_outreach=a.skip_outreach)
        paths = launch.write_back(rec)
        print("\n".join(rec["report"])); print("evidence:", paths)
        if a.commit or a.push:
            res = launch.commit(paths, push=a.push); print("write-back:", json.dumps(res))
            if not res["ok"]:
                return 1
        return 0 if all(r["ok"] for r in rec["loops"]) else 1
    if a.cmd == "autorun":
        from . import autorun
        res = autorun.run(ticks=a.ticks, node=not a.no_node)
        if res["status"] != "ok":
            print(json.dumps(res, indent=2)); return 1
        for t in res["log"]["ticks"]:
            print("\n".join(t["report"]), "\n")
        print("wrote", [str(a.out + "/" + n) for n in autorun.write(res, a.out, a.public)]); return 0
    if a.cmd == "cockpit":
        from . import cockpit
        print("wrote", cockpit.write(a.out, ticks=a.ticks, node=not a.no_node)); return 0
    if a.cmd == "ladder":
        print(json.dumps(ladder.acquire_all(), indent=2)); return 0
    if a.cmd == "selfhost":
        if a.gaps:
            print(json.dumps(selfhost.gaps_report(), indent=2)); return 0
        if a.verify:
            bad = selfhost.verify()
            print("\n".join(bad) or "selfhost ok"); return 1 if bad else 0
        rep = selfhost.boot(db_path=a.db, node=not a.no_node)
        print(json.dumps(rep, indent=2))
        if rep["status"] == "ok":
            print(rep["tick"]["report"])
        return 0 if rep["status"] == "ok" else 1
    if a.cmd == "glossary":
        if a.apply:
            print("regenerated:", glossary.apply() or "nothing (already current)")
        if a.show is not None:
            print(glossary.show(term_id=a.show or None)); return 0
        bad = glossary.check()
        print("\n".join(bad) or "glossary ok"); return 1 if bad else 0
    if a.cmd == "loops":
        if a.list:
            for l in loops.load()["loops"]:
                print(f"{l['id']:24} {l['kind']:10} owner={l['owner']:20} closes_by={l['closes_by']}")
        bad = loops.verify()
        print("\n".join(bad) or "loops ok"); return 1 if bad else 0
    if a.cmd == "kernel":
        if a.lint or a.metrics:
            found, n = [], 0
            for fn in a.lint or a.metrics:
                fs = kernel.lint(open(fn, encoding="utf-8").read()); n += 1
                found += [dict(x, file=fn) for x in fs]
            if a.metrics:
                print(json.dumps(kernel.metrics(found, n), indent=1)); return 0
            print("\n".join(f"{x['file']}:{x['line']}: {x['recognition']}: {x['text']}" for x in found) or "no recognitions fired"); return 1 if found else 0
        bad = kernel.check()
        print("\n".join(bad) or "kernel ok"); return 1 if bad else 0
    if a.cmd == "closedloop":
        return closedloop.main(a.rest)
    if a.cmd == "directive":
        if a.lint:
            found = [dict(x, file=fn) for fn in a.lint for x in directive.lint(open(fn, encoding="utf-8").read())]
            print("\n".join(f"{x['file']}:{x['line']}: {x['recognition']}: {x['text']}" for x in found) or "no owner-handback shapes"); return 1 if found else 0
        if a.ledger:
            led = directive.issue_ledger(); print(json.dumps(led, indent=1)); return 0 if led["balanced"] else 1
        if a.probe:
            rows = directive.probe_all(); print(f"{sum(r['ok'] for r in rows)}/{len(rows)} probes ok, evidence appended to doctrine/probe-log.jsonl"); return 0 if all(r["ok"] for r in rows) else 1
        if a.bootstrap:
            out = directive.bootstrap(); print("\n".join(out)); return 1 if any(x.startswith("MISSING") or " problems" in x for x in out) else 0
        bad = directive.check()
        print("\n".join(bad) or "directive ok"); return 1 if bad else 0
    if a.cmd == "trust":
        k, led = kernel.load(), trust.load()
        if a.event:
            print(json.dumps(trust.apply(led, *a.event, k))); trust.save(led)
        if a.tick:
            print("decayed:", trust.tick(led, k)); trust.save(led)
        print(json.dumps({"tick": led["tick"], "rows": led["rows"], "compounding_rate": trust.compounding_rate(led)}, indent=1)); return 0
    if a.cmd == "writeback":
        try:
            if a.wcmd == "record":
                print("recorded:", writeback.record(".", a.kind, a.title, a.body, session=a.session, owner=a.owner, trigger=a.trigger, probe=a.probe, term=a.term, source=a.source or "doctrine/glossary.json")); return 0
            bad = writeback.check(".", a.base, a.head) if a.wcmd == "check" else writeback.outputs(".", a.dirs, a.ignore)
        except ValueError as e:
            print("refused:", e); return 1
        print("\n".join(bad) or "writeback ok"); return 1 if bad else 0
    if a.cmd == "standards" and a.adopted:  # STANDARDS-FIRST-1: the closing probe of an item that brings a row to adopted
        bad = standards.adopted(standards.REPO, a.adopted); print("\n".join(bad) or f"{a.adopted}: adopted, every probe passes"); return 1 if bad else 0
    if a.cmd == "standards" and (a.commits or a.live or a.audit):
        from . import commitlint
        if a.audit:
            print(standards.audit_table()); return 0
        bad = commitlint.check() if a.commits else standards.live()
        print("\n".join(bad) or f"standards {'commits' if a.commits else 'live'}: ok"); return 1 if bad else 0
    if a.cmd == "standards":
        if a.probe:  # STANDARDS-1 closing probe: passes when the register marks the standard supported
            sup = {e["id"]: e["support"] for e in standards._load(standards.REPO, standards.REG)["entries"]}.get(a.probe)
            print(f"{a.probe}: {sup or 'not in the register'}"); return 0 if sup == "supported" else 1
        if a.apply:
            print("docs/standards table updated" if standards.apply() else "docs/standards table already current")
        bad = standards.check()
        print("\n".join(bad) or "standards ok"); return 1 if bad else 0
    if a.cmd == "doctrine":
        if a.apply:
            print("injected into:", doctrine.apply() or "nothing (already consistent)")
        bad = doctrine.check()
        print("\n".join(bad) or "doctrine ok")
        return 1 if bad else 0
    raw = mf.load(a.manifest)
    if a.cmd == "validate":
        p = mf.validate(raw)
        print("\n".join(p) or "manifest ok"); return 1 if p else 0
    if a.cmd == "filing":
        print(json.dumps(filing.plan(mf.resolve(raw)), indent=2)); return 0
    rep = scaffold.generate(raw, a.out, a.date or dt.date.today().isoformat(), apply=a.apply)
    print(json.dumps(rep, indent=2))
    return 0 if rep["status"] == "ok" else 2


if __name__ == "__main__":
    sys.exit(main())
