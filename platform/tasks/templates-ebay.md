# Task: Templates, starting with "eBay seller" (v4)

Branch `templates-ebay` from `main` of ObserverLabs/marketclue-platform (29b60de or later). Read first:
`platform/SPEC.md` (v3 sections and "v3 decisions"), `platform/backend/README.md`, `platform/README.md`,
`platform/design/UX-RESEARCH.md`. Main now has changes you have not seen: a `balanced` mode
(Sonnet research agents on the basic web tools), a site-wide Smarter cap (429 `smarter_daily_limit`),
public `GET /api/invites/{token}`, capped mock-up size/quality, `deploy.sh --backend-only | --staging`.

Owner: Yuexizi Zhang (credit her as author everywhere). Commit as ObserverClaude. Push only to
`templates-ebay`; the main session merges, deploys and runs live QA. Do not deploy.

## Goal

A **template** is a ready-made setup for one kind of founder or marketplace that the user picks before
a tool runs. It bundles (a) extra intake questions, (b) **capabilities**: tools the research agents may
call besides web search/fetch (in-process API clients now, remote MCP servers later), (c) extra report
sections and charts, and (d) source rules. The first template is **eBay seller**:

1. Find live eBay listings similar to the founder's product (comparable "competitor" items).
2. Show what eBay selling costs: final value fee, per-order fee, payment and shipping costs.
3. Show eBay **Promoted Listings** ad cost scenarios, so the founder can cap ad spend (cost control).

