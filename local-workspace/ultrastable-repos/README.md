# Ultrastable GitHub org: proposed repo layout

Seven private repos under `github.com/ultrastable`. Each folder here is the starter content for one repo.

| Repo | Purpose | Visibility |
|---|---|---|
| `site` | Landing page for the ultrastable domains. Static, deploys to Cloudflare Workers static assets. | private (site itself goes public only after the provisional is filed) |
| `docs` | How Ultrastable works: virtual staff, feedback loops, plussing, governance. Source for site pages later. | private |
| `platform` | The core platform generalized from QNFO and the fleet (Cloudflare). Packaging comes later; for now README + architecture. | private |
| `seed` | The spark: one idea file plus a bootstrapper that starts an organization of virtual managers on a server heartbeat. Agent instructions, autonomy policy, trust ladder, interrupt gate, Worker, tests. | private; becomes a template repo after filing |
| `ip` | Provisional patent working file: invention disclosure, claims sketch, prior-art notes, dated evidence log. | private, owner only |
| `business` | Company, funding and go-to-market material. | private, owner only |
| `.github` | Org defaults: PR template, issue templates, org profile README. | private now; must be public for the profile to show |

Order of work: `ip` first (file the provisional), then `docs`, then publish `site`.
