# 5-minute demo script

Commands match `platform/core/ultrastable/cli.py` and were exercised on 2026-11-10 (demo run: 40 ticks; unit tests: 12 pass). Run from `platform/core` in a cloud workspace that has this repository checked out. Global flags `--db` and `--config` come BEFORE the subcommand. Use a throwaway DB path so you start clean.

**Say up front (every time):** the agents in this demo are SIMULATED, deterministic stand-ins. The platform manages agents; this shows the control loop, not model quality. Command and Anthropic adapters exist but are not yet proven in production.

**Showing the dashboard:** the demo may narrate how trust is computed, the rung names, prediction scoring and the plus rule; the project is open and the Ultrastable License governs use. Every number shown must be the real one from the live dashboard.

## Setup (before the call)
```
cd platform/core
export ULTRASTABLE_DB="$(mktemp -d)/demo.db"
```
(or pass `--db demo.db` each time)

## 0:00-0:40 The problem
"Agents are cheap; managing them isn't. Ultrastable is the manager." Show nothing yet.

## 0:40-1:40 One command: the whole organization
```
python -m ultrastable --db demo.db demo
```
Expected shape (observed): a four-line report ending `Happened: tick 40 ran 11/11 steps ...`, `Decided`, `Next`, `Open: ... gate card(s)`, then KPIs: ticks 40, items_done 47 (observed in one run; may vary with code changes), open_gates 4, silent_drops 0. Point out: 26 seeded work items across three projects; nothing dropped silently.

## 1:40-2:20 Backlog and gates in the terminal
```
python -m ultrastable --db demo.db backlog --all
python -m ultrastable --db demo.db gates
```
Gate cards (observed): "Sign the pilot agreement template", "Buy the conference sponsor package", "Send the outreach as the founder" plus a trust-promotion card. Message: it did the reversible work and stopped only at money, signature and speaking as the founder.

Optional (resolve one, an owner step):
```
python -m ultrastable --db demo.db resolve GATE-W-018
```

## 2:20-3:00 Trust table
```
python -m ultrastable --db demo.db trust
```
Message: "It gets more independent as it proves itself; different kinds of work have different freedom." Do not explain the formula.

## 3:00-4:30 Live dashboard
```
python -m ultrastable --db demo2.db serve --seed-demo --port 8080 --auto-tick 5
```
Open port 8080 of that workspace through its forwarded URL. Walk the sections as they appear: Virtual managers; Last tick report (four lines); Owner gate cards ("the only things that interrupt a person"); Work items; Projects; Earned trust; Rule amendments; Audit trail. Let two or three auto-ticks happen so the board changes. Show `GET /healthz` and `GET /api/state`. Note writes to `/tick`, `/api/items`, gate resolve need the bearer token if `ULTRASTABLE_TOKEN` is set; without it the server prints that writes are OPEN, so always set it.

Amendments: show the "Rule amendments" panel (after a demo run, repeated failures became an adopted rule version; KPI `rules_version` went to 3 in the observed run). Say only: "rules change by recorded, versioned amendment".

## 4:30-5:00 Close
- "Add your own work": `python -m ultrastable --db demo.db add "Write the pricing page" --project web --priority 20` (project must exist; use a seeded one).
- Deployment: Google Cloud Run + Cloud Scheduler script is in `deploy/gcp/deploy.sh` (not run during the demo).
- Ask: pilots with three teams; pre-seed conversation.

## If something fails
Say so and show the test run instead: `python -m unittest discover -s tests` (12 tests, observed OK). Do not improvise claims about real agents.
