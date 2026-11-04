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
conversation; `depth.js` holds the research depth control - a button in the bottom-right corner of each message box that opens a three-stop slider: Quick → Balanced → Smarter), `run.js` (live run, report actions, mock-ups, shared report),
`report.js` (report, source hover cards, fact card sheet), `charts.js` (accessible SVG charts for
`result.charts`), `library.js` (Fact library and My reports, each with a scope picker), `team.js` (Team, `#/join/<token>`).

Templates (v4, SPEC "v4 templates"): `#/new` starts with "Choose a template" — General or eBay seller — as
radio cards with capability badges, loaded from `GET /api/templates`. A template the server reports as
unavailable is shown disabled with its reason; the last choice is remembered per user in localStorage. The
chosen template goes with the first chat message, and a template badge appears next to the depth badge on
conversation, run and report pages (General shows none). eBay reports add "Comparable eBay listings" (asking
prices of active listings on the retrieval date, never sold prices, with the asking-price chart) and
"eBay fees & ad costs" (fee breakdown, Promoted Listings ad-rate scenarios, a stacked chart per scenario and
the ad budget box). A stacked chart whose series items carry `segments` draws one stacked bar per item.

Projects (v5, SPEC "v5: projects"), in `projects.js` (project store, new-project and move dialogs, breadcrumb,
project page): the sidebar lists Projects above Recent (name and a small "Personal" or "Team · <name>" tag,
"+ New project", "Show archived"), and Recent rows show their project name in muted text. The project page
`#/p/<id>` has the name, team or Personal, one "New research in this project" button, a journey strip of
four stage cards (Discover, Compare, Prepare, Grow: latest report with date and one-line takeaway, or "Not
started" with a Start link that opens New research with that tool and the project chosen), Reports and Fact
cards tabs (stage filter, search) and a small "Project brief" box with Edit; "Project settings" (rename,
move between Personal and a team, archive) only for whoever may manage it. New research has a "Project"
select at the top (the project you came from, else the last used, else "No project"; "+ New project" asks
only for a name and Personal/Team) and shows "We already know: …" when the project has a brief; choosing a
project also picks its default template. Conversation, run and report pages show a `Project › Stage`
breadcrumb, and the author gets "Move to project" on the report. Cards reused from an earlier report in the
project are labelled "From an earlier report in this project" and keep their original date. The Team page
has a team picker when you are in several teams (`#/team?team=<id>`), lists the team's projects and offers
"Create another team".

My reports and the Fact library have one scope picker, "Show reports from" / "Show fact cards from": Mine,
then each of your teams (`GET /api/teams/{id}/runs`, `/cards`: finished reports and cards in that team's
projects) and each live project (`GET /api/projects/{id}/runs`, `/cards`). The choice is kept in the address
(`?scope=team:<id>` or `?scope=project:<id>`; the old `?scope=team` means the first team) and remembered per
page; a team or project that is gone falls back to Mine. Search and the type, direction and tool filters work
inside the chosen scope. "Leave team" (members and, when someone else is in the team, owners) opens a dialog:
when you own the team or projects in it, "Who takes over?" picks another member and lists what moves to them;
429 `project_limit` (that member already has 10 live projects) keeps the dialog open to choose someone else.
Removing a member says their projects in the team move to the team owner. A person may own 10 live (not
archived) projects: creating or restoring one at the limit shows the server's message and a hint to archive one.

Loading: `app.js` imports only the shell (`ui`, `api`, `core`, `shell`, `features`, `projects`); each page module
is loaded with `import()` when its route first opens and the rest are prefetched once the first page has
settled. An inline script at the top of `index.html` starts `GET /api/me` (and, for someone signed in last time,
the opening conversation or report) and adds `modulepreload` hints for the opening page, so those requests do
not wait for the module graph; `api.js` reuses those answers once, within 15 seconds. Keep page modules out of
`app.js`'s static imports, and shared helpers (like `toolIcon`) in small modules.

Mock mode: open the site with `?mock=1`. It answers every API call from `mock.js` with invented sample data
and offers two demo accounts — an owner (unlimited reports and mock-ups, owns the team "Clay & Leaf
Studio") and a member (free reports, with a pending invite at `#/join/sample-invite`). Anyone may pick any
research depth. Add `&mockups=off` to see the site without the mock-up feature (the endpoint answers 503) and
`&smarter=limit` to see Smarter refused by the daily cap (429 `smarter_daily_limit`). eBay samples: the owner
has two eBay seller reports (`#/runs/eb01c0ffee01` comparable listings, `#/runs/eb02c0ffee02` fees and ad
budget) and a ready eBay conversation (`#/c/conv-ebay-ready`); every listing is invented and links to
example.com. `&ebay=off` shows the eBay template as not connected (409 `template_unavailable` on use) and
`&fees=partial` shows an incomplete fee breakdown (no per-order fee, no ad budget). Project samples: the
owner has a personal project "Handmade ceramic planters" (`#/p/proj-planters`, reports at Compare, Prepare
and Grow, one still running, Discover not started; the unfiled Discover report `#/runs/b1c2d3e4f5a6` can be
moved into it), a team project "Planters on eBay" in Clay & Leaf Studio (`#/p/proj-ebay`, default template
eBay seller, includes a teammate's report), a team project "Market stall planters" the owner owns in North
Market Makers (so leaving that team asks who takes over) and an archived personal project. The owner is in two
teams (owns Clay & Leaf Studio with Riley Chen; member of North Market Makers with Riley Chen as owner and
Jordan Lee). A project with a brief makes the demo intake ask one question fewer, and a report in a project
cites one card from an earlier report in it. `&projects=limit` puts the owner at 10 live projects (creating or
restoring one answers 429 `project_limit`); `&limit=riley` gives Riley Chen 10 live projects, so handing a team
or project over to Riley answers 429.

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

QA for projects (`qa/projects/`): with the same server, `node qa/projects/flows.js` opens a project from the
sidebar, checks the journey strip, the Reports stage filter, Fact cards search and brief editing, starts a
stage from a team project (tool, project and default template preselected, "We already know", one question
fewer) through to the report breadcrumb and the earlier-card label, creates a project inline, moves a report
into a project, shows archived projects, switches teams with the picker, checks that a non-member cannot see
a team project until they join, covers keyboard paths, the My reports and Fact library scope picker (Mine,
team, project, remembered, stale scope back to Mine), leaving a team with a handover (including the 429 path
and a team owner handing over the team) and the 10-live-project limit on create and restore. It then screenshots the new pages at 1280 and 375
px (and 200% zoom) with axe-core, horizontal-scroll and 44 px target checks into `qa/projects/screenshots/`
and `qa-report.json`.
