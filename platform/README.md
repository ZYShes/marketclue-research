# MarketClue Platform

Author: **Yuexizi Zhang**

Sourced market research, a marketing plan and a budget for solo founders, built on Claude and AWS.
Every statement in a report links to a fact card (exact quote, source link, capture date) or is
labelled as an assumption or an estimate. See `SPEC.md` for the design.

The original Streamlit prototype at the repository root is unchanged and keeps running at
https://marketclue-zyshes.streamlit.app/.

## Frontend (v3)

Static files in `frontend/`, no build step (ES modules): `app.js` (boot, sign-in, router), `shell.js`
(sidebar with Recent history, mobile drawer), `research.js` (`#/new` tool picker and history, `#/c/<id>`
conversation with the research depth slider in `depth.js`: Quick → Balanced → Smarter), `run.js` (live run, report actions, mock-ups, shared report),
`report.js` (report, source hover cards, fact card sheet), `charts.js` (accessible SVG charts for
`result.charts`), `library.js` (Fact library and My reports, Mine | Team), `team.js` (Team, `#/join/<token>`).

Templates (v4, SPEC "v4 templates"): `#/new` starts with "Choose a template" — General or eBay seller — as
radio cards with capability badges, loaded from `GET /api/templates`. A template the server reports as
unavailable is shown disabled with its reason; the last choice is remembered per user in localStorage. The
chosen template goes with the first chat message, and a template badge appears next to the depth badge on
conversation, run and report pages (General shows none). eBay reports add "Comparable eBay listings" (asking
prices of active listings on the retrieval date, never sold prices, with the asking-price chart) and
"eBay fees & ad costs" (fee breakdown, Promoted Listings ad-rate scenarios, a stacked chart per scenario and
the ad budget box). A stacked chart whose series items carry `segments` draws one stacked bar per item.

Mock mode: open the site with `?mock=1`. It answers every API call from `mock.js` with invented sample data
and offers two demo accounts — an owner (unlimited reports and mock-ups, owns the team "Clay & Leaf
Studio") and a member (free reports, with a pending invite at `#/join/sample-invite`). Anyone may pick any
research depth. Add `&mockups=off` to see the site without the mock-up feature (the endpoint answers 503) and
`&smarter=limit` to see Smarter refused by the daily cap (429 `smarter_daily_limit`). eBay samples: the owner
has two eBay seller reports (`#/runs/eb01c0ffee01` comparable listings, `#/runs/eb02c0ffee02` fees and ad
budget) and a ready eBay conversation (`#/c/conv-ebay-ready`); every listing is invented and links to
example.com. `&ebay=off` shows the eBay template as not connected (409 `template_unavailable` on use) and
`&fees=partial` shows an incomplete fee breakdown (no per-order fee, no ad budget).

QA (`qa/frontend-v3/`): serve `frontend/` with `python3 -m http.server 8765`, then run
`node qa/frontend-v3/run-qa.js` (screenshots at 1280 and 375 px, axe-core WCAG 2.2 AA rules, horizontal
scroll and 44 px target checks; writes `qa-report.json` and `screenshots/`) and `node qa/frontend-v3/flows.js`
(resume, run, join and keyboard flows). Playwright must be installed; set `AXE_PATH` to a local
`axe.min.js` when the axe-core CDN is not reachable.

QA for templates (`qa/templates/`): with the same server, `node qa/templates/flows.js` picks eBay seller,
chats, runs and checks the listings table, both eBay charts, the fee breakdown, the ad budget, partial fees,
the not-connected card and keyboard selection, then screenshots the new pages at 1280 and 375 px (and 200%
zoom) with axe-core and horizontal-scroll checks into `qa/templates/screenshots/` and `qa-report.json`.
Set `BASE` when the server is not on `http://localhost:8765/index.html`.
