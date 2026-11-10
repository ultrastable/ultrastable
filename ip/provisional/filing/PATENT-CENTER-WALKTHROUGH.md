# Patent Center: file the provisional (one page)

Not legal advice. Time: about 20 minutes once the account is verified.

**Before the day** (one time): create a USPTO.gov account at https://account.uspto.gov, finish identity verification (ID.me or the paper route; this can take days, so do it first), and keep the phone with the two-factor code nearby.

**On the day**
1. Run `python3 ip/provisional/tools/preflight.py` in the repo. It must print `0 failures`.
2. Open Patent Center: https://patentcenter.uspto.gov and sign in.
3. Choose **New submission**, then **Utility** application type, then in the filing options choose **Provisional** (a provisional is filed as a utility-type submission without claims required; if the menu offers "Provisional application", pick that).
4. **Upload documents.** Each file must be a PDF, letter size, text-searchable, not password protected. Upload:
   - `provisional-specification.pdf` → document description **Specification**
   - `drawings.pdf` → document description **Drawings-only black and white line drawings**
   - the filled cover sheet (see `cover-sheet-PTO-SB-16-data.md`) → **Provisional Cover Sheet (SB16)**; or complete the in-form Application Data Sheet with the same values.
5. **Applicant and inventor** screens: type the values from `cover-sheet-PTO-SB-16-data.md` (inventor Rowan, residence, mailing address, correspondence email). No attorney, no customer number, no domestic benefit, no foreign priority, no government interest.
6. **Entity status / fees:** choose micro or small as decided in `FEES-AND-ENTITY.md`; complete the micro certification on screen if applicable. The fee line shows the exact amount.
7. **Pay** by card or deposit account.
8. **Sign** with an S-signature: type your full legal name between slashes, `/Full Name/`.
9. **Submit.** Wait for the acknowledgment receipt screen, then download the **filing receipt** (application number, filing date, confirmation number).

**After submitting**
- Save the filing receipt in `ip/` (name it `ip/filing-receipt-2026-11-10.pdf`, or the filing day) and add the application number and date to `ip/evidence-log.md`.
- Put the 12-month conversion deadline on the calendar (issue IP-6). The filing date is the priority date.
- Then, and not before, the public site may say "Patent pending" (issues WEB-2, GH-5, PF-1 unlock).
- Check the filing receipt for a foreign filing licence statement; ask the attorney if it appears or if the receipt is delayed.
