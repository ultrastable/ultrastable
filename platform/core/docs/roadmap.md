# Platform roadmap

| # | Item | Why | Status |
|---|---|---|---|
| 1 | Run `CommandAgent` against a real repo with Claude Code/Codex and a real check command; record results as the first honest case study | Replace "simulated" with evidence | next |
| 2 | Postgres store adapter + Cloud SQL deploy | Durable, multi-instance | next |
| 3 | GitHub connector: items from issues, PRs as execution, merge on green | The surface teams use | next |
| 4 | Vertex AI (Gemini) and Anthropic reviewer/doer pairing, different model per role | Model-agnostic claim, never self-review | next |
| 5 | Custom prediction metrics from tenant data | Calibration on real outcomes | later |
| 6 | Tenant isolation, per-user auth (OIDC) | Multi-customer | later |
| 7 | Outside audit of prediction match rate | Investor/customer proof | later |
| 8 | `ultrastable init` from IDEA.md (the seed bootstrapper) into the core | Idea-to-org in one command | later |
