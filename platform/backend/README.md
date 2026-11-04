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
  `gpt-image-1`, 1024x1024 JPEG). The key is read from SSM
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
