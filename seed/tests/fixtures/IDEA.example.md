---
# The one file a founder writes. Everything else bootstraps from it.
org_name: Example Co
slug: example-co
owner: Founder Name
owner_contact: set-in-secret-store   # never put an email or token in this file
owner_contact_backup: set-in-secret-store   # a second address at a different provider: sign-in codes fall through to it when the first is refused or suppressed
---

# Idea

One paragraph: the ongoing system you want to run and what it is accountable for. Not a one-off page or app (see doctrine/VISION.md).

Example: A compliance desk that tracks changes to the rules our product is subject to, updates our controls and evidence, and reports what is out of date every week.

# System test

All four are required. If you cannot fill one in, this is not a fit for Ultrastable.

- Loop: new rule published, control updated, evidence re-checked, with no person in the middle
- Measure: controls out of date, target 0
- Upkeep: regulators publish changes every week
- Run cost: 150 USD a month for the back end

# Who it is for

- The compliance owner and the engineers who ship to the regulated market

# First outcomes

Each line becomes a project with a product manager. Write outcomes, not tasks; the managers break them down.

- Every rule change is triaged within one day
- Controls and evidence are never more than a week out of date
- A weekly four-line report reaches the owner

# Constraints

- Budget per month: 150 USD
- Nothing public until the owner says so
