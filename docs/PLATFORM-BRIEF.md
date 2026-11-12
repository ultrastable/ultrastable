# Ultrastable deployment brief

Ultrastable is a system that runs itself: a scheduled tick reads work items, assigns them to roles (doer and independent reviewer), opens and merges its own code changes, measures the result, and keeps or reverts the change. People only contribute ideas in plain language.

## Requirements (what must exist, and how to prove it)

- **web**: Serve a public website and a read-only dashboard over HTTPS on a custom domain. Probe: GET / returns 200 and /health returns the deployed version equal to the repository version.
- **cron**: Run a scheduled function every 10 minutes (the tick) with no server to maintain. Probe: a tick row is written within 15 minutes of deploy.
- **sql**: A relational database (SQLite-compatible or Postgres) for the work ledger, trust ledger and metrics. Probe: row counts equal after migration.
- **kv**: A key-value store and an object store for assets, caches and state snapshots. Probe: a written key reads back identical bytes.
- **agent**: Run an AI agent step: call a hosted model, with tool use, from the tick. The model provider may differ from the cloud. Probe: one issue produces one pull request.
- **secrets**: A secret store that only the runtime can read; no secret is ever written to the repository. Probe: secret names listed, values never printed.
- **email**: Send and receive email for the owner digest and double opt-in subscribers. Probe: a test digest arrives.
- **ci**: Deploy only through the repository: pull request, green checks, merge, then deploy and verify live. Probe: merged version equals served version.

## Loops that must close

- work: issue -> role assigned -> draft pull request -> independent review -> merge -> deploy -> verify live
- measure: change states predicted metric movement -> deploy -> metric re-read -> keep or revert
- heal: probe fails -> issue and draft pull request opened by itself -> owner and closing probe attached -> fix merged -> probe passes
- bootstrap: one idea in plain language -> project created -> site deployed -> live probe passes, no code touched by the person

## Target: Cloudflare (reference; the site runs here today)

Ask Cloudflare's agent tooling and MCP server for the Cloudflare API (verify the current name and URL in their docs before relying on it). Suggested mapping, which you may improve on:

- web: Workers + custom domains
- cron: Workers Cron Triggers
- sql: D1
- kv: KV and R2
- agent: Workers AI or external model via fetch
- secrets: Worker secrets
- email: Email Routing and Email Sending
- ci: GitHub Actions + wrangler

## Target: Google Cloud (adapter skeleton in platform/adapters/gcp, tested, undeployed)

Ask Google's cloud assistant (Gemini Cloud Assist / Gemini CLI); verify the current name. Suggested mapping, which you may improve on:

- web: Cloud Run + domain mapping
- cron: Cloud Scheduler
- sql: Cloud SQL or Firestore
- kv: Cloud Storage
- agent: Vertex AI or external model
- secrets: Secret Manager
- email: an email provider via API
- ci: GitHub Actions with workload identity

## Target: AWS (not started)

Ask Amazon Q Developer or the AWS agent tooling; verify the current name. Suggested mapping, which you may improve on:

- web: Lambda + CloudFront
- cron: EventBridge Scheduler
- sql: Aurora or DynamoDB
- kv: S3
- agent: Bedrock or external model
- secrets: Secrets Manager
- email: SES
- ci: GitHub Actions with OIDC

## Target: Azure (not started)

Ask Microsoft Copilot in Azure; verify the current name. Suggested mapping, which you may improve on:

- web: Functions + Front Door
- cron: Functions timer trigger
- sql: Azure SQL or Cosmos DB
- kv: Blob Storage
- agent: Azure OpenAI or external model
- secrets: Key Vault
- email: Communication Services
- ci: GitHub Actions with federated credentials

## Your task

Using your own services and best practices, propose the smallest deployment that satisfies every requirement, then perform it. Show the plan first in plain words. Do not delete or overwrite existing resources. After deploying, run each probe and report the real output. Where you cannot satisfy a requirement, say which one and why; do not substitute silently.
