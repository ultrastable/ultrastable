# Self-filing walkthrough: Dutch national application, click by click

Not legal advice. Sources read 2026-11-10 (linked in section 9). **Where a step is marked UNVERIFIED, no primary source answered it; section 8 lists them all.** Rowan signs and pays (see `OWNER-CARD.md`); everything else is prepared.

## 0. The "European Patent Office" confusion, settled

Older Dutch pages (the RVO page "Nederlands octrooi aanvragen" and the older OCNL eOLF page) say you file through **eOLF, the European Patent Office's Online Filing software, with an EPO smart card or an EPO-issued certificate**. That was the old system. Octrooicentrum Nederland (OCNL) has replaced it:

- The new **Online Filing** is run by OCNL itself, a Benelux collaboration; it removed the need for an EPO smart card and downloadable software, and logs in with a **password plus a 2-step code from an authenticator app**. ([article](https://bijl2.nl/nieuws?catid=8&id=142%3Anieuwe-online-filing-applicatie-maakt-een-octrooiaanvraag-indienen-eenvoudiger&view=article))
- It opened to all users on **15 October 2025**, and the **old version was switched off on 15 December 2025**. ([BPP portal notice](https://mijnoctrooi.rvo.nl/bpp-portal/en/node/149))
- So **you do not need an EPO account, smart card or EPO software to file in the Netherlands.** The EPO only matters later (section 6).

One page, the OCNL eOLF page, still shows "Online Filing is tijdelijk niet beschikbaar" (temporarily unavailable). That text may be stale; check the portal's news for an outage notice before the day (UNVERIFIED which is current).

## 1. Register first (do this days before; activation is manual)

1. Open https://efiling.mijnoctrooi.rvo.nl/ and register an **individual account** (each user needs their own; no organisation account is needed).
2. **OCNL activates the account within a few days, with no notification.** Do not wait for an e-mail: try to log in after 3 working days.
3. First login: the portal shows a **QR code**. Scan it with Google Authenticator, Microsoft Authenticator or FreeOTP. From then on you log in with your password and the 6-digit code.
4. UNVERIFIED: whether a private person living abroad (a US citizen resident in NL) may register, and whether any ID is asked. None of the pages read says so. Ask OCNLservicedesk@octrooicentrum.nl or eolf@rvo.nl in your first e-mail, and ask them to confirm they will accept a natural-person applicant filing without a Dutch patent attorney (the pages recommend, but do not require, one).

## 2. Check the files (day before)

`python3 ip/provisional/tools/preflight.py` must end `0 failures`. Files are in `ip/europe/filing-nl/`:

| Attachment | File | Pages |
|---|---|---|
| Description | `beschrijving.pdf` | 1 to 90 |
| Claims (Dutch) | `conclusies.pdf` | 91 to 91 (continues the numbering) |
| Abstract | `samenvatting.pdf` | 1 |
| Drawings | `tekeningen.pdf` | 33 sheets |
| (combined description + claims, if the portal wants one file) | `beschrijving-en-conclusies.pdf` | 91 |

The portal guide says a combined upload is allowed if you state the page count of each item. The guide does not name accepted file formats for these attachments and mentions a "PDF compliance checklist" inside the portal; run it on all four files (UNVERIFIED that our PDFs pass it; fix whatever it flags).

## 3. Create the submission

1. Log in. The **Dashboard** shows "National patent submissions". Click **Create submission** (or Menu > National patent submissions > Create submission).
2. **Basic filing info**
   - User reference (mandatory): `ULTRA-PROV-001-NL`.
   - Filing Language: **English**. (The NL/EN Language button changes only the screen language.)
   - Title of invention: copy it from `filing/ads-data.json`.
   - Type of application: **National Patent**.
   - Type of search report: **Send Search Request later**. A search request must be filed within 13 months of the filing date, or the application lapses; that is intended.
   - Additional requests: **leave both empty** (no early publication; no WIPO DAS copy).
3. **Parties**
   - Applicants > **Add applicant** > **Yes, I'm sure**: natural person, Rowan, with your legal name and Dutch address. Confirm it.
   - Representative: **none**.
   - Inventors > **Add inventor**: Rowan.
   - Communication address: defaults to the first applicant; it must be in an EEA country (your Dutch address qualifies).
4. **Declarations**: no priority (this is the first filing); no international exhibition.
5. **SEQL & Bio**: not applicable (no sequence listing, no biological material).
6. **Attachments**: optionally run the **PDF compliance checklist**; **Upload technical documents**: description, claims, abstract, drawings, each with its page count from section 2. At least a description is required.
7. **Payment of fees**: the portal **calculates the fees from your entries and shows each fee with code, amount and total**. This is where you learn the procedure fee (UNVERIFIED in advance; no OCNL page showed it). Tick at least one **payment intention** to finish this step.
8. **Summary**: review; use the pencil icon to fix a field; click **Save**.

## 4. Sign (identity-bound)

1. At the bottom click **Send to sign**, then **Confirm** (status Draft to Ready to sign).
2. My submissions > open it > view > **Preview submission**; check it.
3. **Sign submission** > pick or create the signer > **Add signature** > **Confirm signatures** > **Send to package**.
4. Signature type: a typed signature is your name between two slashes, for example `/Rowan Surname/`, or an uploaded scan (TIFF or JPEG) of a handwritten signature. ([OCNL eOLF page](https://www.octrooicentrum.nl/over-octrooien/octrooi-aanvragen-en-verlening/digitaal-aanvragen-indienen-online-filing-eolf))

## 5. Pay (identity-bound: money) and send

1. When the status is **Ready to pay**, pay the amount shown in step 3.7. Bank transfer: ING Bank, **IBAN NL41 INGB 0705 0012 96, BIC INGBNL2A**, and **always state the fee and the number the portal or OCNL gives you** (the page asks for the patent number; a new application has only a provisional one, so quote the case ID and user reference). ([OCNL payment methods](https://www.octrooicentrum.nl/octrooien/octrooi-aanvragen/betaalmethoden)) A deposit account or MyPage balance also works but needs an account opened in writing first and 3 working days, so use bank transfer. OCNL sends **no invoice**.
2. UNVERIFIED: whether the portal holds the submission until the payment arrives, or lets you send before paying and expects payment shortly after; the guide shows a bank-transfer illustration but not the sequence. Ask the service desk. Do not pay twice.
3. When it reaches **Ready to send**, click send. Status goes Processing, then **Sent**. If it fails, open the three-dot **More** menu > **Retry sending**.
4. **Clicking send is final: the live system files for real.** Test nothing by pressing send.

## 6. What you get back, and the clocks

- Open the submission > view: **download the submission receipt and the package** (filing date and time, list of documents, a provisional application number). Store them in the repo's evidence record: `ip/evidence-log.md`.
- OCNL also sends a receipt with the application number and filing date by letter within about a month; if nothing arrives, write to teamverlening@rvo.nl. ([OCNL](https://www.octrooicentrum.nl/octrooien/octrooi-aanvragen-en-verlening/octrooidocumenten-indienen))
- The filing date is the **priority date** for foreign filings. A certified **priority certificate costs EUR 9** and is requested in writing from OCNL; you need it (or the EPO retrieves it) for the PCT or EPO filing.

| When | What |
|---|---|
| Filing + 9 months | Prepare the PCT or EPO filing |
| Filing + **12 months** | **Hard stop**: file the PCT or EPO application claiming the Dutch filing (Paris Convention). This is where the EPO enters: EPO account and online filing, or WIPO ePCT. The new OCNL Online Filing did **not** include PCT forms as of the October 2025 notice (UNVERIFIED now). EPO direct filing is described in section 7. |
| Filing + 13 months | Search request and fee due or the Dutch application lapses (fine if the PCT/EPO filing carries the priority) |
| Filing + 16 months | If you claim the Dutch priority elsewhere, other offices' own deadlines apply |
| Filing + 18 months | The Dutch application is published unless withdrawn |
| Month 12 | Engage a US practitioner for any US route (`DECISION-MEMO.md` section 2) |

## 7. Fallback: direct EPO filing (what the EPO wants)

Use if OCNL cannot onboard you in time. Representation is **not** required for an applicant resident in a contracting state (Art. 133(1) EPC; [EPO guidelines](https://epo.org/en/legal/guidelines-epc/2025/a_viii_1_9.html)); Rowan is resident in the Netherlands. UNVERIFIED in detail: the current EPO login method for new users (the EPO stopped issuing smart cards on 1 January 2024 per RVO; the replacement is an EPO account with 2-factor authentication via the MyEPO services). Read https://www.epo.org/en/applying/online-services before the day, file in English, no priority, Form 1001 values as in `FORM-VALUES.md` section 3, at most 15 claims, and pay the filing and search fees within one month.

## 8. Still unverified (plain list)

1. Whether OCNL registers a private person resident abroad for Online Filing, and any ID check.
2. The exact procedure fee (visible only inside the portal).
3. Whether payment must arrive before sending, and the exact reference to quote.
4. Whether Online Filing is up today (the OCNL eOLF page says temporarily unavailable; the portal notice says live since 15 Oct 2025).
5. Whether the portal accepts our PDFs and requires the claims in a separate attachment; the claims-in-Dutch rule with English filing language is from OCNL's format page, not tested in the portal.
6. PCT forms in the new Online Filing; the EPO's current login method.
7. Everything in `DECISION-MEMO.md` section 7 (attorney questions).

Fastest way to close 1 to 5: one e-mail to OCNLservicedesk@octrooicentrum.nl (cc eolf@rvo.nl) or a call to 088 042 40 02 (option 2), then record the answers in `ip/evidence-log.md`.

## 9. Sources (all read 2026-11-10)

[Register and login Online Filing](https://mijnoctrooi.rvo.nl/bpp-portal/en/node/120) · [Online Filing news and decommissioning dates](https://mijnoctrooi.rvo.nl/bpp-portal/en/node/149) · [Online Filing user guide, FO Manual v1.0](https://mijnoctrooi.rvo.nl/bpp-portal/sites/default/files/2025-10/FO%20Manual%20User%20Guide_1.0.docx) · [OCNL eOLF page](https://www.octrooicentrum.nl/over-octrooien/octrooi-aanvragen-en-verlening/digitaal-aanvragen-indienen-online-filing-eolf) · [RVO page (older, EPO smart card text)](https://www.rvo.nl/onderwerpen/octrooien-ofwel-patenten/octrooi-aanvragen/nederland/procedure) · [documents submission](https://www.octrooicentrum.nl/octrooien/octrooi-aanvragen-en-verlening/octrooidocumenten-indienen) · [payment methods](https://www.octrooicentrum.nl/octrooien/octrooi-aanvragen/betaalmethoden) · [format rules](https://www.octrooicentrum.nl/over-octrooien/octrooi-aanvragen-en-verlening/vormvereisten-nederlandse-octrooidocumenten).
