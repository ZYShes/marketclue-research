# MarketClue Platform — 48-hour prototype spec

Author: Yuexizi Zhang. Branch `platform` of ZYShes/marketclue-research; everything lives under `platform/`.
The old Streamlit site (repo root, `cloud_app.py`, `MarketMind-A6-deploy.zip`) must not change.

## Goal

A solo founder signs in with Google, tells a "super agent" what they are building, answers 2–3
clarifying questions, and gets one short document: sourced findings, a marketing plan and a budget,
where every statement either links to a fact card (exact quote + link + capture date) or is labelled
as an assumption or an estimate. Fact cards accumulate in the founder's library for later reference
and can be shared read-only through a link.

Scope is a single-user end-to-end prototype. Not in scope: team spaces, roles, payments, vector search.

## Architecture (AWS, us-west-2, account 238554330017)

```
Browser ── CloudFront (one https origin) ──┬── /*      → S3 site bucket (static SPA, OAC)
                                           └── /api/*  → Lambda Function URL (marketclue-api)
marketclue-api (Python 3.12, x86_64, 1024 MB, 900 s)
  ├─ HTTP mode: router for /api/* (auth, chat, runs, cards, share)
  └─ worker mode: invoked asynchronously by itself with {"worker": "run", "run_id": ...}
DynamoDB table  marketclue        (on-demand, single table, PK/SK strings, TTL attribute "ttl")
S3 bucket       marketclue-data-<acct>  (run results JSON, page snapshots)
SSM parameters  /marketclue/anthropic_api_key (SecureString), /marketclue/session_secret (SecureString)
```

Anthropic: Claude API, model `claude-opus-5-5`, server tools `web_search_20260209` and
`web_fetch_20260209`, `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`).

## Backend layout (`platform/backend/`)

```
app/handler.py     Lambda entry: lambda_handler(event, context). Worker events → pipeline.run(run_id).
                   HTTP events (Function URL payload v2.0) → router.
app/router.py      Routes below; JSON in/out; errors as {"error": {"code", "message"}} with HTTP status.
app/auth.py        Google ID-token verification + session cookie.
app/store.py       DynamoDB + S3 access (signatures below are the contract).
app/quota.py       Free-run rules.
app/settings.py    Env + SSM loading (cached per container).
app/intake.py      Super-agent conversation (Claude).          [owner: Claude main session]
app/pipeline.py    Run pipeline: plan → parallel research → verify → cards → plan/budget → check. [owner: Claude main session]
app/claude.py      Thin wrapper around the anthropic SDK.       [owner: Claude main session]
tests/             pytest; moto for DynamoDB/S3; no network.
requirements.txt   anthropic, pyjwt[crypto], requests, beautifulsoup4
```

### Environment variables

`TABLE_NAME`, `DATA_BUCKET`, `GOOGLE_CLIENT_ID`, `OWNER_EMAILS` (comma separated, unlimited runs),
`FREE_RUNS_PER_USER` (default 1), `MAX_RUNS_PER_DAY` (default 30), `SSM_PREFIX` (default `/marketclue`),
`SELF_FUNCTION_NAME` (for async self-invoke), `STALE_DAYS` (default 90), `SITE_ORIGIN`.

### Auth

- Frontend uses Google Identity Services ("Sign in with Google" button) → gets an ID token (JWT).
- `POST /api/auth/google {"credential": "<id token>"}`: verify RS256 signature with Google JWKS
  (`https://www.googleapis.com/oauth2/v3/certs`, cache keys), `aud == GOOGLE_CLIENT_ID`,
  `iss in {accounts.google.com, https://accounts.google.com}`, not expired, `email_verified`.
  Upsert the user, then set cookie `mc_session` = HS256 JWT `{sub, email, exp: now+7d}` signed with
  `/marketclue/session_secret`; `HttpOnly; Secure; SameSite=Lax; Path=/`.
- Every other `/api/*` route except `GET /api/shared/{token}` and `GET /api/health` requires the cookie → 401 otherwise.
- `POST /api/auth/logout` clears the cookie.

### DynamoDB items (single table `marketclue`)

