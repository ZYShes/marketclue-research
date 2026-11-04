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
conversation with Quick ↔ Smarter), `run.js` (live run, report actions, mock-ups, shared report),
`report.js` (report, source hover cards, fact card sheet), `charts.js` (accessible SVG charts for
`result.charts`), `library.js` (Fact library and My reports, Mine | Team), `team.js` (Team, `#/join/<token>`).

Mock mode: open the site with `?mock=1`. It answers every API call from `mock.js` with invented sample data
and offers two demo accounts — an owner (unlimited, Smarter and mock-ups, owns the team "Clay & Leaf
Studio") and a member (free reports, Quick only, with a pending invite at `#/join/sample-invite`).
Add `&mockups=off` to see the site without the mock-up feature (the endpoint answers 503).

QA (`qa/frontend-v3/`): serve `frontend/` with `python3 -m http.server 8765`, then run
`node qa/frontend-v3/run-qa.js` (screenshots at 1280 and 375 px, axe-core WCAG 2.2 AA rules, horizontal
scroll and 44 px target checks; writes `qa-report.json` and `screenshots/`) and `node qa/frontend-v3/flows.js`
(resume, run, join and keyboard flows). Playwright must be installed; set `AXE_PATH` to a local
`axe.min.js` when the axe-core CDN is not reachable.
