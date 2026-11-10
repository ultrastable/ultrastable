# Decision memo: how Rowan secures a priority date from the Netherlands

Date: 2026-11-10. Status: decision made. **Working analysis from primary sources, not legal advice.**

## 1. Decision

**File a Dutch national patent application at Octrooicentrum Nederland (OCNL), with an English description and Dutch claims (three, in `conclusies-nl.md`), and do not request the search at filing.** This is the closest European thing to a US provisional: you self-file online, the description may be English, nothing is examined for you unless you ask, and the filing date becomes a Paris Convention priority date for 12 months. Within 12 months, file the real application (PCT, or EPO directly) claiming that date.

Runner-up (use if OCNL's Dutch-claim or payment steps block you): **direct EPO filing**, English, self-represented, about EUR 2,800 all-in (`FEE-TABLE.md`). Third: UK IPO, cheapest on paper but it needs a UK address for service (unverified here).

Why NL first: lowest cost and effort of the self-filable routes, a local office that speaks to residents, no search fee forced at filing, and the application simply lapses if you never request the search (OCNL: request and pay within 13 months of filing, or it lapses).

## 2. The US claim, verified

Rowan's claim is **substantially right but not absolute**.

- Final rule, 91 FR 13510 (20 Mar 2026), effective **20 July 2026**: an applicant or owner whose domicile is outside the US must be represented by a registered practitioner; papers must be signed by one. New 37 CFR 1.9(p): domicile is permanent legal place of residence. **Citizenship is irrelevant** ("The USPTO does not collect information on citizenship"); no exception for US citizens abroad; no exception for mixed groups.
- **Provisionals are covered.** The USPTO rejected a request to exempt them. But a provisional **still receives a filing date without a practitioner** (37 CFR 1.53). What fails: an ADS signed by a foreign-domiciled inventor is not accepted (treated as a transmittal letter), so inventorship is not set; later steps (petition to revive, correct inventorship, and the like) need a practitioner; micro entity status needs a practitioner's signature; nonpublication-type requests lack cure.
- Exempt: inventor oath/declaration (1.63), PCT national stage entry documents and PCT-office processing, third-party maintenance fee payments.
- Consequence for planning: a US route later (non-provisional or national stage) will need a practitioner for ordinary prosecution. That is a cost to schedule at month 12, not a reason to avoid filing now.
- Sources: [USPTO notice](https://www.uspto.gov/subscription-center/2026/effective-july-20-foreign-domiciled-patent-applicants-and-owners-will-be) · [Federal Register 2026-05564](https://www.federalregister.gov/documents/2026/03/20/2026-05564/required-use-by-foreign-applicants-and-patent-owners-of-a-patent-practitioner) · [USPTO flyer](https://www.uspto.gov/sites/default/files/documents/flyer-uscounsel-jul2026.pdf).
- Not verified: whether a bare self-filed provisional is fully usable as a US priority claim later. Attorney question.

## 3. Options compared

| Route | Self-file? | Language | Examined? | Cost to secure date | Verdict |
|---|---|---|---|---|---|
| **NL national (OCNL)** | Yes, online (MijnOctrooi / MyPage) | Description Dutch or English; **claims must be Dutch**; abstract same language as description | Search is mandatory for grant but you request it (within 13 months); NL grants even if the search shows the invention is not new or inventive | Procedure fee (amount not published on pages read; see FEE-TABLE) | **Chosen** |
| EPO direct | Yes: Art. 133(1) EPC lets a resident of a contracting state file without a representative | English | Search report issues; examination only on request | EUR 135 filing + EUR 1,595 search + page fees (about EUR 2,800) | Runner-up |
| PCT at RO | Yes at OCNL, EPO or WIPO | English | International search | EUR 1,885 search + CHF 1,330 + transmittal | Not for a first filing: dearer and not faster |
| UK IPO | Yes | English | Only on request within 12 months | GBP 120 (2026 schedule) | Needs UK address for service; unverified |

NL facts from OCNL: [apply](https://www.octrooicentrum.nl/octrooien/octrooi-aanvragen-en-verlening/nederlands-octrooi-aanvragen), [documents](https://www.octrooicentrum.nl/octrooien/octrooi-aanvragen-en-verlening/documenten-nederlandse-octrooiaanvraag), [format and language](https://www.octrooicentrum.nl/over-octrooien/octrooi-aanvragen-en-verlening/vormvereisten-nederlandse-octrooidocumenten), [search](https://www.octrooicentrum.nl/octrooien/octrooi-aanvragen-en-verlening/onderzoek-naar-de-stand-van-de-techniek-voor-je-octrooi). Note: the apply page says the novelty search is mandatory for the procedure and recommends requesting it at filing; the search page says you must request and pay within 13 months. Our plan relies on the latter and Rowan confirms by phone (OCNL 088 042 40 02, option 2) or e-mail verlening@octrooicentrum.nl before filing.

Other priority-establishing routes considered: Benelux and national offices of other states each need their own language and often a local representative; none is cheaper than the three above. A US provisional with filing date only is possible but leaves the ADS unaccepted (section 2).

## 4. What "not examined" means here

- **NL**: no novelty examination blocks grant. The search tells you what exists; the patent can still be granted. Quality is then tested in court. That is cheap protection of uncertain strength, which is fine for a priority date.
- **EPO**: always searches; examines only when you ask and pay.
- **Priority needs only the filing date and a description that supports what you later claim.** A thin filing gives thin priority. File the full specification.

## 5. Novelty risk (stated plainly)

EPO and most countries apply **absolute novelty**: a public disclosure of the invention before the filing date can destroy patentability in Europe, and Europe has no general grace period (the US has a one-year inventor grace period; Europe does not). Every day before filing is exposure. **Whether anything was previously disclosed is an open attorney question and is not asserted here** (`ip/provisional/FILING-CHECKLIST.md` section 1). Until filing, publish nothing new.

## 6. Foreign filing license (US law) and secrecy

- 35 U.S.C. 184 and 37 CFR 5.11: a license is needed before filing abroad only for an **invention made in the United States** (and, with no US filing, no license exists). 5.11(e)(1): no license if the invention was not made in the US. Citizenship and residence are not mentioned in the rule text read; **where the work was done is the test.** Sources: [MPEP 140](https://www.uspto.gov/web/offices/pac/mpep/s140.html).
- Penalty for a missed license: no US patent, or an invalid one (35 U.S.C. 185); willful violation is criminal (186). Serious, so it is on the attorney list.
- If any of the invention was made while Rowan was in the US, treat a license as required. A license petition is a USPTO paper by a foreign-domiciled person and would itself need a practitioner. A one-hour attorney consult answers this; do it before filing if there is any doubt.
- Export-control status of the technical data (5.11(c)) is separate.
- Dutch side: the Rijksoctrooiwet 1995 has national-security secrecy provisions for applications; not verified here whether OCNL screens a resident's application. Attorney question.

## 7. Open attorney questions (none blocks the plan)

1. Where was the invention made (US vs NL), and is a US foreign filing license needed?
2. Is a self-filed US provisional (date only, no accepted ADS) usable later as a priority claim?
3. Any prior disclosure and its dates (QNFO repository; no assertion made).
4. Is an NL priority filing with a Dutch claim enough support, or should the Dutch claim mirror a family?
5. Dutch national-security screening and Art. 75(2) EPC national-filing requirement for NL residents.
6. Entitlement and assignment if Ultrastable is later incorporated (priority right transfers).
7. US counsel at month 12.

## 8. Plus

Prepare the PCT request at month 9 from the same values sheet so month 12 is a form-fill. Expected value: removes the one deadline that cannot be extended.