"General" (today's behaviour, no extra capabilities) stays the default template.

## Facts checked 2026-11-04 (re-check official pages; do not hard-code numbers from here)

- eBay **Finding API and Shopping API were decommissioned on 2025-02-05**; the replacement is the
  **Browse API** (`GET /buy/browse/v1/item_summary/search`, application token from the client-credentials
  grant, scope `https://api.ebay.com/oauth/api_scope`, up to 200 items per call). Daily limits are per app
  (check the Developer Analytics API `rate_limit`); plan for a few thousand calls a day at most.
- **Sold prices are not available to us**: the Marketplace Insights API (sold items, last 90 days) is a
  Limited Release for approved partners. So every price we show is an **asking price of an active listing on
  the retrieval date**. Label it exactly that way in claims, tables and charts. Never write "sells for".
- **Promoted Listings General** (cost per sale): seller picks an ad rate as a % of the total sale amount;
  charged only when a buyer clicks the ad and buys within 30 days. The 2%–100% range was confirmed on the UK
  help page only; confirm the US page (https://www.ebay.com/help/selling/ebay-advertising/promoted-listings-overview?id=5295)
  at run time. **Priority** (cost per click) is charged per click whether or not the item sells; no public
  per-click price list was found, so treat it as "set a daily budget" guidance, not a number.
- Suggested / trending ad rates per listing come from the **Recommendation API**
  (`findListingRecommendations`), which needs a **seller user token** and existing listing IDs. Out of scope
  for this task (phase 2: "Connect your eBay seller account").
- No official eBay MCP server exists; community ones (hanku4u/ebay-mcp-server, YosefHayim/ebay-api-mcp-server)
  are unreviewed third-party code. Do not depend on them. Build our own small client.

## Backend

### Templates and capabilities

- `app/templates.py`: `TEMPLATES = {"general": {...}, "ebay": {...}}`. Each template has `id`, `name`,
  `description`, `tools` (which of the four feature ids it supports; eBay supports all four),
  `capabilities` (ids), `intake_needs` (extra things the research lead must learn, e.g. eBay category or a
  close example listing, item condition, target price, who pays shipping, whether they already sell on eBay)
  and `source_rules` (e.g. "fees and ad rules only from ebay.com help pages").
- `app/capabilities/__init__.py`: a small registry. A capability = `{id, label, tool_definitions (Claude
  tool JSON), run(name, input) -> dict, available() -> (bool, reason)}`. Design it so a later capability
  can be a remote MCP server (Claude API MCP connector) instead of in-process code, but do not build
  MCP plumbing now.
- `app/capabilities/ebay.py`:
  - `ebay_search_listings(query, category_id?, condition?, min_price?, max_price?, limit<=50)` → Browse API
    `item_summary/search` on EBAY_US; returns compact items: title, price + currency, shipping cost if given,
    condition, item URL, seller feedback score, image URL, buying options, `retrieved_at`.
  - Application token cached in memory until expiry; credentials from SSM
    `/marketclue/ebay_client_id` and `/marketclue/ebay_client_secret` (optional; when missing
    `available()` is false with reason "eBay is not connected yet").
  - Cache identical queries for 24 h in DynamoDB (`EBAY#<sha>`), at most 8 Browse calls per run and a
    site-wide daily cap env `MAX_EBAY_CALLS_PER_DAY` (default 1000). 30 s timeout, one retry.
  - Save the raw API JSON of every call to S3 `runs/<run_id>/ebay/<n>.json`; that snapshot is the evidence.

### Pipeline

- Research agents of a run whose template has capabilities get those tools as **client tools** next to the
  server web tools: implement the tool-use loop in `claude.research_call` (execute tool calls, return
  `tool_result`, continue until `end_turn`, keep the pause_turn handling). Haiku/Sonnet/Opus all get them.
- New evidence type: a FINDING may cite a listing returned by `ebay_search_listings` (URL = item URL).
  The quote checker accepts it when the quoted text is found in the saved API snapshot for that item
  (title/price fields), and the card gets `source_kind: "ebay_api"`, `retrieved_at`, and the label
  "eBay listing (asking price, <date>)".
- eBay template report additions (result v4, keep v3 fields):
  - `listings`: up to 12 comparable active listings (title, price, shipping, condition, url, card_id).
  - Chart `asking_prices`: price spread of comparable active listings (sorted bar or dot plot), caption must
    say "asking prices of active listings on <date>, not sold prices".
  - `fees`: a per-item cost breakdown at the founder's target price: final value fee %, per-order fee,
    estimated shipping, Promoted Listings General ad fee at 3 ad rates (e.g. low/typical/high), and what is
    left. Fee percentages must come from cards sourced from official ebay.com pages fetched in this run
    (kind sourced); the arithmetic is kind `estimate` with the method shown. If a rate could not be sourced,
    say so in `missing_evidence` and leave it out rather than guessing.
  - Chart `ebay_costs`: stacked bar of price → fees → ad fee → what is left, per ad-rate scenario.
  - `ad_budget`: the break-even ad rate (the rate at which nothing is left) and a recommended ceiling
    (e.g. half the break-even rate, labelled as a suggestion), plus one line on Priority (daily budget,
    charged per click).
- Feature mapping for the eBay template: competitor_scan → listings + asking-price chart; marketing_plan →
  fees + ad scenarios + budget; launch_checklist → eBay seller account, managed payments, sales tax
  collection by eBay, item specifics/photos rules from ebay.com help; market_check → what listings in the
  category emphasise and which buyers they target (from listing titles/specifics, labelled as listing
  evidence, not buyer voice).

### API

- `GET /api/templates` (signed in) → `[{id, name, description, tools, capabilities: [{id, label}],
  available, unavailable_reason}]`.
- `POST /api/chat` new conversation accepts `template` (default `general`; unknown → 400
  `invalid_template`; unavailable → 409 `template_unavailable` with the reason). Stored on the
  conversation, the brief, the run and the result (`result.template`). Run rows in lists include it.
- Intake `SYSTEM` gets the template's `intake_needs` and still asks at most three questions.

### Tests (no network)

- Unit tests with a fake Browse API (monkeypatch `requests`), token caching, per-run and daily caps,
  24 h cache, missing-credentials path, the tool-use loop (a tool call, a result, then FINDINGs),
  the quote check against API snapshots, fees/ad arithmetic (including a zero-margin case), the new API
  routes, and that the general template behaves exactly as before. Keep all existing tests passing.

### Infra

- `template.yaml`: env `MAX_EBAY_CALLS_PER_DAY`, SSM read already covers `marketclue/*`.
- `deploy.sh`: `put_secret ebay_client_id` / `ebay_client_secret` from `~/.config/marketclue/` only when
  those files exist.

## Frontend

- New research: a "Template" choice above the four tools: "General" and "eBay seller", as large radio
  cards (same style and keyboard behaviour as the tool cards). Each shows its capabilities as small badges
  ("Searches live eBay listings", "Estimates eBay fees and ad costs"). An unavailable template is shown
  disabled with its reason. Remember the last choice per user (localStorage, try/catch).
- Conversation and run pages show the template as a badge next to the depth badge.
- Report: "Comparable eBay listings" table (asking price, shipping, condition, link), the two new charts
  (accessible SVG like the v3 charts, with data table toggle), the fee breakdown and the ad budget box.
- `mock.js`: an eBay sample report and a `GET /templates` answer (one available, one not with `&ebay=off`).
- Extend `qa/frontend-v3/flows.js` (or add `qa/templates/flows.js`): pick eBay, run, see listings and charts.

## Human steps (the owner does these; do not block on them)

eBay Developer Program account → create an application → production keyset (Client ID + Client Secret)
→ complete the Marketplace Account Deletion notification step (or the exemption for apps that do not store
eBay user data). The keys go to SSM as SecureStrings. Until then the eBay template shows "not connected".

## Done when

All tests pass, flows pass in mock mode, README/SPEC updated (SPEC "v4 templates" section), branch pushed.
Report what you verified and what still needs the real eBay keys.
