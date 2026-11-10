# Self-filing walkthrough: Dutch national application, then the 12-month conversion

Not legal advice. About 2 to 3 hours of work. Rowan signs and pays (see `OWNER-CARD.md`); everything else is prepared.

## A. Before the day

1. Run `python3 ip/provisional/tools/preflight.py` (it now also checks this folder); it must end with 0 failures.
2. Attorney questions in `DECISION-MEMO.md` section 7: ask question 1 (where was it made) before filing if there is any doubt. It is a one-hour question.
3. Create an Octrooicentrum account and confirm the online filing route (MijnOctrooi: https://mijnoctrooi.rvo.nl, linked from the OCNL pages). Check how you identify (eHerkenning or DigiD may be required for foreign residents; confirm by phone, 088 042 40 02, option 2, verlening@octrooicentrum.nl).
4. Ask OCNL two things, and record the answers in `ip/evidence-log.md`: (a) the procedure fee today; (b) that not requesting the search leaves the filing date and priority intact until the 13-month limit.
5. The Dutch-format files already exist in `ip/europe/filing-nl/` (A4, OCNL margins, continuous page numbers, claims in Dutch, drawings with reference numerals only). Open each PDF and look at it once; `FORM-VALUES.md` section 4 says what each is.
6. Do not run the text through a generative AI tool at this stage: OCNL warns that disclosure there can cost you the patent. Use the files already prepared.

## B. Filing day

1. Open the online filing portal and start a new Dutch patent application.
2. Enter the values from `FORM-VALUES.md` section 1 (request form: applicant, inventor, no representative, title, no priority, no search request).
3. Upload: `beschrijving-en-conclusies.pdf` as description and claims (it is one numbered document; if the portal wants them separately, split at the page headed CONCLUSIES, page 91 of 91 and keep the numbering), `samenvatting.pdf` as abstract, `tekeningen.pdf` as drawings. Title: copy from `filing/ads-data.json`.
4. Do not tick the search request.
5. Sign (identity-bound) and pay the procedure fee (identity-bound: money). Payment is your job; OCNL sends no invoice.
6. Save the filing receipt with date and application number. The date is the priority date. Record it in `ip/evidence-log.md`.
7. Add the four deadlines in section C to `HANDOFF.md` with the real dates.

## C. After filing

| When | What |
|---|---|
| Filing date plus 9 months | Prepare the PCT request (EPO as RO, English) or the EPO filing from `FORM-VALUES.md` |
| Filing date plus 12 months | **Hard stop.** File PCT or EPO claiming the NL filing as priority (Paris Convention; the deadline cannot be extended). Request a certified copy of the NL application from OCNL for the priority document |
| Filing date plus 13 months | NL: search request and payment due, or the Dutch application lapses (OCNL). Lapsing is fine if the PCT or EPO filing carries the priority |
| Filing date plus 18 months | Publication of the NL application. Withdraw before publication if you want secrecy and the PCT/EPO filing is already in |
| Month 12 | Engage a US practitioner for any US route (see `DECISION-MEMO.md` section 2) |

## D. Fallback: direct EPO filing

1. Create the EPO online filing set-up (Online Filing / MyEPO) with a smart card or the current EPO authentication; see https://www.epo.org/en/applying/online-services.
2. File in English with Form 1001 values from `FORM-VALUES.md` section 3. **Representation is not required for an applicant who is resident in a contracting state (Art. 133(1) EPC); non-residents must be represented (Art. 133(2)).** Rowan is resident in the Netherlands. Source: [EPO Guidelines A-VIII, Representation](https://epo.org/en/legal/guidelines-epc/2025/a_viii_1_9.html).
3. Filing date needs only the request, the applicant's identity, and a description (Rule 40 EPC); claims can follow. Keep claims to 15 or fewer to avoid claim fees.
4. Pay the filing fee and the search fee within one month. Do not pay the designation fee unless you want to proceed.

## E. If a step fails

State exactly what the portal or office said, log it in `docs/BOOTSTRAP-GAPS.md`, and take the fallback in section D the same day. A failed step is an input, not an end.
