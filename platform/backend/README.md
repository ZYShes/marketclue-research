# MarketClue backend

Python 3.12 Lambda entry point: `app.handler.lambda_handler`. HTTP requests use
Lambda Function URL payload v2.0. Worker events have the shape
`{"worker": "run", "run_id": "..."}`.

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
systemd-run --user --scope -q -p MemoryMax=4G -p MemorySwapMax=0 \
  .venv/bin/python -m pytest tests -q
```

Tests use moto, local RSA keys and patched Lambda invocation. Socket connections
are blocked. The production Lambda runtime supplies boto3; development installs
it through `requirements-dev.txt`.

Configuration follows `../SPEC.md`. `get_settings()` caches environment values;
its `session_secret` and `anthropic_api_key` properties decrypt and cache their
SSM SecureString independently on first access. AWS clients are created lazily.

## Pipeline integration

- `app/intake.py`, `app/pipeline.py` and `app/claude.py` are minimal placeholders
  for the pipeline engineer. No Claude calls are implemented.
- `intake.chat(conv, message)` receives the existing history without the current
  message. Return `reply`, `ready` and `brief`; the router appends the user and
  assistant messages and persists the conversation. The 30-message cap includes
  both roles, allowing 15 complete exchanges.
- Run creation writes `queued` META and index rows before asynchronous invocation.
  The router reserves quota transactionally; `store.create_run` does not charge
  quota. Scheduling failures mark the run failed and release both counters.
  Owner emails bypass personal quotas and still obey the global daily cap.
- The worker receives only `run_id`. Load the META via `store.get_run`, write
  stage/status/agents/cost through `store.update_run`, and store the document
  using `store.save_result`. Guard duplicate worker deliveries in the pipeline.
- Store methods return business dictionaries with explicit IDs, without PK/SK
  or Decimal values. `update_run` mirrors status/title/cost to the user's index.
  Snapshot keys hash the original URL; card dedupe uses the normalized URL/quote.

The specified UUID card keys and table schema have no unique dedupe index.
Sequential inserts dedupe; simultaneous first inserts from different containers
can create duplicate cards. Conversation quotas and history writes are also
read-time checks without per-conversation locking. These follow the single-user
prototype scope; run quotas use atomic DynamoDB transactions.

## v3 additions (see `../SPEC.md` v3 and Teams)

- `app/charts.py` builds `result.charts` from structured writer fields
  (`table.rows[].price_usd` / `price_high_usd`, `price_band`, `projection`,
  `themes`) plus the checklist and coverage counts. A chart is skipped, never the
  run, when its inputs are missing. Competitor price bars keep only sourced rows
  whose cited quote states the number.
- Run modes live in `pipeline.MODES`; runs without `mode` run as quick.
  `RESEARCH_MODEL` only applies to callers that pass no model.
- `app/mockups.py` calls the OpenAI Images API (`OPENAI_IMAGE_MODEL`, default
  `gpt-image-2`; `OPENAI_IMAGE_SIZE` 1024x1024 and `OPENAI_IMAGE_QUALITY` low by
  default, capped to 1536 px and low/medium; JPEG). The key is read from SSM
  `/marketclue/openai_api_key` on each request until it exists, so adding it
  needs no redeploy. Images are stored at `mockups/<run_id>/<id>.jpg` and served
  through the API (`GET /api/runs/{id}/mockups/{mockup_id}`, cookie-protected,
  same origin), so no presigned URLs expire. `RUN#/MOCKUP#<id>` items hold the
  metadata; META `mockup_count` enforces the limit of 3 atomically and is
  released when generation fails.
- `app/invites.py` sends invite emails with SES v2 when `SES_FROM` is set; a
  failed send returns `emailed: false` and the invite still works.
- Teams add `TEAM#<id>` items as specified plus a lookup item
  `INVITE#<token>/META {team_id}` so a join needs only the token. Team access is
  checked from both profiles' `team_id` on every request, so removing a member
  takes effect at once.

Contract details beyond the spec, all additive:

