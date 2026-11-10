# Ultrastable provisional patent: filing checklist

Prepared 2026-11-10. This is a working checklist, not legal advice. Have a registered patent attorney or agent review the specification before filing; the most valuable hour of their time is on the §101 framing and the claim-style summaries.

## 1. Act first: the public-disclosure clock

The concepts in this draft are already public. `QNFO/qnfo-workers` is a **public** repository that has documented them since it opened on 2026-08-10, including the virtual portfolio and program managers (MANAGEMENT-PERSONAS-1 to 11, from 2026-10-26), plussing (docs/PLUSSING.md, from 2026-10-29), the doctrine, trust ledger and interrupt gate, and the Ultrastable product page (docs/PRODUCT-ULTRASTABLE.md, 2026-11-10). qnfo.org/platform also describes it live.

- **United States:** under 35 U.S.C. 102(b)(1)(A), the inventor's own public disclosures are not prior art against the inventor if the application is filed within one year. The earliest relevant disclosure may be as early as 2026-08-10, so the safe outer limit is **before 2026-08-10 + 1 year = 2027-08-10**. Filing now is strongly better, because a third party who builds on the public material could file first on improvements.
- **Most other countries (Europe, China and others with absolute novelty):** material that was publicly disclosed before the filing date is likely already unpatentable there. Some countries (for example Japan and Korea) have limited grace periods. The attorney should say what foreign rights remain, if any.
- **From now until filing:** avoid publishing further new technical detail (new loops, new claims, numbers) in public repos, posts or pages. Consider making `qnfo-workers` private or moving new design work into private Ultrastable repos. This does not undo past disclosure, but it stops it growing.
- Keep the dated git history: it is evidence of conception and of the inventor's own disclosure dates.

## 2. Inventorship

- Only natural persons can be inventors (Thaler v. Vidal, Fed. Cir. 2022; USPTO inventorship guidance for AI-assisted inventions, Feb. 2024). Rowan should be listed as inventor for the concepts Rowan conceived (the virtual staff hierarchy, plussing as a fleet philosophy, autonomy that never routes ordinary decisions to the owner, and the directives recorded verbatim in the migrations).
- AI assistance in drafting and implementing does not prevent patenting, but each claim needs a significant human contribution. The attorney may ask for a short note on what Rowan conceived versus what agents implemented. The owner directives quoted in the migrations (dated, verbatim) are good evidence.
- If anyone else contributed to conception, they may need to be named.

## 3. Entity status and fee

- **Micro entity** may apply if Rowan (and any assignee) meets the gross-income limit and has been named on no more than four prior non-provisional applications (form PTO/SB/15A certification). Otherwise **small entity** if fewer than 500 employees.
- Provisional filing fee, last known schedule (January 2025): about **$65 micro, $130 small, $325 large**. Confirm on the USPTO fee schedule at filing time.
- If Ultrastable will be a company, decide whether to file in Rowan's name and assign later, or form the entity first and file with an assignment. Either works; the attorney can advise. Assigning to a new entity can change entity status.

## 4. Documents to upload in USPTO Patent Center

1. **Provisional cover sheet** (PTO/SB/16) or an Application Data Sheet (PTO/AIA/14): inventor legal name, residence, mailing address; title; correspondence address; entity status.
2. **Specification:** `provisional-specification.pdf` (built from `provisional-specification.md`). Includes the claim-style summaries and abstract, which are optional for a provisional but help later.
3. **Drawings:** `drawings.pdf` (FIGS. 1 to 15). Provisional drawings may be informal; formal drawings come with the non-provisional.
4. **Micro entity certification** (PTO/SB/15A) if claiming micro status.
5. **Fee payment.**

Patent Center needs a USPTO.gov account with identity verification (ID.me or paper). Do that before the day you want to file.

## 5. Before filing, edits for the attorney or Rowan

- [ ] Fill in inventor legal name, city, state and citizenship.
- [ ] Decide whether to keep the customer-zero numbers in paragraph [0079].
- [ ] Confirm the wording of [0078j] (the seed code is tested offline; the first real cloud provisioning has not run) and update it when the first deployment runs.
- [ ] Attorney review of §101 risk (Alice): the draft ties the method to specific technical mechanisms (database snapshots to prevent out-of-memory failures, probe-triggered automatic revert, trust-gated permission scope, work-claim leases, two-family model review). The attorney may tighten claim 1 further toward these.
- [ ] Prior-art check against agent orchestration and autonomous SDLC tools (Devin, Factory, Overcut, Traversal, GitHub Copilot coding agent, multi-agent "company" research such as ChatDev and MetaGPT). MetaGPT and ChatDev assign software-company roles to LLM agents, so novelty should rest on the closed loops (risk-weighted allocation, scored predictions, trust ledger, plus loop with keep-or-revert, interrupt gate, self-amending policy), not on role names alone.
- [ ] Add any feature built after 2026-11-10 that should be covered. A provisional only supports what it describes.

## 6. After filing

- The filing date is the priority date. Mark products "patent pending" only after filing.
- **12 months** from filing: file the non-provisional (and PCT, if any foreign rights remain). A provisional cannot be extended. Put the deadline on the calendar the day you file.
- Further provisionals can be filed as the system grows, and all claimed in the non-provisional within 12 months of the earliest one.
- Trademark: "Ultrastable" for software needs a separate USPTO trademark search and application. That is unrelated to the patent.
