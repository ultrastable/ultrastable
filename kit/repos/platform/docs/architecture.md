# Target architecture (draft)

Runs on Cloudflare, matching the existing fleet.

| Component | Responsibility | Likely Cloudflare piece |
|---|---|---|
| Tick scheduler | Fires the heartbeat per org and per role | Cron Triggers, Workflows |
| Role runtime | Portfolio, project, product managers and staff agents | Agents SDK / Durable Objects (one per role instance) |
| Work queue and claims | Backlog, priority function, claims, dispositions | D1 + Queues |
| Trust ledger | Outcomes per (surface, action class), ladder position | D1 |
| Prediction scorer | Scores logged predictions against metrics | Cron + D1 |
| Plussing queue | Proposed pluses, ranking, reserved capacity | D1 |
| Approval gate | Human approval cards for irreversible steps | Worker + notifications |
| Connectors | GitHub, chat, email, the org's tools | MCP |

Org-specific data (roles, objectives, connectors, policies) is configuration, so the same platform serves any organization.

Open items for packaging: tenant isolation, the config schema for an org chart, migration of the existing QNFO tables, and a one-command install.