- `GET /api/conversations/{id}` and `POST /api/chat` also return `run_id` and
  `run_status`; the conversation also has `title`.
- `GET /api/runs` rows include `feature` and `mode`; run META includes `mode`.
- `GET /api/runs/{id}` adds `access: "owner" | "team"`. For `team`, the run has
  `owner_name` and no `conv_id` or `share_token`.
- `POST /api/runs/{id}/mockup` returns `mockup_id`, `prompt_kind` and `label` as
  well; `url` is a same-origin API path. `GET /api/runs/{id}/mockups` returns
  `{mockups, enabled, limit, remaining}`: `enabled` is true only for the site
  owner viewing their own run with the key configured.
- Team routes: `GET /api/team` returns `{team: null, role: null, members: [],
  invites: []}` outside a team; `/api/team/runs` and `/api/team/cards` return
  empty lists. Team cards carry `added_by` (name) and `added_by_sub`.
- Error codes: `invalid_mode` 400, `smarter_daily_limit` 429 (site-wide
  `MAX_SMARTER_PER_DAY` Smarter runs per day, default 10), `mockups_disabled`
  503, `mockups_owner_only` 403, `invalid_prompt_kind` 400, `run_not_done` 409,
  `mockup_limit` 429, `mockup_failed` 502, `already_in_team` 403, `no_team` 404,
  `team_owner_only` 403, `invalid_email` 400, `already_member` 409,
  `invite_limit` 429 (20 open invites), `invite_not_found` 404,
  `invite_unavailable` 410/409, `invite_expired` 410, `invite_email_mismatch`
  403, `cannot_remove_owner` 400, `owner_cannot_leave` 403.

## v4 additions: templates (see `../SPEC.md` v4)

- `app/templates.py` holds `TEMPLATES` (`general`, `ebay`): tools, capabilities, `intake_needs`,
  `source_rules`, `brief_fields` (the eBay brief answers) and per-tool research and writer guidance. General
  adds nothing, so its prompts, schemas and briefs are byte-for-byte the v3 ones (tested).
- `app/capabilities/` is the capability registry. A `Toolbox(capability_ids, run_id)` gives a run's research
  agents the client tool definitions and `result_block()` for the tool-use loop in `claude.research_call`
  (up to 12 turns with tools; without tools the old 4-turn `pause_turn` loop). A later capability can be a
  remote MCP server through the Claude API MCP connector; that plumbing is not built.
- `app/capabilities/ebay.py`: `ebay_search_listings` on the Browse API (`EBAY_US`). Application token from
  the client-credentials grant, cached in memory until a minute before expiry, refreshed once on a 401.
  Identical searches are cached 24 h in DynamoDB (`EBAY#<sha256>/SEARCH`, TTL); concurrent identical searches
  in one run share one call. At most 8 Browse calls per run and `MAX_EBAY_CALLS_PER_DAY` site-wide
  (`DAY#<date>/EBAY_CALLS`); a refused search returns a tool error and the agent carries on with web search.
  30 s timeout, one retry after a timeout, connection error, 429 or 5xx. Every search a run uses (cache hit or
  not) is saved raw to `runs/<run_id>/ebay/<n>.json` with the retrieval time as S3 metadata.
- Listing evidence: each returned item has a `quote_text` ("<title> — $45.00") the agent copies as its quote.
  `pipeline.make_cards` checks a listing FINDING against that item's title and price fields from the snapshot;
  a sourced listing card gets `source_kind: "ebay_api"`, `retrieved_at`, `label` and `snapshot_key`, and a claim
  written in code. eBay item URLs lose their tracking query when compared, and are never fetched as pages.
  A listing card found again in a later run gets the newer check date.
- `app/ebay_report.py`: `cited_listings` (sourced listing cards, cheapest first, max 12), `fee_breakdown`
  (final value fee and per-order fee only from sourced ebay.com help-page cards whose quote states the number;
  amounts, scenarios, break-even and the suggested ceiling are estimates with the method written out) and
  `asking_wording`, which rewrites "sells for" in an eBay writer answer. `app/charts.py` adds
  `asking_prices_chart` and `ebay_costs_chart`.
