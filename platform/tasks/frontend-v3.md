# Task: frontend v3 (branch `frontend-v3`)

Rebuild the UI in platform/frontend/ (static files, no build step) to platform/SPEC.md v3 (read the
whole spec; v3 and Teams sections at the end win). The owner said the current UI looks too old: build a
modern, product-grade, calm interface (Linear / Perplexity / Elicit quality) with full accessibility.
If platform/design/UX-RESEARCH.md exists on any branch, use it; otherwise look at a few of those products
yourself first.

Must have: app shell with a left sidebar (New research button; Recent list grouped Today / This week /
Earlier mixing drafts, running and finished reports with status chips; Fact library; Team) that collapses
on mobile; `#/new` with tabs New (tool picker with the four v3 tool names and the stage names Discover →
Compare → Prepare → Grow) and Existing (searchable history); resume a conversation from history and after
a reload (localStorage keeps the open conversation id); Quick ↔ Smarter control next to Start research
with time/cost hints (Smarter disabled for non-owners with a one-line reason); report page keeps the
classic structure (brief at a glance, numbered findings with sources, tool section, next steps & missing
evidence, coverage) and adds charts from `result.charts` as accessible inline SVG (title, caption, data
labels, "Show data" table toggle, kind badge Sourced/Estimate, method for estimates) and source hover
cards; "Show a mock-up" button that calls the mock-up endpoint when available (hide on 503), images
labelled "AI mock-up — not a real product photo"; Team page and `#/join/<token>`; Library and My reports
get Mine | Team toggles; landing keeps the slogan "See the market differently." in the new visual
language; reading preferences (larger text, spacing, reduced motion, zoom) and the Reading & motion
dialog stay. WCAG 2.2 AA throughout (contrast 4.5:1, visible focus, keyboard everything, landmarks,
labelled controls, 44px targets, reduced motion), no horizontal scroll at 375 px.

Extend mock mode (?mock=1) to cover every new endpoint so the whole UI works without a backend. QA with
Playwright screenshots of every page at 1280 and 375 px (install playwright if needed) and fix what you
see; also run an automated accessibility check (axe-core via CDN in the Playwright page) and fix
violations. Commit with `git -c user.name=ObserverClaude -c user.email=observerax+claude@gmail.com commit`
early and often; push your branch. Final message: what changed, screenshots location, open issues.