| PK | SK | Fields |
|---|---|---|
| `USER#<sub>` | `PROFILE` | email, name, picture, created_at, runs_started (int), is_owner (bool) |
| `USER#<sub>` | `CONV#<conv_id>` | messages (list of {role, text, at}), brief (map or null), ready (bool), created_at, updated_at |
| `USER#<sub>` | `RUN#<created_at>#<run_id>` | run_id, title, status, created_at, cost_usd (index row for listing, newest first) |
| `RUN#<run_id>` | `META` | user_sub, conv_id, title, brief, status (`queued`/`running`/`done`/`failed`), stage, agents (map name → {status, note}), cost_usd, error, share_token, created_at, updated_at, result_key |
| `USER#<sub>` | `CARD#<card_id>` | claim, quote, url, source_title, captured_at, type (`sourced`/`unverified`), direction, tags (list), run_ids (list), dedupe_key |
| `SHARE#<token>` | `META` | run_id, created_at |
| `DAY#<yyyy-mm-dd>` | `COUNTER` | runs (int), ttl |

Ids: `uuid4().hex[:12]`. Times: ISO 8601 UTC strings. Run results (the full document) go to S3
`runs/<run_id>.json`; snapshots of fetched page text to `snapshots/<sha1(url)>.txt`.

### store.py contract (used by intake.py / pipeline.py)

```python
upsert_user(sub, email, name, picture) -> dict            # returns PROFILE item
get_user(sub) -> dict | None
get_conversation(sub, conv_id) -> dict | None
save_conversation(sub, conv: dict) -> None                # conv has conv_id, messages, brief, ready
create_run(sub, conv_id, title, brief) -> dict            # writes META + index row, status queued
get_run(run_id) -> dict | None
update_run(run_id, **fields) -> None                      # partial update; also mirrors status/title/cost_usd to the index row
list_runs(sub, limit=50) -> list[dict]
save_result(run_id, result: dict) -> str                  # S3 put, returns key, sets result_key
load_result(run_id) -> dict | None
save_snapshot(url, text) -> str                           # S3 put, returns key
put_cards(sub, cards: list[dict], run_id) -> list[dict]   # dedupe on dedupe_key; existing card gets run_id appended; returns stored cards with card_id
list_cards(sub, q=None, type=None, direction=None) -> list[dict]   # newest first; q = case-insensitive substring over claim/quote/source_title; adds "stale": bool
get_cards(sub, card_ids: list[str]) -> list[dict]
create_share(run_id) -> str                               # token (secrets.token_urlsafe(16)); stored on META too
resolve_share(token) -> dict | None                       # run META
incr_day_counter() -> int
```

dedupe_key = sha1(url_normalized + "\n" + quote_normalized) where normalization lowercases,
collapses whitespace and strips trailing slashes/fragments from the URL.

### Quota (quota.py)

- Owners (email in OWNER_EMAILS): unlimited.
- Everyone else: `FREE_RUNS_PER_USER` runs total (default 1) → afterwards `POST /api/runs` returns 402
  `{"error": {"code": "free_run_used", "message": "..."}}`.
- Global: more than `MAX_RUNS_PER_DAY` runs started today → 429 `daily_limit`.
- Chat (intake) is not counted but limited to 30 messages per conversation and 20 conversations per user.

### HTTP API

All JSON. Times ISO strings.

- `GET /api/health` → `{"ok": true}`
- `POST /api/auth/google` body `{credential}` → `{user}`; `GET /api/me` → `{user}`; `POST /api/auth/logout` → `{ok}`
  - `user` = `{sub, email, name, picture, is_owner, free_runs_left}` (`free_runs_left` null for owners)
- `POST /api/chat` body `{conv_id?: str, message: str}` →
  `{conv_id, reply: str, ready: bool, brief: Brief | null, messages: [...]}`
  Calls `intake.chat(conv: dict, message: str) -> {"reply", "ready", "brief"}` and persists.
- `GET /api/conversations/{conv_id}` → conversation
- `POST /api/runs` body `{conv_id}` → `{run}`; requires conv.ready; enforces quota; creates run,
  then async-invokes the function with `{"worker": "run", "run_id": ...}` (InvocationType Event).