- Errors: `invalid_template` 400, `template_unavailable` 409 (chat and run start).

Not verified against eBay itself: this environment cannot reach `api.ebay.com`, `developer.ebay.com` or
`www.ebay.com`, and no eBay keys exist here. The request and response shapes follow the Browse API and OAuth
documentation as known on 2026-11-04 and are tested only against a fake (`tests/ebay_fake.py`). Before release,
run one real search with production keys and compare `itemSummaries` fields (`price.value` as a string,
`shippingOptions[].shippingCost`, `itemWebUrl`, `seller.feedbackScore`) and the filter syntax
(`price:[10..50],priceCurrency:USD`, `conditions:{NEW}`) with a live answer; also confirm the US fee and
Promoted Listings help page URLs in `app/templates.py`.

## v5 additions: projects (see `../SPEC.md` v5)

- `app/store.py` adds projects (`PROJECT#<id>/META`, list rows under `USER#<owner>` or `TEAM#<team_id>`,
  run rows `PROJECT#<id>/RUN#<created_at>#<run_id>` written by `create_run`, mirrored by `update_run` for
  status, title and takeaway, and moved by `file_run`) and membership rows `USER#<sub>/TEAMMEMBER#<team_id>`,
  which replace `PROFILE.team_id` (no code reads it any more). The limits are read-time checks: at most 10
  live (not archived) projects per owner (`projects.live_owned`: personal list rows plus the owner's projects
  in each of their teams) and 10 teams per person (membership rows). Two simultaneous creates can pass the
  check together; that matches the prototype's other read-time limits.
- Leaving a team (`router._leave_team`): the team owner, or a member who owns projects in the team, names a
  remaining member (`new_owner_sub`) who becomes owner of those projects and, for a team owner, of the team
  (`store.hand_over_team`, one transaction). The heir's live-project limit is checked first. When the team
  owner removes a member, the member's projects in that team pass to the team owner; any beyond the team
  owner's limit are archived on the way. `GET /api/teams/{id}` reports `leaving` so the UI can ask.
- `app/projects.py` holds the rules: `role()` (owner, team_owner, member or none), the list and detail
  shapes, and the AI context: `intake_context()` (brief + one line per finished report) and
  `research_context()` (brief, latest takeaway per stage, up to 30 project cards: sourced first, then
  most-cited, then newest, cut at 14,000 characters ≈ 4,000 tokens).
- `app/router.py`: a done run is readable by its author or by anyone who can see its project (`access:
  "project"`); unfiled runs are private. `/api/teams/{id}/...` routes take an explicit team; the legacy
  `/api/team/...` routes act on the first team joined. A ready intake brief fills only empty project brief
  fields. A conversation filed in a project the user can no longer see starts its run unfiled.
- `app/pipeline.py`: with a project, the planner prompt gets the context and its schema a `reused` field; the
  writer prompt gets the context with earlier card ids; earlier sourced cards join the reviewer's and the
  charts' known cards; cited ones are added to `result.cards` (`earlier: true`, label "from an earlier report in
  this project", original `captured_at`). `result.project` is set. Without a project nothing changes (tested
  by comparing prompts and schemas). The takeaway (≤300 chars) is stored on run META when a run finishes.
- `infra/migrate_projects.py`: see SPEC "Migration". It imports `app.store`, so its rows have exactly the
  formats the code reads. Run it with `--dry-run` first, then for real before deploying v5 (the v3 code
  ignores the new rows) and once more right after deploying (it files done runs created in between).
  `--drop-profile-team-id` removes the legacy attribute once v5 is live.
- Errors: `project_not_found` 404, `project_owner_only` 403, `project_limit` 429, `team_limit` 429,
  `no_team` 404, `new_owner_required` 400, `invalid_new_owner` 400. `already_in_team` is no longer returned;
  `owner_cannot_leave` 403 now only when the owner is the team's only member.
- Migrated team projects are owned by the team owner and count toward their 10 live projects (the migration
  itself does not check the limit, so an owner can start above it and only has to archive before creating).
