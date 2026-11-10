# Ultrastable provisional patent: filing checklist

Prepared 2026-11-10. This is a working checklist, not legal advice. Have a registered patent attorney or agent review the specification before filing; the most valuable hour of their time is on the §101 framing and the claim-style summaries.

## 1. Prior-publication question for the attorney (open, not established)

Open question, not a finding: does anything in the QNFO repositories or pages that is accessible to third parties overlap what the claims cover, and if so what and when? Facts supplied by the inventor (2026-11-10): the QNFO repository is distributed under the QNFO Unified License Agreement v2.1 (non-commercial; a separate written agreement for any use that generates money; derivatives stay under the agreement; patent applications must cite QNFO), it was created in August 2026 as a separate effort, and the key combination claimed here has not been publicly disclosed. This draft does not assert that the invention is already public.

To establish from git history and page archives, not to assume:
- which files, if any, describe the claimed combinations (scored predictions feeding trust-gated scope; the reserved-capacity plus loop with keep-or-revert; two-family evidence-gated review; claims with a fence; the owner console with emailed-code step-up and one-tap delegate) and the first public date of each;
- whether a restrictive licence changes the analysis (the attorney decides; public accessibility of a document is generally what matters for a printed publication);
- what qnfo.org/platform and ultrastable.io showed, and since when.

Cheap steps that do not depend on the answer:
1. File the provisional early. The US grace period (35 U.S.C. 102(b)(1)(A), one year from the inventor's own disclosure, if any) and foreign absolute-novelty rules are the attorney's call once the inventory exists.
2. Until filing, add no new technical detail to public repositories, posts or pages (issue 52 covers the public site).
3. Keep the dated git history as evidence of conception.
4. Licence term "patent applications must cite QNFO": the attorney decides how to satisfy it (cross-reference or information disclosure) without conceding anything.

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
