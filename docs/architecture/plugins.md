# Plugin tier: external services as optional code loops

Spec for `seed/plugins/`. Machine-readable scope: `seed/plugins/SCOPE.json`. Enforced by `python3 -m plugins check` (in `checks.yml`, no new workflow).

## Core mission, and what a plugin is
The core bootstraps a working, server-side, self-managing system from a person's wish: tick, managers and staff, trust ladder, predictions, plussing, interrupt gate, and the specs they run on. A **plugin** is an optional capability for talking to the outside world (email, a mailing list, social channels, video, a cloud API, the system's own self-description). It is a code loop plus an agent role under the same manager, plussing and trust framework as everything else. It is **optional, never in the core path**: delete `seed/plugins/` and the core boots and passes its tests (a test does exactly that).

## The boundary, in code
| Rule | Enforced by |
|---|---|
| Core (`bootstrap`, `worker`, `autonomy`, `agents`, `ultrastable.json`) never imports, requires or names a plugin | `scopecheck.check` (fails CI); `test_core_import_fails`, `test_core_boots_without_plugins` |
| Every plugin declares role, action classes, adapters, hosts, caps in `SCOPE.json`; manifest may not exceed it | `scopecheck`, `Runtime._decide` |
| Defaults: disabled, dry-run, rung `observed` | `plugin.json` check, config template check |
| Secrets: adapter config holds env **names**; values are read only by `Runtime.secret`; no `os.environ` elsewhere; secret-like strings fail the lint | `scopecheck`, tests (token never appears in a dry-run record) |
| Out of bounds list (money, signing, owner's personal accounts, unconsented mail, ignoring suppression, deleting what a plugin did not create, claims not in the self-description) | `SCOPE.out_of_bounds`; each item has a refusal path below |

## How far each plugin may reach
Every action passes `Runtime.perform`, in order: scope (plugin, class, adapter) -> kill switch -> enabled -> content guard -> consent and suppression -> rate caps (config can lower SCOPE caps, never raise) -> mode (dry-run stops here and records the redacted request) -> trust rung against the class minimum -> credential bindings present -> egress host allowlist per step -> send. Every attempt is a ledger row; a refusal states its reason and is never re-routed.

| Plugin | Role | Reach (action classes) | Notes |
|---|---|---|---|
| `email` | communications | draft, send_to_person | Cloudflare `send_email` via a sender Worker template (`email/worker/sender.js`, tested); sender allowlist; one consented recipient per send |
| `mailing_list` | outreach | draft | double opt-in (HMAC token), confirm, unsubscribe = suppression, campaigns with unsubscribe link; delivers through `email`, so its gate applies |
| `social` | marketing | draft, cloud_read, publish_public | Bluesky, Mastodon (idempotency key), Buffer v1 REST (channel ids discovered live, never stored; verify current API terms before enabling). Text must be a verbatim excerpt of the approved self-description |
| `youtube` | marketing | draft, cloud_read, publish_video | Data API v3 resumable upload, **private or unlisted only**; public release is a gate card |
| `gcp` | operations | cloud_read, cloud_write | `*.googleapis.com` only; GET reads; writes only resources labelled `managed-by=ultrastable`; DELETE is out of bounds; token is a short-lived binding |
| `selfdescribe` | branding | describe_self, draft | see below |
| `communicate` | communications | draft | guided flow below |

Trust: classes carry a minimum rung (`draft`/`describe_self` observed; `cloud_read` assisted; sending and publishing delegated; `cloud_write` autonomous). The instance config `rung` is set by reviewed PR, like `autonomy/policy.json`; trust never widens it by itself. Each loop logs a prediction (`<metric> <op> <n> within <N> h`) and an outcome (surface `plugin:<role>`) for the scorer and trust ledger.

## The loops (`plugins/loops.py`)
- **branding**: regenerates `self/SELF.md` and `self/self.json` from the repo; `python3 -m plugins self --check` fails on drift.
- **marketing**: takes the next unposted approved sentence and offers it to the configured adapter, within cadence and caps.
- **outreach**: runs queued campaigns (`comms/campaigns/*.json`) through the list and email gate.
- **communications**: sends the four-line report to the configured address. This closes gap **SG-3** (report sink); **SG-4** (mail) and **SG-5** (social) close with `email`/`mailing_list` and `social`. Live delivery still needs a person to register a mailbox or account (identity-bound gate card) and a reviewed PR to set `mode: live`.

## How the system sees and describes itself
`selfdescribe` builds one description from the repo only: core mission, roles (from `ultrastable.json` and role files), what each plugin may reach, the out-of-bounds list, trust rungs, and owner-approved statements. Nothing is typed by hand; drift fails CI. The `public` list is the only text marketing may post. Branding, marketing and outreach therefore cannot say what the code does not say.

## "What do you want to communicate" (for non-coders)
`python3 -m plugins communicate` asks seven questions, each a numbered choice or a short phrase (goal, audience, tone, channels, cadence, off-limits, one sentence in your own words). It reports gaps instead of guessing, writes `comms/brief.json`, and names the plugins to enable. The owner never edits code; enabling is a reviewed PR the fleet opens.

## Why multi-agent self-referential loops
See `docs/product/why-multi-agent-loops.md`.

## Not duplicated
The QNFO-era workers extraction (inventory in the extraction thread) moves the *core*; these plugins are written fresh and generic, with no QNFO names or ids. The existing `social/` and `outreach/` automation keeps running and migrates onto this runtime as its adapters.