- `GET /api/runs` → `{runs: [...]}`; `GET /api/runs/{run_id}` → `{run, result | null}` (owner only)
- `POST /api/runs/{run_id}/share` → `{token, url}`; `GET /api/shared/{token}` → `{run, result}` (public, read-only; strips user_sub)
- `GET /api/cards?q=&type=&direction=` → `{cards: [...]}`

`Brief` = `{business: str, customer: str, location: str|null, stage: str, budget_usd: number|null,
goal: str, questions: [str]}`.

### Run states shown to the user

`run.stage` ∈ `planning`, `researching`, `verifying`, `planning_marketing`, `checking`, `writing`, `done`.
`run.agents` = map of agent name → `{status: queued|running|done|failed, note}`; research agents are
named after their direction (e.g. "Competitors & prices").

### Result document (`result`)

```json
{
  "title": "...", "generated_at": "...", "brief": {...},
  "summary": [{"text": "...", "kind": "sourced|assumption|estimate", "card_ids": [], "method": ""}],
  "findings": [{"direction": "...", "items": [{"text": "...", "kind": "...", "card_ids": ["..."], "method": ""}]}],
  "cards": [{card}],
  "plan": [{"section": "Customers|Positioning|Pricing|Channels|Content (4 weeks)|Measurement|Brand & compliance",
            "items": [{"text": "...", "kind": "sourced|assumption|estimate", "card_ids": [], "method": "for estimates: how it was computed"}]}],
  "budget": {"currency": "USD", "total": 0,
             "lines": [{"item": "...", "amount": 0, "kind": "sourced|assumption|estimate", "card_ids": [], "method": "..."}]},
  "next_checks": ["what to verify next, specific"],
  "cost": {"usd": 0.0, "input_tokens": 0, "output_tokens": 0, "web_searches": 0, "web_fetches": 0},
  "agents": [{"name": "...", "status": "...", "seconds": 0}],
  "seconds": 0
}
```

Card `type`: `sourced` = the quote was found word for word in the page text we captured; `unverified` =
not found. Only `sourced` cards may back a `sourced` plan item. "Sourced" means the quote is really on
that page; it does not prove the page is right — the UI says so in its help text.

## Frontend (`platform/frontend/`)

Static files only, no build step: `index.html`, `app.js` (ES modules allowed), `styles.css`,
`config.js` (`window.MC_CONFIG = {googleClientId, apiBase: "/api"}`), favicon. Google Identity Services
script from `https://accounts.google.com/gsi/client`. All UI text English. Footer: "MarketClue · Built by
Yuexizi Zhang". Brand: paper `#F4F2EA`, card `#FBFAF5`, ink `#242522`, muted `#5B5E55`, rust `#B13C1C`,
amber `#E3A43B`, sage `#7C8466`, night `#1C2028`, rule `#D9D4C7`; Arial/Helvetica for UI, Cambria/Georgia
italic for quotes. Must work at 1280 px and 390 px wide. Hash routes:

- `#/` landing + Sign in with Google (if not signed in); otherwise redirect to `#/new`.
- `#/new` chat with the super agent: message list, input, "Start research" button enabled when `ready`;
  shows the brief as an editable-looking summary card (read-only is fine).
- `#/runs/<id>` live run view: stage stepper + one row per agent with status, polling every 3 s;
  when done renders the document: summary, findings with card chips, plan, budget table, next checks,
  cost line ("This report cost about $0.42 in AI and search"). Card chip click opens a side panel:
  claim, quote (italic), source link, captured date, type badge, stale badge.
  Kind badges: Sourced (rust), Assumption (amber), Estimate (sage). Share button → copies link.
- `#/library` fact cards: search box, type filter, direction filter, stale badge, "used in" runs.
- `#/runs` list of my runs.
- `#/shared/<token>` read-only document, no sign-in needed.
- Header: logo + nav (New research, Library, My runs) + user avatar menu (Sign out). Shows free runs left.

## Infra (`platform/infra/`)

`template.yaml` (SAM) + `deploy.sh` (build with pip into a package dir, `aws cloudformation package/deploy`,
upload frontend to S3, invalidate CloudFront, put SSM parameters if missing). Profile `marketclue`.
AWS Budget with alerts at $10/$20/$30.

