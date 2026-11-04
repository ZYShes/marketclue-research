# Task: four more templates (Food truck, Restaurant / café, Daycare / childcare, Etsy seller)

Branch `templates-more` from `main` of ObserverLabs/marketclue-platform (latest). Read first: `platform/SPEC.md`
(v4 templates, v5 projects), `platform/backend/README.md`, `platform/tasks/templates-ebay.md` (how the eBay
template is built), `platform/backend/app/templates.py`, `capabilities/`, `ebay_report.py`. Owner: Yuexizi Zhang
(credit her as author). Commit as ObserverClaude, push only to `templates-more`, do not deploy; the main session
merges, deploys and runs live QA.

## Goal (owner, 2026-11-04)

Add four templates next to General and eBay seller, so the New research page offers six. None of them needs a
new API key: they use web search and fetch with template-specific intake questions, source rules, report
sections and charts. Every claim keeps the Sourced / Assumption / Estimate labels and quote checks.

| id | Name | Who it is for |
| --- | --- | --- |
| `food_truck` | Food truck | Someone starting a mobile food business in a US city |
| `restaurant` | Restaurant / café | Someone opening a small restaurant, café or bakery |
| `daycare` | Daycare / childcare | Someone opening a home daycare or a childcare center |
| `etsy` | Etsy seller | A maker selling handmade or designed goods on Etsy |

## Shared building blocks (new capabilities, in-process, no keys)

1. **`official_requirements`** ("Checks permits from official pages"): research directions for permits, licences,
   inspections, taxes and rules must prefer the founder's city, county and state government pages (.gov, plus
   state-run domains listed in code). A requirement item counts as Sourced only when its card comes from such a
   page fetched in this run; otherwise it is an Assumption with "check with <agency>". Each item: requirement,
   agency, link, fee only if a sourced card states it, captured date. The section is titled
   "Requirements to check" and always carries the line: "A checklist built from official pages. Confirm each item
   with the agency; this is not legal advice."
2. **`local_benchmarks`** ("Compares nearby businesses"): find comparable local businesses and their public prices
   (menus, tuition, fees) from their own pages or listings. Chart `price_benchmarks` from sourced cards only
   (like the eBay asking-price chart); caption says what the prices are and the retrieval date. No ratings or
   review counts unless a fetched page states them; never personal data.
3. **`startup_costs`** ("Estimates startup costs"): a cost breakdown (e.g. vehicle or lease, equipment, permits,
   insurance, first inventory) as kind `estimate` with the method written out, built only from sourced cost
   cards plus clearly labelled founder inputs from the brief. A cost line with no source is left out and named in
   `missing_evidence`. Chart `startup_costs` = stacked bar or ranked bars with a total range, never a single
   precise total.
4. **`etsy_fees`** ("Estimates Etsy fees and ad costs"): like `ebay_fees` in `ebay_report.py`: fee rates count only
   when a sourced card from an etsy.com help page fetched in this run states them (listing fee, transaction fee,
   payment processing fee, Offsite Ads fee and its tiers). Breakdown at the founder's target price and what is
   left; chart `etsy_costs`. Comparable listing prices come from etsy.com pages the agents fetched (asking prices
   on the retrieval date, never sold prices).

Reuse the eBay patterns (registry entry, `available()`, report builder, charts in `charts.py`). Keep templates
data-driven in `templates.py`; a template lists its capabilities, intake needs, source rules and which report
sections each of the four tools gets.

## Per-template detail

- **Food truck** — intake: city and state, cuisine, where they plan to sell (street, events, office parks),
  own truck or rented. Requirements: mobile food unit health permit, commissary kitchen rule, fire inspection,
  business licence, street-vending and parking rules, event vendor fees. Benchmarks: nearby trucks' menu prices.
  Startup costs: truck (buy/lease), kitchen equipment, permits, insurance, first inventory.
- **Restaurant / café** — intake: city and neighbourhood, seats, cuisine, alcohol or not. Requirements: food
  service permit, plan review, business licence, liquor licence (state), signage and occupancy rules.
  Benchmarks: nearby menu price ranges. Startup costs: lease and deposit, build-out, equipment, permits.
- **Daycare / childcare** — intake: state and city, home-based or center, ages served, planned number of children.
  Requirements: state childcare licence (for Washington: DCYF), staff-to-child ratios by age, background checks,
  training, space rules, inspections; subsidy programs (for Washington: Working Connections Child Care) and
  insurance. Benchmarks: nearby tuition ranges from providers' own pages. Startup costs: space changes, safety
  equipment, licensing fees, insurance. Never collect or show anything about specific children or families.
- **Etsy seller** — intake: product type, size and material, target price, shipping (who pays). Report:
  comparable Etsy listings with asking prices, fee breakdown, Offsite Ads scenarios, what is left per sale.

The four tools map as for eBay: market_check → who buys and what they say (local: who the customers are,
what nearby businesses emphasise); competitor_scan → benchmarks; launch_checklist → requirements; marketing_plan
→ channels plus cost lines. Intake still asks at most three questions and reuses the project brief.

## Frontend

- New research shows six template cards; cards wrap on narrow screens; the `#/templates` page lists all six.
  Each card has an icon, a one-line description and its capability badges.
- Report sections: "Requirements to check" (with the not-legal-advice line), "Prices nearby", "Startup costs",
  and for Etsy "Etsy fees & ad costs". Same accessibility bar as before (axe 0, 44 px targets, keyboard).
- `mock.js`: one sample report per new template; extend `qa/templates/flows.js`.

## Tests (no network)

Registry and `GET /api/templates` (six entries, all available), intake prompts include each template's needs,
official-source rule (a requirement from a non-government page becomes an Assumption), benchmark chart only from
sourced cards, startup-cost estimate math and missing lines, Etsy fee math including a zero-margin case, and the
General and eBay templates unchanged. All existing tests pass.

## Done when

Tests and mock flows pass, SPEC gets a "v4.1: more templates" section, README updated, branch pushed. Report what
you verified.
