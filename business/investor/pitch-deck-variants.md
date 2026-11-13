# Pitch deck variants (FN-5 draft, 2026-11-13)

Base: [pitch-deck-outline.md](pitch-deck-outline.md), one story: Ultrastable is the manager for your AI workers. NDA-only until the provisional is filed. Only slides 4, 5, 9, 10 and 12 differ per variant; slides 1-3, 6-8, 11 are shared. No number below is new: each comes from the cited source.

## Cloudflare variant (Cloudflare for Startups, ultrastable/ops#26)
- 4. Difference: runs entirely on Workers, D1, KV, Durable Objects and cron triggers; no servers for the customer to own.
- 5. Product today: the live site (ultrastable.io) and the QNFO fleet as customer zero run on Cloudflare; evidence `business/investor/evidence.json` (24 of 24 components live, 19 of 19 edges wired as of 2026-11-12).
- 9. Go-to-market: generated sites and per-site back ends on `*.ultrastable.io` are a Cloudflare consumption story (ops#29).
- 10. Model: cost per project dominated by Workers AI / model calls; measured method in `docs/ops/COST-PER-TICK.md` (dollar figure pending live run, ops#4).
- 12. Ask: Cloudflare credits to fund pilot runtime; framing per `business/funding/credit-programs.md`.

## Google Cloud variant (Google for Startups, ultrastable/ops#27)
- 4. Difference: cloud-agnostic core with a Google Cloud adapter (`deploy/gcp/deploy.sh`); Gemini/Vertex as a doer and an independent reviewer model.
- 5. Product today: same control loop; GCP deploy path exists, unproven in production (state this).
- 9. Go-to-market: design-partner pilots on the customer's own GCP project.
- 10. Model: usage at cost passes through to Vertex billing.
- 12. Ask: GCP credits for pilots; answers in `business/funding/applications/google-for-startups/ANSWERS.md`. No Workspace purchase within 31 days before applying (ops#12).

## Review
Done check is "reviewed by Rowan" (owner step). Export to slides after review; keep NDA footer.