## Cost and safety rails

- Each run: at most 4 research directions, `max_uses` 4 web searches and 3 web fetches per direction,
  `max_content_tokens` 6000 per fetch, effort `medium` for research, `low` for checking.
- Track `usage` of every call; store `cost_usd` on the run (Opus 5.5 $4/$20 per MTok, cache reads $0.20,
  web search $10 per 1,000).
- Robots: we only fetch pages ourselves as a fallback, with a normal user agent, 10 s timeout, 2 MB cap,
  honouring robots.txt.

---

# v2 (2026-11-03): four features and the classic report

Supersedes the parts above where they differ. Architecture is unchanged (Lambda + Claude, no n8n).

## Features

`feature` ∈ `market_check`, `competitor_scan`, `marketing_plan`, `launch_checklist`.

| feature | Name in the UI | Question it answers | Extra report section |
|---|---|---|---|
| `market_check` | Market check | Who buys, and what do they say? | — |
| `competitor_scan` | Competitor & price scan | Who sells this, and for how much? | `table` (price comparison) |
| `marketing_plan` | Marketing plan & budget | How do I get my first customers? | `plan`, `budget` |
| `launch_checklist` | Launch checklist | What do I need before I sell? | `checklist` (official sources first) |

Journey order on the home page: Validate (Market check) → Price (Competitor & price scan) →
Launch (Launch checklist) → Grow (Marketing plan & budget).

## API changes

- `POST /api/chat` body `{conv_id?, message, feature?}`: `feature` is read only when `conv_id` is absent
  (new conversation; default `marketing_plan`). Responses include `"feature"`. `GET /api/conversations/{id}`
  includes `feature`.
- The brief gains `"feature"`. Runs carry it in `run.brief.feature`; `GET /api/runs` rows may include `feature`.

## Result document v2

```json
{
  "version": 2,
  "feature": "competitor_scan",
  "title": "...", "generated_at": "...", "brief": {...},
  "takeaway": {"text": "The main point in 2-3 sentences", "kind": "sourced|assumption|estimate", "card_ids": [], "method": ""},
  "findings": [{"title": "short headline", "text": "1-3 sentences", "kind": "...", "card_ids": [], "method": ""}],
  "table": {"title": "...", "columns": ["Seller", "Product", "Price", "Notes"],
            "rows": [{"cells": ["...", "...", "$54", "..."], "card_ids": ["..."]}]} ,
  "plan": [{"section": "...", "items": [{"text", "kind", "card_ids", "method"}]}],
  "budget": {"currency": "USD", "total": 0, "lines": [{"item", "amount", "kind", "card_ids", "method"}]},
  "checklist": [{"step": "Register your business name", "text": "...", "kind": "...", "card_ids": [], "official": true}],
  "next_steps": [{"text": "what to do", "how": "how to check it"}],
  "missing_evidence": ["what the sources did not show"],
  "coverage": {"directions": 4, "pages_read": 10, "quotes_found": 20, "quotes_total": 20, "claims_narrowed": 3, "relabelled": 2},
  "cards": [{card}], "cost": {...}, "agents": [...], "seconds": 0
}
```

`table` is null except for `competitor_scan`; `plan`/`budget` only for `marketing_plan` (else `[]`/null);
`checklist` only for `launch_checklist` (else `[]`). Findings are shown numbered (1, 2, 3...).

## Report page (like the original MarketClue brief)

1. Title, feature name, date, "N fact cards, M sourced", time taken, Share.
2. **The brief at a glance**: the takeaway with its kind badge and source chips.
3. **Findings**: numbered list; each finding = title, text, kind badge, and a collapsible
   "Sources for finding N" that lists its cards inline (quote in serif italic, source title as link,
   captured date, Sourced/Unverified badge).
