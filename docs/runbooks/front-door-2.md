# FRONT-DOOR-2 runbook

## Idea consumer (site/worker.js)
Flow: `/start` stores `idea:<time>:<id>` in the ASSETS KV, asks 3 follow-up questions (RECALL-1), builds and audits the page, then the hourly tick (`consumeIdeas`) scaffolds a Worker (`us-idea-<id>`, serves the page, `/health`) and deploys it with the Workers API. Outcome: KV `deploy:<id>`.
Needs two secrets on `ultrastable-site`: `CF_DEPLOY_TOKEN` (Workers Scripts: Edit) and `CF_ACCOUNT_ID`. Without them the record says `pending-credentials` and the page stays at `/s/<id>`. Owner step: `wrangler secret put CF_DEPLOY_TOKEN` and `CF_ACCOUNT_ID` in `site/`.
Probe: `GET /s/<id>/status` is `ready`, KV `deploy:<id>` has `ok: true`, and its `url` + `/health` answers.

## Executor queue
The executor reads `docs/issues/*.json` (QUEUE-1, `foundation/queue.py`; default `EXECUTOR_SOURCE=queue`). Code tasks are never filed as issues.
Issues on `ultrastable/ultrastable` stay enabled until the owner decides otherwise; this change does not disable them.

## Retiring the six archived repos (owner step)
`scripts/mirror_then_delete.sh` mirrors seed, platform, docs, site, business and ip, makes a bundle of each, verifies it restores, and stops. Only `--delete` deletes (irreversible; needs `gh` with `delete_repo`). Keep the bundles. Target set afterwards: ultrastable, ops, workers, spec, license, .github.
