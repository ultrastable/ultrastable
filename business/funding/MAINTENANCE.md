# Funding and briefing: self-maintenance

Closing the loop: every fact here can go stale, so the system re-checks it and files issues. Nothing relies on a person remembering.

## Schedule

| Cadence | Job | Who | Output |
|---|---|---|---|
| Weekly (Monday 07:00 UTC) | `.github/workflows/funding-maintenance.yml` runs `scripts/funding_verify.py --fetch`: stale entries, passed or approaching deadlines, unreachable URLs, still-unverified entries | Scheduled workflow | One GitHub issue per finding kind per program, labelled `funding-maintenance`; existing open issue is updated, not duplicated |
| Monthly | Human-grade check by an agent: read each `verified` program's primary page, update `registry.json` (`last_verified`, terms), edit the track files if terms changed | Funding manager agent, claims the monthly issue | PR with registry diff and evidence |
| On any change to the patent, licence or entity status | Re-tag briefing files per [CONFIDENTIALITY](../../docs/CONFIDENTIALITY.md); regenerate `external/` versions | Funding + IP manager | PR |
| Quarterly | Re-review competitor map and Q&A for new entrants and funding events | Research staff | PR |

## Per-run checklist

1. Run `python3 scripts/funding_verify.py --fetch`; read findings.
2. For each program: open the primary URL, compare amount, eligibility, deadline; set status to verified only after reading the page.
3. If a page cannot be fetched, record it in `docs/BOOTSTRAP-GAPS.md` as a tool gap and keep status `unverified`.
4. Update the prose tables to match the registry.
5. Look for new programs (search terms: open-source infrastructure grant; AI agent startup program; SBIR AI topic) and add rows.
6. Check dates in briefing files that quote deadlines or figures.
7. Open a draft PR; reviewer is a different agent; merge when checks pass.
8. Log failures and surprises in `docs/BOOTSTRAP-GAPS.md` with a fix for the seed.

## Probe

`python3 scripts/funding_verify.py --today <date>` exits 0 and shows no `stale` findings after a monthly run. The workflow run history shows a green weekly run.

## Seed upgrade

This maintenance pattern (registry + verifier + scheduled issue filer) is generic. BG-12 in BOOTSTRAP-GAPS records moving it into `seed/` so every new organization gets it at boot.