4. Feature section: price table (each row's source chips) / marketing plan + 4-week budget table /
   launch checklist (checkbox-style list; "Official source" tag when `official`).
5. **Next steps & missing evidence**: next steps as a numbered list with "How to check" under each;
   missing evidence as a short list.
6. **Evidence coverage**: a small table from `coverage` plus the cost line.
7. All fact cards (collapsed) and About this report (collapsed).

---

# v3 (2026-11-03 evening): history, effort, charts, mockups, modern UI

Supersedes earlier sections where they differ. Feedback from the owner that drives it:
1/5. Conversations and research must survive a closed browser; "New research" needs New and Existing.
2. An effort choice: Quick ↔ Smarter. 3. Charts, tables and projections that help decide.
4. Optional mock pictures (OpenAI image model). 6/7. Modern UI with full accessibility, informed by
the best comparable products. 8. Clearer journey names and order.

## Journey and tool names (replace v2 names in all UI copy)

| feature id | Stage | Tool name | Question |
|---|---|---|---|
| `market_check` | 1 Discover | Find your customers | Who buys, and what do they say? |
| `competitor_scan` | 2 Compare | Check competitors & prices | Who sells this, and for how much? |
| `launch_checklist` | 3 Prepare | Get ready to sell | What do I need before I sell? |
| `marketing_plan` | 4 Grow | Get your first customers | Which channels, and what will it cost? |

"Validate" is dropped: these tools read public evidence; validating demand needs real buyers, which is
what each report's next steps ask the founder to do.

## History and resume (backend + frontend)

- `GET /api/conversations?limit=50` → `{conversations: [{conv_id, feature, title, ready, run_id|null,
  run_status|null, updated_at}]}` newest first. `title` = brief.business, else the first user message (≤80 chars).
- Starting a run stores `run_id` on the conversation (`run_id`, `run_status` mirrored by `update_run`
  when the run has `conv_id`).
- `GET /api/conversations/{id}` returns the full conversation incl. messages, brief, feature, run_id.
- Frontend: an app shell with a left sidebar (collapsible on mobile): "New research" button, then
  "Recent" list (Today / This week / Earlier) mixing conversations in progress and finished reports with
  status chips (Draft, Ready, Running, Done, Failed); "Fact library" link. Selecting an item restores
  the chat (messages + brief) or opens the report. The open conversation id is kept in localStorage so a
  reload returns to it. `#/new` shows two tabs: New (pick a tool) and Existing (the same history list,
  searchable).

## Effort: Quick ↔ Smarter

- `POST /api/runs` body `{conv_id, mode: "quick"|"smarter"}` (default quick). Stored on the run and in
  `result.mode`.
- quick: research agents on `claude-haiku-5-5`, up to 3 directions, 3 page fetches each, writer effort
  medium. ~1.5 min, ~$0.35.
- smarter: research agents on `claude-opus-5-5`, up to 4 directions, 4 fetches each, writer effort high.
  ~3 min, ~$2–2.5.
- Non-owners may only start quick runs (403 `smarter_owner_only`); the UI shows Smarter disabled with a
  one-line reason for them. The UI shows time and cost estimates next to the choice.

## Charts and projections (result v3 additions)

`result.charts`: list of chart specs, rendered client-side as accessible inline SVG (no chart library,
each chart has a title, a one-sentence takeaway caption, data labels, and a visible data table toggle):
`{id, type: "bar"|"stacked_bar"|"range", title, caption, unit: "USD"|"count"|"%", kind:
"sourced"|"estimate", series: [{label, value, low?, high?, card_ids: []}], method}`.
- competitor_scan: price by seller (bar; range when a source gives "from–to"), plus the founder's
  suggested price band as an estimate when the writer proposes one.
- marketing_plan: 4-week budget by line (bar), and a simple projection (estimate): first-month reach and
  sales range from the budget with the method spelled out (e.g. "$60 ads ÷ $0.80 per click × 2–4%
  conversion").
- market_check: how often each buyer theme appears across checked cards (count, sourced).
- launch_checklist: steps by kind (official / other / assumption) as a stacked bar.
- All: evidence coverage (quotes found vs total, pages read) as a small bar.
Charts are built in code from structured writer fields wherever possible, not free-drawn by the model.

## Mock pictures (optional)

- `POST /api/runs/{id}/mockup` body `{prompt_kind: "product"|"listing"|"ad"}` → generates one image with
  the OpenAI Images API (model from env `OPENAI_IMAGE_MODEL`, default `gpt-image-1`), stores it in S3, returns
  `{url, prompt, created_at}`; `GET /api/runs/{id}/mockups` lists them. Requires SSM `/marketclue/openai_api_key`;
  when missing the endpoint returns 503 `mockups_disabled` and the UI hides the button. Owner-only for now;
  max 3 per run. Every image is labelled "AI mock-up — not a real product photo".

## UI direction

Modern, calm, product-grade (think Linear / Perplexity / Elicit quality), not a document page: app shell,
clear hierarchy, generous whitespace, one accent, system or one well-chosen web font, 8-pt spacing grid,
cards only where they mean an object, subtle motion only on user action. Accessibility is non-negotiable:
WCAG 2.2 AA (contrast 4.5:1, focus visible, keyboard everything, landmarks, labelled controls, 44px targets,
reduced motion, the existing reading preferences). Landing keeps the slogan "See the market differently."
but in the new visual language. Footer credit "Built by Yuexizi Zhang".

## Teams (owner invites members; reports and fact cards are shared, conversations are not)

- One team per user for this prototype. A signed-in user can create a team (they become its owner).
- Items: `TEAM#<team_id>/META` {name, owner_sub, created_at}; `TEAM#<team_id>/MEMBER#<sub>` {email, name,
  role owner|member, joined_at}; `TEAM#<team_id>/INVITE#<token>` {email, created_at, expires_at (7 days),
  status pending|accepted|revoked}; `USER#<sub>/PROFILE.team_id`.
- API:
  - `POST /api/team {name}` → create (403 if already in a team). `GET /api/team` → `{team, role, members, invites}`
    (invites only for the owner).
  - `POST /api/team/invites {email}` (owner) → `{token, invite_url, emailed: bool}`. `invite_url` =
    `SITE_ORIGIN/#/join/<token>`. If SES is configured (env `SES_FROM`), also send the invite email and set
    `emailed: true`; otherwise the owner copies the link (UI shows "Copy invite link").
  - `DELETE /api/team/invites/{token}` (owner) revokes. `POST /api/team/join {token}`: the signed-in
    user's Google email must equal the invite email (case-insensitive) → becomes member.
  - `DELETE /api/team/members/{sub}` (owner; cannot remove themself) → removed member loses team access at
    once. `POST /api/team/leave` (member).
  - `GET /api/team/runs` → finished (status done) runs of all current members, newest first, with
    `owner_name`. `GET /api/team/cards?q=&type=&direction=` → fact cards of all current members (deduped by
    dedupe_key, `added_by`).
  - `GET /api/runs/{id}` also allowed for current members of the run owner's team when the run is done.
    Conversations and in-progress runs stay private to their author.
- UI: "Team" page (owner: name, members list with Remove, pending invites with Copy link / Revoke, invite
  form; member: members list and Leave). Library gets "Mine | Team" toggle; My reports gets "Mine | Team".
  `#/join/<token>` page explains the invite and joins after sign-in.

## v3 decisions (owner, 2026-11-03)

- Effort belongs to whoever starts the task: any signed-in user picks Quick or Smarter for their own run
  (no owner-only rule). Guard: at most `MAX_SMARTER_PER_DAY` (default 10) Smarter runs site-wide per day →
  429 `smarter_daily_limit`; the UI then offers Quick. A free user's single free report may be either mode.
- Privacy: conversations and runs that are not finished are visible only to the person who started them.
  Teams share only finished output: done reports (read-only) and fact cards. Members cannot change or
  delete another member's report.
- Invites must work for people who have never signed in: `GET /api/invites/{token}` (public, no auth) →
  `{team_name, inviter_name, email_hint (e.g. "y•••@gmail.com"), status, expires_at}`. `#/join/<token>` shows
  "<inviter> invited you to <team>" with a Google sign-in button when signed out; after sign-in (which
  creates the account) it joins automatically when the Google email matches, otherwise explains which
  email the invite is for and offers to sign in with another account. Expired/revoked invites say so.
- Mock-up images: provider chain in this order — `MOCKUP_PROVIDER=openai` (OpenAI Images API, key in SSM
  `/marketclue/openai_api_key`); a second provider slot `creatorhub` is reserved but not implemented now.
